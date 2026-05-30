-- エージェントの進捗実況を記録するテーブル。audit_log とは分離した揮発可能なランタイムログ。
CREATE TABLE agent_activity (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  actor TEXT NOT NULL,
  phase TEXT NOT NULL,
  detail TEXT,
  target_article_id TEXT
);
CREATE INDEX idx_agent_activity_ts ON agent_activity (timestamp DESC);
CREATE INDEX idx_agent_activity_actor_ts ON agent_activity (actor, timestamp DESC);
