#!/bin/sh
# hermes/cron-bootstrap.sh
#
# Minakata の 5 つの subagent skill を Hermes cron に登録する idempotent script。
# docker/docker-compose.yml の hermes-cron-init サービスから one-shot 実行される
# 想定(hermes 本体コンテナと /opt/data を共有 named volume で共有)。
#
# `hermes cron create` は重複検出を持たないため、`hermes cron list` の出力を
# 名前 (`minakata-<skill>`) で grep して既存なら skip / 無ければ create する。

set -eu

# main-hermes が gateway run で起動して cron API を受けられるまで待つ。
# 起動直後だと `hermes cron list` が 1 を返すことがあるので最大 60 秒リトライ。
echo "[cron-bootstrap] waiting for hermes to accept commands..."
ready=false
for _ in $(seq 1 30); do
    if hermes cron list >/dev/null 2>&1; then
        ready=true
        break
    fi
    sleep 2
done
if [ "$ready" != true ]; then
    echo "[cron-bootstrap] hermes never became ready; aborting" >&2
    exit 1
fi

ensure_cron() {
    name=$1
    schedule=$2
    skill=$3
    prompt=$4

    # `hermes cron list` の table 内に `name` が含まれていれば既存。
    # 厳密一致したいので前後にスペースを付けて grep する(部分一致回避)。
    if hermes cron list 2>/dev/null | grep -qF " $name "; then
        echo "[cron-bootstrap] $name already exists; skip"
        return 0
    fi

    echo "[cron-bootstrap] create $name (schedule=$schedule skill=$skill)"
    # `hermes cron create` は失敗しても exit 0 で返す場合があるため、
    # create 後に再度 `hermes cron list` を見て登録できたかを必ず確認する。
    hermes cron create "$schedule" "$prompt" --skill "$skill" --name "$name" || true
    if hermes cron list 2>/dev/null | grep -qF " $name "; then
        echo "[cron-bootstrap] OK: $name registered"
    else
        echo "[cron-bootstrap] FAILED to register $name" >&2
        return 1
    fi
}

# schedule format の制約 (cron/jobs.py parse_duration / parse_schedule より):
# - `every <N>m` / `every <N>h` / `every <N>d` のみ。`s` (秒) は不可
# - 「毎日 HH:MM」のような時刻指定は **cron 式** で書く (`0 7 * * *` = 毎日 07:00)
# - gateway tick が 60s なので秒単位の interval は意味なし、1m を最小粒度として扱う

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

echo "[cron-bootstrap] done"
