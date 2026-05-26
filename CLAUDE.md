# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## リポジトリの現状

`0.1.0-mvp` 実装中。`packages/` (`core` / `web` / `mcp`)、`docker/`、`hermes/skills/` までは骨格が動き、`bun test` / `bun run typecheck` / `bun run lint` は通る状態。MVP 受け入れ条件まではまだ複数の不整合があり、GitHub Issue に追跡されている。

主要エントリ:

- `packages/web/server/index.ts` — Hono サーバー兼 MCP マウント
- `packages/web/app/routes/` — React Router v7 のルート(SSR + loader/action)
- `packages/mcp/src/tools.ts` — 全 MCP ツールの登録
- `packages/core/src/` — ドメインサービス (`article` / `auth` / `audit` / `message` / `task` / `search` / `review` / `policy` / `comment` / `skill` / `maintenance` / `embedding`)
- `hermes/skills/<name>/SKILL.md` — Hermes subagent 定義 (`dialogue` / `researcher` / `daily_research` / `freshness_checker` / `changelog_writer`)

実装を変更する前に、必読の仕様書と既存 Issue(`gh issue list`) を確認すること。

## 必読の仕様書(変更前に必ず参照)

- `docs/grand-design.md` — プロダクトの目的・方針(P1〜P11)
- `docs/tech-stack.md` — 技術選定の根拠と「採用しないもの」の理由(§11 Non-goals は必ず確認)
- `docs/user-stories.md` — ユーザーストーリーと受け入れ条件
- `docs/non-functional-requirement.md` — 非機能要件

## アーキテクチャの核(全体像を把握する上で重要)

Minakata は「エージェントハーネスによる自動情報収集システム」。コードを書く前に以下の原則を理解すること。

- **Markdown が source of truth**(P3): SQLite はインデックス/キャッシュに過ぎず、Markdown ファイルから再構築可能であること
- **ドメインロジックは `@minakata/core` に一元化**(P4): Web / MCP は `core` を呼ぶだけ。同じ処理を 2 箇所に書かない
- **人間は記事を直接編集しない**(P5): すべての書き込みはエージェント経由(MCP ツール → `core`)
- **ユーザー入口は WebUI のみ**(P6): Telegram / Discord / Slack 等のメッセージングゲートウェイは持たない
- **Web ↔ Agent は MCP メッセージバス経由**(P10): WebSocket やプロセス直結ではなく、SQLite のメッセージテーブル + EventEmitter + SSE で繋ぐ
- **Hermes が cron とキュー消化を担当**(P9): Minakata 側にスケジューラやワーカープロセスを作らない(`@minakata/worker` は不要)
- **埋め込み生成はローカル**(P11): Transformers.js + `multilingual-e5-base` を `core` プロセス内で実行。外部 API には送らない
- **生成系 LLM は OpenCode Go 経由**(P7): Hermes コンテナのみが API キーを保持。Minakata 側からは見えない(Zen `/zen/v1` も同じキーで併用可能だが既定は Go)

### パッケージ構成(現状)

```
packages/
├── core/   # ドメインロジック共有ライブラリ(依存なし)
├── web/    # React Router v7 + Hono(BFF 兼用)
└── mcp/    # MCP サーバー(web と同一プロセスで /mcp にマウント済み)
```

`web` と `mcp` は両方とも `core` に依存する。`core` は他に依存しない。`web` プロセスが起動時に `packages/web/server/index.ts:24` で `mountMcp` を呼び、Streamable HTTP の `/mcp` を立ち上げる。

### データフロー(対話)

1. ユーザー発言 → `web` が `core.MessageService.post()` で SQLite 保存
2. Hermes が `minakata.poll_messages` MCP ツールを 30 秒周期で呼ぶ
3. Hermes が応答を `minakata.post_agent_response` で書き戻す
4. `core` の EventEmitter が `web` の SSE ハンドラに通知 → ブラウザへ転送

### データフロー(調査)

1. 対話エージェントが `minakata.enqueue_task` でキュー投入
2. Hermes の `researcher` subagent が `minakata.poll_tasks` で 5 分周期消化 → 記事更新

## 技術スタック(必ず守ること)

