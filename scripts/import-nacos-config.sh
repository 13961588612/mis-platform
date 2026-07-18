#!/usr/bin/env bash
# 兼容旧命令，转发到 nacos-push.sh
set -euo pipefail
NAMESPACE="${1:-test}"
exec "$(dirname "$0")/nacos-push.sh" "$NAMESPACE"
