-- Minakata 初期スキーマ
-- ファイル名は 0001_init.sql。順序は数字昇順で適用。冪等にするため CREATE IF NOT EXISTS を多用。

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

-- ユーザー
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('viewer','editor','admin')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('viewer','editor','admin')),
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  invited_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

-- 購読トピック
CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  keywords_json TEXT NOT NULL DEFAULT '[]',
  priority_sources_json TEXT NOT NULL DEFAULT '[]',
  exclusion_json TEXT NOT NULL DEFAULT '[]',
  depth TEXT NOT NULL DEFAULT 'shallow' CHECK (depth IN ('shallow','deep')),
  format TEXT,
  instructions_md TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, topic_id)
);

-- 記事(SQLite はインデックス/キャッシュ。source of truth は Markdown ファイル)
CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','published','pending_approval','archived')),
  source TEXT NOT NULL CHECK (source IN ('manual','agent_research','agent_changelog')),
  tags_json TEXT NOT NULL DEFAULT '[]',
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  freshness_rank TEXT NOT NULL DEFAULT 'fresh' CHECK (freshness_rank IN ('fresh','aging','stale','very_stale')),
  last_researched_at TEXT,
  last_accessed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  cost_usd REAL NOT NULL DEFAULT 0,
  summary TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_updated ON articles(updated_at);
CREATE INDEX IF NOT EXISTS idx_articles_topic ON articles(topic_id);

-- FTS5 全文検索仮想テーブル(content は articles.id を rowid 化して関連付け)
CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
  article_id UNINDEXED,
  title,
  body,
  tags,
  tokenize = 'unicode61'
);

-- 対話セッション・メッセージ(MessageService が SSE 経由でブラウザに転送)
CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'dialogue' CHECK (kind IN ('dialogue','knowledge')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','agent')),
  content TEXT NOT NULL,
  is_final INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  claimed_at TEXT,
  claimed_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_unclaimed ON messages(claimed_at) WHERE claimed_at IS NULL;

-- タスクキュー(Hermes が cron 周期で消化)
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('urgent','interactive','scheduled','maintenance')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('queued','claimed','done','failed')) DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  claimed_at TEXT,
  claimed_by TEXT,
  completed_at TEXT,
  parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  parent_review_id TEXT,
  dedup_key TEXT,
  cost_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_dedup ON tasks(dedup_key) WHERE dedup_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_queue ON tasks(status, priority, created_at);

CREATE TABLE IF NOT EXISTS task_dlq (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  type TEXT NOT NULL,
  priority TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  reason TEXT NOT NULL,
  moved_at TEXT NOT NULL
);

-- レビュー / コメント
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  change_pct REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')) DEFAULT 'pending',
  reviewer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  before_hash TEXT NOT NULL,
  after_hash TEXT NOT NULL,
  proposed_body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_reviews_article ON reviews(article_id);

CREATE TABLE IF NOT EXISTS review_comments (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  line_anchor TEXT,
  body TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS article_comments (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  anchor TEXT,
  body TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('open','resolved')) DEFAULT 'open',
  created_at TEXT NOT NULL
);

-- 既読
CREATE TABLE IF NOT EXISTS read_status (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  read_at TEXT NOT NULL,
  PRIMARY KEY (user_id, article_id)
);

-- 監査ログ
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  actor TEXT NOT NULL,
  agent_name TEXT,
  hermes_session_id TEXT,
  tool_name TEXT NOT NULL,
  target_article_id TEXT,
  before_hash TEXT,
  after_hash TEXT,
  source_request_id TEXT,
  cost_usd REAL NOT NULL DEFAULT 0,
  metadata_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(timestamp);

-- リサーチ方針
CREATE TABLE IF NOT EXISTS research_policy (
  id TEXT PRIMARY KEY,
  body_md TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
INSERT OR IGNORE INTO research_policy (id, body_md, updated_at)
VALUES ('default', '', '1970-01-01T00:00:00.000Z');

-- スキル提案
CREATE TABLE IF NOT EXISTS skill_proposals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed','approved','rejected')) DEFAULT 'proposed',
  reviewer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT
);
