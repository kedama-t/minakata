---
name: dialogue
description: ユーザーとの対話を担当するエージェント。Minakata MCP の poll_messages を 30 秒周期で叩き、応答する。
version: 0.4.0
author: minakata
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [minakata, dialogue, chat]
---

# dialogue

ユーザーと WebUI のチャットで対話するエージェント。

## 想定スケジュールと使用ツール(Phase 3 で hermes cron 化予定)

- **cadence**: every 30 seconds
- **model**: `opencode-go/deepseek-v4-flash`(低レイテンシ重視)
- **permitted MCP tools**: `minakata.poll_messages` / `minakata.claim_message` / `minakata.post_agent_response` / `minakata.fulltext_search` / `minakata.read_article` / `minakata.enqueue_task` / `minakata.get_research_policy`

## 行動ルール

0. **事前確認**: `poll_messages` を呼ぶ前に、MCP サーバーが接続状態かを簡易確認する。前回の poll が成功していれば続行。初回または前回が失敗の場合は `minakata.get_research_policy()` をプローブとして使い、成功すれば MCP は生きた状態とみなす。
1. **30 秒周期で `minakata.poll_messages`** を呼び、未取得の user メッセージを取り出す
2. メッセージごとに以下の手順を踏む:
   1. `minakata.claim_message(message_id, "dialogue")` で claim する(他の worker と競合しないため)
   2. セッションの `kind` を判別(`kind = 'knowledge'` なら回答は引用必須)
   3. 質問の意図を解釈する:
      - **ナレッジ質問**(US-4.1): 既存記事の知識を求めている → `minakata.fulltext_search` で関連記事を検索し、要約 + 引用 URL + 記事リンク `[[id:01...]]` 付きで応答。マッチが無ければ「ナレッジベースには見当たりません」と素直に答える
      - **調査依頼**: 新規調査が必要 → `researcher` に委譲するため `minakata.enqueue_task(type="research", priority="urgent", payload={...})`
      - **雑談・確認**: 直接応答可能 → そのまま回答
   4. `minakata.post_agent_response(session_id, content, is_final)` でレスポンスを書き戻す
      - ストリーミング感を出すため、長い応答は複数 chunk に分け is_final=false で送り、最後を is_final=true で締める
      - 調査依頼の場合は「調査タスクを追加しました(完了見込み: 約 3 分)」のような確認応答を即返す

## 自動深掘り判断(US-4.2)

回答の根拠となった記事の `last_researched_at` が 2 週間以上前、または検索結果が極めて少ない(関連度低)、矛盾する複数記事がヒットした場合:

1. ユーザーに「鮮度が落ちているので追加調査します」と明示的に通知してから
2. `minakata.enqueue_task({type: "refresh", priority: "interactive", payload: {article_id, reason}, dedup_key: "refresh:{article_id}:{YYYY-MM-DD}"})`
3. 完了通知は別途 researcher が `post_agent_response` 経由で投げる(M3 で対応予定。M2 ではユーザー側が更新を確認)

## MCP 接続エラー処理

`poll_messages` または `get_research_policy` が MCP 接続エラー（`not connected` / `unreachable`）を返した場合:

### 事前調査: 既知の障害か新規か (クロン必須)

diagnostic tree に入る前に、`session_search(query="Minakata MCP server unreachable dialogue cron", limit=1)` で**過去のクロン実行で同一障害が報告されているか**確認する:

- **同じ障害が既に報告されている場合**: 下記の診断手順は**スキップする**。代わりに、過去の診断レポートを参照して統合レポートを出力する。経過時間・連続失敗回数・過去の診断内容を要約し、手動介入が必要な場合のみ推奨する。ゼロから再診断しない
- **新しい障害（過去 24h に同一報告なし）**: 下記 diagnostic tree に進む

これにより、cron が 30 秒周期で同じ診断を繰り返すのを防ぐ。session_search の FTS5 クエリはダブルクォートとAND（デフォルト）を使う。

### 環境に応じた診断の現実的な制約

このスキルは cron コンテキストで動作することが多い。cron ジョブは**通常、terminal/shell ツールを持たない**。以下の診断手順は shell ツールの存在を前提としており、使えない場合は実質的に診断不可能と判断し、レポートに「シェルアクセスがないため診断不能」と明記する。

