---
title: "技術スタック仕様"
version: "0.1.0-mvp"
created_at: "2026-05-21"
modified_at: "2026-05-21"
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
| P1  | 自己ホスティング前提                                     | Docker Compose で完結                                                  |
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
              ┌──────────────────────────┐
              │  Hermes Agent             │
              │  - dialogue subagent       │
              │  - researcher subagent     │
              │  - freshness subagent      │
              │  - 自然言語 cron で:        │
              │    * メッセージ poll       │
              │    * 調査タスク poll        │
              │    * デイリーリサーチ起動    │
              │    * 鮮度チェック          │
              │  - LLM 接続:                │
              │    OpenCode Go (OpenAI互換) │
              │    + BYOK(任意)            │
              │  - Web 接続:                │
              │    search → SearXNG         │
              │    extract → Firecrawl      │
              └──────────────────────────┘
```

**ユーザー対話の流れ(対話エージェント)**:

1. ユーザーがチャットで発言 → Web が `core.PostUserMessage(session_id, text)` で SQLite に保存
2. Web は SSE で `/chat/:sessionId/stream` を購読中
3. Hermes が短周期 cron(例:30 秒ごと)で `minakata.poll_messages` MCP ツールを呼ぶ
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
│   ├── web/               # React Router v7 アプリ
│   └── mcp/               # MCP サーバー
├── docker/
│   ├── Dockerfile.minakata   # web + mcp 同居
│   ├── Dockerfile.hermes     # Hermes 用(必要なら)
│   └── docker-compose.yml
├── hermes/                # Hermes 設定・スキル
│   ├── config/
│   └── skills/
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

- `ArticleService` — read / search / list / create / update / archive
- `MessageService` — post / poll / claim / respond / subscribe
- `TaskService` — enqueue / claim / complete / fail / cancel / dlq
- `SearchService` — fulltext / similar / by_tag
- `EmbeddingService` — embedQuery / embedPassage / warmup
- `AuditService` — log / query
- `GitService` — commit / diff / history / push
- `MaintenanceService` — snapshot / vacuum / reindex(Hermes が cron で呼ぶ)

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
| 記事           | `minakata.read_article`, `create_article`, `update_article`, `list_articles`                                                  |
| アーカイブ承認 | `minakata.archive_article`, `unarchive_article`, `approve_archive`, `reject_archive`, `list_archive_proposals`                |
| メッセージバス | `minakata.poll_messages`, `claim_message`, `post_agent_response`                                                              |
| タスクキュー   | `minakata.poll_tasks`(claim 兼用), `complete_task`, `fail_task`, `enqueue_task`                                              |
| 検索           | `minakata.fulltext_search`, `similar_articles`, `by_tag`                                                                      |
| レビュー       | `minakata.propose_update`, `approve_review`, `reject_review`, `list_pending_reviews`, `add_review_comment`                    |
| メンテナンス   | `minakata.snapshot_db`, `recompute_freshness`                                                                                 |
| 方針 / コメント | `minakata.get_research_policy`, `update_research_policy`, `add_article_comment`, `list_article_comments`, `resolve_article_comment` |
| スキル提案     | `minakata.propose_skill`, `approve_skill`, `reject_skill`, `list_skill_proposals`                                             |

**起動形態**:

- 開発・初期運用は `@minakata/web` と同一プロセス(Hono の `/mcp` ルートにマウント)
- 負荷増・障害分離が必要になったら別コンテナへ。`core` 経由なのでコード変更小

**Hermes からの接続と障害時の扱い**:

- **トランスポート**: HTTP Streamable、`/mcp` 単一ルート、ポート 3000（`PORT` env で変更可）、Bearer Token（`MCP_TOKEN`）。SSE / stdio エンドポイントは存在しない。`uvx` / `npx` でのプロセス起動ではなく `url` ベースの HTTP 接続（`hermes/config.yaml`: `mcp_servers.minakata.url: "http://minakata:3000/mcp"`）
- **疎通確認**: `curl -fsS http://minakata:3000/health` → `{"status":"ok"}`（認証不要）。`/mcp` 自体は Bearer 必須なので curl では叩けない
- **DB 初期化**: 起動シーケンスで `runMigrations()` が同期実行される（`packages/web/server/index.ts`）ため、`/health` が返る時点で DB は初期化済み。手動 migrate は不要
- **起動順保証**: Docker healthcheck（interval 15s / retries 3）と Hermes コンテナの `depends_on: minakata: condition: service_healthy` により、Hermes 起動時に Minakata は healthy 保証済み
- **接続不能時の確認順**: ① `curl http://minakata:3000/health` で疎通 → ② `MCP_TOKEN` が `.env` と一致しているか → ③ `podman compose ps` で minakata コンテナの health 状態。**`uvx` / `npx` / PATH / プロファイル診断は Minakata には無関係なので行わない**

