# Minakata

> AI エージェントハーネスによる自動情報収集・チーム共有ナレッジベース。
> 名称は徹底したフィールドワークで在野研究を残した「南方熊楠」に由来。

Minakata は購読トピックを毎晩自動調査し、調査結果を Markdown ベースの Wiki として蓄積するシステムです。チームは WebUI で閲覧・検索・レビューができ、深掘りはチャット経由で対話エージェントに依頼します。

- 設計ドキュメント: `docs/grand-design.md`, `docs/tech-stack.md`, `docs/user-stories.md`, `docs/non-functional-requirement.md`
- 開発フェーズ: `0.1.0-mvp`(MVP コアの実装が進行中)

## アーキテクチャ要点

```
[ User Browser ]
      │ HTTPS (loader/action + SSE)
      ▼
[ @minakata/web ]  ── in-process call ──┐
      │ /mcp                            ▼
      ▼                          [ @minakata/core ]
[ @minakata/mcp ] ──────────────────┐    │
      ▲ Streamable HTTP             │    ├─ articles / search / messages / tasks
      │ Bearer Token                │    ├─ auth / audit / review / policy
[ Hermes Agent ] ─ subagents ─┐     ▼    └─ embedding (Transformers.js, ローカル)
   ├─ dialogue                │  [ Markdown + Git ]
   ├─ researcher              │  [ SQLite (FTS5 + sqlite-vec) ]
   ├─ daily_research          │
   ├─ freshness_checker       │
   └─ changelog_writer        │
        │ web_search          │
        ▼                     ▼
   [ SearXNG ]          [ Firecrawl Cloud ]
```

- **`@minakata/core`** : ドメインロジック共有ライブラリ。Web / MCP の両方が呼ぶ。
- **`@minakata/web`** : React Router v7 framework mode + `react-router-hono-server`(Bun)。BFF を兼ねる。
- **`@minakata/mcp`** : MCP サーバー。Web プロセスの `/mcp` にマウント。Hermes が接続する唯一の口。
- **Hermes** : Docker で独立稼働するエージェントハーネス。Minakata MCP 経由でしか Minakata 側に書き込めない。
- **SearXNG / Firecrawl** : Hermes が Web 検索 / 抽出に使う。

詳細は `docs/grand-design.md`(P1〜P11)と `docs/tech-stack.md` を参照。

## 前提

| ツール             | バージョン | 用途                                                   |
| ------------------ | ---------- | ------------------------------------------------------ |
| **Bun**            | 1.x        | 全パッケージのランタイム / パッケージマネージャ        |
| **Docker**         | 24+        | docker compose で minakata / hermes / searxng を起動   |
| **Git**            | 2.x        | `data/articles` の履歴管理(`@minakata/core` が初期化) |
| **macOS / Linux**  | x86_64 推奨 | `sqlite-vec` のバイナリ互換性のため。ARM は要動作検証 |

> Node.js / pnpm / npm は使いません(P8)。`bun` で統一してください。

### sqlite-vec の動作要件

`bun:sqlite` が組み込みでバンドルしている SQLite は拡張ロードが無効化されています。`@minakata/core` の `openDb()` は以下の順に拡張対応 SQLite を探し、`Database.setCustomSQLite()` で差し替えます:

1. 環境変数 `SQLITE_CUSTOM_LIB` で明示指定したパス
2. macOS Homebrew (`/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib`)
3. Linux 標準パス (`/usr/lib/x86_64-linux-gnu/libsqlite3.so.0` ほか)

ローカルで動かない場合は Homebrew で `brew install sqlite` を入れるか、`SQLITE_CUSTOM_LIB` を指定してください。Docker イメージ(`oven/bun:1` ベース)は Debian Bookworm の `libsqlite3-0` を導入済みのため、特別な設定不要です。

## クイックスタート(Docker Compose)

最も簡単な起動手順。`User Story US-1.1` の受け入れ条件を満たすパスです。

```bash
# 1) クローンして移動
git clone <repo-url> minakata && cd minakata

# 2) 環境変数を準備
cp .env.example .env
# .env を編集:最低限 MCP_TOKEN と SEARXNG_SECRET を埋める
#   生成例: openssl rand -hex 32

# 3) Minakata 本体(web + MCP)だけ先に起動
docker compose -f docker/docker-compose.yml --env-file .env up -d minakata

# 4) ブラウザで http://localhost:3000 を開く
#    初回アクセスで /setup に飛ぶので、管理者メール+パスワード(8 文字以上)を登録

# 5) Hermes(エージェント)を起動する場合は profile を指定
#    OPENCODE_API_KEY / FIRECRAWL_API_KEY を .env に入れたうえで
docker compose -f docker/docker-compose.yml --env-file .env --profile agent up -d
```

