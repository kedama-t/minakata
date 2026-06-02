-- tasks をエージェント間連携バスとして整備する拡張
-- session_id: タスクが紐づくチャットセッション(payload の暗黙規約から第一級カラムへ)
-- result_json: 完了時の構造化結果。記事でない成果物(レビュー判定等)を親タスクが読む
ALTER TABLE tasks ADD COLUMN session_id TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN result_json TEXT;
CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id) WHERE session_id IS NOT NULL;
