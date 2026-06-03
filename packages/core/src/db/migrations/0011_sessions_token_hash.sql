-- セッショントークンのランダム部分を SHA-256 ハッシュで保存し、照合できるようにする
ALTER TABLE sessions ADD COLUMN token_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
