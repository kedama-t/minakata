-- アップロード資料(#239): 人間が WebUI から投入した pdf / md / pptx のインデックス。
-- 実体(raw ファイル + 抽出 Markdown)は DOCUMENTS_ROOT 配下に保存され、
-- このテーブルはインデックスに過ぎない(P3: Markdown が source of truth)。
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pdf','md','pptx')),
  size INTEGER NOT NULL,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_uploader ON documents(uploaded_by);
