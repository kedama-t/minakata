-- タスクの依頼元ユーザーを記録する。Hermes 側で agent が自発的に enqueue したものは NULL。
-- editor が WebUI から追加調査依頼した場合に user.id を入れる。
ALTER TABLE tasks ADD COLUMN requested_by TEXT;
CREATE INDEX IF NOT EXISTS idx_tasks_requested_by ON tasks(requested_by) WHERE requested_by IS NOT NULL;
