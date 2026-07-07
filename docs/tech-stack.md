---
title: "技術スタック仕様"
version: "0.1.0-mvp"
created_at: "2026-05-21"
modified_at: "2026-06-09"
states: "approved"
---

# Minakata 技術スタック仕様

## 1. ドキュメントの目的とスコープ

本ドキュメントは Minakata の **技術スタック決定** をまとめる。各レイヤーで採用するライブラリ・ランタイム・運用ツールと、選定理由を記録する。

- 機能仕様(ユーザーストーリー、エージェント挙動、APIシグネチャ)は別ドキュメント
- データモデル(記事 frontmatter、DBスキーマ)は別ドキュメント
- 本書では「何を使うか」「なぜそれか」「採用しないものは何か」のみ扱う

---

## 2. 全体方針

| #   | 方針                                                     | 含意                                                                   |
| --- | -------------------------------------------------------- | ---------------------------------------------------------------------- |
| P1  | 自己ホスティング前提                                     | Podman Compose(rootless)で完結                                        |
| P2  | エージェントハーネスは差し替え可能                       | Minakata 側は MCP のみで対話。Hermes 以外の MCP クライアントでも接続可 |
| P3  | Markdown ファイルが source of truth                      | DB はインデックス/キャッシュ。Markdown が消えても再構築可能            |
| P4  | ドメインロジックは一箇所(`core`)                         | Web / MCP すべてが同じ `core` を呼ぶ                                   |
| P5  | 人間は記事を直接編集しない                               | すべての書き込みはエージェント経由(依頼ベース)                         |
| P6  | **ユーザーの入口は WebUI のみ**                          | 外部メッセージング・ゲートウェイは持たない                             |
| P7  | **生成系 LLM はマネージド/クラウドのみ**(初期)           | LLM 推論サーバーは構成に含めない。埋め込みは別扱い(P11)                |
| P8  | ランタイムは Bun に統一                                  | Web / MCP / スクリプトすべて Bun で実行                                |
| P9  | **エージェントの定期実行・スケジュールは Hermes が担う** | Minakata 側にワーカーやスケジューラを持たない                          |
| P10 | **Web ↔ Agent の対話は MCP メッセージバス経由**          | Minakata MCP が単一接点になり、harness 差し替え可能性を保つ            |
| P11 | **埋め込み生成はローカル**(`core` 内 Transformers.js)    | コストとプライバシーの両立、外部 API 依存を減らす                      |

---

## 3. アーキテクチャ概要

```
┌──────────────────────────────────────────────────────────┐
│  User (Browser)                                            │
└──┬───────────────────────────────────────────────────────┘
   │ HTTPS (POST message / SSE subscribe)
   ▼
┌────────────────────────────────────────────────────────────┐
│  @minakata/web (Bun + React Router v7)                       │
│  - UI / BFF (loader / action)                                │
│  - チャット UI:POST メッセージ + SSE で応答受信               │
└──────┬──────────────────────────────────────────────────────┘
       │ in-process call
       ▼
┌──────────────────────────────────────────────────────────┐
│  @minakata/core (shared domain library)                    │
│  - Articles / Search / Audit / Git / Messages / Tasks       │
│  - Embedding (Transformers.js, ローカル実行)                 │
└──┬───────────────────────────┬─────────────────────────────┘
   │                            │
   ▼                            ▼
┌──────────────┐         ┌────────────────┐
│ Markdown +   │         │ SQLite          │
│ Git repo     │         │ FTS5 + vec      │
│              │         │ messages/tasks  │
│              │         │ audit log       │
└──────────────┘         └────────────────┘
       ▲                            ▲
       │ MCP tools (read/write)     │
       └────────────┬───────────────┘
                    │
              ┌─────────────────────┐
              │  @minakata/mcp       │
              │  (Hono の /mcp で公開)│
              └─────────┬───────────┘
                        │ MCP Streamable HTTP
                        ▼
              ┌──────────────────────────────┐
              │  Hermes Agent                 │
              │  - dialogue(対話 / poll 60s)  │
              │  - researcher(調査キュー消化) │
              │  - daily_research(夜間バッチ) │
              │  - freshness_checker(鮮度)    │
              │  - synthesizer(統合記事)      │
              │  - taxonomy_builder(タグ整理) │
              │  - gap_detector(欠落検出)     │
              │  - feedback_analyst(自己改善) │
              │  - changelog_writer(日報)     │
              │  - backup_agent(バックアップ) │
              │  - cron で各 poll / バッチ起動 │
              │  - LLM 接続:                   │
              │    OpenCode Go (OpenAI互換)    │
              │    + BYOK(任意)               │
              │  - Web 接続:                   │
              │    search → SearXNG            │
              │    extract → Minakata 自前      │
              │             /v1/scrape         │
              └──────────────────────────────┘
```

**ユーザー対話の流れ(対話エージェント)**:

1. ユーザーがチャットで発言 → Web が `core.MessageService.post(session_id, text)` で SQLite に保存
2. Web は SSE で `/chat/:sessionId/stream` を購読中
3. Hermes が短周期 cron(`dialogue` は 60 秒ごと)で `minakata.poll_messages` MCP ツールを呼ぶ
4. Hermes が処理し、`minakata.post_agent_response(session_id, chunk, is_final)` を必要回数呼ぶ
5. `core` が in-process EventEmitter で Web の SSE ハンドラに通知 → ブラウザへ転送

**調査タスクの流れ**:

1. 対話エージェントが「これは調査が必要」と判断 → `minakata.enqueue_task(...)` で SQLite キューに投入
2. Hermes が `minakata.poll_tasks` を cron で消化 → researcher subagent が処理 → 記事更新 → 完了報告

---

## 4. プロジェクト構造

**モノレポ**(Bun workspaces)