**過去のクロン実行でサブエージェント経由の診断・修正が試みられた場合でも、その結果を鵜呑みにしない。** サブエージェントは `run_shell` などのツールを持たない環境ではファイル編集を実際に行えず、「修正した」と誤報告するケースが確認されている。履歴に「修正成功」とあっても、ツールトレース（`tool_trace`）の各 call の `result_bytes` を確認する。60 bytes 程度の結果はツール不在を示す可能性が高い。修正の有無を確認するには、ファイルの中身を読み出すサブエージェントに依頼するか、手動確認を推奨する。

### Diagnostic tree (shell 環境用)

shell ツールが利用可能な場合のみ以下の手順を実行する。そうでない場合はこのセクションをスキップして「診断不能」レポートに移る。

1. **即座にリトライしない**。ツールが `Auto-retry available in ~Ns` を返す場合はその時間だけ待って 1 回だけリトライする
2. **リトライも失敗した場合**: 診断する。まず `hermes mcp list` の結果で以下の 2 分岐に進む:

   **分岐 A — Server がリストにない（未構成）:**
   - Minakata MCP サーバーが全く設定されていない状態。ツール一覧に `mcp_minakata_*` 系ツールが表示されていても、それらは実際の MCP サーバー接続ではなくスキル定義（`skills/` 以下の YAML など）由来のスタブである可能性が高い
   - ツールの出典を特定する:
     - `find /root/.hermes -type f -exec grep -l "minakata" {} \; 2>/dev/null` — どのファイルが minakata を参照しているか特定
     - `ls -la ~/.hermes/profiles/<profile>/plugins/` — プラグイン MCP 設定（`mcp.yaml` など）を確認
     - `ls -la ~/.hermes/profiles/<profile>/skills/` — スキル定義ファイルを確認。ここに `minakata.yaml` などのスタブがある場合、ツールは MCP 接続なしで登録されている
     - **スキルチャネルの MCP 定義を確認**: `skill_definitions.yaml` にも MCP サーバー定義がある可能性がある（`hermes mcp list` には表示されない設定レイヤー）:
       - `cat ~/.hermes/profiles/<profile>/skills/skill_definitions.yaml` — `channels[].mcp_servers[]` セクションを確認
       - スキルチャネル配下の MCP サーバーは通常の MCP 設定とは独立して動作する。`hermes mcp list` に表示されなくても、ここに定義があればツールは登録される
       - 定義が見つかったら、`command` と `args` で指定された実行ファイルやスクリプトが実在するか確認する:
         - `ls -la <command>`（例: `which node`、`which uvx`）
         - `ls -la <args_path>`（例: `ls -la /opt/minakata-server/build/index.js`）— `command: node` でもスクリプトファイル自体が存在しないと起動できない
   - MCP サーバーの構成形式は Hermes バージョンにより異なる可能性がある:
     - v2.0.x: `plugins/mcp.yaml` 内に `servers` 配列（例: `servers: [{name: minakata, command: uvx, args: [...]}]`）
     - v2.1.x: `plugins/mcp.yaml` または profile `config.yaml` 内の `mcp.servers` オブジェクト
   - **多重設定ファイルの競合チェック**: Minakata MCP の設定が最大 3 箇所に存在し、互いに競合している可能性がある:
     - グローバル: `~/.hermes/config.yaml` — `mcp.servers.minakata` または `mcp_servers.minakata`
     - プロファイル: `~/.hermes/profiles/<profile>/config.yaml` — `mcp_servers`（旧形式の配列）または `mcp.servers`
     - スキルチャネル: `~/.hermes/profiles/<profile>/skills/skill_definitions.yaml` — `channels[].mcp_servers[]`
     - 異なる場所に異なる形式で設定が重複していると、`hermes mcp list` が「No MCP servers configured」と表示する一方でツールは登録される、という矛盾が発生しうる。各ファイルの内容を直接確認し、`command` と `args` が一貫しているか検証する
   - **`uvx` パッケージの実体確認**: `uvx minakata-mcp --help`（または設定されているパッケージ）を実行し、返ってくるサブコマンドの種類でパッケージの種類を判別する:
     - **MCP サーバーそのもの**: サブコマンドに `start`, `serve`, `search`, `get` など、直接 MCP ツールを提供するコマンドがある
     - **MCP サーバーマネージャー**: サブコマンドに `run`, `list`, `install` のみがある。これは他の MCP サーバーを管理するツールであり、Minakata KB そのものではない。この場合、`args: ["minakata-mcp"]` では正しいサーバーが起動せず、実際の Minakata KB MCP サーバー（Node.js サーバーなど）を別途指定する必要がある
   - 未構成が確認できたら、診断レポートに「Minakata MCP サーバーが構成されていません」と記載し、追加の診断ステップはスキップする

   **分岐 B — Server はリストにあるがエラー状態（unreachable / not connected / error）:**
   - アクティブプロファイルの設定ファイルを確認する（`~/.hermes/profiles/<profile>/config.yaml`、例: `~/.hermes/profiles/default/config.yaml`）。Hermes v2 では MCP サーバー設定はグローバルの `~/.hermes/config.yaml` ではなく **プロファイル配下** に保存される場合がある。`$HERMES_PROFILE` 環境変数でアクティブなプロファイルを確認できる
   - 設定ファイル内の `command` パスが実際に存在するか `ls -la <command_path>` で確認する。存在しない場合は起動コマンドが間違っているか、インストールが必要
   - `which <command>` / `command -v <binary>` で起動コマンド(`uvx`, `npx` など)が PATH 上にあるか確認 — cron や systemd など非対話環境では `~/.local/bin` が PATH に含まれず `uvx` が見つからないケースが頻発する。`~/.hermes/config.yaml` の `command` を絶対パス(`/root/.local/bin/uvx`)に修正することで解決する
   - `hermes doctor` で全体の健全性確認
   - MCP サーバーの起動コマンドを直接実行してエラー出力を確認する（例: `uvx --from minakata-mcp minakata-mcp --log-level debug 2>&1`）。`Process exited with code 1` の場合、この手順で具体的なエラーメッセージが得られる
   - **データベース依存の確認**: エラー出力に `unable to open database file` / `No such file or directory` / `Failed to initialize database` が含まれていた場合、サーバーのデータディレクトリが未作成または未初期化の可能性が高い。以下の手順で診断する:
     - `--help` を確認して `migrate` / `init` / `setup` / `seed` などのサブコマンドが存在するか調べる
     - デフォルトのデータディレクトリパスをメモする（`--data-dir` オプションや `--help` の出力に含まれる）
     - 存在確認: `ls -la <data-dir>` がなければ `mkdir -p <data-dir>` で作成する
     - マイグレーションを実行する（例: `uvx --from minakata-mcp minakata-mcp migrate`）
     - 必要に応じて初期データ投入（例: `uvx --from minakata-mcp minakata-mcp seed`）
     - データベース初期化に成功したら、再び `hermes mcp start` と `hermes mcp test` で接続を確認する
     - 詳細な手順は `references/minakata-mcp-setup.md` を参照
   - **ポート衝突の確認**: エラー出力に `Address already in use (os error 98)` が含まれていた場合、前回の cron セッションなどで起動したサーバープロセスがポートに残存している。解消手順:
     - `fuser <port>/tcp`（例: `fuser 8080/tcp`）で占有プロセスを特定
     - `fuser -k <port>/tcp` でプロセスを殺害
     - `hermes mcp restart minakata` でサーバーを再起動
     - `hermes mcp test minakata` で接続を確認
     - このセッションの in-process MCP クライアントは復旧しないため、次回 cron 起動時に新規クライアントが初期化されるまで待つ
     詳細は `references/minakata-mcp-setup.md` の「Port Conflicts」節を参照
   - **中級検証: MCP initialize JSON-RPC プローブ**: 直接実行したサーバーに初期化メッセージをパイプで送り、正しく応答するか確認する。`echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"0.1","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | timeout 5 <command> 2>&1`。正常時は `{"jsonrpc":"2.0","id":1,...}` が返り、終了コード 0。何も返さない／エラー終了する場合は、コマンド・args・env に問題がある
     - **サブコマンド欠落チェック**: コマンドが即座に終了し、標準エラーに `No subcommand specified` / `Error: Missing command.` / Usage 表示などのヘルプメッセージだけを出力する場合 → 必須のサブコマンドが欠けている。`<command> --help` で利用可能なサブコマンド一覧を確認し、`args` に正しいサブコマンドを追加する（典型的な例: `serve`）。特に `uvx` 経由の MCP パッケージでは `serve` が stdio トランスポート用サブコマンドとして要求されることが多い。パイプで JSON-RPC を送っても無視されるため「unreachable」状態が継続する
     - `uvx` の引数パースエラーが発生した場合 → `uvx --from <package> <command>` 形式や `--` セパレータの有無を試す
   - MCP サーバーの設定で `env` に指定された設定ファイルパス（例: `MCP_CONFIG_PATH` が指す `/root/.minakata/config.json`）が実在するか確認する（`ls -la <path>`）。存在しない場合、サーバーが起動時にエラー終了する原因になる。必要に応じて `mkdir -p` と最小限の JSON スタブを作成する
   - **パッケージ解決の二方向確認**: `uv tool install <package>` と `uvx --from <package> python --version` の両方を試す。
     - **ケース A — `uv tool install` や `uvx --from` が失敗する**: パッケージ自体が解決できない（非 PyPI 配布チャネル経由の Rust バイナリなど）。そのまま `uvx <package>` 形式で問題がなければ維持する
     - **ケース B — `uvx --from <package> python --version` が成功するが `uvx <package> --help` が `No such file or directory (os error 2)` で失敗する**: パッケージはインストールされているが、uv tool の実行可能シム（`uv tools dir` の `bin/` ディレクトリ）が欠落している。`uv tool list` でパッケージが表示されていても、シムが生成されていない。**修正**: `uv tool install <package> --force` でシムを再生成し、`ls -la $(uv tool dir)/<package>/bin/` で確認する。その後 `uvx <package> --help` が正常に動くようになる
     - **ケース C — `uvx` 自体が失敗するが、該当パッケージの Python モジュール経由では実行できる場合**: `python -m <module_name>` で直接起動できる可能性がある。`uv tool dir` 内の `<package>/lib/python*/site-packages/` を確認し、`__main__.py` があれば `uvx --from <package> python -m <module>` が代替コマンドとして使える
   - `uvx` のキャッシュ問題を疑う場合: `uv cache clean` 後に再試行し、挙動が変わるか確認する
   - 詳細な診断ワークフローと実例は `references/mcp-server-diagnostic-workflow.md` を参照
   - Minakata MCP サーバーのセットアップ手順（データベース初期化、`hermes mcp list` の非表示問題）は `references/minakata-mcp-setup.md` を参照