- `minakata` コンテナ: ポート 3000 で `web` + `mcp` を同居。`./data` と `./models` をホストマウント。
- `hermes` コンテナ: `--profile agent` を付けたときだけ起動。LLM API キーは Hermes 側のみが保持(Minakata からは見えない設計)。
- `searxng` コンテナ: Hermes が `web_search` に使う。ポートは外部公開しない(Docker network 内で完結)。

### 停止 / 再起動 / ログ

```bash
docker compose -f docker/docker-compose.yml --env-file .env logs -f minakata
docker compose -f docker/docker-compose.yml --env-file .env restart minakata
docker compose -f docker/docker-compose.yml --env-file .env down
```

## ローカル開発(コンテナ無しで動かす)

UI を素早く回したい / `bun test` を書く場合は、Bun を直接動かすのが速い。

```bash
# 1) 依存インストール(Bun workspaces)
bun install

# 2) 環境変数(最低限)
cp .env.example .env
# DATABASE_URL を実体パスに変えるのを忘れずに
#   DATABASE_URL=file:./data/minakata.db
#   ARTICLES_ROOT=./data/articles
#   HF_HOME=./models
#   MCP_TOKEN=$(openssl rand -hex 32)
#   MCP_ALLOWED_HOSTS=localhost,localhost:3000,127.0.0.1,127.0.0.1:3000

# 3) Dev サーバー(Vite + react-router-hono-server)
bun run dev
# → http://localhost:3000

# 4) 別ターミナルでテスト / 型チェック / lint
bun test
bun run typecheck
bun run lint           # 修正は bun run lint:fix
```

### MCP エンドポイントを単体で叩く

開発時に MCP ツールを直接試したいときは `bunx @modelcontextprotocol/inspector` か curl が使えます:

```bash
# tools/list を叩く例(Streamable HTTP, stateless)
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer ${MCP_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## 環境変数

`.env.example` に全項目があります。重要なものだけ抜粋:

| 変数                  | 用途                                                                  | 必須              |
| --------------------- | --------------------------------------------------------------------- | ----------------- |
| `MCP_TOKEN`           | MCP の Bearer Token。Hermes と共有                                    | 必須(空は危険)   |
| `MCP_ALLOWED_HOSTS`   | MCP の Host ヘッダ allowlist(DNS rebinding 対策)。カンマ区切り        | 推奨              |
| `DATABASE_URL`        | SQLite のパス(`file:` プレフィックス)。例: `file:/app/data/minakata.db` | 必須              |
| `ARTICLES_ROOT`       | Markdown 記事ルート。例: `/app/data/articles`                          | 必須              |
| `HF_HOME`             | Transformers.js モデルキャッシュ。例: `/app/.cache/huggingface`        | 必須              |
| `SKILLS_DIR`          | スキル提案承認時に書き出すディレクトリ。例: `./hermes/skills`         | 任意              |
| `OPENCODE_API_KEY`    | OpenCode (Go / Zen 共通) の API キー。Hermes コンテナのみが保持        | Hermes 起動時に必要 |
| `OPENAI_API_BASE`     | OpenAI 互換エンドポイント。既定 `https://opencode.ai/zen/go/v1` (Go)。Zen に戻す場合は `/zen/v1` | 任意              |
| `FIRECRAWL_API_KEY`   | Firecrawl Cloud の API キー。Hermes コンテナのみ                      | Hermes 起動時に必要 |
| `ANTHROPIC_API_KEY`   | 重要記事用の BYOK(任意)                                              | 任意              |
| `SEARXNG_SECRET`      | SearXNG セッションシークレット                                        | SearXNG 起動時に必要 |
| `SQLITE_CUSTOM_LIB`   | sqlite-vec 用の拡張対応 SQLite 共有ライブラリパス                     | 任意(自動検出)   |
| `PORT`                | Web サーバーのポート(デフォルト 3000)                                 | 任意              |

> `OPENCODE_API_KEY` / `FIRECRAWL_API_KEY` / `ANTHROPIC_API_KEY` は **Hermes コンテナのみ** が保持する設計です(P7、tech-stack.md §8.3)。`minakata` コンテナの環境には流れません。

## 主要ディレクトリ

```
minakata/
├── packages/
│   ├── core/                  # ドメインロジック(SQLite / Markdown / 埋め込み / 認証 / 監査)
│   │   ├── src/db/migrations/ # 0001_init.sql / 0002_vec.sql(?raw インライン)
│   │   └── tests/             # bun test スイート(in-memory SQLite)
│   ├── web/                   # React Router v7 framework mode(BFF 兼用)
│   │   ├── app/routes/        # loader/action の集合
│   │   └── server/index.ts    # createHonoServer + mountMcp
│   └── mcp/                   # MCP ツール定義 + Streamable HTTP マウント
├── docker/
│   ├── Dockerfile.minakata
│   └── docker-compose.yml
├── hermes/
│   ├── config/config.yaml     # Hermes プロバイダ / MCP 接続 / SearXNG / Firecrawl
│   └── skills/                # dialogue / researcher / daily_research / freshness_checker / changelog_writer
├── searxng/settings.yml       # SearXNG の設定(JSON formats 有効、limiter off)
├── docs/                      # 仕様書(設計フェーズの source of truth)
├── data/                      # 実行時データ(.gitignore)
│   ├── articles/              # Markdown(別 Git リポジトリ)
│   └── minakata.db            # SQLite
├── models/                    # Transformers.js モデルキャッシュ(.gitignore)
└── types/globals.d.ts         # `*.sql?raw` の型宣言
```

