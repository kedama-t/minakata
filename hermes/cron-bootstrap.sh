#!/command/with-contenv sh
# hermes/cron-bootstrap.sh
#
# s6-overlay の cont-init.d hook として実行される(docker-compose.yml で
# `/etc/cont-init.d/99-minakata-cron` に :ro mount してある)。
# stage2-hook (`01-hermes-setup`) の後、main-hermes サービスが起動する前に
# root として 1 回呼ばれる。
#
# shebang に `/command/with-contenv` を使うことで s6-overlay v3 の
# /run/s6/container_environment/ から container env を呼び戻している。
# 素の #!/bin/sh だと OPENCODE_GO_API_KEY 等が UNSET になって `hermes
# config set` が API key を書けない(#52)。
#
# やること: Minakata の 5 subagent skill 用 cron job を idempotent に登録。
# `hermes cron create` は jobs.json への file write しかしないので gateway
# が起動していなくても問題なく動く。各 job を `--name "minakata-<skill>"`
# で識別し、既存ならスキップする。

set -eu

PATH="/opt/hermes/.venv/bin:${PATH}"
export PATH

# cont-init.d 内で見える env を診断(値は伏せる)。s6-overlay は通常
# container env を継承するが、欠けていたら compose 側 / .env / podman の
# どこかで途切れている合図。
echo "[minakata-cron] env check:"
for var in OPENCODE_GO_API_KEY MCP_TOKEN HERMES_UID HERMES_GID FIRECRAWL_API_KEY; do
    if [ -n "$(eval echo "\${$var:-}")" ]; then
        echo "    $var: (set)"
    else
        echo "    $var: (UNSET or empty)"
    fi
done

# hermes コマンドは hermes user 権限で実行する(jobs.json の owner が
# hermes になるように)。s6-setuidgid は s6-overlay の組込みで PATH 上に
# 居る前提(stage2-hook も同じ呼び方をしている)。
# `s6-setuidgid` は環境変数をそのまま継承する(明示的に clean しない)。
hermes_run() {
    s6-setuidgid hermes hermes "$@"
}

# cron scheduler は tick ごとに `load_dotenv(/opt/data/.env, override=True)`
# を呼んで env を再読込する(cron/scheduler.py:1472)。compose 経由で渡した
# env だけだと s6 supervised プロセスが container env を継承していないため
# /opt/data/.env に書いておかないと OPENCODE_GO_API_KEY が cron context で
# 見えない(#52)。
#
# 公式パス (`hermes config set OPENCODE_GO_API_KEY ...`) も .env 書き込みに
# 帰着するが、サブプロセス・権限経路で詰まることがあるので、確実性のため
# 直接ファイルに書く。既存行があれば削除して append (idempotent)。
HERMES_ENV_FILE="${HERMES_HOME:-/opt/data}/.env"
write_env_kv() {
    key=$1
    value=$2
    if [ -z "$value" ]; then
        return 0
    fi
    # まず既存の `KEY=...` 行を削除(コメント `# KEY=` はそのまま残す)。
    if [ -f "$HERMES_ENV_FILE" ]; then
        sed -i.bak "/^$key=/d" "$HERMES_ENV_FILE"
        rm -f "$HERMES_ENV_FILE.bak"
    else
        touch "$HERMES_ENV_FILE"
    fi
    printf '%s=%s\n' "$key" "$value" >> "$HERMES_ENV_FILE"
}

echo "[minakata-cron] sync API keys → $HERMES_ENV_FILE"
write_env_kv OPENCODE_GO_API_KEY "${OPENCODE_GO_API_KEY:-}"
write_env_kv FIRECRAWL_API_KEY "${FIRECRAWL_API_KEY:-}"
# hermes user が読めるようにする(stage2-hook が後で chmod 600 し直すが
# 念のため owner も合わせる)。
chown hermes:hermes "$HERMES_ENV_FILE" 2>/dev/null || true
chmod 600 "$HERMES_ENV_FILE" 2>/dev/null || true

# 上の .env への直書きで `_resolve_api_key_provider_secret` の env 経路
# (hermes_cli/auth.py:606) はカバーできるはずだが、なぜか cron context で
# 拾われないケースがあるので credential pool にも登録しておく
# (env で見つからない時のフォールバック先、auth.py:613)。
if [ -n "${OPENCODE_GO_API_KEY:-}" ]; then
    echo "[minakata-cron] register OpenCode Go in credential pool"
    hermes_run auth add opencode-go --type api_key --api-key "$OPENCODE_GO_API_KEY" \
        >/dev/null 2>&1 || echo "[minakata-cron] WARN: hermes auth add failed"
fi

# provider / model 名は config.yaml に書く(API key 以外なので .env 不要)。
hermes_run config set model.provider opencode-go >/dev/null 2>&1 || true
hermes_run config set model.default deepseek-v4-flash >/dev/null 2>&1 || true

# `hermes cron list` 出力の "    Name:      <name>" 行と name の完全一致で
# 既存チェック(create が success だったか確認するためにも再利用する)。
job_registered() {
    hermes_run cron list 2>/dev/null | grep -qE "^[[:space:]]*Name:[[:space:]]+$1$"
}

ensure_cron() {
    name=$1
    schedule=$2
    skill=$3
    prompt=$4

    if job_registered "$name"; then
        echo "[minakata-cron] $name already exists; skip"
        return 0
    fi

    echo "[minakata-cron] create $name (schedule=$schedule skill=$skill)"
    # hermes cron create は失敗時も exit 0 で返ることがあるので、create 後に
    # 必ず list で実在確認する。
    hermes_run cron create "$schedule" "$prompt" --skill "$skill" --name "$name" || true
    if job_registered "$name"; then
        echo "[minakata-cron] OK: $name registered"
    else
        echo "[minakata-cron] FAILED to register $name. Current cron list:" >&2
        hermes_run cron list 2>&1 | sed 's/^/  /' >&2
        return 1
    fi
}

# schedule format の制約 (cron/jobs.py parse_duration / parse_schedule より):
# - `every <N>m` / `every <N>h` / `every <N>d` のみ。`s` (秒) は不可
# - 「毎日 HH:MM」のような時刻指定は cron 式で書く(`0 7 * * *` = 毎日 07:00)
# - gateway tick が 60s なので秒単位の interval は意味なし、1m が最小粒度

ensure_cron "minakata-dialogue" "every 1m" "dialogue" \
    "Poll Minakata for new user chat messages and respond. Follow the dialogue skill's rules."

ensure_cron "minakata-researcher" "every 5m" "researcher" \
    "Poll Minakata's research task queue and process one pending task. Follow the researcher skill's rules."

ensure_cron "minakata-daily-research" "0 3 * * *" "daily_research" \
    "Enqueue research tasks for all active subscription topics. Follow the daily_research skill's rules."

ensure_cron "minakata-freshness-checker" "every 6h" "freshness_checker" \
    "Recompute article freshness ranks and enqueue refresh / archive proposals as needed. Follow the freshness_checker skill's rules."

ensure_cron "minakata-changelog-writer" "0 7 * * *" "changelog_writer" \
    "Summarize yesterday's research agent activity into a ChangeLog article. Follow the changelog_writer skill's rules."

echo "[minakata-cron] done"