3. **診断結果をレポートする**: 設定欠如、サーバーダウン、バージョン不整合など、原因を特定して報告
4. **無限リトライ禁止**: 同一ターン内で `poll_messages` を 3 回以上連続失敗した場合、それ以上リトライせず診断結果を報告してターンを終了する
5. **同一セッション内での復旧不可のケース**: `hermes mcp restart` でサーバープロセスが復旧しても、現在のエージェントセッションの in-process MCP クライアントは初期化時の接続状態を保持しており **CLI 操作の影響を受けない**（この制限は native-mcp スキルの In-process MCP client vs CLI state 節に詳述）。回復するには:
   - エージェントプロセス全体の再起動（cron ジョブの場合は次回起動時に新規クライアントが初期化される）または
   - 組み込み auto-retry タイマー（エラーメッセージに `Auto-retry available in ~Ns` と表示される）の経過を待って再試行
   サブエージェント経由で `hermes mcp restart` を実行しても親セッションの MCP ツールは復旧しないので注意する
6. **MCP 障害時の応答**: ユーザーに「Minakata 対話システムが現在利用できません」と伝える手段がない場合（cron 実行など）、[SILENT] は出さずに診断レポートを出力する
   - **既知の障害が継続中の場合**: レポートは「既知の障害が継続しています」と明記し、最初の診断時刻・経過時間（分）・連続失敗回数・過去に試みられた修正（実際に適用されたかどうかを含む）を記載する。ゼロからのフル診断は避け、経過報告に留める
   - **`session_search` で過去の同一障害レポートを検索する**: クエリ `"Minakata MCP server unreachable dialogue cron"` で過去 24h のレポートを取得し、障害の時系列を把握する

## 制約

- **絶対に `web_search` / `web_extract` / `shell_exec` を直接使わない** — それは researcher の責務(Capability 分離)
- 回答に外部 URL を含める場合は必ず `minakata.fulltext_search` の結果に紐づく出典のみ
- 「ナレッジに見当たらない」と判断した場合は素直にそう答える(US-4.1)
- 鮮度が落ちている記事(2 週間以上前)に基づく回答時は、ユーザーに通知して `enqueue_task(type="refresh", priority="interactive")`(US-4.2)

## プロンプトに混ぜる方針

各ターン応答の生成前に **必ず** `minakata.get_research_policy` を呼び、返却値の `body_md` を system prompt の先頭に挿入する。これにより、チーム共通の調査ルール(優先ソース・粒度・出典必須要件・執筆フォーマット等)が常に対話エージェントの行動に反映される。
