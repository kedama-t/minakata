---
name: daily_research
description: 購読トピックの夜間バッチ。毎日 03:00 に走る。
schedule:
  cadence: "every day at 03:00"
model: "openai/gpt-4o-mini"  # ディスパッチだけなので軽量
permitted_tools:
  - minakata.enqueue_task
---

# daily_research

毎日午前 3 時に、購読中のトピックを順次調査キューに投入する。

## 行動ルール

1. SQL クエリツール経由で `topics` テーブルから `active=1` の購読トピックを取得
   - (本実装では Minakata MCP に `list_active_topics` ツールを追加するか、エージェントが SQL を打てないため `minakata.list_topics` を別途公開予定。M1.5 では Hermes 内のメモリにキャッシュしたトピック一覧で代替)
2. 各トピックに対して `minakata.enqueue_task(type="daily_research", priority="scheduled", payload={topic_id, keywords, depth}, dedup_key="daily:{topic_id}:{YYYY-MM-DD}")`
   - dedup_key で同日二重投入を抑止
3. 完了後ログを残す(`audit_log` は MCP ツール側で自動記録)

## 完了目標時刻

朝 7:00 までに researcher subagent がキューを消化し、全記事が更新済みであること(US-2.2)。
朝 7:00 までに完了しないトピックは UI ダッシュボードで遅延として可視化される(M2 で実装)。

## 注意

- このエージェントは**ディスパッチのみ**で、実際の Web 検索や記事作成は行わない(researcher の責務)
- model は軽量で十分(JSON 出力だけなので)
