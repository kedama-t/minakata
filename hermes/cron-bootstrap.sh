#!/bin/sh
# hermes/cron-bootstrap.sh
#
# Minakata の 5 つの subagent skill を Hermes cron に登録する idempotent script。
# docker/docker-compose.yml の hermes-cron-init サービスから one-shot 実行される
# 想定(hermes 本体コンテナと /opt/data を共有 named volume で共有)。
#
# `hermes cron create` は重複検出を持たないため、`hermes cron list` の出力を
# 名前 (`minakata-<skill>`) で grep して既存なら skip / 無ければ create する。
# `hermes cron list` の出力は "    Name:      <name>" 形式(末尾改行)。

set -eu

# 公式イメージの ENV PATH と同じく venv を先頭に置く(image の ENTRYPOINT
# /init を bypass しているため activate スクリプトが走らない、を補う)。
export PATH="/opt/hermes/.venv/bin:${PATH}"

# main-hermes コンテナ側の stage2-hook が /opt/data を初期化するのを待つ。
# `hermes cron list` が exit 0 で返るまで最大 60 秒リトライ。
echo "[cron-bootstrap] waiting for hermes runtime to become ready..."
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

# 診断: 私たちの skill が `skills.external_dirs` 経由で認識されているかを
# 段階的に確認する(#50)。
echo "[cron-bootstrap] --- diagnostic ---"

echo "[cron-bootstrap] (1) /opt/hermes-minakata-skills の中身:"
ls -la /opt/hermes-minakata-skills 2>&1 | sed 's/^/    /'

echo "[cron-bootstrap] (2) config.yaml の skills.external_dirs:"
sed -n '/^skills:/,/^[^ ]/p' /opt/data/config.yaml 2>&1 | sed 's/^/    /'

echo "[cron-bootstrap] (3) hermes skills list (minakata 系のみ):"
if hermes skills list 2>&1 | grep -E "minakata|dialogue|researcher|daily_research|freshness_checker|changelog_writer" | sed 's/^/    /' ; then
    :
else
    echo "    (no minakata skills detected)"
fi

echo "[cron-bootstrap] --- end diagnostic ---"

# `hermes cron list` の "Name:" 行と比較する正規表現。
# 例: "    Name:      minakata-dialogue"(末尾改行)
job_registered() {
    hermes cron list 2>/dev/null | grep -qE "^[[:space:]]*Name:[[:space:]]+$1$"
}

ensure_cron() {
    name=$1
    schedule=$2
    skill=$3
    prompt=$4

    if job_registered "$name"; then
        echo "[cron-bootstrap] $name already exists; skip"
        return 0
    fi

    echo "[cron-bootstrap] create $name (schedule=$schedule skill=$skill)"
    # `hermes cron create` は失敗しても exit 0 で返す場合があるため、
    # create 後に再度 list を読んで実在を確認する。
    hermes cron create "$schedule" "$prompt" --skill "$skill" --name "$name" || true
    if job_registered "$name"; then
        echo "[cron-bootstrap] OK: $name registered"
    else
        echo "[cron-bootstrap] FAILED to register $name. Current cron list:" >&2
        hermes cron list 2>&1 | sed 's/^/  /' >&2
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
