#!/usr/bin/env bash
# open-wren-firewall.sh — wren 机 firewalld：仅放行 ai-platform → WrenMcpAgent 9100/9101
#
# 用法（在 wren 机 root 执行）：
#   export AI_PLATFORM_SOURCE_IP=10.20.0.10   # ai-platform 出口/内网源 IP（必填）
#   sudo -E bash open-wren-firewall.sh
#
# 可选：
#   FIREWALLD_ZONE=public          默认 public
#   WREN_AGENT_CONTROL_PORT=9100
#   WREN_AGENT_MCP_PORT=9101
#   DRY_RUN=1                      只打印将执行的命令
#
# 前置：RHEL / Rocky / Alma / CentOS Stream 等使用 firewalld 的发行版
#   sudo dnf install -y firewalld && sudo systemctl enable --now firewalld

set -euo pipefail

AI_PLATFORM_SOURCE_IP="${AI_PLATFORM_SOURCE_IP:-}"
CONTROL_PORT="${WREN_AGENT_CONTROL_PORT:-9100}"
MCP_PORT="${WREN_AGENT_MCP_PORT:-9101}"
ZONE="${FIREWALLD_ZONE:-public}"
DRY_RUN="${DRY_RUN:-0}"

usage() {
  cat <<'EOF'
用法: sudo AI_PLATFORM_SOURCE_IP=<ai-platform源IP> bash open-wren-firewall.sh

环境变量:
  AI_PLATFORM_SOURCE_IP   必填。ai-platform 访问 wren 机的内网源 IP
  FIREWALLD_ZONE            firewalld zone，默认 public
  WREN_AGENT_CONTROL_PORT   控制面端口，默认 9100
  WREN_AGENT_MCP_PORT       数据面端口，默认 9101
  DRY_RUN                   1=仅预览命令

验证:
  firewall-cmd --zone=public --list-rich-rules
  curl -sf http://127.0.0.1:9100/internal/v1/wren-mcp/health
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ -z "$AI_PLATFORM_SOURCE_IP" ]]; then
  echo "ERROR: AI_PLATFORM_SOURCE_IP 未设置" >&2
  usage >&2
  exit 1
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: 请使用 root 或 sudo 执行" >&2
  exit 1
fi

if ! command -v firewall-cmd >/dev/null 2>&1; then
  echo "ERROR: 未安装 firewalld。请先: sudo dnf install -y firewalld && sudo systemctl enable --now firewalld" >&2
  exit 1
fi

run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[DRY_RUN] $*"
  else
    echo "+ $*"
    eval "$@"
  fi
}

ensure_firewalld() {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[DRY_RUN] systemctl enable --now firewalld"
    return
  fi
  if ! systemctl is-active --quiet firewalld; then
    run "systemctl enable --now firewalld"
  fi
}

rich_rule_exists() {
  local rule="$1"
  firewall-cmd --permanent --zone="${ZONE}" --list-rich-rules 2>/dev/null | grep -Fq "${rule}"
}

add_rich_rule() {
  local rule="$1"
  if rich_rule_exists "${rule}"; then
    echo "  skip (已存在): ${rule}"
    return
  fi
  run "firewall-cmd --permanent --zone=${ZONE} --add-rich-rule='${rule}'"
}

ensure_firewalld

ACCEPT_CTRL="rule family=\"ipv4\" source address=\"${AI_PLATFORM_SOURCE_IP}\" port port=\"${CONTROL_PORT}\" protocol=\"tcp\" accept"
ACCEPT_MCP="rule family=\"ipv4\" source address=\"${AI_PLATFORM_SOURCE_IP}\" port port=\"${MCP_PORT}\" protocol=\"tcp\" accept"
DROP_CTRL="rule family=\"ipv4\" port port=\"${CONTROL_PORT}\" protocol=\"tcp\" drop"
DROP_MCP="rule family=\"ipv4\" port port=\"${MCP_PORT}\" protocol=\"tcp\" drop"

echo "=== Wren 机 firewalld 配置 ==="
echo "zone              : ${ZONE}"
echo "ai-platform 源 IP : ${AI_PLATFORM_SOURCE_IP}"
echo "控制面端口        : ${CONTROL_PORT}/tcp"
echo "数据面端口        : ${MCP_PORT}/tcp"
echo "本地 wren 端口段  : 18080-18180（127.0.0.1，不开放）"
echo ""

add_rich_rule "${ACCEPT_CTRL}"
add_rich_rule "${ACCEPT_MCP}"
add_rich_rule "${DROP_CTRL}"
add_rich_rule "${DROP_MCP}"
run "firewall-cmd --reload"

echo ""
echo "=== 完成 ==="
echo "  firewall-cmd --zone=${ZONE} --list-rich-rules"
echo "  ss -ltnp | grep -E ':(${CONTROL_PORT}|${MCP_PORT})\\b'"