```
minakata/
├── packages/
│   ├── core/              # ドメインロジック(共通)
│   ├── web/               # React Router v7 アプリ(BFF + /v1/scrape + /mcp 同居)
│   └── mcp/               # MCP サーバー
├── docker/
│   ├── Dockerfile.minakata    # web + mcp 同居(Hermes は公式 image を使うので Dockerfile なし)
│   ├── docker-compose.yml     # minakata / hermes(--profile agent)/ searxng
│   └── docker-compose.dev.yml # 開発用オーバーライド
├── hermes-skills/         # subagent 定義の正本(git 管理 / :ro mount で seed)
│   └── <name>/SKILL.md
├── hermes/                # Hermes 実行時データ(.gitignore 中心)
│   ├── config.yaml        # canonical な最小設定(:ro override)
│   ├── cron-bootstrap.sh  # 起動時に skill seed + cron 登録(#52 / #187)
│   ├── main-wrapper.sh    # HERMES_HOME を /opt/data に固定する上書き
│   └── skills/            # 実行時 skill コピー(Hermes が curator で自律編集)
├── searxng/               # SearXNG 設定
│   └── settings.yml
├── scripts/               # メンテナンス CLI(Bun スクリプト)
├── docs/                  # 仕様書類
├── data/                  # 実行時(.gitignore)
│   ├── articles/          # Markdown(別 git リポ)
│   └── minakata.db        # SQLite
├── models/                # 埋め込みモデルキャッシュ(.gitignore)
├── package.json
├── bunfig.toml
└── tsconfig.json
```

### `package.json`(ルート)抜粋

```jsonc
{
  "name": "minakata",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "dev": "bun run --filter @minakata/web dev",
    "build": "bun run --filter '*' build",
    "test": "bun test",
  },
}
```

### パッケージ依存関係

| Package          | 依存   | 役割                          |
| ---------------- | ------ | ----------------------------- |
| `@minakata/core` | (none) | ドメイン(内部のみ)            |
| `@minakata/web`  | `core` | UI + BFF                      |
| `@minakata/mcp`  | `core` | MCP server(Hermes 等の接続口) |

`@minakata/worker` は不要。Hermes が cron + キュー消化を担う(P9)。

---

## 5. 各レイヤーの技術選定

### 5.1 共有コア(`@minakata/core`)

