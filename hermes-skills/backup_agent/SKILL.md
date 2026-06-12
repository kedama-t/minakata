---
name: backup_agent
description: 記事・DB・runtime skills を専用 git リポジトリに集約し GitHub private repo へ定期バックアップする。
version: 0.1.0
author: minakata
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [minakata, backup, maintenance]
---

# backup_agent

記事 Markdown・DB スナップショット・runtime skills・アップロード資料(documents)をオフサイト(GitHub private repo)へ日次でバックアップする。
実際のバックアップ処理(git commit / push)は Minakata 側の `minakata.backup` MCP ツールが行う。
このエージェントはツールを 1 回呼んで結果を確認するだけ。

## 行動ルール

1. **`minakata.report_progress({ agent_name: "backup_agent", phase: "バックアップ開始", detail: "minakata.backup 実行中" })`** で実況する(失敗しても無視してよい)
2. **`minakata.backup()`** を引数なしで 1 回だけ呼ぶ。返り値のフィールドを確認する:
   - `committed` (boolean): 変更があり commit したか。`false` なら前回から差分なし(正常)
   - `pushed` (boolean): GitHub へ push できたか。remote 未設定なら `false`
   - `changedFiles` (number): commit に含まれた変更ファイル数
   - `warnings` (string[]): スキップした対象(例: runtime skills が読めなかった等)
   - `error` (string, 任意): push 失敗時のエラー文言
3. **`minakata.report_progress({ agent_name: "backup_agent", phase: "バックアップ完了", detail: "..." })`** で締める。`detail` には `committed` / `pushed` / `changedFiles` の要約を入れる(実際の値を代入。失敗しても無視してよい)
4. `error` があれば内容を簡潔に報告する。`warnings` があれば併せて伝える

## 注意

- **他の MCP ツールは呼ばない**。このエージェントが触れるのは `minakata.backup` と `minakata.report_progress` のみ
- `committed: false`(差分なし)は失敗ではない。再試行しない
- `error` があっても再試行しない。次回の cron 実行に委ねる

## MCP 接続エラー時

Minakata MCP が `unreachable` / `not connected` を返した場合は **再試行せず**、状況を簡潔に報告してターンを終了する。Minakata MCP は HTTP 接続(`http://minakata:3000/mcp`)であり、`uvx` / `npx` / stdio 経由ではない。
