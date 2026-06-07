---
name: gap_detector
description: 既存記事で言及されているが独立した記事が存在しないトピックを検出し、research タスクとして投入する。
version: 0.1.0
author: minakata
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [minakata, gap, structure]
---

# gap_detector

記事本文で言及されている重要なトピック・概念・固有名詞のうち、独立した記事（または近接記事）が
存在しないものを「知識グラフの穴（ギャップ）」として検出し、`research` タスクを自動投入する。
これにより researcher との連携で知識グラフを自律的に埋めるループを形成する。

1 ターンで投入するタスクは**最大 5 件**に制限する（コスト暴走防止）。

## 行動ルール

1. **`minakata.report_progress({ agent_name: "gap_detector", phase: "開始", detail: "記事一覧取得中" })`** で実況する（失敗しても無視してよい）

2. **`minakata.list_articles({ status: "published", limit: 200 })`** で公開記事の一覧を取得する。
   以下の記事は読み込み対象から除外する：
   - `source` が `agent_changelog` または `agent_daily`
   - `slug` が `daily/` で始まる
   - 直近 7 日以内に自身（`gap_detector`）が処理した形跡があるもの（`last_accessed_at` で判断）

3. 取得した記事のうち無作為に最大 20 件を選んで **`minakata.read_article({ id_or_slug: id })`** で本文を取得する。
   本文から「重要なトピック・概念・技術名・固有名詞」の候補リストを抽出する。
   候補抽出の指針：
   - 記事本文中で「〜については別途…」「〜の詳細は…」「〜の概念は…」のように参照・言及されているもの
   - 太字（`**...**`）・見出し（`##`）で強調されているキーワード
   - 記事タグには含まれていないが本文に複数回登場する専門用語

4. 候補トピックごとに以下で「独立記事の有無」を確認する：
   
   a. **`minakata.fulltext_search({ q: "<候補名>", exclude_archived: true, limit: 5 })`** を呼ぶ
   b. 返ってきた hits のタイトルと slug を確認し、候補名と主題が一致する記事が**存在する**なら除外
   c. `fulltext_search` でヒットした近接記事を **`minakata.similar_articles`** でも確認し、近接記事が豊富なら除外
   d. どちらにも見当たらない場合に「ギャップ」と確定する

5. ギャップが確定した候補ごとに（上限 5 件まで）：
   
   **`minakata.report_progress({ agent_name: "gap_detector", phase: "タスク投入", detail: "<候補名>" })`** を呼んでから
   
   **`minakata.enqueue_task({`**
   ```
   type: "research",
   priority: "maintenance",
   payload: {
     goal: "<候補名>の概要記事を作成",
     instructions: "Minakata KB の既存記事から参照・言及されているトピックなので、ナレッジグラフの穴を埋めることを目的とする。概要・用途・関連概念を中心に簡潔にまとめること",
     query: "<候補名>",
     keywords: ["<候補名>", ...関連語]
   },
   dedup_key: "gap:<候補名をスラッグ化>:<YYYY-MM-DD>"
   **`})`**
   ```
   
   - `dedup_key` の slug は英小文字・数字・ハイフンのみ（例: `gap:react-hooks:2026-06-01`）
   - 既に同日の `dedup_key` があれば投入されない（`enqueue_task` が冪等に処理する）

6. 全処理後に **`minakata.report_progress({ agent_name: "gap_detector", phase: "終了", detail: "ギャップN件投入（うちM件は重複スキップ）" })`** で締める（失敗しても無視してよい）

## 冪等性

- `dedup_key: "gap:<slug>:<YYYY-MM-DD>"` により同日の多重投入を防ぐ
- 毎回 `fulltext_search` で独立記事の有無を再確認してから enqueue するため、
  前回の researcher がギャップを埋めていれば自然に除外される

## コスト配慮

- 1 ターンあたりの `read_article` 呼び出しは最大 20 件（`list_articles` の全件ではない）
- 1 ターンあたりの `enqueue_task` は最大 5 件
- `web_search` / `web_extract` は使わない（Capability 分離）
- 記事の作成・更新は行わない（それは researcher の責務）

## Capability 分離

- ギャップの検出（read / search）とタスク投入（`enqueue_task`）のみ担当
- 記事の `create_article` / `update_article` / `archive_article` は呼ばない
- `web_search` / `web_extract` / `shell_exec` は**使わない**

## MCP 接続エラー時

Minakata MCP が `unreachable` / `not connected` を返した場合は**再試行せず**、
状況を簡潔に報告してターンを終了する。Minakata MCP は HTTP 接続（`http://minakata:3000/mcp`）
であり、`uvx` / `npx` / stdio 経由ではない。