## 開発フロー

| コマンド             | 説明                                                          |
| -------------------- | ------------------------------------------------------------- |
| `bun install`        | Bun workspaces で全パッケージの依存解決                       |
| `bun run dev`        | Vite + Hono で web を起動(`localhost:3000`)                    |
| `bun test`           | 全パッケージのテスト(`bun test` Vitest 互換 API)              |
| `bun run typecheck`  | `react-router typegen` 後に `tsc --noEmit` を全パッケージで   |
| `bun run lint`       | Biome の lint + format チェック                               |
| `bun run lint:fix`   | Biome の自動修正                                              |
| `bun run build`      | 全パッケージのビルド(web は React Router build)               |

`lefthook.yml` に pre-commit(Biome + typecheck)、pre-push(`bun test`)が設定されています。`bun install` 時に自動で hook が登録されます。

## データモデルの不変条件(必ず守る)

設計仕様(P1〜P11)から派生する重要な不変条件:

- **Markdown が source of truth**(P3): SQLite はインデックス。`data/articles/*.md` を全消ししても `core` が再構築可能であるべき。
- **人間は記事を直接編集しない**(P5): すべての書き込みは MCP ツール経由(`create_article` / `update_article` / `archive_article` ...)
- **ユーザー入口は WebUI のみ**(P6): Telegram / Discord / Slack 等のゲートウェイは追加しない。
- **Hermes が cron とキュー消化を担当**(P9): Minakata 側にスケジューラやワーカーを書かない。`@minakata/worker` は永遠に存在しない。
- **埋め込みはローカル**(P11): `multilingual-e5-base`(768 次元)を Transformers.js で同期実行。外部 API には記事本文を送らない。
- **生成系 LLM API キーは Hermes コンテナのみ**(P7, §8.3): Minakata プロセスから見えてはいけない。

破壊的操作(アーカイブ・削除・30% 超書き換え・スキル追加)は **承認ゲート** を経由します(`tech-stack.md` §6)。

## セキュリティ(プロンプトインジェクション対策)

実装時に絶対に外さない設計原則(`docs/tech-stack.md` §8.1):

- **Capability 分離**: Hermes の subagent ごとに `permitted_tools` で MCP ツールを限定(`hermes/skills/*/SKILL.md` 参照)。
- **コンテンツフェンシング**: 外部抽出テキストは `<untrusted_content>...</untrusted_content>` で囲み、命令文として解釈させない。
- **行動制限**: エージェントが触れるのは Minakata MCP ツールのみ。`shell_exec` / 任意外部 HTTP は禁止。
- **MCP 保護**: Bearer Token 認証(`MCP_TOKEN`)、Host ヘッダ検証(`MCP_ALLOWED_HOSTS`)、Zod による全入力バリデーション。

`MCP_TOKEN` が空のまま `minakata` を起動すると `[minakata] MCP_TOKEN is not set …` の警告が出ます。本番では必ず `openssl rand -hex 32` 等で生成した値を入れてください。

## トラブルシューティング

- **`Database.setCustomSQLite` で何も見つからない**: macOS なら `brew install sqlite`、Linux なら `apt-get install -y libsqlite3-0`。または `SQLITE_CUSTOM_LIB=/path/to/libsqlite3.dylib` を `.env` に追加。
- **Transformers.js のモデルダウンロードが遅い**: 初回起動時に約 200MB のダウンロード(`HF_HOME` にキャッシュ)。`docker compose` ではボリュームを永続化済み(`./models`)。
- **MCP `/mcp` が 401**: `Authorization: Bearer <MCP_TOKEN>` が一致していない。`.env` を再ロード(`docker compose down && up -d`)。
- **`/mcp` が 403 `forbidden_host`**: `MCP_ALLOWED_HOSTS` にアクセス元 Host(ポート含む)を追加。
- **`bun run dev` で `.react-router/types/...` が見つからない**: `bunx react-router typegen` を先に走らせる(`bun run typecheck` が内部で実行)。
- **Hermes が起動しない**: `OPENCODE_API_KEY` 未設定 / 公式 Hermes イメージ未公開の可能性。Hermes 公式ドキュメントを参照のうえ profile から外して minakata 単体でも UI 検証は可能。

## ライセンス

未定(リポジトリオーナーに確認)。
