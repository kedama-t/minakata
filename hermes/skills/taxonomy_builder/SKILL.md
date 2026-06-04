---
name: taxonomy_builder
description: タグ・カテゴリ体系を俯瞰し、表記揺れ統合・孤立タグ整理・粒度調整を自動で行う。承認不要・自動反映。
version: 0.1.0
author: minakata
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [minakata, taxonomy, structure]
---

# taxonomy_builder

記事の増加に応じてタグ体系を自動提案・再編成する。タグは記事の `tags` JSON 配列に
分散しており、正規化されたマスタが存在しない。このエージェントはタグ全体を俯瞰し、
以下の問題を自動で修正する：

- **表記揺れ**: 大文字・小文字の不統一、全角・半角の混在、単数形・複数形、ハイフン/スペース差異
- **孤立タグ**: 記事 1 件にしか使われていないタグ（記号的なものや誤記が多い）
- **上位下位の重複**: 同じ概念の粒度違いタグが並存している（例: `js` と `javascript`）

変更は `update_article` の `tags` のみで行い、`body` は**絶対に渡さない**（渡すと ReviewService 経由の 30% ゲートが誤発火する）。承認は不要で直接 applied になる。誤った再編は dialogue 経由で個別に `update_article` させて事後修正できる。

1 ターンで更新する記事は**最大 50 件**に制限する（コスト暴走防止）。

## 行動ルール

1. **`minakata.report_progress({ agent_name: "taxonomy_builder", phase: "開始", detail: "タグ集計中" })`** で実況する（失敗しても無視してよい）

2. **`minakata.list_tags({ exclude_archived: true })`** でタグ別件数一覧を取得する。
   全体構造（件数の多いタグ・孤立タグ・似た名前のタグ群）を把握する。

3. 以下の正規化方針を決定する：

   **A. 表記揺れの統合**（優先度: 高）
   - 英語タグはすべて小文字・ハイフン区切りを正規形とする
     （例: `JavaScript` → `javascript`、`React Hooks` → `react-hooks`）
   - 全角英数は半角に統一する
   - 末尾の `s` 差異（`api` vs `apis`）は件数の多い方に統一する

   **B. 孤立タグの整理**（優先度: 中）
   - 件数が 1 の孤立タグは、より一般的なタグへのマージを検討する
   - ただし、固有名詞・製品名など意図的と思われるものはそのままにする
   - 孤立タグを完全に削除する場合は、空タグ配列ではなく**より上位のタグに置き換える**

   **C. 上位下位の重複解消**（優先度: 低）
   - 明らかに同義のタグ（`js` と `javascript`、`ml` と `machine-learning`）は
     正式名称・長い方へ統一する
   - 上位概念（`frontend`）と下位概念（`react`）は**両方残す**（削除しない）

4. 正規化対象のタグごとに **`minakata.by_tag({ tag: "<旧タグ>", limit: 200 })`** で
   対象記事を取得する。
   
   対象記事ごとに（更新済み 50 件に達したらそれ以降はスキップ）：
   
   **`minakata.report_progress({ agent_name: "taxonomy_builder", phase: "タグ更新", detail: "<旧タグ> → <新タグ> / 記事 ...末尾8文字" })`** を呼んでから
   
   **`minakata.update_article({ id: <記事id>, tags: <正規化後のタグ配列全体>, author: "taxonomy_builder" })`** を呼ぶ。
   
   - `body` は**絶対に渡さない**（渡すと 30% ゲートを誤発火させる）
   - `tags` は旧タグを新タグに置き換えた配列全体を渡す（`read_article` で現在の tags を確認してから構築する）
   - 既に正規化済み（現在の tags が既に正規形と一致）の記事は update しない（冪等性）

5. **`minakata.report_progress({ agent_name: "taxonomy_builder", phase: "終了", detail: "正規化タグN種・更新記事M件" })`** で締める（失敗しても無視してよい）

## 注意: update_article の body 省略について

`update_article` に `body` を含めると `ReviewService.proposeUpdate` を経由し、
本文変更率 30% 超で `pending_approval` に保留される。タグ更新は常に `body` を省略し、
`tags` のみ渡すこと。このとき変更は直接 applied になり承認不要。

## 冪等性

- 記事ごとに現在の `tags` を確認してから更新するため、既に正規化済みの記事は update しない
- `by_tag` 検索と `update_article` はいずれも冪等（同じ値での更新は実質ノーオペレーション）

## 暴走防止

- 1 ターンあたりの `update_article` 呼び出しは最大 50 件
- `fulltext_search` や `read_article` の呼び出し数は最小限に絞る

## Capability 分離

- タグの再編（`update_article` の `tags` のみ）を担当
- 本文(`body`)の更新・記事の新規作成・アーカイブ提案は行わない
- `web_search` / `web_extract` / `shell_exec` は**使わない**

## MCP 接続エラー時

Minakata MCP が `unreachable` / `not connected` を返した場合は**再試行せず**、
状況を簡潔に報告してターンを終了する。Minakata MCP は HTTP 接続（`http://minakata:3000/mcp`）
であり、`uvx` / `npx` / stdio 経由ではない。
