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

## 想定スケジュールと使用ツール(Phase 3 で hermes cron 化予定)

- **cadence**: every 6 hours
- **model**: `opencode-go/deepseek-v4-flash`
- **permitted MCP tools**: `minakata.recompute_freshness` / `minakata.list_articles` / `minakata.enqueue_task` / `minakata.archive_article` / `minakata.report_progress`

## 行動ルール

1. **`minakata.report_progress({ phase: "鮮度チェック中", detail: "recompute_freshness 実行中" })`** で実況する(失敗しても無視してよい)
2. **`minakata.recompute_freshness(aging_h=24, stale_h=72, very_stale_h=168)`** を呼び、各記事の `freshness_rank` を最新化する
3. `minakata.list_articles({status: 'published'})` で記事一覧を取得する。返却値の `last_accessed_at`(string ISO 8601 / null)と `freshness_rank` を読んで次のアクションを決める
4. `freshness_rank` が `stale` / `very_stale` の記事に対して `enqueue_task(type="refresh", priority="scheduled", payload={article_id}, dedup_key="refresh:{article_id}:{YYYY-MM-DD}")`
5. `last_accessed_at` が 30 日以上前(または `null` のまま `updated_at` から 30 日以上経過)の記事は `minakata.archive_article(id, reason)` を呼ぶ(US-7.2)
   - **注意**: archive は §6 承認ゲートを通る。この MCP ツールは `archive_proposals` に `proposed` 行を残すだけで、即時 archive は行わない。admin が WebUI `/admin/archives` で承認したときに初めて `articles.status='archived'` へ反映される
   - 既に proposed が出ている記事に再度呼んでも UNIQUE 制約で既存提案 ID を返すだけ(冪等)

## しきい値の根拠

- 24 時間で aging: 日次バッチが回っているなら 1 日に 1 度は触られているはず
- 72 時間で stale: 3 日触られていなければ要注意
- 168 時間で very_stale: 1 週間放置はアクション必須

## 冪等性

`dedup_key` を `refresh:{article_id}:{今日の日付}` にすることで、同じ日に複数回トリガーされても 1 つしか積まれない。

## MCP サーバー障害時

Minakata MCP サーバーが到達不能な場合の対処は `researcher` スキルの「エラーハンドリング: MCP サーバー不在」および `references/mcp-server-troubleshooting.md` を参照。