- **ランタイム**: Bun 1.x で統一(P8)。Node.js / pnpm / npm は使わない
- **SQLite**: `bun:sqlite` を使う(`better-sqlite3` は不採用)
- **拡張**: FTS5(全文検索)、`sqlite-vec`(ベクトル検索、768次元固定)
- **スキーマ**: Zod v4(MCP SDK と共有)
- **Web**: React Router v7 framework mode + `react-router-hono-server`(Next.js は不採用)
- **MCP**: `@modelcontextprotocol/sdk` v1.x の `WebStandardStreamableHTTPServerTransport` を Hono に手動マウント(`packages/mcp/src/hono.ts`)。トランスポートは Streamable HTTP のみ(SSE トランスポートは非推奨)
- **Lint/Format**: Biome
- **テスト**: `bun test`(Vitest 互換 API)
- **E2E**: Playwright(未導入。MVP の受け入れシナリオが固まったタイミングで追加)

## プロンプトインジェクション対策(セキュリティ最重要)

仕様の中核。実装時に絶対に外してはいけない:

- **Capability 分離**: Hermes の subagent ごとに呼べる MCP ツールを限定する
- **コンテンツフェンシング**: 外部取得テキストは `<untrusted_content>` タグで囲んで synthesizer に渡す
- **行動制限**: エージェントが触れるのは Minakata MCP ツールのみ。任意の外部 HTTP / `shell_exec` は許可しない
- **承認ゲート**: アーカイブ・削除・大幅書き換え・スキル追加は WebUI 経由で human-in-the-loop
- **MCP 保護**: Host header 検証、Bearer Token 認証、Zod による厳格な入力バリデーション

## ロール(`viewer` / `editor` / `admin`)

- `viewer`: 閲覧・検索のみ
- `editor`: 調査依頼・チャット・レビュー(承認/差し戻し)
- `admin`: ユーザー管理・破壊的操作の承認

破壊的操作は MCP ツール側で `pending_approval` 状態にして保留し、admin が WebUI から承認したときに初めて反映する設計。

## 開発時の注意事項(プロジェクト固有)

- コミット前に lint & test を実行
- 外部 API キー(`OPENCODE_API_KEY` / `FIRECRAWL_API_KEY` / `MCP_TOKEN` / `SEARXNG_SECRET` / `ANTHROPIC_API_KEY`)は `.env` に書き、コードにハードコードしない
- LLM API キー類は **Hermes コンテナのみ**が保持する設計(Minakata 側から見えてはいけない)
- アーキ依存: `sqlite-vec` のバイナリ互換性のため x86_64 推奨。ARM で開発する場合は動作検証が必要

## 作業フロー(Issue → ブランチ → PR)

仕様不整合・バグ・機能改善はすべて GitHub Issue として登録し、Issue 単位でブランチ・PR を回す。手順は固定:

1. **Issue 起票**: `gh issue create -t "<タイトル>" -b "<本文>"` で登録。仕様(`docs/` 配下)との対応箇所と該当ファイル:行番号を必ず本文に書く
2. **ブランチ切り出し**: `git switch -c <type>/<issue番号>-<短い説明>`(例: `fix/1-audit-hash`)。起点は最新の `main`
3. **実装 + 検証**: `bun run typecheck` / `bun test` / `bun run lint` を通すまで PR は出さない。pre-commit hook(Biome + typecheck)と pre-push hook(`bun test`)は `--no-verify` で迂回しない
4. **コミット**: 1 Issue = 1 論理コミットを基本に、`fix:` / `feat:` / `chore:` などの conventional prefix で書く。コミットメッセージ末尾に `Closes #<番号>` を入れる
5. **push + PR**: `git push -u origin <branch>` → `gh pr create --title "..." --body "..."`。PR 本文の Summary / Test plan は HEREDOC で渡す。`Closes #N` を本文に入れて Issue と連動させる
6. **マージは人間が実行**: エージェントは PR 作成までで停止する。`gh pr merge` を勝手に叩かない

## やってはいけないこと(`docs/tech-stack.md` §11 より抜粋)

- 独自のスケジューラ・ワーカー(`@minakata/worker` 等)を作る → Hermes が担う
- ローカル LLM 推論サーバー(Ollama / vLLM)を構成に追加する → 生成系は OpenCode Go
- 外部メッセージングゲートウェイ(Telegram / Discord / Slack)を追加する → 入口は WebUI のみ
- Redis / BullMQ / Postgres / Pinecone / Elasticsearch / LangChain / Next.js を導入する → すべて代替手段が決まっている
- 埋め込みを外部 API(OpenAI / Cohere 等)に出す → ローカル実行が原則
