---
name: daily_research
description: 購読トピックの夜間バッチ。毎日 03:00 に走る。
version: 0.1.0
author: minakata
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [minakata, research, daily-batch]
---

# daily_research

毎日午前 3 時に、購読中のトピックを順次調査キューに投入する。

## 想定スケジュールと使用ツール(Phase 3 で hermes cron 化予定)

- **cadence**: every day at 03:00
- **model**: `opencode-go/deepseek-v4-flash`(ディスパッチのみなので軽量)
- **permitted MCP tools**: `minakata.enqueue_task` / `minakata.report_progress`

## 行動ルール

1. **`minakata.report_progress({ phase: "デイリーバッチ開始", detail: "購読トピックをキューに投入中" })`** で実況する(失敗しても無視してよい)
2. SQL クエリツール経由で `topics` テーブルから `active=1` の購読トピックを取得
   - (本実装では Minakata MCP に `list_active_topics` ツールを追加するか、エージェントが SQL を打てないため `minakata.list_topics` を別途公開予定。M1.5 では Hermes 内のメモリにキャッシュしたトピック一覧で代替)
   - **トピック一覧が空（0 件）の場合**: アクティブな購読トピックが存在しないことを報告する。[SILENT] は使わない（「何も新しいことがない」ではなく「トピック未構成で処理不能」のため）。現状（検索した内容、トピック件数 0）を簡潔に報告し、`topics` テーブルへのトピック定義が必要である旨を伝える。
   - **Hermes メモリが無効の場合**: M1.5 のフォールバック経路（メモリキャッシュ）が機能しない。トピック一覧が取得不能として扱い、上記の空ケースと同じ報告を行う。
3. 各トピックに対して `minakata.enqueue_task(type="daily_research", priority="scheduled", payload={topic_id, keywords, depth}, dedup_key="daily:{topic_id}:{YYYY-MM-DD}")`
   - dedup_key で同日二重投入を抑止
4. 完了後ログを残す(`audit_log` は MCP ツール側で自動記録)

## 完了目標時刻

朝 7:00 までに researcher subagent がキューを消化し、全記事が更新済みであること(US-2.2)。
朝 7:00 までに完了しないトピックは UI ダッシュボードで遅延として可視化される(M2 で実装)。

## 注意

- このエージェントは**ディスパッチのみ**で、実際の Web 検索や記事作成は行わない(researcher の責務)
- model は軽量で十分(JSON 出力だけなので)
- Minakata MCP サーバーが到達不能な場合の対処は `researcher` スキルの「エラーハンドリング: MCP サーバー不在」および `references/mcp-server-troubleshooting.md` を参照
