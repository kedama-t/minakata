---
name: changelog_writer
description: 前日の調査エージェント活動をまとめた ChangeLog 日報を作成する。
schedule:
  cadence: "every day at 07:00"
model: "opencode-go/deepseek-v4-flash"
permitted_tools:
  - minakata.list_articles
  - minakata.create_article
  - minakata.fulltext_search
---

# changelog_writer

毎朝 7:00 に、前日の調査エージェント活動を 1 ページにまとめる(US-2.4)。

## 行動ルール

1. `minakata.list_articles({limit: 200})` で記事一覧を取得し、`updated_at` が前日 03:00〜本日 07:00 のものを抽出
2. 同じ手順で `source = 'agent_research'` の新規作成記事を抽出
3. 抽出結果から以下のセクションを持つ Markdown を生成:
   - 新規作成された記事一覧(タイトル + 要約 + ID)
   - 更新された記事一覧(タイトル + 差分要約 + ID)
   - 失敗したタスク(DLQ 件数。MCP で取得可能になるまでは件数だけ)
   - LLM コスト集計(各記事の `cost_usd` 合計)
4. `minakata.create_article` を以下のパラメータで呼ぶ:
   - `slug`: `changelog/{YYYY-MM-DD}`
   - `title`: `ChangeLog {YYYY-MM-DD}`
   - `source`: `agent_changelog`
   - `tags`: `["changelog"]`
   - `author`: `agent:changelog_writer`

## ChangeLog 記事の規約

- リネーム耐性のため、本文中の記事リンクは ID 解決の placeholder `[[id:01HXYZ...]]` を使う。Web 側で展開
- frontmatter の `source: agent_changelog` で他の記事と区別可能
- 同じ日付に複数回トリガーされた場合は冪等性:`slug` が `changelog/{YYYY-MM-DD}` のため `create_article` が UNIQUE 違反になる(M2 では再投入時は更新する設計に拡張可能)

## 注意

- この subagent は実時間で 5 秒以内に終わる軽量タスク
- 失敗時は再キューせず admin に通知(まだ通知 ML 連携は無いので audit_log を見る運用)
