#!/usr/bin/env bash
# close-wren-firewall.sh — 撤销 open-wren-firewall.sh 添加的 firewalld rich-rule
#
# 用法: sudo bash close-wren-firewall.sh

set -euo pipefail

CONTROL_PORT="${WREN_AGENT_CONTROL_PORT:-9100}"
MCP_PORT="${WREN_AGENT_MCP_PORT:-9101}"
ZONE="${FIREWALLD_ZONE:-public}"
DRY_RUN="${DRY_RUN:-0}"

run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[DRY_RUN] $*"
  else
    echo "+ $*"
    eval "$@"
  fi
}

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: 请使用 root 或 sudo 执行" >&2
  exit 1
fi

if ! command -v firewall-cmd >/dev/null 2>&1; then
  echo "ERROR: 未安装 firewalld" >&2
  exit 1
fi

for port in "$CONTROL_PORT" "$MCP_PORT"; do
  while firewall-cmd --permanent --zone="${ZONE}" --list-rich-rules 2>/dev/null | grep -q "port=\"${port}\""; do
    rule="$(firewall-cmd --permanent --zone="${ZONE}" --list-rich-rules | grep "port=\"${port}\"" | head -1)"
    run "firewall-cmd --permanent --zone=${ZONE} --remove-rich-rule='${rule}'"
  done
done

run "firewall-cmd --reload"
echo "firewalld: 已撤销 ${ZONE} 中 tcp/${CONTROL_PORT}、tcp/${MCP_PORT} 相关 rich-rule"
