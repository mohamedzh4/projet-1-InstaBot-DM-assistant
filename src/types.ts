export type Bindings = {
  DB: D1Database
  PUBLIC_URL: string
  IG_VERIFY_TOKEN: string
  IG_APP_SECRET: string
  IG_ACCESS_TOKEN: string
  ENCRYPTION_KEY: string
  IG_GRAPH_MESSAGES_URL?: string
  BOT_NAME?: string
  GROQ_API_KEY?: string
  GEMINI_API_KEY?: string
  OPENAI_API_KEY?: string
  CREDIT_STORY_REPLY?: string
  CREDIT_STORY_MENTION?: string
  CREDIT_COMMENT?: string
  CREDIT_MENTION?: string
  CREDIT_INVITE?: string
  CREDIT_AI_TEXT?: string
  CREDIT_AI_MEDIA?: string
  CREDIT_BRAIN_MIN?: string
  CREDIT_WELCOME?: string
  NOTION_CLIENT_ID?: string
  NOTION_CLIENT_SECRET?: string
  ALLOW_DEV_INBOX?: string
  DEV_INBOX_SECRET?: string
}

export type StorageMode = "chat" | "server" | "notion"
export type NoteKind = "note" | "watch_later" | "steps"
export type AiProvider = "groq" | "gemini" | "openai" | "local"
export type CreditKind =
  | "story_reply"
  | "story_mention"
  | "post_comment"
  | "live_comment"
  | "mention"
  | "invite"
  | "welcome"

export type UserRow = {
  igsid: string
  storage_mode: StorageMode
  notion_access_token: string | null
  notion_database_id: string | null
  ai_provider: AiProvider | null
  ai_api_key: string | null
  invite_code: string
  invited_by: string | null
  referral_count: number
  story_engaged_on: string | null
  ai_used_on: string | null
  ai_used_count: number
  credits: number
  credits_earned: number
  username: string | null
  messaged_at: string | null
  created_at: string
  updated_at: string
}

export type NoteRow = {
  id: string
  igsid: string
  kind: NoteKind
  title: string
  body: string
  created_at: string
}

export type Command =
  | { type: "help" }
  | { type: "settings" }
  | { type: "invite" }
  | { type: "join"; code: string }
  | { type: "list"; kind: NoteKind | "all" }
  | { type: "mode"; mode: StorageMode }
  | { type: "credits" }

export type AiIntent = {
  action: "save_note" | "watch_later" | "steps" | "show" | "chat"
  title?: string
  content?: string
  items?: string[]
  list?: "notes" | "watch_later" | "steps" | "all"
  reply?: string
}
