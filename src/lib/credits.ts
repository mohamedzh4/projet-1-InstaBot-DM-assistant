import type { Bindings, CreditKind, UserRow } from "../types"
import { nowIso } from "./crypto"
import { ensureUser, findByInvite, getUser, updateUser } from "./db"

export function envInt(env: Bindings, key: string, fallback: number): number {
  const raw = (env as unknown as Record<string, unknown>)[key]
  if (typeof raw !== "string" || raw.trim() === "") return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

export function creditAmounts(env: Bindings): Record<CreditKind, number> {
  return {
    story_reply: envInt(env, "CREDIT_STORY_REPLY", 2),
    story_mention: envInt(env, "CREDIT_STORY_MENTION", 4),
    post_comment: envInt(env, "CREDIT_COMMENT", 2),
    live_comment: envInt(env, "CREDIT_COMMENT", 2),
    mention: envInt(env, "CREDIT_MENTION", 3),
    invite: envInt(env, "CREDIT_INVITE", 5),
    welcome: envInt(env, "CREDIT_WELCOME", 0),
  }
}

export function aiCost(env: Bindings, hasMedia: boolean): number {
  return hasMedia ? envInt(env, "CREDIT_AI_MEDIA", 2) : envInt(env, "CREDIT_AI_TEXT", 1)
}

export function brainMinEarned(env: Bindings): number {
  return envInt(env, "CREDIT_BRAIN_MIN", 1)
}

export function isBrainUnlocked(user: UserRow, env: Bindings): boolean {
  return user.credits_earned >= brainMinEarned(env)
}

export function earnHint(env: Bindings, bot: string): string {
  const a = creditAmounts(env)
  return `Follow @${bot} first (Instagram cannot tell us follows, so set the account to “followers can message”).

Earn credits:
• Reply to our story (+${a.story_reply}, once per story)
• Tag @${bot} in your story (+${a.story_mention})
• Comment on our post (+${a.post_comment})
• Friend opens your invite link (+${a.invite} for you)

Likes and “share to a friend” without them opening the link cannot be seen by Instagram’s API.`
}

export type AwardResult = { awarded: boolean; amount: number; credits: number; user: UserRow }

export async function awardCredit(
  env: Bindings,
  igsid: string,
  kind: CreditKind,
  sourceId: string,
): Promise<AwardResult> {
  const amount = creditAmounts(env)[kind]
  const user = await ensureUser(env.DB, igsid)
  if (amount <= 0) return { awarded: false, amount: 0, credits: user.credits, user }

  const insert = await env.DB.prepare(
    `INSERT OR IGNORE INTO credit_events (id, igsid, kind, amount, source_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), igsid, kind, amount, sourceId.slice(0, 180), nowIso())
    .run()
  if ((insert.meta?.changes ?? 0) === 0) {
    const latest = (await getUser(env.DB, igsid)) || user
    return { awarded: false, amount: 0, credits: latest.credits, user: latest }
  }

  await env.DB.prepare(
    `UPDATE users SET credits = credits + ?, credits_earned = credits_earned + ?, updated_at = ? WHERE igsid = ?`,
  )
    .bind(amount, amount, nowIso(), igsid)
    .run()

  const latest = (await getUser(env.DB, igsid)) || {
    ...user,
    credits: user.credits + amount,
    credits_earned: user.credits_earned + amount,
  }
  return { awarded: true, amount, credits: latest.credits, user: latest }
}

export async function spendCredits(env: Bindings, user: UserRow, cost: number): Promise<UserRow | null> {
  if (cost <= 0) return user
  if (user.credits < cost) return null
  const result = await env.DB.prepare(
    `UPDATE users SET credits = credits - ?, updated_at = ? WHERE igsid = ? AND credits >= ?`,
  )
    .bind(cost, nowIso(), user.igsid, cost)
    .run()
  if (!result.success || (result.meta?.changes ?? 0) === 0) return null
  return { ...user, credits: user.credits - cost }
}

export function inviteLink(env: { BOT_NAME?: string }, code: string): string {
  const name = (env.BOT_NAME || "instabot").replace(/^@/, "")
  return `https://ig.me/m/${encodeURIComponent(name)}?ref=${encodeURIComponent(code)}`
}

export function sanitizeInviteRef(ref: string | undefined | null): string | null {
  if (!ref) return null
  const code = ref.trim().toUpperCase()
  if (!/^[A-Z0-9]{4,12}$/.test(code)) return null
  return code
}

export async function applyInvite(
  env: Bindings,
  friend: UserRow,
  code: string,
): Promise<{ friend: UserRow; message: string; inviter?: UserRow; awarded: boolean }> {
  if (friend.invite_code === code) {
    return { friend, message: "That's your own invite link.", awarded: false }
  }
  if (friend.invited_by) {
    return { friend, message: "You already used an invite.", awarded: false }
  }
  const owner = await findByInvite(env.DB, code)
  if (!owner) return { friend, message: "Unknown invite.", awarded: false }
  if (owner.igsid === friend.igsid) {
    return { friend, message: "That's your own invite link.", awarded: false }
  }

  await updateUser(env.DB, friend.igsid, { invited_by: owner.igsid })
  await updateUser(env.DB, owner.igsid, { referral_count: owner.referral_count + 1 })
  const award = await awardCredit(env, owner.igsid, "invite", `invite:${friend.igsid}`)
  const friendLatest = (await getUser(env.DB, friend.igsid)) || friend
  return {
    friend: friendLatest,
    inviter: award.user,
    awarded: award.awarded,
    message: award.awarded
      ? `You're in via ${owner.invite_code}. They earned +${award.amount} credits.`
      : "You're in. That invite was already counted.",
  }
}
