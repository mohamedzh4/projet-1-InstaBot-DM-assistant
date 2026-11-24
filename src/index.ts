import { Hono } from "hono"
import type { AiProvider, Bindings } from "./types"
import { handleMessagingEvent } from "./lib/bot"
import { handleInstagramChange } from "./lib/growth"
import { encryptSecret, timingSafeEqual } from "./lib/crypto"
import { ensureUser, getSettingsToken, getUser, updateUser } from "./lib/db"
import {
  type IgChangeEvent,
  type IgMessagingEvent,
  sendInstagramText,
  verifyInstagramSignature,
  verifyWebhookChallenge,
} from "./lib/instagram"
import { ensureNotionDatabase, exchangeNotionCode, notionAuthorizeUrl } from "./lib/notion"
import { parseMode, settingsPageHtml } from "./lib/settings-page"
import { inviteLink, isBrainUnlocked } from "./lib/credits"
import { repliesOf, wrapEnv } from "./lib/replies"
import { devChatPage } from "./lib/dev-page"
import {
  exchangeInstagramCode,
  exchangeLongLivedToken,
  extractInstagramCode,
  igOauthRedirectUri,
  igSetupPageHtml,
  instagramAuthorizeUrl,
} from "./lib/ig-oauth"

const app = new Hono<{ Bindings: Bindings }>()

function notionRedirectUri(env: Bindings): string {
  return `${env.PUBLIC_URL.replace(/\/$/, "")}/auth/notion/callback`
}

function igOauthAllowed(env: Bindings): boolean {
  return env.ALLOW_DEV_INBOX === "true" || env.ALLOW_IG_OAUTH_SETUP === "true"
}

function html(
  body: string,
  status = 200,
  extraCsp = "",
) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'${extraCsp}`,
    },
  })
}

app.get("/", (c) => {
  if (c.env.ALLOW_DEV_INBOX === "true") return c.redirect("/dev")
  return c.text("InstaBot lives in Instagram DMs. Send the account a message.")
})

app.get("/dev", (c) => {
  if (c.env.ALLOW_DEV_INBOX !== "true" || !c.env.DEV_INBOX_SECRET) return c.text("off", 404)
  return html(
    devChatPage(c.env.DEV_INBOX_SECRET),
    200,
    "; script-src 'unsafe-inline'; connect-src 'self'",
  )
})

app.get("/setup/ig", (c) => {
  if (!igOauthAllowed(c.env)) return c.text("off", 404)
  const appId = (c.env.INSTAGRAM_APP_ID || "").trim()
  const secret = (c.env.IG_APP_SECRET || "").trim()
  const redirectUri = igOauthRedirectUri(c.env.IG_OAUTH_REDIRECT_URI)
  return html(
    igSetupPageHtml({
      configured: Boolean(appId && secret),
      authorizeUrl: appId ? instagramAuthorizeUrl(appId, redirectUri) : undefined,
      redirectUri,
      error: c.req.query("error") || undefined,
    }),
    200,
    "; script-src 'unsafe-inline'",
  )
})

app.get("/setup/ig/start", (c) => {
  if (!igOauthAllowed(c.env)) return c.text("off", 404)
  const appId = (c.env.INSTAGRAM_APP_ID || "").trim()
  const secret = (c.env.IG_APP_SECRET || "").trim()
  const redirectUri = igOauthRedirectUri(c.env.IG_OAUTH_REDIRECT_URI)
  if (!appId || !secret) return c.redirect("/setup/ig")
  return c.redirect(instagramAuthorizeUrl(appId, redirectUri))
})

