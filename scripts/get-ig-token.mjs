import { createInterface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const varsPath = join(root, ".dev.vars")

function parseVars(text: string): Record<string, string> {
  const out = {}
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

function upsertVar(text: string, key: string, value: string): string {
  const line = `${key}="${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
  const re = new RegExp(`^${key}=.*$`, "m")
  if (re.test(text)) return text.replace(re, line)
  return `${text.replace(/\s*$/, "")}\n${line}\n`
}

function extractCode(raw) {
  const trimmed = raw.trim().replace(/#_$/, "")
  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `https://localhost/?${trimmed}`)
    const fromQuery = parsed.searchParams.get("code")
    if (fromQuery) return fromQuery
  } catch {
    /* fall through */
  }
  const match = trimmed.match(/(?:^|[?&])code=([^&#\s]+)/)
  if (!match?.[1]) {
    throw new Error("No code found. Copy the full address bar after login (it contains ?code=).")
  }
  return decodeURIComponent(match[1])
}

async function readJson(res) {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Instagram returned non-JSON (${res.status}): ${text.slice(0, 240)}`)
  }
}

const env = existsSync(varsPath) ? parseVars(readFileSync(varsPath, "utf8")) : {}
const appId = (process.env.INSTAGRAM_APP_ID || env.INSTAGRAM_APP_ID || "").trim()
const secret = (process.env.IG_APP_SECRET || env.IG_APP_SECRET || "").trim()
const redirectUri = (process.env.IG_OAUTH_REDIRECT_URI || env.IG_OAUTH_REDIRECT_URI || "https://localhost/").trim()

if (!appId || !secret) {
  console.error(`Missing INSTAGRAM_APP_ID or IG_APP_SECRET.

1. Meta → Instagram → API setup with Instagram login → 4. Set up Instagram business login
2. OAuth redirect URI exactly: ${redirectUri}
3. Put Instagram app ID and Instagram app secret (not Facebook App ID/Secret) in .dev.vars
4. Run: npm run ig-token
`)
  process.exit(1)
}

const authorize = new URL("https://www.instagram.com/oauth/authorize")
authorize.searchParams.set("client_id", appId)
authorize.searchParams.set("redirect_uri", redirectUri)
authorize.searchParams.set("response_type", "code")
authorize.searchParams.set(
  "scope",
  "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments",
)

const rl = createInterface({ input, output })
console.log("Meta Generate token is broken. Use Instagram login instead.\n")
console.log("1. Open this URL in Chrome (log in as the bot Instagram):\n")
console.log(authorize.toString())
console.log("\n2. After Allow, the page https://localhost/ will fail to load. That is OK.")
console.log("3. Copy the FULL address bar and paste it below.\n")
const pasted = await rl.question("Paste URL: ")
rl.close()

const code = extractCode(pasted)
const form = new FormData()
form.set("client_id", appId)
form.set("client_secret", secret)
form.set("grant_type", "authorization_code")
form.set("redirect_uri", redirectUri)
form.set("code", code)

const shortRes = await fetch("https://api.instagram.com/oauth/access_token", { method: "POST", body: form })
const shortBody = await readJson(shortRes)
if (!shortRes.ok || typeof shortBody.access_token !== "string") {
  const message = shortBody.error_message || shortBody.error_type || JSON.stringify(shortBody)
  throw new Error(`Short-lived token failed: ${message}`)
}

const longUrl = new URL("https://graph.instagram.com/access_token")
longUrl.searchParams.set("grant_type", "ig_exchange_token")
longUrl.searchParams.set("client_secret", secret)
longUrl.searchParams.set("access_token", shortBody.access_token)
const longRes = await fetch(longUrl)
const longBody = await readJson(longRes)
if (!longRes.ok || typeof longBody.access_token !== "string") {
  const message = longBody.error?.message || longBody.error_message || JSON.stringify(longBody)
  throw new Error(`Long-lived token failed: ${message}`)
}

if (existsSync(varsPath)) {
  const next = upsertVar(readFileSync(varsPath, "utf8"), "IG_ACCESS_TOKEN", longBody.access_token)
  writeFileSync(varsPath, next)
  console.log("\nSaved IG_ACCESS_TOKEN to .dev.vars (gitignored). Do not paste it in chat.")
} else {
  console.log("\nToken received. Put it in IG_ACCESS_TOKEN yourself. Do not paste it in chat.")
}
if (typeof longBody.expires_in === "number") {
  console.log(`Expires in about ${Math.round(longBody.expires_in / 86400)} days.`)
}
