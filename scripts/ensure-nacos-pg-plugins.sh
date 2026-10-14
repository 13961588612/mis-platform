#!/usr/bin/env bash
# 下载 Nacos PostgreSQL 插件 + JDBC（版本必须与 Nacos Server 对齐）
#
# pig-mesh 兼容：https://github.com/pig-mesh/nacos-datasource-plugin-pg
#   2.3.1–2.3.2 → 0.0.3（默认）
#   2.5.x       → 0.0.5
#   3.0.1+      → 0.0.7（本仓库勿用 3.x）
#
# Maven 坐标注意：
#   ≤0.0.4 → com.pig4cloud.plugin:nacos-datasource-plugin-pg
#   ≥0.0.5 → com.pig4cloud.plugin:nacos-datasource-plugin-postgresql
#
# 用法：
#   bash scripts/ensure-nacos-pg-plugins.sh
#   bash /data/mis-nacos/scripts/ensure-nacos-pg-plugins.sh /data/mis-nacos/plugins
#   bash .../ensure-nacos-pg-plugins.sh /data/mis-nacos/plugins 2.5.4
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PARENT="$(cd "$SCRIPT_DIR/.." && pwd)"

PLUGINS_ARG="${1:-}"
NACOS_VER="${2:-2.3.2}"

if [[ "${PLUGINS_ARG}" == "java8" || "${PLUGINS_ARG}" == "java17" ]]; then
  PLUGINS_ARG=""
  NACOS_VER="2.3.2"
fi
if [[ "${NACOS_VER}" == "java8" || "${NACOS_VER}" == "java17" ]]; then
  NACOS_VER="2.3.2"
fi

if [[ -n "$PLUGINS_ARG" ]]; then
  PLUGINS_DIR="$PLUGINS_ARG"
elif [[ -f "$PARENT/Dockerfile" ]]; then
  PLUGINS_DIR="$PARENT/plugins"
elif [[ -d "$PARENT/deploy/nacos" ]]; then
  PLUGINS_DIR="$PARENT/deploy/nacos/plugins"
else
  PLUGINS_DIR="$PARENT/plugins"
fi

PLUGIN_VER="0.0.3"
case "$NACOS_VER" in
  2.2.*|2.3.0) PLUGIN_VER="0.0.2" ;;
  2.3.*)       PLUGIN_VER="0.0.3" ;;
  2.4.*)       PLUGIN_VER="0.0.4" ;;
  2.5.*)       PLUGIN_VER="0.0.5" ;;
  3.0.0*)      PLUGIN_VER="0.0.6" ;;
  3.*)         PLUGIN_VER="0.0.7" ;;
  *)
    echo "WARN: unknown Nacos version '$NACOS_VER', default plugin 0.0.3" >&2
    PLUGIN_VER="0.0.3"
    ;;
esac

# ≤0.0.4 旧 artifactId；≥0.0.5 新名
case "$PLUGIN_VER" in
  0.0.[1-4]) ARTIFACT="nacos-datasource-plugin-pg" ;;
  *)         ARTIFACT="nacos-datasource-plugin-postgresql" ;;
esac

mkdir -p "$PLUGINS_DIR"

download() {
  local name="$1" url="$2"
  local dest="$PLUGINS_DIR/$name"
  if [[ -f "$dest" ]]; then
    echo "OK exists: $name"
    return 0
  fi
  echo "Downloading $name ..."
  curl -fsSL -o "$dest" "$url"
  echo "Saved $dest"
}

rm -f "$PLUGINS_DIR"/nacos-datasource-plugin-postgresql-*.jar \
      "$PLUGINS_DIR"/nacos-datasource-plugin-pg-*.jar

JAR_NAME="${ARTIFACT}-${PLUGIN_VER}.jar"
download "$JAR_NAME" \
  "https://repo1.maven.org/maven2/com/pig4cloud/plugin/${ARTIFACT}/${PLUGIN_VER}/${JAR_NAME}"

download "postgresql-42.7.3.jar" \
  "https://repo1.maven.org/maven2/org/postgresql/postgresql/42.7.3/postgresql-42.7.3.jar"

echo "Nacos PG plugins ready: Nacos=${NACOS_VER} → ${ARTIFACT}:${PLUGIN_VER}  dir=$PLUGINS_DIR"
ls -la "$PLUGINS_DIR"
