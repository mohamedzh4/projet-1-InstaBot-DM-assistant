import type { NoteKind, NoteRow, StorageMode, UserRow } from "../types"
import { inviteCode, nowIso, randomToken } from "./crypto"

type Db = D1Database

function mapUser(row: Record<string, unknown>): UserRow {
  return {
    igsid: String(row.igsid),
    storage_mode: row.storage_mode as StorageMode,
    notion_access_token: (row.notion_access_token as string | null) ?? null,
    notion_database_id: (row.notion_database_id as string | null) ?? null,
    ai_provider: (row.ai_provider as UserRow["ai_provider"]) ?? null,
    ai_api_key: (row.ai_api_key as string | null) ?? null,
    invite_code: String(row.invite_code),
    invited_by: (row.invited_by as string | null) ?? null,
    referral_count: Number(row.referral_count ?? 0),
    story_engaged_on: (row.story_engaged_on as string | null) ?? null,
    ai_used_on: (row.ai_used_on as string | null) ?? null,
    ai_used_count: Number(row.ai_used_count ?? 0),
    credits: Number(row.credits ?? 0),
    credits_earned: Number(row.credits_earned ?? 0),
    username: (row.username as string | null) ?? null,
    messaged_at: (row.messaged_at as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

export async function getUser(db: Db, igsid: string): Promise<UserRow | null> {
  const row = await db.prepare("SELECT * FROM users WHERE igsid = ?").bind(igsid).first()
  return row ? mapUser(row as Record<string, unknown>) : null
}

export async function ensureUser(db: Db, igsid: string): Promise<UserRow> {
  const existing = await getUser(db, igsid)
  if (existing) return existing
  const now = nowIso()
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = inviteCode()
    try {
      await db
        .prepare(
          `INSERT INTO users (igsid, storage_mode, invite_code, referral_count, ai_used_count, created_at, updated_at)
           VALUES (?, 'chat', ?, 0, 0, ?, ?)`,
        )
        .bind(igsid, code, now, now)
        .run()
      const created = await getUser(db, igsid)
      if (created) return created
    } catch {
      continue
    }
  }
  throw new Error("Could not create user")
}

const USER_COLUMNS = [
  "storage_mode",
  "notion_access_token",
  "notion_database_id",
  "ai_provider",
  "ai_api_key",
  "invited_by",
  "referral_count",
  "story_engaged_on",
  "ai_used_on",
  "ai_used_count",
  "credits",
  "credits_earned",
  "username",
  "messaged_at",
] as const

export async function updateUser(
  db: Db,
  igsid: string,
  patch: Partial<
    Pick<
      UserRow,
      | "storage_mode"
      | "notion_access_token"
      | "notion_database_id"
      | "ai_provider"
      | "ai_api_key"
      | "invited_by"
      | "referral_count"
      | "story_engaged_on"
      | "ai_used_on"
      | "ai_used_count"
      | "credits"
      | "credits_earned"
      | "username"
      | "messaged_at"
    >
  >,
): Promise<void> {
  const fields: string[] = []
  const values: unknown[] = []
  for (const key of USER_COLUMNS) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue
    fields.push(`${key} = ?`)
    values.push(patch[key])
  }
  if (fields.length === 0) return
  fields.push("updated_at = ?")
  values.push(nowIso(), igsid)
  await db
    .prepare(`UPDATE users SET ${fields.join(", ")} WHERE igsid = ?`)
    .bind(...values)
    .run()
}

export async function findByInvite(db: Db, code: string): Promise<UserRow | null> {
  const row = await db
    .prepare("SELECT * FROM users WHERE invite_code = ?")
    .bind(code.toUpperCase())
    .first()
  return row ? mapUser(row as Record<string, unknown>) : null
}

export async function insertNote(
  db: Db,
  igsid: string,
  kind: NoteKind,
  title: string,
  body: string,
): Promise<NoteRow> {
  const row: NoteRow = {
    id: crypto.randomUUID(),
    igsid,
    kind,
    title: title.slice(0, 200),
    body: body.slice(0, 20000),
    created_at: nowIso(),
  }
  await db
    .prepare("INSERT INTO notes (id, igsid, kind, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(row.id, row.igsid, row.kind, row.title, row.body, row.created_at)
    .run()
  return row
}

export async function listNotes(db: Db, igsid: string, kind?: NoteKind): Promise<NoteRow[]> {
  const sql = kind
    ? "SELECT * FROM notes WHERE igsid = ? AND kind = ? ORDER BY created_at DESC LIMIT 30"
    : "SELECT * FROM notes WHERE igsid = ? ORDER BY created_at DESC LIMIT 30"
  const stmt = kind ? db.prepare(sql).bind(igsid, kind) : db.prepare(sql).bind(igsid)
  const { results } = await stmt.all<NoteRow>()
  return results ?? []
}

export async function createSettingsToken(db: Db, igsid: string): Promise<string> {
  const token = randomToken(24)
  const expiresAt = Date.now() + 30 * 60 * 1000
  await db
    .prepare("INSERT INTO settings_tokens (token, igsid, expires_at) VALUES (?, ?, ?)")
    .bind(token, igsid, expiresAt)
    .run()
  return token
}

export async function getSettingsToken(
  db: Db,
  token: string,
): Promise<{ igsid: string } | null> {
  const row = await db
    .prepare("SELECT igsid, expires_at FROM settings_tokens WHERE token = ?")
    .bind(token)
    .first<{ igsid: string; expires_at: number }>()
  if (!row || Number(row.expires_at) < Date.now()) return null
  return { igsid: row.igsid }
}

export async function alreadyProcessed(db: Db, mid: string): Promise<boolean> {
  const row = await db.prepare("SELECT mid FROM processed_messages WHERE mid = ?").bind(mid).first()
  return Boolean(row)
}

export async function markProcessed(db: Db, mid: string): Promise<void> {
  await db
    .prepare("INSERT OR IGNORE INTO processed_messages (mid, created_at) VALUES (?, ?)")
    .bind(mid, nowIso())
    .run()
}
