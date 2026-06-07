-- フィードバックループ(#194): 記事いいね + 自己改善インサイト

-- 記事へのいいね(ユーザーからの非テキストフィードバック)。
-- (user_id, article_id) を主キーにし 1 ユーザー 1 いいねに制限する。
CREATE TABLE IF NOT EXISTS article_likes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, article_id)
);
CREATE INDEX IF NOT EXISTS idx_article_likes_article ON article_likes(article_id);

-- エージェントが自己改善ループで蓄積する執筆インサイト。
-- いいね/コメントの傾向分析から「どう書けば評価されるか」を Markdown で記録し、
-- 執筆系 subagent が system prompt に挿入する。research_policy と同型(単一行)。
CREATE TABLE IF NOT EXISTS feedback_insights (
  id TEXT PRIMARY KEY,
  body_md TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
INSERT OR IGNORE INTO feedback_insights (id, body_md, updated_at)
VALUES ('default', '', '1970-01-01T00:00:00.000Z');
