const NOTION_VERSION = "2022-06-28"

type NotionSearchResult = {
  results?: {
    object?: string
    id?: string
    parent?: { type?: string }
    properties?: { title?: { title?: { plain_text?: string }[] } }
  }[]
}

async function notionFetch(token: string, path: string, init?: RequestInit) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
      ...(init?.headers || {}),
    },
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`Notion ${res.status}: ${body.slice(0, 280)}`)
  return body ? (JSON.parse(body) as unknown) : null
}

export async function exchangeNotionCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<string> {
  const basic = btoa(`${clientId}:${clientSecret}`)
  const res = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  })
  const json = (await res.json()) as { access_token?: string; error?: string }
  if (!res.ok || !json.access_token) {
    throw new Error(json.error || "Notion OAuth failed")
  }
  return json.access_token
}

export function notionAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    owner: "user",
    redirect_uri: redirectUri,
    state,
  })
  return `https://api.notion.com/v1/oauth/authorize?${params.toString()}`
}

export async function ensureNotionDatabase(token: string): Promise<string> {
  const search = (await notionFetch(token, "/search", {
    method: "POST",
    body: JSON.stringify({ query: "InstaBot", page_size: 20 }),
  })) as NotionSearchResult

  const existingDb = search.results?.find((r) => r.object === "database")
  if (existingDb?.id) return existingDb.id

  const page = search.results?.find((r) => r.object === "page")
  if (!page?.id) {
    throw new Error("Pick a Notion page during connect so InstaBot can create a database there.")
  }

  const created = (await notionFetch(token, "/databases", {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "page_id", page_id: page.id },
      title: [{ type: "text", text: { content: "InstaBot" } }],
      properties: {
        Name: { title: {} },
        Type: {
          select: {
            options: [
              { name: "Note", color: "blue" },
              { name: "Watch later", color: "purple" },
              { name: "Steps", color: "green" },
            ],
          },
        },
        Body: { rich_text: {} },
      },
    }),
  })) as { id?: string }

  if (!created.id) throw new Error("Could not create Notion database")
  return created.id
}

export async function addNotionItem(
  token: string,
  databaseId: string,
  typeLabel: "Note" | "Watch later" | "Steps",
  title: string,
  body: string,
): Promise<void> {
  const children =
    body.length > 1800
      ? body.match(/[\s\S]{1,1800}/g)?.map((chunk) => ({
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: [{ type: "text", text: { content: chunk } }] },
        }))
      : [
          {
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [{ type: "text", text: { content: body.slice(0, 1800) } }],
            },
          },
        ]

  await notionFetch(token, "/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties: {
        Name: { title: [{ type: "text", text: { content: title.slice(0, 200) } }] },
        Type: { select: { name: typeLabel } },
        Body: {
          rich_text: [{ type: "text", text: { content: body.slice(0, 1800) } }],
        },
      },
      children,
    }),
  })
}

export async function listNotionItems(
  token: string,
  databaseId: string,
  typeLabel?: "Note" | "Watch later" | "Steps",
): Promise<{ title: string; body: string }[]> {
  const filter = typeLabel
    ? { property: "Type", select: { equals: typeLabel } }
    : undefined
  const json = (await notionFetch(token, `/databases/${databaseId}/query`, {
    method: "POST",
    body: JSON.stringify({
      page_size: 20,
      ...(filter ? { filter } : {}),
      sorts: [{ timestamp: "created_time", direction: "descending" }],
    }),
  })) as {
    results?: {
      properties?: {
        Name?: { title?: { plain_text?: string }[] }
        Body?: { rich_text?: { plain_text?: string }[] }
      }
    }[]
  }
  return (json.results || []).map((page) => ({
    title: page.properties?.Name?.title?.[0]?.plain_text || "Untitled",
    body: page.properties?.Body?.rich_text?.map((t) => t.plain_text || "").join("") || "",
  }))
}
