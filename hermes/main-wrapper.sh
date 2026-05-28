#!/command/with-contenv sh
# minakata-side override of /opt/hermes/docker/main-wrapper.sh.
#
# 上流の同名スクリプトはシバンが `#!/bin/sh` で、s6-overlay の
# container env (/run/s6/container_environment/) を読み戻さない。
# 結果として `hermes gateway run` プロセスが image-level の
# `HERMES_HOME=/opt/data` を継承できず、`Path.home()/.hermes`
# (= /opt/data/.hermes) にフォールバックする。
#
# 一方 cron-bootstrap.sh (cont-init.d) は `with-contenv` シバンで
# HERMES_HOME=/opt/data を取得し /opt/data/cron/jobs.json に cron job
# を書く。gateway が読むのは /opt/data/.hermes/cron/jobs.json なので
# 両者が分裂してジョブが永遠に実行されない。
#
# 本ファイルはシバンだけを `#!/command/with-contenv sh` に変えた
# clone。docker-compose で /opt/hermes/docker/main-wrapper.sh に :ro
# bind mount し、上流のパス・引数ルーティング契約はそのまま維持する。

set -e

cd /opt/data
# shellcheck disable=SC1091
. /opt/hermes/.venv/bin/activate

if [ $# -eq 0 ]; then
    exec s6-setuidgid hermes hermes
fi

if command -v "$1" >/dev/null 2>&1; then
    exec s6-setuidgid hermes "$@"
fi

exec s6-setuidgid hermes hermes "$@"
