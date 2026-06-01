-- エージェントによる記事コメントへの返信を格納する列を追加する。
-- agent_reply IS NULL = 未返信、NOT NULL = 返信済み。
ALTER TABLE article_comments ADD COLUMN agent_reply TEXT;
ALTER TABLE article_comments ADD COLUMN agent_replied_at TEXT;
