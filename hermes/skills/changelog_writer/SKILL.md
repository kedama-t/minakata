---
name: changelog_writer
description: 前日の調査エージェント活動をまとめた ChangeLog 日報を作成する。
version: 0.1.0
author: minakata
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [minakata, changelog, daily-batch]
---

# changelog_writer

毎朝 7:00 に、前日の調査エージェント活動を 1 ページにまとめる(US-2.4)。

## 行動ルール

1. **`minakata.report_progress({ agent_name: "changelog_writer", phase: "ChangeLog 執筆開始", detail: "記事一覧を集計しています" })`** で実況する(失敗しても無視してよい)
2. `minakata.list_articles({limit: 200})` で記事一覧を取得し、`updated_at` が前日 03:00〜本日 07:00 のものを抽出
3. 同じ手順で `source = 'agent_research'` の新規作成記事を抽出。抽出完了後に **`minakata.report_progress({ agent_name: "changelog_writer", phase: "記事集計完了", detail: "新規N件・更新M件を抽出。Markdown 生成中" })`** を呼ぶ
4. 抽出結果から以下のセクションを持つ Markdown を生成:
   - 新規作成された記事一覧(タイトル + 要約 + ID)
     - なお、[[id:01HXYZ...]] と書くと Web 側で記事タイトルに展開されるため、ID を併記する形で記載する
   - 更新された記事一覧(タイトル + 差分要約 + ID)
   - 失敗したタスク: `minakata.list_dlq({ since: "<前日 03:00 ISO>" })` を呼んで DLQ 件数とタスク種別一覧を取得し記載
   - LLM コスト集計(各記事の `cost_usd` 合計)
5. **`minakata.report_progress({ agent_name: "changelog_writer", phase: "ChangeLog 記事作成中", detail: "changelog/{YYYY-MM-DD}" })`** を呼んでから `minakata.create_article` を以下のパラメータで呼ぶ:
   - `slug`: `changelog/{YYYY-MM-DD}`
   - `title`: `ChangeLog {YYYY-MM-DD}`
   - `source`: `agent_changelog`
   - `tags`: `["changelog"]`
   - `author`: `agent:changelog_writer`
6. 作成完了後に **`minakata.report_progress({ agent_name: "changelog_writer", phase: "ChangeLog 完了", detail: "changelog/{YYYY-MM-DD} を作成" })`** で締める(失敗しても無視してよい)

## ChangeLog 記事の規約

- リネーム耐性のため、本文中の記事リンクは ID 解決の placeholder `[[id:01HXYZ...]]` を使う。Web 側で展開
- frontmatter の `source: agent_changelog` で他の記事と区別可能
- 同じ日付に複数回トリガーされた場合は冪等性:`slug` が `changelog/{YYYY-MM-DD}` のため `create_article` が UNIQUE 違反になる(M2 では再投入時は更新する設計に拡張可能)

## 注意

- この subagent は実時間で 5 秒以内に終わる軽量タスク
- 失敗時は再キューせず admin に通知(まだ通知 ML 連携は無いので audit_log を見る運用)

## MCP 接続エラー時

Minakata MCP が `unreachable` / `not connected` を返した場合は **再試行せず**、状況を簡潔に報告してターンを終了する。Minakata MCP は HTTP 接続（`http://minakata:3000/mcp`）であり、`uvx` / `npx` / stdio 経由ではない。接続仕様と疎通確認手順は `docs/tech-stack.md` の MCP サーバー節を参照。
