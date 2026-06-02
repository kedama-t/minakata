-- articles.source の CHECK 制約を撤廃し、バリデーションを Zod に一元化する。
-- これにより source 種別の追加が enum 1 行で済み、以後テーブル再作成が不要になる。
-- SQLite は ALTER TABLE で CHECK を変更できないため、テーブル再作成で対応する。
--
-- 注: articles_old へのリネーム方式は子テーブル(archive_proposals 等)の FK 参照を
--     SQLite が自動書き換えするため使えない。articles_new を先に作り、データコピー後
--     旧テーブルを削除、最後に articles_new → articles とリネームする。
PRAGMA foreign_keys=OFF;

CREATE TABLE articles_new (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','published','pending_approval','archived')),
  source TEXT NOT NULL,
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

INSERT INTO articles_new SELECT * FROM articles;

DROP TABLE articles;

ALTER TABLE articles_new RENAME TO articles;

CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_updated ON articles(updated_at);
CREATE INDEX IF NOT EXISTS idx_articles_topic ON articles(topic_id);

PRAGMA foreign_keys=ON;
