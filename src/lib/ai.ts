import type { AiIntent, AiProvider, Bindings, UserRow } from "../types"
import { decryptSecret } from "./crypto"
import { interpretLocal } from "./local-ai"

const GROQ_CHAT = "https://api.groq.com/openai/v1/chat/completions"
const GROQ_WHISPER = "https://api.groq.com/openai/v1/audio/transcriptions"
const OPENAI_CHAT = "https://api.openai.com/v1/chat/completions"
const OPENAI_WHISPER = "https://api.openai.com/v1/audio/transcriptions"
const MAX_MEDIA_BYTES = 12_000_000

type ResolvedAi = {
  provider: AiProvider
  key: string
  shared: boolean
}

export async function resolveAi(
  env: Bindings,
  user: UserRow,
): Promise<ResolvedAi | { error: string }> {
  if (user.ai_api_key && user.ai_provider) {
    try {
      const key = await decryptSecret(user.ai_api_key, env.ENCRYPTION_KEY)
      return { provider: user.ai_provider, key, shared: false }
    } catch {
      return { error: "Your saved API key could not be read. Open settings and paste it again." }
    }
  }
  if (env.GROQ_API_KEY) return { provider: "groq", key: env.GROQ_API_KEY, shared: true }
  if (env.GEMINI_API_KEY) return { provider: "gemini", key: env.GEMINI_API_KEY, shared: true }
  if (env.OPENAI_API_KEY) return { provider: "openai", key: env.OPENAI_API_KEY, shared: true }
  return { provider: "local", key: "", shared: true }
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/\{[\s\S]*\}/)
  const jsonText = fenced ? fenced[0] : trimmed
  try {
    const parsed = JSON.parse(jsonText) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return null
  }
  return null
}

function toIntent(data: Record<string, unknown>, fallbackReply: string): AiIntent {
  const action = String(data.action || "chat")
  const allowed: AiIntent["action"][] = ["save_note", "watch_later", "steps", "show", "chat"]
  return {
    action: allowed.includes(action as AiIntent["action"])
      ? (action as AiIntent["action"])
      : "chat",
    title: typeof data.title === "string" ? data.title : undefined,
    content: typeof data.content === "string" ? data.content : undefined,
    items: Array.isArray(data.items)
      ? data.items.filter((x): x is string => typeof x === "string").slice(0, 40)
      : undefined,
    list:
      data.list === "notes" ||
      data.list === "watch_later" ||
      data.list === "steps" ||
      data.list === "all"
        ? data.list
        : undefined,
    reply: typeof data.reply === "string" ? data.reply : fallbackReply,
  }
}

const SYSTEM = `You are InstaBot, an Instagram DM assistant. Read the user message (and optional video transcript). Reply in the same language as the user.
Return ONLY JSON:
{
  "action": "save_note" | "watch_later" | "steps" | "show" | "chat",
  "title": "short title",
  "content": "note or numbered steps",
  "items": ["film or item names when action is watch_later"],
  "list": "notes" | "watch_later" | "steps" | "all",
  "reply": "short DM the user will see"
}
Rules:
- watch_later: lists of films, series, songs, places to try later.
- steps: tutorials / how-to. Put a clean numbered list in content.
- save_note: anything to remember.
- show: they want to see saved items.
- chat: greeting or question that does not save.
- reply must confirm what you extracted, briefly.`

async function chatGroqOrOpenAi(
  url: string,
  key: string,
  model: string,
  userContent: string,
): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userContent },
      ],
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`AI HTTP ${res.status}: ${body.slice(0, 240)}`)
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  return json.choices?.[0]?.message?.content || ""
}

async function chatGemini(key: string, userContent: string): Promise<string> {
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: userContent }] }],
        generationConfig: { temperature: 0.2 },
      }),
    },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 240)}`)
  }
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  return json.candidates?.[0]?.content?.parts?.[0]?.text || ""
}

export async function interpretMessage(
  ai: ResolvedAi,
  userText: string,
  transcript?: string,
): Promise<AiIntent> {
  const userContent = transcript
    ? `User message:\n${userText || "(no text, media only)"}\n\nTranscript / media text:\n${transcript}`
    : `User message:\n${userText}`

  if (ai.provider === "local") return interpretLocal(userText, transcript)

  let raw = ""
  if (ai.provider === "groq") {
    raw = await chatGroqOrOpenAi(GROQ_CHAT, ai.key, "llama-3.3-70b-versatile", userContent)
  } else if (ai.provider === "openai") {
    raw = await chatGroqOrOpenAi(OPENAI_CHAT, ai.key, "gpt-4o-mini", userContent)
  } else {
    raw = await chatGemini(ai.key, userContent)
  }
  const parsed = parseJsonObject(raw)
  if (!parsed) {
    return {
      action: userText ? "save_note" : "chat",
      title: "Note",
      content: transcript || userText,
      reply: raw.slice(0, 700) || "Saved.",
    }
  }
  return toIntent(parsed, "Done.")
}

export async function transcribeMedia(
  ai: ResolvedAi,
  bytes: Uint8Array,
  filename: string,
  mime: string,
): Promise<string | null> {
  const form = new FormData()
  const blob = new Blob([bytes], { type: mime || "application/octet-stream" })
  form.append("file", blob, filename)

  if (ai.provider === "groq") {
    form.append("model", "whisper-large-v3-turbo")
    const res = await fetch(GROQ_WHISPER, {
      method: "POST",
      headers: { Authorization: `Bearer ${ai.key}` },
      body: form,
    })
    if (!res.ok) return null
    const json = (await res.json()) as { text?: string }
    return json.text?.trim() || null
  }
  if (ai.provider === "openai") {
    form.append("model", "whisper-1")
    const res = await fetch(OPENAI_WHISPER, {
      method: "POST",
      headers: { Authorization: `Bearer ${ai.key}` },
      body: form,
    })
    if (!res.ok) return null
    const json = (await res.json()) as { text?: string }
    return json.text?.trim() || null
  }
  return null
}

export async function downloadMedia(url: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const res = await fetch(url, {
    headers: { "User-Agent": "InstaBot/1.0" },
  })
  if (!res.ok) return null
  const len = Number(res.headers.get("content-length") || "0")
  if (len > MAX_MEDIA_BYTES) return null
  const mime = res.headers.get("content-type") || "application/octet-stream"
  const buf = await res.arrayBuffer()
  if (buf.byteLength > MAX_MEDIA_BYTES) return null
  return { bytes: new Uint8Array(buf), mime }
}

export function isCreditLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /429|rate limit|quota|insufficient_quota|resource_exhausted/i.test(msg)
}
