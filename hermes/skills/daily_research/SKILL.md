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

## 行動ルール

1. **`minakata.report_progress({ agent_name: "daily_research", phase: "デイリーバッチ開始", detail: "購読トピックをキューに投入中" })`** で実況する(失敗しても無視してよい)
2. **`minakata.list_topics({})`** を呼んで `active=1` の購読トピック一覧を取得する
   - **トピック一覧が空（0 件）の場合**: アクティブな購読トピックが存在しないことを報告する。[SILENT] は使わない（「何も新しいことがない」ではなく「トピック未構成で処理不能」のため）。現状（トピック件数 0）を簡潔に報告し、`/topics` ページからトピック定義が必要である旨を伝える。
3. 各トピックに対して **`minakata.report_progress({ agent_name: "daily_research", phase: "トピック投入中", detail: <topic_id または keywords の概要> })`** を呼んでから `minakata.enqueue_task(type="daily_research", priority="scheduled", payload={topic_id, keywords, depth}, dedup_key="daily:{topic_id}:{YYYY-MM-DD}")`
   - dedup_key で同日二重投入を抑止
4. 全トピック投入後に **`minakata.report_progress({ agent_name: "daily_research", phase: "バッチ完了", detail: "N件のトピックをキューに投入" })`** で締める(N は実際の件数。失敗しても無視してよい)
5. 完了後ログを残す(`audit_log` は MCP ツール側で自動記録)

## 完了目標時刻

朝 7:00 までに researcher subagent がキューを消化し、全記事が更新済みであること(US-2.2)。
朝 7:00 までに完了しないトピックは UI ダッシュボードで遅延として可視化される(M2 で実装)。

## 注意

- このエージェントは**ディスパッチのみ**で、実際の Web 検索や記事作成は行わない(researcher の責務)
- model は軽量で十分(JSON 出力だけなので)
- Minakata MCP が `unreachable` / `not connected` を返した場合は **再試行せず**、状況を簡潔に報告してターンを終了する。接続仕様と疎通確認手順は `docs/tech-stack.md` の MCP サーバー節を参照
