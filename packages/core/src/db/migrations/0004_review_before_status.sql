-- reviews テーブルに before_status を追加し、reject 時に proposeUpdate 前の
-- 記事 status へ正しく戻せるようにする(US-6.2「反映前の状態が常に source of
-- truth として残る」の精神に沿う)。

ALTER TABLE reviews ADD COLUMN before_status TEXT;
