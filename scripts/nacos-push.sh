#!/usr/bin/env bash
# 用法: ./nacos-push.sh <namespace>
# 从 deploy/nacos-config/{namespace}/ 推送到 Nacos
set -euo pipefail

NAMESPACE="${1:?usage: nacos-push.sh <namespace>}"
GROUP="${NACOS_CONFIG_GROUP:-MIS_GROUP}"
NACOS_SERVER="${NACOS_SERVER:-http://localhost:8848}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMPORT_DIR="$ROOT/deploy/nacos-config/$NAMESPACE"

if [[ ! -d "$IMPORT_DIR" ]]; then
  echo "Config directory not found: $IMPORT_DIR" >&2
  exit 1
fi

echo "Push $IMPORT_DIR -> namespace=$NAMESPACE"

TOKEN=""
if RESP=$(curl -sf -X POST "$NACOS_SERVER/nacos/v1/auth/login" \
  -d "username=nacos&password=nacos" 2>/dev/null); then
  TOKEN=$(echo "$RESP" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
fi

CURL_AUTH=()
if [[ -n "$TOKEN" ]]; then
  CURL_AUTH=(-H "Authorization: Bearer $TOKEN")
fi

for f in "$IMPORT_DIR"/*.yaml; do
  [[ -f "$f" ]] || continue
  data_id=$(basename "$f" .yaml)
  content=$(cat "$f")
  curl -sf -X POST "$NACOS_SERVER/nacos/v1/cs/configs" \
    "${CURL_AUTH[@]}" \
    --data-urlencode "dataId=$data_id" \
    --data-urlencode "group=$GROUP" \
    --data-urlencode "tenant=$NAMESPACE" \
    --data-urlencode "type=yaml" \
    --data-urlencode "content=$content" >/dev/null
  echo "Pushed $data_id -> namespace=$NAMESPACE group=$GROUP"
done

echo "Done. Verify at $NACOS_SERVER/nacos"
