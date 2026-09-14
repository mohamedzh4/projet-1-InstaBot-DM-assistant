CREATE TABLE users (
  igsid TEXT PRIMARY KEY,
  storage_mode TEXT NOT NULL DEFAULT 'chat',
  notion_access_token TEXT,
  notion_database_id TEXT,
  ai_provider TEXT,
  ai_api_key TEXT,
  invite_code TEXT NOT NULL UNIQUE,
  invited_by TEXT,
  referral_count INTEGER NOT NULL DEFAULT 0,
  story_engaged_on TEXT,
  ai_used_on TEXT,
  ai_used_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  igsid TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (igsid) REFERENCES users (igsid)
);

CREATE TABLE settings_tokens (
  token TEXT PRIMARY KEY,
  igsid TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE processed_messages (
  mid TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_notes_igsid_kind ON notes (igsid, kind);
CREATE INDEX idx_users_invite ON users (invite_code);
CREATE INDEX idx_tokens_igsid ON settings_tokens (igsid);
