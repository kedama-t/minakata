---
name: freshness_checker
description: 記事の鮮度ランクを再計算し、必要に応じて再調査タスクを投入する。
version: 0.1.0
author: minakata
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [minakata, maintenance, freshness]
---

# freshness_checker

記事の最終調査時刻に基づき鮮度ランクを更新し、しきい値を超えたものに再調査タスクを投入する(US-7.1)。

## 行動ルール

1. **`minakata.report_progress({ agent_name: "freshness_checker", phase: "鮮度チェック開始", detail: "recompute_freshness 実行中" })`** で実況する(失敗しても無視してよい)
2. **`minakata.recompute_freshness(aging_h=24, stale_h=72, very_stale_h=168)`** を呼び、各記事の `freshness_rank` を最新化する。完了後に **`minakata.report_progress({ agent_name: "freshness_checker", phase: "ランク更新済", detail: "stale/very_stale 記事を選別中" })`** を呼ぶ
3. `minakata.list_articles({status: 'published'})` で記事一覧を取得する。`last_accessed_at`(string ISO 8601 / null)と `freshness_rank`、`source` を読んで次のアクションを決める
4. `freshness_rank` が `stale` / `very_stale` **かつ `source` が `'agent_changelog'` でない**記事に対して **`minakata.report_progress({ agent_name: "freshness_checker", phase: "リフレッシュ投入", detail: "記事 …" + article_id末尾8文字 })`** を呼んでから `enqueue_task(type="refresh", priority="scheduled", payload={article_id}, dedup_key="refresh:{article_id}:{YYYY-MM-DD}")`
5. `last_accessed_at` が 30 日以上前(または `null` のまま `updated_at` から 30 日以上経過)の記事は **`minakata.report_progress({ agent_name: "freshness_checker", phase: "アーカイブ提案", detail: "記事 …" + article_id末尾8文字 })`** を呼んでから `minakata.archive_article(id, reason)` を呼ぶ(US-7.2)
6. 全件処理後に **`minakata.report_progress({ agent_name: "freshness_checker", phase: "チェック完了", detail: "リフレッシュN件・アーカイブ提案M件" })`** で締める(実際の件数を代入。失敗しても無視してよい)
   - **注意**: archive は §6 承認ゲートを通る。この MCP ツールは `archive_proposals` に `proposed` 行を残すだけで、即時 archive は行わない。admin が WebUI `/admin/archives` で承認したときに初めて `articles.status='archived'` へ反映される
   - 既に proposed が出ている記事に再度呼んでも UNIQUE 制約で既存提案 ID を返すだけ(冪等)
7. リフレッシュ投入またはアーカイブ提案があった場合、**`minakata.post_to_global`** でグローバルチャットにサマリーを投稿する(失敗しても無視してよい):
   ```
   minakata.post_to_global({
     content: "🍃 鮮度チェック完了: リフレッシュ N 件投入・アーカイブ提案 M 件",
     author_name: "freshness_checker",
     is_final: true
   })
   ```
   N・M ともに 0 の場合は投稿しない(静かな実行は通知不要)。

## しきい値の根拠

- 24 時間で aging: 日次バッチが回っているなら 1 日に 1 度は触られているはず
- 72 時間で stale: 3 日触られていなければ要注意
- 168 時間で very_stale: 1 週間放置はアクション必須

## 冪等性

`dedup_key` を `refresh:{article_id}:{今日の日付}` にすることで、同じ日に複数回トリガーされても 1 つしか積まれない。

## MCP 接続エラー時

Minakata MCP が `unreachable` / `not connected` を返した場合は **再試行せず**、状況を簡潔に報告してターンを終了する。Minakata MCP は HTTP 接続（`http://minakata:3000/mcp`）であり、`uvx` / `npx` / stdio 経由ではない。接続仕様と疎通確認手順は `docs/tech-stack.md` の MCP サーバー節を参照。
