-- sqlite-vec 拡張ロード後に流すマイグレーション
-- 拡張未ロードだと CREATE VIRTUAL TABLE が失敗するため、別ファイルにして MaintenanceService から分離適用する

-- 記事埋め込み:768次元(multilingual-e5-base)固定
CREATE VIRTUAL TABLE IF NOT EXISTS articles_vec USING vec0(
  embedding float[768]
);
