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
# 素の #!/bin/sh だと OPENCODE_GO_API_KEY 等が UNSET になる。
#
# やること:
#   (a) compose 経由で渡された API key を /opt/data/.env に書く
#       (s6 supervised プロセスは container env を継承しないため、cron
#        scheduler の load_dotenv が拾えるよう .env に persist する必要)
#   (b) カスタム skills を .hermes/skills/ に symlink する(フォールバック保険)
#   (c) Minakata の 5 subagent skill 用 cron job を idempotent に登録
#
# gateway/CLI 間の HERMES_HOME 不一致(以前 cron job が走らなかった原因)は
# `hermes/main-wrapper.sh` を with-contenv シバン版に差し替えることで根本
# 解決済み(docker-compose.yml の bind mount)。このスクリプトでは触らない。
#
# 設定 (model / provider / mcp_servers / disabled_toolsets) は
# `hermes/config.yaml` に baked in 済み。compose が /opt/data/config.yaml を
# :ro mount するので、このスクリプトから書き換えるべきものは無い。

set -eu

PATH="/opt/hermes/.venv/bin:${PATH}"
export PATH

# "MIN HOUR rest" 形式の cron 式をローカル TZ から UTC に変換する。
# TZ 環境変数を python3 の datetime が自動的に参照するため、変換は自動。
# python3 が使えない場合は元の式をそのまま返す(UTC として扱われる)。
local_cron_to_utc() {
    local_expr="$1"
    python3 - <<PYEOF 2>/dev/null || echo "$local_expr"
import datetime
parts = '$local_expr'.split()
local_m, local_h = int(parts[0]), int(parts[1])
offset_secs = int(datetime.datetime.now(datetime.timezone.utc).astimezone().utcoffset().total_seconds())
total_utc_m = (local_h * 60 + local_m - offset_secs // 60) % (24 * 60)
parts[0] = str(total_utc_m % 60)
parts[1] = str(total_utc_m // 60)
print(' '.join(parts))
PYEOF
}

echo "[minakata-cron] HERMES_HOME=${HERMES_HOME:-/opt/data}"

# --- (a) API key を .env に persist する -----------------------------------

HERMES_ENV_FILE="${HERMES_HOME:-/opt/data}/.env"
write_env_kv() {
    key=$1
    value=$2
    [ -z "$value" ] && return 0
    if [ -f "$HERMES_ENV_FILE" ]; then
        # 既存の `KEY=...` 行を削除(コメント `# KEY=` はそのまま残す)。
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
write_env_kv FIRECRAWL_BASE_URL "${FIRECRAWL_BASE_URL:-}"
write_env_kv SCRAPER_TOKEN "${SCRAPER_TOKEN:-}"
chown hermes:hermes "$HERMES_ENV_FILE" 2>/dev/null || true
chmod 600 "$HERMES_ENV_FILE" 2>/dev/null || true

# --- (b) カスタム skills を .hermes/skills/ に symlink する ------------------
# main-wrapper.sh override 後は gateway も HERMES_HOME=/opt/data を読むので
# 通常 .hermes/skills/ 経路は使われない。万一フォールバックが発動したケース
# でも skills が見つかるよう、保険として symlink は維持する。
GATEWAY_SKILLS_DIR="${HERMES_HOME:-/opt/data}/.hermes/skills"
mkdir -p "$GATEWAY_SKILLS_DIR"
chown hermes:hermes "$GATEWAY_SKILLS_DIR" 2>/dev/null || true
for skill in dialogue researcher daily_research freshness_checker changelog_writer; do
    dest="$GATEWAY_SKILLS_DIR/$skill"
    if [ ! -e "$dest" ]; then
        ln -sfn "../../skills/$skill" "$dest"
        echo "[minakata-cron] linked skill: $skill"
    fi
done

# --- (c) cron job を idempotent に登録 -------------------------------------

# hermes コマンドは hermes user 権限で実行する(jobs.json の owner が
# hermes になるように)。s6-setuidgid は s6-overlay の組込み。
hermes_run() {
    s6-setuidgid hermes hermes "$@"
}

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
        echo "[minakata-cron] Available skills at failure time:" >&2
        hermes_run skills list 2>&1 | head -20 | sed 's/^/  /' >&2
        return 1
    fi
}

# --- (diagnostic) skill discovery check ------------------------------------
# cron job を登録する前に skill が認識されているか確認する。
echo "[minakata-cron] checking skill discovery..."
hermes_run skills list 2>&1 | head -20 | sed 's/^/  /'

# schedule format の制約 (cron/jobs.py parse_duration / parse_schedule より):
# - `every <N>m` / `every <N>h` / `every <N>d` のみ。`s` (秒) は不可
# - 「毎日 HH:MM」のような時刻指定は cron 式で書く(`0 7 * * *` = 毎日 07:00)
# - gateway tick が 60s なので秒単位の interval は意味なし、1m が最小粒度

ensure_cron "minakata-dialogue" "every 1m" "dialogue" \
    "Poll Minakata for new user chat messages and respond. Follow the dialogue skill's rules."

ensure_cron "minakata-researcher" "every 5m" "researcher" \
    "Poll Minakata's research task queue and process one pending task. Follow the researcher skill's rules."

ensure_cron "minakata-daily-research" "$(local_cron_to_utc '0 3 * * *')" "daily_research" \
    "Enqueue research tasks for all active subscription topics. Follow the daily_research skill's rules."

ensure_cron "minakata-freshness-checker" "every 6h" "freshness_checker" \
    "Recompute article freshness ranks and enqueue refresh / archive proposals as needed. Follow the freshness_checker skill's rules."

ensure_cron "minakata-changelog-writer" "$(local_cron_to_utc '0 7 * * *')" "changelog_writer" \
    "Summarize yesterday's research agent activity into a ChangeLog article. Follow the changelog_writer skill's rules."

echo "[minakata-cron] done"
