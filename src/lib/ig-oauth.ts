const DEFAULT_REDIRECT = "https://localhost/"
const SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
].join(",")

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

export function igOauthRedirectUri(configured?: string): string {
  const value = (configured || DEFAULT_REDIRECT).trim()
  return value || DEFAULT_REDIRECT
}

export function instagramAuthorizeUrl(appId: string, redirectUri: string): string {
  const url = new URL("https://www.instagram.com/oauth/authorize")
  url.searchParams.set("client_id", appId)
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", SCOPES)
  return url.toString()
}

export function extractInstagramCode(raw: string): string {
  const trimmed = raw.trim().replace(/#_$/, "")
  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `https://localhost/?${trimmed}`)
    const fromQuery = parsed.searchParams.get("code")
    if (fromQuery) return fromQuery
  } catch {
    /* fall through */
  }
  const match = trimmed.match(/(?:^|[?&])code=([^&#\s]+)/)
  if (!match?.[1]) throw new Error("No code found. Copy the full address bar after Instagram login, including ?code=...")
  return decodeURIComponent(match[1])
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text()
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(`Instagram returned non-JSON (${res.status}): ${text.slice(0, 240)}`)
  }
}

function igErrorMessage(body: Record<string, unknown>, status: number): string {
  const nested = body.error
  const message =
    (typeof body.error_message === "string" && body.error_message) ||
    (nested && typeof nested === "object" && "message" in nested && typeof nested.message === "string"
      ? nested.message
      : "") ||
    (typeof body.error_type === "string" && body.error_type) ||
    `HTTP ${status}`
  if (/redirect_uri/i.test(message)) {
    return `${message} The redirect URI in Meta must be exactly https://localhost/ (slash at the end).`
  }
  if (/client_id|app id|invalid platform/i.test(message)) {
    return `${message} Use the Instagram app ID and Instagram app secret from the Instagram product page, not the Facebook App ID/Secret.`
  }
  return message
}

export async function exchangeInstagramCode(opts: {
  appId: string
  appSecret: string
  redirectUri: string
  code: string
}): Promise<{ accessToken: string; userId?: string }> {
  const form = new FormData()
  form.set("client_id", opts.appId)
  form.set("client_secret", opts.appSecret)
  form.set("grant_type", "authorization_code")
  form.set("redirect_uri", opts.redirectUri)
  form.set("code", opts.code)
  const res = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    body: form,
  })
  const body = await readJson(res)
  if (!res.ok || typeof body.access_token !== "string") {
    throw new Error(igErrorMessage(body, res.status))
  }
  return {
    accessToken: body.access_token,
    userId: typeof body.user_id === "string" || typeof body.user_id === "number" ? String(body.user_id) : undefined,
  }
}

export async function exchangeLongLivedToken(opts: {
  appSecret: string
  shortLivedToken: string
}): Promise<{ accessToken: string; expiresIn?: number }> {
  const url = new URL("https://graph.instagram.com/access_token")
  url.searchParams.set("grant_type", "ig_exchange_token")
  url.searchParams.set("client_secret", opts.appSecret)
  url.searchParams.set("access_token", opts.shortLivedToken)
  const res = await fetch(url)
  const body = await readJson(res)
  if (!res.ok || typeof body.access_token !== "string") {
    throw new Error(igErrorMessage(body, res.status))
  }
  return {
    accessToken: body.access_token,
    expiresIn: typeof body.expires_in === "number" ? body.expires_in : undefined,
  }
}

