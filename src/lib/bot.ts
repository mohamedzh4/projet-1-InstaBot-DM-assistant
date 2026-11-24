import type { AiIntent, Bindings, NoteKind, StorageMode, UserRow } from "../types"
import { interpretMessage, isCreditLimitError, resolveAi, downloadMedia, transcribeMedia } from "./ai"
import { modeLabel, parseCommand } from "./commands"
import {
  aiCost,
  applyInvite,
  awardCredit,
  earnHint,
  inviteLink,
  isBrainUnlocked,
  sanitizeInviteRef,
  spendCredits,
} from "./credits"
import { decryptSecret, nowIso, utcDate } from "./crypto"
import {
  alreadyProcessed,
  createSettingsToken,
  ensureUser,
  getUser,
  insertNote,
  listNotes,
  markProcessed,
  updateUser,
} from "./db"
import { type IgMessagingEvent, sendInstagramText } from "./instagram"
import { addNotionItem, listNotionItems } from "./notion"
import { brainUnlockHint } from "./unlock"

function helpText(env: Bindings, user: UserRow, bot: string): string {
  return `Follow @${bot}, then use this chat.

Save modes:
• chat — I reply and forget (default)
• brain — I keep it here (${brainUnlockHint(user, env)})
• notion — your Notion, optional page

Commands:
help · credits · settings · invite · join CODE
list · watch later · steps
save chat · save brain · save notion

Credits: ${user.credits} (earned ${user.credits_earned})
${earnHint(env, bot)}

Invite link:
${inviteLink(env, user.invite_code)}`
}

function settingsUrl(env: Bindings, token: string): string {
  return `${env.PUBLIC_URL.replace(/\/$/, "")}/s/${token}`
}

async function openSettings(env: Bindings, igsid: string): Promise<string> {
  if (!env.PUBLIC_URL) {
    return "Settings page is not available yet (PUBLIC_URL missing on the server)."
  }
  const token = await createSettingsToken(env.DB, igsid)
  return `Optional page (Notion + your AI key). You can ignore it and stay in the chat:\n${settingsUrl(env, token)}\n\nExpires in 30 minutes. Send settings again if it expires.`
}

function formatNotes(rows: { title: string; body: string }[], empty: string): string {
  if (rows.length === 0) return empty
  return rows
    .slice(0, 15)
    .map((n, i) => `${i + 1}. ${n.title}${n.body ? `\n${n.body.slice(0, 180)}` : ""}`)
    .join("\n\n")
}

async function showList(env: Bindings, user: UserRow, kind: NoteKind | "all"): Promise<string> {
  if (user.storage_mode === "chat") {
    return "You're in chat mode — I don't keep lists. Send `save brain` or `save notion` (after connecting), then save again."
  }
  if (user.storage_mode === "notion") {
    if (!user.notion_access_token || !user.notion_database_id) {
      return "Notion is not connected. Send settings and login, or use `save chat` / `save brain`."
    }
    const token = await decryptSecret(user.notion_access_token, env.ENCRYPTION_KEY)
    const label =
      kind === "watch_later" ? "Watch later" : kind === "steps" ? "Steps" : kind === "note" ? "Note" : undefined
    const items = await listNotionItems(token, user.notion_database_id, label)
    return formatNotes(items, "Nothing in Notion yet.")
  }
  const k = kind === "all" ? undefined : kind
  const items = await listNotes(env.DB, user.igsid, k)
  return formatNotes(
    items.map((n) => ({ title: n.title, body: n.body })),
    "Nothing saved in the brain yet.",
  )
}

async function persist(
  env: Bindings,
  user: UserRow,
  kind: NoteKind,
  title: string,
  body: string,
): Promise<{ extra: string }> {
  if (user.storage_mode === "chat") return { extra: "" }

  if (user.storage_mode === "server") {
    if (!isBrainUnlocked(user, env)) {
      return { extra: `\n\nNot saved in the brain. ${brainUnlockHint(user, env)}` }
    }
    await insertNote(env.DB, user.igsid, kind, title, body)
    return { extra: "\n\nSaved in the brain." }
  }

  if (!user.notion_access_token || !user.notion_database_id) {
    return { extra: "\n\nNotion is not connected. Send settings to login, or `save chat`." }
  }
  const token = await decryptSecret(user.notion_access_token, env.ENCRYPTION_KEY)
  const label = kind === "watch_later" ? "Watch later" : kind === "steps" ? "Steps" : "Note"
  await addNotionItem(token, user.notion_database_id, label, title, body)
  return { extra: "\n\nSaved in your Notion." }
}

