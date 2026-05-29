# MCP サブコマンド欠落 — 実例診断記録

> 発生日: 2026-05-28
> 関連: dialogue cron job の MCP unreachable 障害

## 経緯

dialogue cron ジョブが `minakata.get_research_policy()` を呼び出したところ、MCP サーバーが 62 回連続 unreachable 状態。

## 原因（二重）

1. **データベース未初期化**: `/root/.minakata/` ディレクトリが存在せず、サーバー起動時に `unable to open database file` で FATAL 終了。
2. **サブコマンド欠落**: Hermes の MCP 設定が `args: [minakata-mcp]` のみで `serve` サブコマンドが欠けていた。`uvx minakata-mcp` は `No subcommand specified. Use "serve" or "http-serve" to start the server.` と出力して終了コード 1 で即死。

## 診断フロー

### Step 1: 構成確認
```bash
# プロファイル
echo $HERMES_PROFILE           # → default
hermes mcp list                # → Server exists, status: error
hermes doctor                  # → MCP Servers: 1 configured, 1 error
```

### Step 2: 設定ファイル精査
```bash
cat ~/.hermes/profiles/default/config.yaml
# → mcp_servers.minakata: command=uvx, args=[minakata-mcp], env={}
```

### Step 3: 直接起動テスト
```bash
# Before DB init:
uvx --from minakata-mcp minakata-mcp --log-level debug 2>&1
# → ERROR Unable to open database file → FATAL → exit(1)

# After DB init (without serve):
echo '{"jsonrpc":"2.0","id":1,"method":"initialize"...}' | timeout 5 uvx minakata-mcp 2>&1
# → "No subcommand specified. Use 'serve' or 'http-serve' to start the server."

# With serve (working):
echo '{"jsonrpc":"2.0","id":1,"method":"initialize"...}' | timeout 5 uvx minakata-mcp serve 2>&1
# → {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"0.1","capabilities":{...}}}
```

### Step 4: エラーログ確認
```bash
cat ~/.hermes/logs/mcp-minakata.err.log
# → "No subcommand specified. Use 'serve' or 'http-serve' to start the server."

cat ~/.hermes/logs/mcp-minakata.log
# → [INFO] Starting MCP server minakata
# → [ERROR] MCP server minakata exited with code 1
```

### Step 5: CLIs で起動確認
```bash
hermes mcp restart minakata     # → ✓ restarted successfully  (after config fix)
hermes mcp test minakata         # → ✓ Connection successful. Tools available: 8
```

## 修復手順

```bash
# 1. データベース初期化
uvx --from minakata-mcp minakata-mcp init

# 2. 設定修正: args に serve を追加
# ~/.hermes/profiles/default/config.yaml:
#   mcp_servers:
#     minakata:
#       command: uvx
#       args:
#         - minakata-mcp
#         - serve

# 3. MCP 再起動
hermes mcp restart minakata
hermes mcp test minakata
```

## 注意点

- **in-process client は復旧不可**: `hermes mcp restart` が成功しても、現在のエージェントセッションの MCP ツールは復旧しない。次回 cron 起動（新規セッション）で新規クライアントが初期化される。
- **エラー状態の遷移**: `unreachable after N consecutive failures` → `not connected` の順に変化する。`not connected` は auto-retry 機構が新たな接続を試みている状態。
- **delegate_task 経由の診断**: エージェントに `terminal` ツールがない場合、`delegate_task(toolsets=['terminal'])` でサブエージェントを起動してシェルコマンドを実行できる。

## 観察: 設定書き換え現象

`yaml.safe_load` + `yaml.dump` で Hermes 設定ファイルを編集すると、コメントが消失し YAML フォーマットが変わる。また、Hermes の auto-healing メカニズムにより、CLI が起動に失敗したサーバーの設定を自動的に上書きする可能性がある。設定変更時は `sed` など YAML 構造を変えないツールを使うか、変更後にファイル全体を目視確認する。