export function igSetupPageHtml(opts: {
  configured: boolean
  authorizeUrl?: string
  redirectUri: string
  error?: string
  token?: string
  expiresIn?: number
  userId?: string
}): string {
  const days =
    opts.expiresIn && opts.expiresIn > 0 ? Math.max(1, Math.round(opts.expiresIn / 86400)) : undefined
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Instagram token</title>
  <style>
    :root { color-scheme: dark; }
    body { margin:0; font-family: ui-sans-serif, system-ui, sans-serif; background:#0b0b0f; color:#f4f4f5; min-height:100vh; }
    main { max-width: 32rem; margin: 0 auto; padding: 1.25rem; }
    h1 { font-size: 1.25rem; margin: 0 0 .35rem; }
    p.lead, .meta, ol { color:#a1a1aa; font-size:.92rem; line-height:1.5; }
    ol { padding-left: 1.2rem; }
    section { background:#14141b; border:1px solid #27272a; border-radius:16px; padding:1rem; margin:1rem 0; }
    h2 { font-size:.95rem; margin:0 0 .75rem; }
    input, textarea { width:100%; box-sizing:border-box; background:#0b0b0f; color:#fff; border:1px solid #3f3f46;
      border-radius:10px; padding:.7rem .75rem; font-size:.95rem; }
    textarea { min-height: 5.5rem; font-family: ui-monospace, monospace; }
    button, .btn { display:inline-block; width:100%; box-sizing:border-box; text-align:center; text-decoration:none;
      background:#fff; color:#000; border:0; border-radius:12px; padding:.8rem; font-weight:650; font-size:.95rem;
      margin-top:.75rem; }
    .btn.ghost { background:transparent; color:#fff; border:1px solid #3f3f46; }
    .ok { background:#052e16; color:#86efac; padding:.65rem .75rem; border-radius:10px; margin-bottom:1rem; font-size:.9rem; }
    .err { background:#450a0a; color:#fecaca; padding:.65rem .75rem; border-radius:10px; margin-bottom:1rem; font-size:.9rem; }
    code { background:#27272a; padding:.1rem .35rem; border-radius:6px; }
  </style>
</head>
<body>
<main>
  <h1>Get the Instagram token</h1>
  <p class="lead">Meta’s <strong>Generate token</strong> button is broken. This page uses Instagram login instead. Do not paste the token into chat.</p>
  ${opts.error ? `<div class="err">${esc(opts.error)}</div>` : ""}
  ${
    opts.token
      ? `<div class="ok">Long-lived token ready${days ? ` (~${days} days)` : ""}${opts.userId ? ` · user ${esc(opts.userId)}` : ""}. Copy it into <code>IG_ACCESS_TOKEN</code> in <code>.dev.vars</code>, then later <code>wrangler secret put IG_ACCESS_TOKEN</code>.</div>
  <section>
    <h2>IG_ACCESS_TOKEN</h2>
    <textarea readonly id="tok">${esc(opts.token)}</textarea>
    <button type="button" onclick="navigator.clipboard.writeText(document.getElementById('tok').value)">Copy token</button>
  </section>`
      : ""
  }
  ${
    opts.configured
      ? `<section>
    <h2>1. Log in as the bot</h2>
    <p class="meta">Redirect URI in Meta must be exactly <code>${esc(opts.redirectUri)}</code>. Log in as <strong>dm_instabot</strong>, not your personal Instagram.</p>
    <a class="btn" href="/setup/ig/start">Log in with Instagram</a>
  </section>
  <section>
    <h2>2. Paste the address bar</h2>
    <p class="meta">After Allow, the browser will fail to load <code>https://localhost/</code>. That is expected. Copy the <strong>full URL</strong> (it contains <code>?code=</code>) and paste it here.</p>
    <form method="post" action="/setup/ig/exchange">
      <textarea name="callback" placeholder="https://localhost/?code=AQA..." required></textarea>
      <button type="submit">Exchange code for token</button>
    </form>
  </section>`
      : `<section>
    <h2>Missing Instagram app ID / secret</h2>
    <p class="meta">In Meta: Instagram → API setup with Instagram login → <strong>4. Set up Instagram business login</strong>.</p>
    <ol>
      <li>OAuth redirect URI: <code>${esc(opts.redirectUri)}</code></li>
      <li>Copy <strong>Instagram app ID</strong> (not Facebook App ID) into <code>INSTAGRAM_APP_ID</code> in <code>.dev.vars</code></li>
      <li>Copy <strong>Instagram app secret</strong> (not App settings → Basic) into <code>IG_APP_SECRET</code></li>
      <li>Restart <code>npm run local</code> and refresh this page</li>
    </ol>
  </section>`
  }
</main>
</body>
</html>`
}