async function setMode(env: Bindings, user: UserRow, mode: StorageMode): Promise<string> {
  if (mode === "server" && !isBrainUnlocked(user, env)) {
    return `Brain is locked. ${brainUnlockHint(user, env)}`
  }
  if (mode === "notion" && (!user.notion_access_token || !user.notion_database_id)) {
    return `Connect Notion first (optional):\n${await openSettings(env, user.igsid)}`
  }
  await updateUser(env.DB, user.igsid, { storage_mode: mode })
  return `Save mode is now ${modeLabel(mode)}.`
}

async function mediaTranscript(
  env: Bindings,
  user: UserRow,
  event: IgMessagingEvent,
): Promise<string | undefined> {
  const attachments = event.message?.attachments || []
  const bits: string[] = []
  const storyUrl = event.message?.reply_to?.story?.url
  if (storyUrl) bits.push(`(story url) ${storyUrl}`)

  const ai = await resolveAi(env, user)
  if ("error" in ai) {
    for (const att of attachments) {
      if (att.payload?.title) bits.push(att.payload.title)
      if (att.payload?.url) bits.push(att.payload.url)
    }
    return bits.length ? bits.join("\n") : undefined
  }

  for (const att of attachments) {
    if (att.payload?.title) bits.push(att.payload.title)
    const url = att.payload?.url
    if (!url) continue
    const media = await downloadMedia(url)
    if (!media) {
      bits.push(url)
      continue
    }
    const name = att.type === "audio" ? "audio.mp3" : "reel.mp4"
    const text = await transcribeMedia(ai, media.bytes, name, media.mime)
    bits.push(text || url)
  }
  return bits.length ? bits.join("\n\n") : undefined
}

function intentToSave(intent: AiIntent): { kind: NoteKind; title: string; body: string } | null {
  if (intent.action === "watch_later") {
    const items = intent.items?.length ? intent.items : intent.content ? [intent.content] : []
    if (items.length === 0) return null
    return {
      kind: "watch_later",
      title: intent.title || "Watch later",
      body: items.map((x, i) => `${i + 1}. ${x}`).join("\n"),
    }
  }
  if (intent.action === "steps") {
    const body = intent.content || intent.items?.map((x, i) => `${i + 1}. ${x}`).join("\n")
    if (!body) return null
    return { kind: "steps", title: intent.title || "Steps", body }
  }
  if (intent.action === "save_note") {
    const body = intent.content || intent.items?.join("\n")
    if (!body) return null
    return { kind: "note", title: intent.title || "Note", body }
  }
  return null
}

function referralCode(event: IgMessagingEvent): string | null {
  return sanitizeInviteRef(
    event.referral?.ref || event.message?.referral?.ref || event.postback?.referral?.ref,
  )
}

async function handleInviteArrival(env: Bindings, user: UserRow, event: IgMessagingEvent): Promise<UserRow> {
  const code = referralCode(event)
  if (!code) return user
  const result = await applyInvite(env, user, code)
  if (result.awarded && result.inviter?.messaged_at) {
    await sendInstagramText(
      env,
      result.inviter.igsid,
      `A friend opened your invite. +credits. Balance: ${result.inviter.credits}.`,
    ).catch(() => {})
  }
  return result.friend
}

async function handleAiTurn(
  env: Bindings,
  user: UserRow,
  text: string,
  event: IgMessagingEvent,
): Promise<void> {
  const ai = await resolveAi(env, user)
  if ("error" in ai) {
    await sendInstagramText(env, user.igsid, `${ai.error}\n\n${await openSettings(env, user.igsid)}`)
    return
  }

  const hasMedia = Boolean(event.message?.attachments?.length)
  // Only the shared paid AI costs credits; the built-in local extractor and a
  // user's own key are free. Check the balance now, but charge only after the
  // AI call succeeds so failures and empty results never cost anything.
  const cost = ai.shared && ai.provider !== "local" ? aiCost(env, hasMedia) : 0
  if (cost > 0 && user.credits < cost) {
    const bot = env.BOT_NAME || "instabot"
    await sendInstagramText(
      env,
      user.igsid,
      `Not enough credits (${user.credits}, need ${cost}). Earn more, or add your own AI key.\n\n${earnHint(env, bot)}\n\n${await openSettings(env, user.igsid)}`,
    )
    return
  }

  const transcript = await mediaTranscript(env, user, event)
  if (!text && !transcript) {
    await sendInstagramText(env, user.igsid, "Send a text, a Reel, or a video. Send help for commands.")
    return
  }

  try {
    const intent = await interpretMessage(ai, text, transcript)
    if (cost > 0) {
      const paid = await spendCredits(env, user, cost)
      if (paid) user = paid
    }

    if (intent.action === "show") {
      const kind =
        intent.list === "watch_later"
          ? "watch_later"
          : intent.list === "steps"
            ? "steps"
            : intent.list === "notes"
              ? "note"
              : "all"
      await sendInstagramText(env, user.igsid, await showList(env, user, kind))
      return
    }

    const save = intentToSave(intent)
    if (!save) {
      await sendInstagramText(env, user.igsid, intent.reply || "Got it.")
      return
    }

    const result = await persist(env, user, save.kind, save.title, save.body)
    const preview =
      user.storage_mode === "chat"
        ? `${intent.reply || "Here it is:"}\n\n${save.title}\n${save.body}`
        : `${intent.reply || "Done."}${result.extra}\n\n${save.title}\n${save.body.slice(0, 500)}`
    await sendInstagramText(env, user.igsid, preview)
  } catch (err) {
    if (isCreditLimitError(err)) {
      await sendInstagramText(
        env,
        user.igsid,
        `The AI provider hit its limit. Add your own key or earn credits and try later.\n\n${await openSettings(env, user.igsid)}`,
      )
      return
    }
    console.error(err)
    await sendInstagramText(env, user.igsid, "I couldn't process that. Try text only, or send help.")
  }
}

