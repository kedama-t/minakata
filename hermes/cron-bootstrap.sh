#!/bin/sh
# hermes/cron-bootstrap.sh
#
# s6-overlay の cont-init.d hook として実行される(docker-compose.yml で
# `/etc/cont-init.d/99-minakata-cron` に :ro mount してある)。
# stage2-hook (`01-hermes-setup`) の後、main-hermes サービスが起動する前に
# root として 1 回呼ばれる。
#
# やること: Minakata の 5 subagent skill 用 cron job を idempotent に登録。
# `hermes cron create` は jobs.json への file write しかしないので gateway
# が起動していなくても問題なく動く。各 job を `--name "minakata-<skill>"`
# で識別し、既存ならスキップする。

set -eu

PATH="/opt/hermes/.venv/bin:${PATH}"
export PATH

# hermes コマンドは hermes user 権限で実行する(jobs.json の owner が
# hermes になるように)。s6-setuidgid は s6-overlay の組込みで PATH 上に
# 居る前提(stage2-hook も同じ呼び方をしている)。
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