app.post("/setup/ig/exchange", async (c) => {
  if (!igOauthAllowed(c.env)) return c.text("off", 404)
  const appId = (c.env.INSTAGRAM_APP_ID || "").trim()
  const secret = (c.env.IG_APP_SECRET || "").trim()
  const redirectUri = igOauthRedirectUri(c.env.IG_OAUTH_REDIRECT_URI)
  if (!appId || !secret) {
    return html(igSetupPageHtml({ configured: false, redirectUri, error: "Add INSTAGRAM_APP_ID and IG_APP_SECRET first." }))
  }
  const form = await c.req.parseBody()
  const callback = typeof form.callback === "string" ? form.callback : ""
  try {
    const code = extractInstagramCode(callback)
    const shortLived = await exchangeInstagramCode({ appId, appSecret: secret, redirectUri, code })
    const longLived = await exchangeLongLivedToken({
      appSecret: secret,
      shortLivedToken: shortLived.accessToken,
    })
    return html(
      igSetupPageHtml({
        configured: true,
        redirectUri,
        token: longLived.accessToken,
        expiresIn: longLived.expiresIn,
        userId: shortLived.userId,
      }),
      200,
      "; script-src 'unsafe-inline'",
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token exchange failed"
    return html(
      igSetupPageHtml({
        configured: true,
        redirectUri,
        error: message.slice(0, 400),
      }),
    )
  }
})

app.get("/webhook", (c) => {
  const challenge = verifyWebhookChallenge(new URL(c.req.url), c.env.IG_VERIFY_TOKEN || "")
  if (!challenge) return c.text("forbidden", 403)
  return c.text(challenge)
})

app.post("/webhook", async (c) => {
  const raw = await c.req.text()
  const signature = c.req.header("X-Hub-Signature-256")
  const devHeader = c.req.header("X-Dev-Secret")
  const allowDev =
    c.env.ALLOW_DEV_INBOX === "true" &&
    Boolean(c.env.DEV_INBOX_SECRET) &&
    Boolean(devHeader) &&
    timingSafeEqual(devHeader || "", c.env.DEV_INBOX_SECRET || "")

  if (!allowDev) {
    if (!c.env.IG_APP_SECRET) return c.text("misconfigured", 500)
    const ok = await verifyInstagramSignature(c.env.IG_APP_SECRET, raw, signature || null)
    if (!ok) return c.text("bad signature", 401)
  }

  let payload: {
    object?: string
    entry?: { id?: string; messaging?: IgMessagingEvent[]; changes?: IgChangeEvent[] }[]
  }
  try {
    payload = JSON.parse(raw) as typeof payload
  } catch {
    return c.text("invalid json", 400)
  }

  const messaging = (payload.entry || []).flatMap((e) => e.messaging || [])
  const changes = (payload.entry || []).flatMap((e) =>
    (e.changes || []).map((change) => ({ businessId: e.id, change })),
  )
  c.executionCtx.waitUntil(
    Promise.all([
      ...messaging.map((event) => handleMessagingEvent(c.env, event)),
      ...changes.map(({ businessId, change }) => handleInstagramChange(c.env, businessId, change)),
    ]).catch((err) => {
      console.error(err)
    }),
  )
  return c.text("ok")
})

app.post("/dev/inbox", async (c) => {
  if (c.env.ALLOW_DEV_INBOX !== "true") return c.text("off", 404)
  const secret = c.req.header("X-Dev-Secret") || ""
  if (!c.env.DEV_INBOX_SECRET || !timingSafeEqual(secret, c.env.DEV_INBOX_SECRET)) {
    return c.json({ error: "forbidden" }, 403)
  }
  const body = (await c.req.json()) as {
    igsid?: string
    text?: string
    storyId?: string
    storyMention?: boolean
    comment?: boolean
    commentId?: string
    friendClick?: boolean
  }
  if (!body.igsid || typeof body.igsid !== "string" || body.igsid.length > 80) {
    return c.json({ error: "igsid required" }, 400)
  }

  const igsid = body.igsid

  const env = wrapEnv(c.env)
  const mid = `dev-${crypto.randomUUID()}`

  if (body.comment) {
    await handleInstagramChange(env, "local-bot", {
      field: "comments",
      value: {
        from: { id: igsid, username: "local" },
        comment_id: String(body.commentId || mid),
        text: "nice",
        media: { id: "post-1" },
      },
    })
  }

  if (body.friendClick) {
    const host = await ensureUser(env.DB, igsid)
    await handleMessagingEvent(env, {
      sender: { id: `friend-${crypto.randomUUID().slice(0, 8)}` },
      referral: { ref: host.invite_code, source: "SHORTLINKS", type: "OPEN_THREAD" },
      message: { mid: `dev-${crypto.randomUUID()}`, text: "help" },
    })
  }

  if (body.storyId || body.storyMention || body.text !== undefined) {
    await handleMessagingEvent(env, {
      sender: { id: igsid },
      message: {
        mid,
        text: body.text,
        attachments: body.storyMention
          ? [{ type: "story_mention", payload: { url: "https://example.com/story" } }]
          : undefined,
        reply_to: body.storyId ? { story: { id: body.storyId, url: "https://example.com/story" } } : undefined,
      },
    })
  }

  const user = await getUser(env.DB, igsid)
  return c.json({
    replies: repliesOf(env),
    user: user
      ? {
          credits: user.credits,
          credits_earned: user.credits_earned,
          invite_code: user.invite_code,
          storage_mode: user.storage_mode,
        }
      : null,
  })
})

app.get("/s/:token", async (c) => {
  const token = c.req.param("token")
  const found = await getSettingsToken(c.env.DB, token)
  if (!found) return c.text("This link expired. Send settings in Instagram.", 410)
  const user = await ensureUser(c.env.DB, found.igsid)
  const saved = c.req.query("saved")
  const error = c.req.query("error")
  return html(
    settingsPageHtml({
      token,
      user,
      notionEnabled: Boolean(c.env.NOTION_CLIENT_ID && c.env.NOTION_CLIENT_SECRET),
      inviteUrl: inviteLink(c.env, user.invite_code),
      brainOpen: isBrainUnlocked(user, c.env),
      saved: saved ? "Saved." : undefined,
      error: error ? decodeURIComponent(error) : undefined,
    }),
  )
})

app.post("/s/:token", async (c) => {
  const token = c.req.param("token")
  const found = await getSettingsToken(c.env.DB, token)
  if (!found) return c.text("This link expired. Send settings in Instagram.", 410)
  if (!c.env.ENCRYPTION_KEY) return c.text("ENCRYPTION_KEY is required", 500)

  const form = await c.req.formData()
  const user = await ensureUser(c.env.DB, found.igsid)

  if (form.get("disconnect_notion") === "1") {
    const nextMode = user.storage_mode === "notion" ? "chat" : user.storage_mode
    await updateUser(c.env.DB, user.igsid, {
      notion_access_token: null,
      notion_database_id: null,
      storage_mode: nextMode,
    })
    return c.redirect(`/s/${token}?saved=1`)
  }

  const mode = parseMode(form.get("storage_mode"))
  if (mode === "server" && !isBrainUnlocked(user, c.env)) {
    return c.redirect(`/s/${token}?error=${encodeURIComponent("Brain is locked. Earn growth credits first (story reply, comment, or invite).")}`)
  }
  if (mode === "notion" && (!user.notion_access_token || !user.notion_database_id)) {
    return c.redirect(`/s/${token}?error=${encodeURIComponent("Connect Notion first, or pick chat / brain.")}`)
  }

  const providerRaw = String(form.get("ai_provider") || "")
  const provider: AiProvider | null =
    providerRaw === "groq" || providerRaw === "gemini" || providerRaw === "openai"
      ? providerRaw
      : user.ai_provider === "local"
        ? null
        : user.ai_provider

  const clearKey = form.get("clear_key") === "1"
  const pasted = String(form.get("ai_api_key") || "").trim()
  if (pasted.length > 400) {
    return c.redirect(`/s/${token}?error=${encodeURIComponent("API key is too long.")}`)
  }

  let ai_api_key = user.ai_api_key
  let ai_provider = provider
  if (clearKey) {
    ai_api_key = null
    ai_provider = null
  } else if (pasted) {
    ai_api_key = await encryptSecret(pasted, c.env.ENCRYPTION_KEY)
    ai_provider = provider || "groq"
  }

  await updateUser(c.env.DB, user.igsid, {
    ...(mode ? { storage_mode: mode } : {}),
    ai_provider,
    ai_api_key,
  })
  return c.redirect(`/s/${token}?saved=1`)
})

app.get("/s/:token/notion", async (c) => {
  const token = c.req.param("token")
  const found = await getSettingsToken(c.env.DB, token)
  if (!found) return c.text("This link expired. Send settings in Instagram.", 410)
  if (!c.env.NOTION_CLIENT_ID || !c.env.PUBLIC_URL) {
    return c.text("Notion is not configured on this bot.", 501)
  }
  const url = notionAuthorizeUrl(c.env.NOTION_CLIENT_ID, notionRedirectUri(c.env), token)
  return c.redirect(url)
})

app.get("/auth/notion/callback", async (c) => {
  const state = c.req.query("state") || ""
  const code = c.req.query("code") || ""
  const oauthError = c.req.query("error")
  const found = state ? await getSettingsToken(c.env.DB, state) : null
  if (!found) return c.text("Session expired. Send settings in Instagram and try Notion again.", 410)
  if (oauthError) {
    return c.redirect(`/s/${state}?error=${encodeURIComponent("Notion login was cancelled.")}`)
  }
  if (!code || !c.env.NOTION_CLIENT_ID || !c.env.NOTION_CLIENT_SECRET || !c.env.ENCRYPTION_KEY) {
    return c.redirect(`/s/${state}?error=${encodeURIComponent("Notion is not configured.")}`)
  }
  try {
    const access = await exchangeNotionCode(
      c.env.NOTION_CLIENT_ID,
      c.env.NOTION_CLIENT_SECRET,
      code,
      notionRedirectUri(c.env),
    )
    const databaseId = await ensureNotionDatabase(access)
    const encrypted = await encryptSecret(access, c.env.ENCRYPTION_KEY)
    const user = await getUser(c.env.DB, found.igsid)
    await updateUser(c.env.DB, found.igsid, {
      notion_access_token: encrypted,
      notion_database_id: databaseId,
      storage_mode: user?.storage_mode === "notion" ? "notion" : user?.storage_mode || "chat",
    })
    await sendInstagramText(
      c.env,
      found.igsid,
      "Notion is connected. Send `save notion` if you want new items there.",
    ).catch(() => {})
    return c.redirect(`/s/${state}?saved=1`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Notion connect failed"
    return c.redirect(`/s/${state}?error=${encodeURIComponent(msg.slice(0, 180))}`)
  }
})

export default app
