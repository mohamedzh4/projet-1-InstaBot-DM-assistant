ALTER TABLE users ADD COLUMN credits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN credits_earned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN messaged_at TEXT;

CREATE TABLE credit_events (
  id TEXT PRIMARY KEY,
  igsid TEXT NOT NULL,
  kind TEXT NOT NULL,
  amount INTEGER NOT NULL,
  source_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_credit_events_igsid ON credit_events (igsid);