| 領域               | 選定                                                                                              | 備考                                       |
| ------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 言語               | TypeScript (strict mode)                                                                          |                                            |
| ランタイム         | **Bun 1.x**                                                                                       | 全パッケージで統一                         |
| スキーマ           | [Zod](https://zod.dev/) v4                                                                        | MCP SDK と整合                             |
| SQLite             | [`bun:sqlite`](https://bun.sh/docs/api/sqlite)                                                    | Bun 組み込み                               |
| 全文検索           | SQLite [FTS5](https://www.sqlite.org/fts5.html)                                                   | 別サービス不要                             |
| ベクトル検索       | [`sqlite-vec`](https://github.com/asg017/sqlite-vec)                                              | `bun:sqlite` の `loadExtension` で読み込み |
| 埋め込みランタイム | [`@huggingface/transformers`](https://github.com/huggingface/transformers.js) v4(Transformers.js) | Bun ネイティブ対応、ONNX Runtime ベース    |
| 埋め込みモデル     | `intfloat/multilingual-e5-base`(q8 量子化、768 次元)                                              | 多言語対応、英日混在に強い                 |
| Git 操作           | [`simple-git`](https://github.com/steveukx/git-js) または `Bun.spawn` で `git` CLI 直接           |                                            |
| ファイルロック     | [`proper-lockfile`](https://www.npmjs.com/package/proper-lockfile)                                | 別プロセス分離時の保険                     |
| プロセス内イベント | Node.js `events.EventEmitter`                                                                     | Web ↔ MCP 同居時の通知                     |
| ロガー             | [`pino`](https://getpino.io/)                                                                     | Bun で動作                                 |
| ID 生成            | [`ulid`](https://github.com/ulid/javascript)                                                      | 時系列ソート可                             |
| Frontmatter        | [`gray-matter`](https://github.com/jonschlinkert/gray-matter)                                     | YAML / TOML 両対応                         |

**`core` が公開するサービスインターフェイス**:

- `ArticleService` — read / search / list / create / update / archive / freshness
- `MessageService` — post / poll / claim / respond / subscribe
- `TaskService` — enqueue / claim / complete / fail / cancel / dlq / progress
- `SearchService` — fulltext / similar / by_tag
- `EmbeddingService` — embedQuery / embedPassage / warmup
- `AuditService` — log / query
- `ReviewService` — propose / approve / reject / list(大幅書き換えの承認ゲート)
- `PolicyService` — リサーチ方針の取得・更新
- `CommentService` — 記事コメントの投稿・解決・エージェント返信
- `FeedbackService` — いいね集計 / 執筆インサイト(自己改善ループ)
- `SkillService` — スキル提案の登録・承認・却下
- `ArchiveService` — アーカイブ提案と承認反映
- `TopicService` — 購読トピック管理
- `ActivityService` — エージェント活動ログ(ダッシュボード / changelog 用)
- `BackupService` — 記事 + DB + runtime skills を専用 git リポへ集約
- `MaintenanceService` — snapshot / vacuum / reindex(Hermes が cron で呼ぶ)

Git 操作(commit / diff / history / push)は記事リポジトリ用 `article/git.ts` とバックアップ用 `BackupService` が `simple-git` 経由で行う(独立した `GitService` は持たない)。

**埋め込みの実装方針**:

- Transformers.js を `core` プロセス内に同梱、外部 API 呼び出しなし(P11)
- モデルは `core` 起動時に lazy load(初回呼び出し時に 1〜3 秒の cold start)、以降メモリ常駐
- E5 系モデルの prefix 規約に従い、検索クエリは `query: ...`、本文インデックスは `passage: ...` を付与
- `sqlite-vec` の仮想テーブルは 768 次元固定で作成
- モデル変更時は新次元用テーブルを作成し、`MaintenanceService.reindex()` で再生成する設計
- モデルファイルは `./models` 永続ボリュームにキャッシュ(`HF_HOME` 環境変数で指定)

### 5.2 Web アプリケーション(`@minakata/web`)

| 領域                  | 選定                                                                                                                    | 備考                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| フレームワーク        | [React Router v7](https://reactrouter.com/) framework mode                                                              |                             |
| サーバーアダプタ      | [`react-router-hono-server`](https://github.com/rphlmr/react-router-hono-server)                                        | Hono 上で動かす(MCP と同居) |
| HTTP ベース           | [Hono](https://hono.dev/)                                                                                               | Bun ネイティブ対応          |
| HTTP サーバー         | `Bun.serve` 経由                                                                                                        | Hono の Bun アダプタ        |
| CSS                   | [Tailwind CSS](https://tailwindcss.com/) v4                                                                             | Vite 統合                   |
| UI コンポーネント     | [shadcn/ui](https://ui.shadcn.com/)                                                                                     | コピーして所有              |
| Markdown レンダリング | [`react-markdown`](https://github.com/remarkjs/react-markdown) + [`remark-gfm`](https://github.com/remarkjs/remark-gfm) |                             |
| 差分表示              | [`diff2html`](https://github.com/rtfpessoa/diff2html)                                                                   | レビュー UI                 |
| コードハイライト      | [`shiki`](https://shiki.style/)                                                                                         | サーバーサイド              |
| 認証セッション        | [`@oslojs/jwt`](https://oslojs.dev/) + Cookie                                                                           | パスワードは Argon2id       |
| ストリーミング        | Hono SSE                                                                                                                | チャット UI                 |

**チャット UI の挙動**(P10 メッセージバス):

- POST `/chat/:sessionId/message`: `core.MessageService.post()` で SQLite に保存
- GET `/chat/:sessionId/stream`(SSE): `core.MessageService.subscribe(session_id)` で EventEmitter を listen し、レスポンスチャンクをそのままブラウザに転送
- Hermes はサブプロセスとして起動せず、独立コンテナ。Web は Hermes の存在を直接は意識しない

### 5.3 MCP サーバー(`@minakata/mcp`)

| 領域           | 選定                                                                                                                                                                          | 備考                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| MCP SDK        | [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) v1.x                                                                                    | v2 は様子見                                   |
| トランスポート | Streamable HTTP                                                                                                                                                               | SSE は非推奨                                  |
| HTTP 統合      | SDK 同梱の `WebStandardStreamableHTTPServerTransport` を Hono に手動マウント(`packages/mcp/src/hono.ts`)。Host header 検証と Bearer Token 認証はアプリ側で実装               | `@modelcontextprotocol/hono` は未リリース     |
| スキーマ       | Zod(`core` と共有)                                                                                                                                                            | tool の `inputSchema` / `outputSchema` に流用 |
| 認証           | Bearer Token(MVP)→ JWT/OAuth(将来)                                                                                                                                            |                                               |
| 検証           | [MCP Inspector](https://github.com/modelcontextprotocol/inspector)                                                                                                            | Hermes 接続前の確認                           |

**公開するツール群(概略 — 詳細は `packages/mcp/src/tools.ts`)**:

| カテゴリ       | ツール例                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 記事           | `minakata.read_article`, `create_article`, `update_article`, `list_articles`, `list_tags`, `expire_ephemeral_articles`        |
| アーカイブ提案 | `minakata.archive_article`, `unarchive_article`, `list_archive_proposals`                                                     |
| メッセージバス | `minakata.poll_messages`, `claim_message`, `post_agent_response`, `update_session_title`                                      |
| タスクキュー   | `minakata.enqueue_task`, `poll_tasks`(claim 兼用), `get_task`, `report_progress`, `complete_task`, `fail_task`, `list_dlq`   |
| 検索           | `minakata.fulltext_search`, `similar_articles`, `by_tag`                                                                      |
| レビュー       | `minakata.propose_update`, `list_pending_reviews`, `add_review_comment`                                                       |
| メンテナンス   | `minakata.snapshot_db`, `recompute_freshness`, `backup`                                                                       |
| 方針 / トピック | `minakata.get_research_policy`, `list_topics`                                                                                 |
| コメント       | `minakata.add_article_comment`, `list_article_comments`, `poll_article_comments`, `reply_article_comment`, `resolve_article_comment` |
| フィードバック | `minakata.get_feedback_signals`, `get_feedback_insights`, `update_feedback_insights`                                          |
| スキル提案     | `minakata.propose_skill`, `list_skill_proposals`                                                                              |

> **承認系(`approve_*` / `reject_*` / `update_research_policy` 等)は MCP ツールではない**。破壊的操作の承認は人間が WebUI から `core` を直接呼ぶ設計(セクション 6)で、エージェントには公開しない。

**起動形態**:

- 開発・初期運用は `@minakata/web` と同一プロセス(Hono の `/mcp` ルートにマウント)
- 負荷増・障害分離が必要になったら別コンテナへ。`core` 経由なのでコード変更小

**Hermes からの接続と障害時の扱い**:

- **トランスポート**: HTTP Streamable、`/mcp` 単一ルート、ポート 3000（`PORT` env で変更可）、Bearer Token（`MCP_TOKEN`）。SSE / stdio エンドポイントは存在しない。`uvx` / `npx` でのプロセス起動ではなく `url` ベースの HTTP 接続（`hermes/config.yaml`: `mcp_servers.minakata.url: "http://minakata:3000/mcp"`）
- **疎通確認**: `curl -fsS http://minakata:3000/health` → `{"status":"ok"}`（認証不要）。`/mcp` 自体は Bearer 必須なので curl では叩けない
- **DB 初期化**: 起動シーケンスで `runMigrations()` が同期実行される（`packages/web/server/index.ts`）ため、`/health` が返る時点で DB は初期化済み。手動 migrate は不要
- **起動順保証**: compose の healthcheck（interval 15s / retries 3）と Hermes コンテナの `depends_on: minakata: condition: service_healthy` により、Hermes 起動時に Minakata は healthy 保証済み
- **接続不能時の確認順**: ① `curl http://minakata:3000/health` で疎通 → ② `MCP_TOKEN` が `.env` と一致しているか → ③ `podman compose ps` で minakata コンテナの health 状態。**`uvx` / `npx` / PATH / プロファイル診断は Minakata には無関係なので行わない**

### 5.4 エージェントハーネス

| 領域                 | 選定                                                   | 備考                                    |
| -------------------- | ------------------------------------------------------ | --------------------------------------- |
| ハーネス             | [Hermes Agent](https://hermes-agent.nousresearch.com/) | Nous Research, Python                   |
| 永続化バックエンド   | コンテナボリューム(`hermes/` を bind mount)            | Hermes の `/opt/data` を host に集約     |
| Minakata との接続    | MCP Streamable HTTP                                    | Hermes 設定で Minakata MCP を登録       |
| 自然言語スケジューラ | Hermes ビルトイン                                      | cron 式不要、「毎晩 3 時に...」と書ける |
| サブエージェント分離 | Hermes ビルトイン                                      | Capability 分離(後述)に利用             |
| スキル自動生成       | Hermes ビルトイン                                      | admin 承認ゲート経由のみ許可            |

**Hermes 内で定義するサブエージェント**(正本は `hermes-skills/<name>/SKILL.md`):

- `dialogue` — `minakata.poll_messages` を 60 秒周期で実行、対話処理
- `researcher` — `minakata.poll_tasks` を消化、Web 検索 → 抽出 → 記事化
- `daily_research` — 毎晩 03:00 に購読トピックを順次 `enqueue_task`
- `freshness_checker` — 鮮度ランクを再計算し、しきい値超過記事を再調査投入
- `synthesizer` — 意味的に近い記事群を統合記事化(元記事はアーカイブ提案へ)
- `taxonomy_builder` — タグ・カテゴリ体系の表記揺れ統合・粒度調整(自動反映)
- `gap_detector` — 記事で言及済みだが独立記事が無いトピックを調査投入
- `feedback_analyst` — いいね/コメントを分析し執筆インサイトを更新(自己改善)
- `changelog_writer` — 前日のエージェント活動を ChangeLog 日報化
- `backup_agent` — 記事・DB・runtime skills を GitHub private repo へバックアップ

Capability 分離(セクション 8)は subagent ごとに呼べる MCP ツールを allowlist で限定する設計。機構は #224 で実装済み(Minakata 側の allowlist Proxy + per-agent token)だが、enforcement は既定で無効(単一 `MCP_TOKEN` 共有=全ツール許可)。Hermes の per-skill MCP 制限(上流 #492)が入るまで Minakata 側 allowlist は defense-in-depth として温存(Issue #208 で継続追跡)。

**重要な非採用事項**:

- **Hermes Gateway(Telegram / Discord / Slack 連携)は使わない**
- ユーザー入口は WebUI のみ(P6)

### 5.5 LLM(生成モデル供給)

**OpenCode Go を OpenAI 互換 API として利用**。Hermes の OpenAI 互換プロバイダ設定で接続する。Go は OpenCode が提供する $10/月 サブスクリプションで、curated な OSS coding model 群(GLM, Kimi, DeepSeek, Qwen など)を定額で叩ける。Zen (`/zen/v1`) も同じ API キーで併用可能だが、本プロジェクトでは Go に一本化する。

| 項目           | 値                                          |
| -------------- | ------------------------------------------- |
| エンドポイント | `https://opencode.ai/zen/go/v1`             |
| プロトコル     | OpenAI Chat Completions 互換                |
| 認証           | API キー(`opencode.ai/auth` で取得)         |
| 課金           | サブスクリプション(OpenCode Go、$10/月)     |
| モデル一覧     | `https://opencode.ai/zen/go/v1/models`      |

**タスク種別ごとのモデル切替(Go 名前空間内で使い分け)**:

| タスク                       | 推奨モデル                          | 用途                        |
| ---------------------------- | ----------------------------------- | --------------------------- |
| 対話 / ディスパッチ(低遅延) | `opencode-go/deepseek-v4-flash`     | dialogue / daily_research 等 |
| 夜間バッチ(調査・記事化)    | `opencode-go/glm-5.1`               | researcher                  |
| 重要記事の最終仕上げ         | `opencode-go/kimi-k2.6`             | premium ロール              |

Hermes 側でサブエージェントごとに使うモデルを切替える方針だが、Hermes 公式 SKILL.md は `model:` frontmatter を持たない(MVP では `hermes/config.yaml` の `model.default` 1 本で起動、ロール別モデル切替は Phase 3 で cron job 作成時に指定する)。

**Claude 等の商用モデルを使いたい場合(本書スコープ外)**: Go には Claude / GPT は含まれない。OpenCode Go provider は plugin 側で base_url を `/zen/go/v1` にハードコードし、専用 env `OPENCODE_GO_API_KEY` で auto detect する(汎用 `OPENAI_API_BASE` / `OPENAI_API_KEY` では切り替わらない)。必要になったら Hermes の `config.yaml` に Zen(pay-as-you-go)や Anthropic プロバイダを別途追加して BYOK する。MVP では Go 単独で完結させる。

**埋め込みについては本セクションの対象外**(`core` 内でローカル実行、セクション 5.1 を参照)

**将来的にローカル LLM を追加する場合**: Hermes は OpenAI 互換エンドポイントなら何でも繋がるため、`ollama` / `vllm` サービスを `docker-compose.yml` に追加し、Hermes 側プロバイダを切り替えるだけで対応可。本書スコープ外。

### 5.6 Web 検索・抽出バックエンド

Hermes は `web_search` / `web_extract` / `browser_*` を組み込みツールとして提供する。バックエンド(実際に検索・抽出を行うサービス)は pluggable で、Minakata では以下の構成を採用する。

| 用途                        | プロバイダ                      | 提供形態                     | コスト |
| --------------------------- | ------------------------------- | ---------------------------- | ------ |
| 検索(`web_search`)          | **SearXNG**                     | セルフホスト(Podman)         | 無料   |
| 抽出(`web_extract`)         | **Minakata 自前 `/v1/scrape`**  | `core`/`web` プロセス内で実行 | 無料   |
| ブラウザ自動化(`browser_*`) | (初期スコープ外)                | —                            | —      |

**抽出は Firecrawl Cloud から Minakata 自前実装に置き換え済み**。`packages/web/server/scraper.ts` が Firecrawl `/v1/scrape` 互換のエンドポイント(`packages/web/server/index.ts` で `/v1/scrape` にマウント)を提供し、Hermes はこれを `FIRECRAWL_BASE_URL=http://minakata:3000` で叩く。外部 Firecrawl への送信は発生しない。`FIRECRAWL_API_KEY` は外部 API キーではなく、Hermes → Minakata の `/v1/scrape` 呼び出しを認証する共有 Bearer シークレットとして使う。

**自前スクレイパの構成**:

- HTML 取得 → [`linkedom`](https://github.com/WebReflection/linkedom) でパース → [`@mozilla/readability`](https://github.com/mozilla/readability) で本文抽出 → [`turndown`](https://github.com/mixmark-io/turndown) で Markdown 化
- **SSRF 対策**(`scraper.ts`): スキーム検証 + DNS 解決後の IP チェックで private / loopback / link-local / 予約 IP 宛を拒否(`isPrivateIp` / `assertSafeUrl`)。IPv6 リテラル(`[::1]` 等)・IPv4-mapped IPv6(`::ffff:127.0.0.1`)も判定。リダイレクトは手動追従し各ホップを再検証、検証済み IP に接続を固定(独自 `lookup`)して DNS リバインディング / TOCTOU を封じる

**選定理由**:

- **SearXNG**: OSS、自前ホストでレート制限なし、検索エンジンメタアグリゲータ。検索回数の予測がつかないリサーチ用途と相性が良い
- **自前抽出**: 外部 API のクレジット消費・送信プライバシーを避けられる。静的 HTML が大半のリサーチ対象(ニュース、リリースノート、ドキュメント、ブログ)は Readability で十分カバーできる
- **ブラウザ自動化を初期から含めない**: JS ヘビーなページ・ログイン必須サイト・動的ダッシュボードが必要になった時点で Firecrawl Cloud 併用や Camofox / Browser Use 追加を検討

**将来の拡張余地**:

- JS レンダリングが必要なページが増えたら、`/v1/scrape` のバックエンドを Firecrawl Cloud / セルフホスト Firecrawl に差し替える(Hermes 側設定は変更不要、互換 API のまま)

**Hermes 設定**(`hermes/config.yaml`。公式 Docker docs 通り `../hermes` を `/opt/data` 丸ごと bind mount するので、このファイルが `/opt/data/config.yaml` として読まれる):

```yaml
model:
  default: "deepseek-v4-flash"  # OpenCode Go 内のモデル
  provider: "opencode-go"
mcp_servers:
  minakata:
    url: "http://minakata:3000/mcp"
    headers:
      Authorization: "Bearer ${MCP_TOKEN}"
```

Skills の初期状態の正本はリポジトリ直下 `hermes-skills/<name>/SKILL.md` に置き git 管理する。`hermes-skills/` を `/opt/minakata-skills` に :ro mount し、`hermes/cron-bootstrap.sh` が起動時に実行時 `/opt/data/skills/` へ seed する(既定は無い skill だけコピー、`MINAKATA_SKILLS_RESET=1` で初期状態へ強制上書き)。実行時 skill は Hermes が curator で自律編集するため `hermes/skills/` は gitignore して git から分離する(#187)。Cron job は `hermes/cron-bootstrap.sh` を `/etc/cont-init.d/99-minakata-cron` に :ro mount しておくと起動時に自動登録される(#52)。

SearXNG / Firecrawl は Hermes 標準の `web_search` / `web_extract` ツールが自動で利用する。FIRECRAWL_API_KEY は環境変数で渡す。SearXNG エンドポイントは Hermes 側のデフォルトに任せる(必要なら Hermes 側 cli-config.yaml.example の web 設定を確認)。

**SearXNG 設定**(`searxng/settings.yml` の重要部分):

```yaml
search:
  formats:
    - html
    - json # Hermes は JSON で結果を取得するため必須
server:
  secret_key: "${SEARXNG_SECRET}"
  limiter: false # Hermes からの自動リクエストを許容
```

### 5.7 データ永続化

| 役割                     | ストア                                     | 備考                                         |
| ------------------------ | ------------------------------------------ | -------------------------------------------- |
| Source of truth          | Markdown ファイル(`data/articles/**/*.md`) | frontmatter 付き                             |
| 履歴・バックアップ       | Git(同ディレクトリ)                        | エージェントごとに author を分けてコミット   |
| インデックス・キャッシュ | SQLite(`data/minakata.db`)                 | FTS5 / sqlite-vec / messages / tasks / audit |
| 添付・アップロード       | `data/uploads/`                            | エージェントが取り込み                       |
| 埋め込みモデルキャッシュ | `models/`(`HF_HOME`)                       | Transformers.js が初回起動時にダウンロード   |
| Hermes 永続データ        | Hermes コンテナ専用ボリューム(`hermes/`)   | 会話・メモリ・スキル                         |

**バックアップ戦略**:

- Markdown + Git: 別リポ(GitHub プライベート等)へ定期 push。Hermes が `minakata.git_push` を日次 cron で呼ぶ
- SQLite: Hermes が `minakata.snapshot_db` を日次 cron で呼ぶ。または Litestream
- 埋め込みモデル: バックアップ対象外(再ダウンロード可能)
- Hermes 自身のメモリ: ボリュームバックアップ(別途運用)

### 5.8 メッセージバス・タスクキュー

| 領域             | 選定                                                                   | 備考                                                    |
| ---------------- | ---------------------------------------------------------------------- | ------------------------------------------------------- |
| 実装             | SQLite ベース(`core.MessageService` / `core.TaskService` 自前)         | Redis 不要                                              |
| 通知             | プロセス内 `EventEmitter`(Web と MCP 同居前提)                         | 別プロセス時は SQLite ポーリング + LISTEN/NOTIFY 風実装 |
| メッセージ優先度 | 1 段階(対話は到着順)                                                   |                                                         |
| タスク優先度     | 4 段階(urgent / interactive / scheduled / maintenance)                 |                                                         |
| 同時実行制御     | `article_id` 単位で直列化                                              | Hermes 側セマフォ + `core` 側のロック                   |
| 冪等性           | `(topic_hash, date)` で重複排除                                        | enqueue 時                                              |
| 失敗処理         | Hermes の subagent エラー → `fail_task` → 指数バックオフリトライ → DLQ | UI で確認・再投入                                       |
| スケジュール     | Hermes の自然言語 cron                                                 | Minakata 側スケジューラなし                             |

**ポーリング周期の指針**:

- `poll_messages`: 60 秒(`dialogue` subagent。対話のレスポンス感とコストの折衷)
- `poll_tasks`: 数分間隔(調査タスクは長時間なので頻度低くて OK)

### 5.9 デプロイメント

| 領域                     | 選定                                                                       | 備考                                    |
| ------------------------ | -------------------------------------------------------------------------- | --------------------------------------- |
| コンテナ                 | **Podman / Podman Compose**(rootless)                                      | `bun run compose:up` でラップ。`docker` は使わない |
| ベースイメージ(minakata) | `oven/bun:1`                                                               | Bun 公式                                |
| ベースイメージ(hermes)   | `nousresearch/hermes-agent:main`                                           | 公式 image。専用 Dockerfile は持たない  |
| ベースイメージ(searxng)  | `searxng/searxng:latest`                                                   | 公式                                    |
| プロキシ                 | Caddy(任意)                                                                | HTTPS 自動取得                          |
| 永続ボリューム           | `./data`、`./models`、`./hermes`、`./hermes-skills`、`./searxng` をホストマウント |                                  |
| プロファイル             | `hermes` は `--profile agent`(`bun run compose:up:agent`)で起動           | minakata / searxng は既定で起動         |
| アーキ固定               | x86_64 推奨(`sqlite-vec` バイナリ互換性のため)                             | ARM 利用時は要動作検証                  |

**構成 `docker/docker-compose.yml`(抜粋)**。正本は同ファイルを参照(健全性チェックやコメントが付く):

```yaml
name: minakata
services:
  minakata:
    build: { context: .., dockerfile: docker/Dockerfile.minakata }
    image: minakata:dev
    ports: ["${MINAKATA_BIND:-127.0.0.1}:3000:3000"] # Web + MCP + /v1/scrape 同居
    volumes:
      - ../data:/app/data
      - ../models:/app/.cache/huggingface         # 埋め込みモデルキャッシュ
      - ../hermes/skills:/app/runtime-skills:ro    # backup_agent が runtime skills を取り込む
    environment:
      MCP_TOKEN: "${MCP_TOKEN}"
      DATABASE_URL: "file:/app/data/minakata.db"
      ARTICLES_ROOT: "/app/data/articles"
      HF_HOME: "/app/.cache/huggingface"
      MCP_ALLOWED_HOSTS: "${MCP_ALLOWED_HOSTS:-minakata:3000,localhost,localhost:3000}"
      FIRECRAWL_API_KEY: "${FIRECRAWL_API_KEY}"  # /v1/scrape の Bearer 検証用
      BACKUP_DIR: "/app/data/backup"
      BACKUP_GIT_REMOTE: "${BACKUP_GIT_REMOTE:-}"
      RUNTIME_SKILLS_DIR: "/app/runtime-skills"
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:3000/health"]
      interval: 15s
      timeout: 3s
      retries: 3

  hermes:
    image: nousresearch/hermes-agent:main
    profiles: ["agent"]            # `bun run compose:up:agent` で起動
    command: ["gateway", "run"]    # headless 長期稼働モード(cron スケジューラ込み)
    volumes:
      - ../hermes:/opt/data
      - ../hermes/config.yaml:/opt/data/config.yaml:ro
      - ../hermes-skills:/opt/minakata-skills:ro                          # skill 正本(:ro)
      - ../hermes/cron-bootstrap.sh:/etc/cont-init.d/99-minakata-cron:ro  # 起動時 seed + cron 登録
      - ../hermes/main-wrapper.sh:/opt/hermes/docker/main-wrapper.sh:ro   # HERMES_HOME 固定
    environment:
      HERMES_UID: "${HERMES_UID:-10000}"   # podman rootless の UID マッピング(#42)
      HERMES_GID: "${HERMES_GID:-10000}"
      OPENCODE_GO_API_KEY: "${OPENCODE_API_KEY}"
      FIRECRAWL_API_KEY: "${FIRECRAWL_API_KEY}"
      FIRECRAWL_BASE_URL: "${FIRECRAWL_BASE_URL:-http://minakata:3000}"  # 抽出を Minakata に転送
      SEARXNG_URL: "${SEARXNG_URL:-http://searxng:8080}"
      MCP_TOKEN: "${MCP_TOKEN}"
    depends_on:
      minakata: { condition: service_healthy }
      searxng: { condition: service_started }

  searxng:
    image: searxng/searxng:latest
    volumes:
      - ../searxng:/etc/searxng
    environment:
      INSTANCE_NAME: "minakata-search"
      SEARXNG_SECRET: "${SEARXNG_SECRET}"
    expose: ["8080"]   # Hermes コンテナからのみアクセス。外部公開不要
```

---

## 6. 認証・認可

| 観点             | MVP                                   | 将来           |
| ---------------- | ------------------------------------- | -------------- |
| Web ユーザー認証 | メール+パスワード(Argon2id ハッシュ)  | OIDC / SSO     |
| MCP 認証         | Bearer Token(環境変数)                | OAuth 2.1      |
| ロール           | `viewer` / `editor` / `admin` の 3 段 | 細粒度 RBAC    |
| 監査ログ         | 全変更系操作を SQLite に記録          | 改ざん検知付き |

**承認ゲート**(破壊的操作のみ human-in-the-loop):

| 操作                        | ゲート                          |
| --------------------------- | ------------------------------- |
| 記事新規作成・追記          | なし                            |
| 大幅書き換え(>30% 変更)     | editor 承認                     |
| アーカイブ・削除            | admin 承認                      |
| Hermes 自己改善(スキル追加) | admin 承認 + コード差分レビュー |
| 外部 HTTP POST              | 原則禁止(限定 allowlist のみ)   |

承認ゲートの「保留」は MCP ツールが作る(`minakata.archive_article` は即時アーカイブせず `pending_approval` の提案を登録)。「承認/却下」はエージェントに公開せず、admin が WebUI から `core` を直接呼んだときに初めて反映する。

---

## 7. 観測・ロギング

| 種別               | 実装                                                                        |
| ------------------ | --------------------------------------------------------------------------- |
| アプリログ         | `pino` JSON + コンテナ stdout                                               |
| 監査ログ           | `core.AuditService`(SQLite `audit_log` テーブル)                            |
| トレース           | OpenTelemetry(将来導入)                                                     |
| LLM コスト計測     | Hermes が `complete_task` でトークン数・コスト見積を渡し、Minakata 側で集計(精度改善は Issue #189) |
| Web 抽出コスト計測 | 自前 `/v1/scrape` のため外部コストなし。リクエスト数はアプリログで把握      |
| 埋め込みコスト     | 計測不要(ローカル実行)。CPU/メモリ消費は通常のリソース監視で                |
| メトリクス         | `/metrics` Prometheus 形式(将来)                                            |

監査ログの最低限のフィールド: `id, timestamp, actor, agent_name, hermes_session_id, tool_name, target_article_id, before_hash, after_hash, source_request_id, cost_usd`

---

## 8. セキュリティ

### 8.1 プロンプトインジェクション対策

| パターン                        | 実装                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Capability 分離**             | 各 subagent が呼べる MCP ツールを allowlist で限定する。**機構は #224 で実装済み**(`tools.ts` の `CAPABILITIES` + `registerTool` を gate する Proxy、per-agent token)。ただし **enforcement は既定 OFF**: 既定は単一 `MCP_TOKEN` 共有で agent 未特定=全ツール許可。per-agent token を効かせるには Hermes の per-skill MCP 制限(上流 #492)待ち。Minakata 側 allowlist は defense-in-depth として温存。継続追跡 Issue #208 |
| **コンテンツフェンシング**      | 外部取得テキストは `<untrusted_content>` タグで囲む。`web_extract`(`/v1/scrape`)と `read_document` は**サーバ側で自動フェンス**(偽閉じタグもエスケープ)。**`web_search`(Hermes 内蔵→SearXNG)のスニペットはフェンス対象外**で SKILL のプロンプト制約に依存 |
| **ドメイン API による行動制限** | エージェントが触れるのは Minakata MCP ツールのみ。`shell_exec` / 任意外部 HTTP は許可しない。`web_extract`(`/v1/scrape`)は SSRF 対策(スキーム/IP 検証・リダイレクト再検証・DNS ピン留め・IPv6/IPv4-mapped 判定)を経る |
| **承認ゲート**                  | 破壊的操作は WebUI レビュー(セクション 6)。エージェント経由の `update_article` は `status` 直変更を拒否し archived はアーカイブ提案へ回す |
| **監査・ロールバック**          | 全変更を git に記録                                                                                          |

参考:

- [Simon Willison — Dual LLM pattern](https://simonwillison.net/2023/Apr/25/dual-llm-pattern/)
- [Google — CaMeL: Defeating Prompt Injections by Design](https://arxiv.org/abs/2503.18813)
- [OWASP LLM Top 10 — LLM01: Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)

### 8.2 MCP サーバー側の保護

- Host header 検証(`MCP_ALLOWED_HOSTS` で許可ホストを限定し DNS rebinding を防ぐ。`packages/mcp/src/hono.ts`)
- Bearer Token 認証(`MCP_TOKEN`)
- コンテナネットワーク内で閉じる(searxng は `expose` のみで外部非公開)
- Tool 入力は Zod でバリデーション。破壊系・特権ツール(archive_article / propose_skill / backup / snapshot_db / expire_ephemeral_articles)は `.strict()` で未知キーを拒否する

### 8.3 シークレット管理

- 環境変数(`.env`、git 管理外)
- 本番: Podman Secrets / SOPS / 1Password CLI 等
- LLM API キー(OpenCode Go/Zen / Anthropic 等)は **Hermes コンテナのみが保持**。Minakata 側からは見えない。`FIRECRAWL_API_KEY` は外部キーではなく Hermes ↔ Minakata `/v1/scrape` の共有 Bearer シークレット(両コンテナで同値)

### 8.4 プライバシー

- 埋め込み生成はローカルで完結するため、記事本文が外部 API に送信されない(P11)
- 外部送信が発生するのは: (a) 生成系 LLM へのプロンプト(OpenCode Go/Zen)、(b) Web 検索クエリ(SearXNG 経由)、(c) Web 抽出対象 URL への直接アクセス(Minakata 自前 `/v1/scrape`。第三者の抽出 API は経由しない)に限られる

---

## 9. 開発・運用ツール

| 領域               | ツール                                                              |
| ------------------ | ------------------------------------------------------------------- |
| パッケージ管理     | **Bun workspaces**                                                  |
| ビルド             | `bun build`(必要に応じて Vite)                                      |
| Linter / Formatter | [Biome](https://biomejs.dev/)                                       |
| テスト             | **`bun test`**(Vitest 互換 API)                                     |
| E2E                | [Playwright](https://playwright.dev/)                               |
| 型チェック         | TypeScript strict + `tsc --noEmit` を CI で                         |
| Git hook           | [Lefthook](https://github.com/evilmartians/lefthook)                |
| CI                 | GitHub Actions(self-hosted runner OK)                               |
| MCP 動作確認       | `bunx @modelcontextprotocol/inspector`                              |
| DB 確認            | [DB Browser for SQLite](https://sqlitebrowser.org/) / `sqlite3` CLI |

---

## 10. 非機能要件・想定スケール

| 項目                         | 想定値                                          |
| ---------------------------- | ----------------------------------------------- |
| 同時利用ユーザー             | 〜10 名(チーム単位)                             |
| 記事数                       | 〜10,000                                        |
| 1日あたり調査タスク          | 〜500                                           |
| 1日あたり Web 抽出ページ数   | 〜数百(自前 `/v1/scrape`。外部クレジット枠なし) |
| 並列調査 subagent            | 1〜10(Hermes 側で制御)                          |
| Web UI レスポンスタイム(p95) | < 1s                                            |
| 対話の初回応答(p95)          | < 30s(`poll_messages` 周期 + LLM 応答)          |
| 個別調査の完了時間(p95)      | < 5min                                          |
| 夜間バッチの完了時刻         | 朝 7:00 までに完了                              |
| データボリューム上限         | 10GB(Markdown + SQLite)                         |
| `minakata` コンテナのメモリ  | 1〜2GB(うち埋め込みモデル常駐 〜200MB)          |

**スケール越え時の対応**:

- 記事数 10,000 超 → ベクトル検索のインデックス再構築戦略を見直し
- ユーザー数 30 超 → MCP を別プロセス分離、Postgres 移行を検討
- 対話レイテンシが問題化 → `poll_messages` 周期短縮 or pub/sub 化(Redis 等)を検討
- JS レンダリングが必要なページが増加 → `/v1/scrape` のバックエンドを Firecrawl 等へ差し替え
- 埋め込みスループット不足 → `multilingual-e5-small` への切替(精度トレードオフ)、または専用埋め込みサービス(TEI 等)への切り出し

---

## 11. 採用しないものと理由(Non-goals)

| 候補                                                                           | 採用しない理由                                                                         |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| **ローカル LLM 推論サーバー(Ollama / vLLM 等)**                                | 生成系は OpenCode Go を使う(P7)。後から追加可能                                        |
| **埋め込み API(OpenAI / Cohere 等の外部依存)**                                 | ローカル実行で十分な品質。コスト・プライバシーの両面で有利(P11)                        |
| **外部メッセージングゲートウェイ(Telegram / Discord / Slack、Hermes Gateway)** | ユーザー入口を WebUI に一本化(P6)                                                      |
| **OpenCode CLI(opencode コマンド)**                                            | 採用するのは OpenCode Go の **モデルサービス**のみ。harness は Hermes                  |
| **`@minakata/worker`(独自スケジューラ・ワーカー)**                             | Hermes の cron + subagent が同等機能を提供(P9)                                         |
| **WebSocket / pub/sub によるリアルタイム配信**                                 | 初期は SQLite + EventEmitter で十分。レイテンシ要件は満たす                            |
| **Nous Tool Gateway**                                                          | Nous Portal の有料サブスクが必要。OpenCode Go で推論をしているため二重コスト           |
| **ブラウザ自動化バックエンド(Browserbase / Browser Use / Camofox)**            | 初期スコープ外。`web_extract` でカバーできない要件が出てきたら検討                     |
| **専用埋め込みサービス(TEI / Ollama embeddings)**                              | Minakata の規模では Transformers.js を `core` 同梱で十分。将来スループット不足時に検討 |
| Next.js                                                                        | React Router v7 で必要十分                                                             |
| Node.js / pnpm                                                                 | Bun に統一(P8)                                                                         |
| `better-sqlite3`                                                               | `bun:sqlite` を採用                                                                    |
| PostgreSQL                                                                     | チーム規模では SQLite + FTS5 で足りる                                                  |
| Redis / BullMQ                                                                 | キューも SQLite で                                                                     |
| Pinecone / Weaviate                                                            | `sqlite-vec` で足りる                                                                  |
| LangChain / LlamaIndex                                                         | Hermes がハーネスを担う                                                                |
| Elasticsearch / Meilisearch                                                    | FTS5 で間に合う                                                                        |
| Kubernetes                                                                     | Podman Compose で運用                                                                  |
| **外部 Web 抽出 API(Firecrawl Cloud 等)を既定にする**                         | 自前 `/v1/scrape`(Readability)で十分。コスト・プライバシー優先。必要時のみ差し替え     |
| 自前エージェントフレームワーク                                                 | Hermes を使う。再発明しない                                                            |

---

## 12. 参考リンク

### MCP

- TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- Server Guide: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md
- Inspector: https://github.com/modelcontextprotocol/inspector
- MCP 仕様: https://modelcontextprotocol.io/

### Hermes Agent

- 公式: https://hermes-agent.nousresearch.com/
- GitHub: https://github.com/NousResearch/hermes-agent
- ドキュメント: https://hermes-agent.nousresearch.com/docs/
- Web Search & Extract ドキュメント: https://hermes-agent.nousresearch.com/docs/user-guide/features/web-search

### OpenCode Go / Zen

- Go 公式: https://opencode.ai/docs/go/
- Zen 公式: https://opencode.ai/docs/zen/
- Providers ドキュメント: https://opencode.ai/docs/providers/
- 認証: https://opencode.ai/auth
- モデル一覧: https://models.dev/

### Web 検索・抽出

- SearXNG ドキュメント: https://docs.searxng.org/
- SearXNG (GitHub): https://github.com/searxng/searxng
- Firecrawl 公式: https://www.firecrawl.dev/
- Firecrawl OSS: https://github.com/mendableai/firecrawl

### 埋め込み

- Transformers.js: https://github.com/huggingface/transformers.js
- Transformers.js ドキュメント: https://huggingface.co/docs/transformers.js
- multilingual-e5-base モデル: https://huggingface.co/intfloat/multilingual-e5-base
- 日本語埋め込み評価(参考): https://github.com/oshizo/JapaneseEmbeddingEval

### Bun

- 公式: https://bun.sh/
- bun:sqlite: https://bun.sh/docs/api/sqlite
- Workspaces: https://bun.sh/docs/install/workspaces
- bun test: https://bun.sh/docs/cli/test

### React Router v7

- 公式: https://reactrouter.com/
- Hono アダプタ: https://github.com/rphlmr/react-router-hono-server

### データストア

- SQLite FTS5: https://www.sqlite.org/fts5.html
- sqlite-vec: https://github.com/asg017/sqlite-vec
- Litestream: https://litestream.io/

### セキュリティ

- OWASP LLM Top 10: https://genai.owasp.org/llm-top-10/
- CaMeL paper: https://arxiv.org/abs/2503.18813
- Dual LLM pattern: https://simonwillison.net/2023/Apr/25/dual-llm-pattern/

---

## 13. 改訂履歴

| 版        | 日付       | 変更 |
| --------- | ---------- | ---- |
| 0.1.0-mvp | 2026-05-21 | 初版 |
| 0.1.0-mvp | 2026-06-09 | 実装に合わせ更新: コンテナランタイムを Podman に統一 / Web 抽出を Minakata 自前 `/v1/scrape`(Readability)へ置換 / subagent 一覧を hermes-skills 正本に同期 / MCP ツール表を実際の登録 41 ツールへ更新 / core サービス一覧を追補 / compose 例を実ファイルに整合 / Capability 分離の MVP 未実装(#208)を明記 |
| 0.1.0-mvp | 2026-07-07 | プロンプトインジェクション監査の是正: Capability 分離を「機構実装済み・既定 OFF(#492 待ち)」へ記述更新 / コンテンツフェンシングの `web_search` 非対象を明記 / SSRF 対策にリダイレクト再検証・DNS ピン留め・IPv6 判定を追記 / `update_article` の status 直変更ゲートを明記 |