export async function handleMessagingEvent(env: Bindings, event: IgMessagingEvent): Promise<void> {
  if (event.message?.is_echo) return
  const igsid = event.sender?.id
  if (!igsid) return
  const mid = event.message?.mid
  if (mid) {
    if (await alreadyProcessed(env.DB, mid)) return
    await markProcessed(env.DB, mid)
  }

  let user = await ensureUser(env.DB, igsid)
  if (!user.messaged_at) {
    await updateUser(env.DB, igsid, { messaged_at: nowIso() })
    await awardCredit(env, igsid, "welcome", `welcome:${igsid}`)
    user = (await getUser(env.DB, igsid)) || user
  }

  user = await handleInviteArrival(env, user, event)

  const storyId = event.message?.reply_to?.story?.id
  if (storyId || event.message?.reply_to?.story) {
    const source = storyId || mid || `story:${utcDate()}`
    const award = await awardCredit(env, igsid, "story_reply", `story_reply:${igsid}:${source}`)
    await updateUser(env.DB, igsid, { story_engaged_on: utcDate() })
    user = award.user
    if (award.awarded && !event.message?.text && !event.message?.attachments?.length && !referralCode(event)) {
      await sendInstagramText(
        env,
        igsid,
        `+${award.amount} credits for the story reply. Balance: ${award.credits}. ${brainUnlockHint(user, env)}`,
      )
      return
    }
  }

  const mention = (event.message?.attachments || []).find((a) => a.type === "story_mention")
  if (mention) {
    const source = mention.payload?.url || mid || "mention"
    const award = await awardCredit(env, igsid, "story_mention", `story_mention:${igsid}:${source}`)
    user = award.user
    if (award.awarded && !event.message?.text) {
      await sendInstagramText(
        env,
        igsid,
        `+${award.amount} credits for tagging us in your story. Balance: ${award.credits}.`,
      )
      return
    }
  }

  const text = (event.message?.text || "").trim()
  const cmd = text ? parseCommand(text) : null
  const bot = env.BOT_NAME || "instabot"

  if (cmd?.type === "help") {
    await sendInstagramText(env, igsid, helpText(env, user, bot))
    return
  }
  if (cmd?.type === "credits") {
    await sendInstagramText(env, igsid, `Balance: ${user.credits} (earned ${user.credits_earned}).\n\n${earnHint(env, bot)}`)
    return
  }
  if (cmd?.type === "settings") {
    await sendInstagramText(env, igsid, await openSettings(env, igsid))
    return
  }
  if (cmd?.type === "invite") {
    await sendInstagramText(
      env,
      igsid,
      `Share this link. You get credits when a friend opens it and messages the bot:\n${inviteLink(env, user.invite_code)}\n\nOr they can send: join ${user.invite_code}\nFriends so far: ${user.referral_count}`,
    )
    return
  }
  if (cmd?.type === "join") {
    const joined = await applyInvite(env, user, cmd.code)
    if (joined.awarded && joined.inviter?.messaged_at) {
      await sendInstagramText(
        env,
        joined.inviter.igsid,
        `A friend used your code. Balance: ${joined.inviter.credits}.`,
      ).catch(() => {})
    }
    await sendInstagramText(env, igsid, joined.message)
    return
  }
  if (cmd?.type === "list") {
    await sendInstagramText(env, igsid, await showList(env, user, cmd.kind))
    return
  }
  if (cmd?.type === "mode") {
    await sendInstagramText(env, igsid, await setMode(env, user, cmd.mode))
    return
  }

  if (!text && !event.message?.attachments?.length) {
    if (referralCode(event)) {
      await sendInstagramText(env, igsid, helpText(env, user, bot))
    }
    return
  }

  await handleAiTurn(env, user, text, event)
}