### 5.4 エージェントハーネス

| 領域                 | 選定                                                   | 備考                                    |
| -------------------- | ------------------------------------------------------ | --------------------------------------- |
| ハーネス             | [Hermes Agent](https://hermes-agent.nousresearch.com/) | Nous Research, Python                   |
| 永続化バックエンド   | Docker                                                 | Hermes ネイティブ対応                   |
| Minakata との接続    | MCP Streamable HTTP                                    | Hermes 設定で Minakata MCP を登録       |
| 自然言語スケジューラ | Hermes ビルトイン                                      | cron 式不要、「毎晩 3 時に...」と書ける |
| サブエージェント分離 | Hermes ビルトイン                                      | Capability 分離(後述)に利用             |
| スキル自動生成       | Hermes ビルトイン                                      | admin 承認ゲート経由のみ許可            |

**Hermes 内で定義するサブエージェント**:

- `dialogue` — `minakata.poll_messages` を 30 秒周期で実行、対話処理
- `researcher` — `minakata.poll_tasks` を 5 分周期で消化、記事更新
- `daily_research` — 毎晩 03:00 に購読トピックを順次 `enqueue_task`
- `freshness_checker` — 6 時間ごとに鮮度しきい値超過記事を `enqueue_task`
- `fetcher` / `synthesizer` / `writer` — Capability 分離用(セクション 8)

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

**Claude 等の商用モデルを使いたい場合(本書スコープ外)**: Go には Claude / GPT は含まれない。必要になったら `OPENAI_API_BASE` を `https://opencode.ai/zen/v1` に切替えて Zen の pay-as-you-go を併用するか、Hermes に Anthropic プロバイダを追加して BYOK する。MVP では Go 単独で完結させる。

**埋め込みについては本セクションの対象外**(`core` 内でローカル実行、セクション 5.1 を参照)

**将来的にローカル LLM を追加する場合**: Hermes は OpenAI 互換エンドポイントなら何でも繋がるため、`ollama` / `vllm` サービスを `docker-compose.yml` に追加し、Hermes 側プロバイダを切り替えるだけで対応可。本書スコープ外。

### 5.6 Web 検索・抽出バックエンド

Hermes は `web_search` / `web_extract` / `browser_*` を組み込みツールとして提供する。バックエンド(実際に検索・抽出を行うサービス)は pluggable で、Minakata では以下の構成を採用する。

| 用途                        | プロバイダ          | 提供形態             | コスト                              |
| --------------------------- | ------------------- | -------------------- | ----------------------------------- |
| 検索(`web_search`)          | **SearXNG**         | セルフホスト(Docker) | 無料                                |
| 抽出(`web_extract`)         | **Firecrawl Cloud** | クラウド API         | 500 クレジット/月の無料枠、以降従量 |
| ブラウザ自動化(`browser_*`) | (初期スコープ外)    | —                    | —                                   |

**選定理由**:

- **SearXNG**: OSS、自前ホストでレート制限なし、検索エンジンメタアグリゲータ。検索回数の予測がつかないリサーチ用途と相性が良い
- **Firecrawl**: JS レンダリング・Cloudflare 等の保護に対応、API キー 1 つで導入できる。`web_extract` を Firecrawl にすると JS ヘビーなリリースノートページや製品ページも安定して読める
- **per-capability split**: Hermes は検索と抽出で別プロバイダを使えるので、SearXNG(検索)+ Firecrawl(抽出)の組み合わせが可能
- **ブラウザ自動化を初期から含めない**: 多くのリサーチ対象(ニュース、リリースノート、ドキュメント、ブログ)は `web_extract` でカバーできる。ログイン必須サイト・動的ダッシュボードが必要になった時点で Camofox(ローカル)や Browser Use(クラウド)を追加検討

**運用上のしきい値とフォールバック**:

- Firecrawl の無料枠 500/月はあくまで試験運用想定。本稼働すると数千クレジット/月になりうるので、本格運用入りで → 有料プラン($25/月〜)へ昇格、または **Firecrawl もセルフホスト**(OSS 版が公式リポジトリで公開されている)に切替
- SearXNG が想定どおり動かない場合の代替として、`hermes skills install official/research/searxng-search` でフォールバック用スキルが用意されている

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

Skills は `hermes/skills/<name>/SKILL.md` に置けば `/opt/data/skills/` として Hermes に直接見える(`external_dirs` は不要)。Cron job は `hermes/cron-bootstrap.sh` を `/etc/cont-init.d/99-minakata-cron` に :ro mount しておくと起動時に自動登録される(#52)。

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

- `poll_messages`: 30 秒(対話のレスポンス感)
- `poll_tasks`: 5 分(調査タスクは長時間なので頻度低くて OK)

### 5.9 デプロイメント

| 領域                     | 選定                                                           | 備考                   |
| ------------------------ | -------------------------------------------------------------- | ---------------------- |
| コンテナ                 | Docker / Docker Compose                                        | 自己ホスティング前提   |
| ベースイメージ(minakata) | `oven/bun:1`                                                   | Bun 公式               |
| ベースイメージ(hermes)   | Hermes 公式イメージ(なければ Python ベース)                    |                        |
| ベースイメージ(searxng)  | `searxng/searxng:latest`                                       | 公式                   |
| プロキシ                 | Caddy(任意)                                                    | HTTPS 自動取得         |
| 永続ボリューム           | `./data`、`./models`、`./hermes`、`./searxng` をホストマウント |                        |
| アーキ固定               | x86_64 推奨(`sqlite-vec` バイナリ互換性のため)                 | ARM 利用時は要動作検証 |

**最小構成 `docker-compose.yml`**:

```yaml
services:
  minakata:
    build: { context: ., dockerfile: docker/Dockerfile.minakata }
    ports: ["3000:3000"] # Web + MCP 同居
    volumes:
      - "./data:/app/data"
      - "./models:/app/.cache/huggingface" # 埋め込みモデルキャッシュ
    environment:
      MCP_TOKEN: "${MCP_TOKEN}"
      DATABASE_URL: "file:/app/data/minakata.db"
      HF_HOME: "/app/.cache/huggingface"

  hermes:
    image: nousresearch/hermes-agent:main
    command: ["gateway", "run"]
    volumes:
      - "./hermes:/opt/data"
      - "./hermes/cron-bootstrap.sh:/etc/cont-init.d/99-minakata-cron:ro"
    environment:
      # podman rootless 時の UID マッピング
      HERMES_UID: "${HERMES_UID:-10000}"
      HERMES_GID: "${HERMES_GID:-10000}"
      # OpenCode Go (base_url ハードコード)
      OPENCODE_GO_API_KEY: "${OPENCODE_API_KEY}"
      # Web 抽出: Firecrawl
      FIRECRAWL_API_KEY: "${FIRECRAWL_API_KEY}"
      # Minakata MCP の Bearer Token (config.yaml の headers で展開)
      MCP_TOKEN: "${MCP_TOKEN}"
    depends_on: [minakata, searxng]

  searxng:
    image: searxng/searxng:latest
    volumes:
      - "./searxng:/etc/searxng"
    environment:
      INSTANCE_NAME: "minakata-search"
      SEARXNG_SECRET: "${SEARXNG_SECRET}"
    # Hermes コンテナからのみアクセスする想定。外部公開は不要
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

承認ゲートは MCP ツール側で実装(`minakata.archive_article` は `pending_approval` 状態で保留、Web UI から admin が承認すると初めて反映)。

---

## 7. 観測・ロギング

| 種別               | 実装                                                                        |
| ------------------ | --------------------------------------------------------------------------- |
| アプリログ         | `pino` JSON + Docker stdout                                                 |
| 監査ログ           | `core.AuditService`(SQLite `audit_log` テーブル)                            |
| トレース           | OpenTelemetry(将来導入)                                                     |
| LLM コスト計測     | Hermes が `complete_task` でトークン数・コスト見積を渡し、Minakata 側で集計 |
| Web 抽出コスト計測 | Firecrawl ダッシュボードで月次クレジット消費を確認                          |
| 埋め込みコスト     | 計測不要(ローカル実行)。CPU/メモリ消費は通常のリソース監視で                |
| メトリクス         | `/metrics` Prometheus 形式(将来)                                            |

監査ログの最低限のフィールド: `id, timestamp, actor, agent_name, hermes_session_id, tool_name, target_article_id, before_hash, after_hash, source_request_id, cost_usd`

---

## 8. セキュリティ

### 8.1 プロンプトインジェクション対策

| パターン                        | 実装                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Capability 分離**             | Hermes の subagent 機構で `fetcher` / `synthesizer` / `writer` を分離。各 subagent が呼べる MCP ツールを限定 |
| **コンテンツフェンシング**      | 外部取得テキストは `<untrusted_content>` タグで囲んで synthesizer に渡す                                     |
| **ドメイン API による行動制限** | エージェントが触れるのは Minakata MCP ツールのみ。`shell_exec` / 任意外部 HTTP は許可しない                  |
| **承認ゲート**                  | 破壊的操作は WebUI レビュー(セクション 6)                                                                    |
| **監査・ロールバック**          | 全変更を git に記録                                                                                          |

参考:

- [Simon Willison — Dual LLM pattern](https://simonwillison.net/2023/Apr/25/dual-llm-pattern/)
- [Google — CaMeL: Defeating Prompt Injections by Design](https://arxiv.org/abs/2503.18813)
- [OWASP LLM Top 10 — LLM01: Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)

### 8.2 MCP サーバー側の保護

- Host header 検証(`@modelcontextprotocol/hono` 標準提供)
- Bearer Token / OAuth 認証
- Docker network 内で閉じる(リクエスト元 IP 制限)
- Tool 入力は Zod で厳格バリデーション

### 8.3 シークレット管理

- 環境変数(`.env`、git 管理外)
- 本番: Docker Secrets / SOPS / 1Password CLI 等
- LLM API キー(OpenCode Go/Zen / Anthropic 等)・Firecrawl API キーは **Hermes コンテナのみが保持**。Minakata 側からは見えない

### 8.4 プライバシー

- 埋め込み生成はローカルで完結するため、記事本文が外部 API に送信されない(P11)
- 外部送信が発生するのは: (a) 生成系 LLM へのプロンプト(OpenCode Go/Zen)、(b) Web 検索クエリ(SearXNG 経由)、(c) Web 抽出対象 URL(Firecrawl Cloud)に限られる

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
| 1日あたり Web 抽出ページ数   | 〜100(Firecrawl 無料枠想定。本稼働時は要見直し) |
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
- Web 抽出 500/月 超 → Firecrawl 有料化 or セルフホスト切替
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
| Kubernetes                                                                     | Docker Compose で運用                                                                  |
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
