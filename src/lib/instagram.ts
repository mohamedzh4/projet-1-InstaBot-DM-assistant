import { hmacSha256Hex, timingSafeEqual } from "./crypto"
import type { Bindings } from "../types"
import { recordReply } from "./replies"

const IG_TEXT_LIMIT = 900

export function verifyWebhookChallenge(
  url: URL,
  verifyToken: string,
): string | null {
  const mode = url.searchParams.get("hub.mode")
  const token = url.searchParams.get("hub.verify_token")
  const challenge = url.searchParams.get("hub.challenge")
  if (mode === "subscribe" && token && verifyToken && timingSafeEqual(token, verifyToken) && challenge) {
    return challenge
  }
  return null
}

export async function verifyInstagramSignature(
  appSecret: string,
  rawBody: string,
  header: string | null,
): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false
  const expected = header.slice("sha256=".length).toLowerCase()
  const actual = (await hmacSha256Hex(appSecret, rawBody)).toLowerCase()
  return timingSafeEqual(actual, expected)
}

export function splitMessage(text: string): string[] {
  if (text.length <= IG_TEXT_LIMIT) return [text]
  const chunks: string[] = []
  let rest = text
  while (rest.length > 0) {
    chunks.push(rest.slice(0, IG_TEXT_LIMIT))
    rest = rest.slice(IG_TEXT_LIMIT)
  }
  return chunks
}

export async function sendInstagramText(
  env: Bindings,
  igsid: string,
  text: string,
): Promise<void> {
  recordReply(env, text)
  if (!env.IG_ACCESS_TOKEN) {
    if (env.ALLOW_DEV_INBOX === "true") return
    throw new Error("IG_ACCESS_TOKEN is required")
  }
  const url = env.IG_GRAPH_MESSAGES_URL || "https://graph.instagram.com/v21.0/me/messages"
  for (const part of splitMessage(text)) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.IG_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipient: { id: igsid },
        messaging_type: "RESPONSE",
        message: { text: part },
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Instagram send failed: ${res.status} ${body.slice(0, 300)}`)
    }
  }
}

export type IgAttachment = {
  type?: string
  payload?: { url?: string; title?: string }
}

export type IgMessagingEvent = {
  sender?: { id?: string }
  recipient?: { id?: string }
  timestamp?: number
  message?: {
    mid?: string
    text?: string
    is_echo?: boolean
    attachments?: IgAttachment[]
    reply_to?: { story?: { url?: string; id?: string } }
    referral?: { ref?: string; source?: string; type?: string }
  }
  referral?: { ref?: string; source?: string; type?: string }
  postback?: {
    title?: string
    payload?: string
    referral?: { ref?: string; source?: string; type?: string }
  }
}

export type IgChangeEvent = {
  field?: string
  value?: {
    from?: { id?: string; username?: string }
    comment_id?: string
    parent_id?: string
    text?: string
    media?: { id?: string }
  }
}
