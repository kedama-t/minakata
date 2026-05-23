-- tech-stack.md §6: アーカイブ・削除は admin 承認ゲートを通す
-- minakata.archive_article は即時実行せず、ここに proposed 行を残し、
-- admin が approve した時点で初めて articles.status='archived' へ反映する。

CREATE TABLE IF NOT EXISTS archive_proposals (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('proposed','approved','rejected')) DEFAULT 'proposed',
  proposed_by TEXT NOT NULL,
  reviewer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  decided_reason TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_archive_proposals_status ON archive_proposals(status);
-- 同じ記事に対して proposed 状態のレコードは 1 つだけ
CREATE UNIQUE INDEX IF NOT EXISTS uq_archive_proposals_active
  ON archive_proposals(article_id) WHERE status = 'proposed';
