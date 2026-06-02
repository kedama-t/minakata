CREATE TABLE IF NOT EXISTS global_messages (
  id          TEXT PRIMARY KEY,
  author_type TEXT NOT NULL CHECK (author_type IN ('user', 'agent')),
  author_id   TEXT,
  author_name TEXT NOT NULL,
  content     TEXT NOT NULL,
  is_final    INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  claimed_at  TEXT,
  claimed_by  TEXT
);
CREATE INDEX IF NOT EXISTS idx_global_messages_created   ON global_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_global_messages_unclaimed ON global_messages(claimed_at) WHERE claimed_at IS NULL;
