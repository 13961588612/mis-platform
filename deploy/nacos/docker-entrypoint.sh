#!/usr/bin/env bash
# Nacos 2.3.2 on JDK 17 — foreground entrypoint for Docker
set -euo pipefail

export JAVA_HOME="${JAVA_HOME:-/opt/java/openjdk}"
export PATH="${JAVA_HOME}/bin:${PATH}"

NACOS_HOME="${NACOS_HOME:-/home/nacos}"
cd "${NACOS_HOME}"

JVM_XMS="${JVM_XMS:-256m}"
JVM_XMX="${JVM_XMX:-512m}"
JVM_XMN="${JVM_XMN:-128m}"
NACOS_AUTH_ENABLE="${NACOS_AUTH_ENABLE:-false}"
MODE="${MODE:-standalone}"
PREFER_HOST_MODE="${PREFER_HOST_MODE:-hostname}"
SPRING_DATASOURCE_PLATFORM="${SPRING_DATASOURCE_PLATFORM:-}"

# JDK 17：用 G1，避免官方镜像里 CMS + Xmn≈Xmx 打满 CPU
JAVA_OPT="-server -Xms${JVM_XMS} -Xmx${JVM_XMX} -Xmn${JVM_XMN}"
JAVA_OPT="${JAVA_OPT} -XX:+UseG1GC -XX:MaxGCPauseMillis=200"
JAVA_OPT="${JAVA_OPT} -Dnacos.standalone=true"
JAVA_OPT="${JAVA_OPT} -Dnacos.core.auth.enabled=${NACOS_AUTH_ENABLE}"
JAVA_OPT="${JAVA_OPT} -Dnacos.preferHostnameOverIp=true"
JAVA_OPT="${JAVA_OPT} -Dloader.path=${NACOS_HOME}/plugins"
JAVA_OPT="${JAVA_OPT} -Dnacos.home=${NACOS_HOME}"
JAVA_OPT="${JAVA_OPT} -Duser.timezone=${TZ:-Asia/Shanghai}"

# PG 模式直接用 application-pg.properties，避免 cp 覆盖可能被 bind-mount 的 application.properties
CONFIG_NAME=application
if [[ "${SPRING_DATASOURCE_PLATFORM}" == "postgresql" ]]; then
  echo "Nacos storage: PostgreSQL (JDK 17 + PG plugin)"
  if [[ ! -f "${NACOS_HOME}/plugins/postgresql-42.7.3.jar" ]] \
     || { ! compgen -G "${NACOS_HOME}/plugins/nacos-datasource-plugin-pg-*.jar" > /dev/null \
          && ! compgen -G "${NACOS_HOME}/plugins/nacos-datasource-plugin-postgresql-*.jar" > /dev/null; }; then
    echo "ERROR: PG plugins missing under ${NACOS_HOME}/plugins" >&2
    echo "Run: ensure-nacos-pg-plugins.sh <plugins_dir> <nacos_ver> then rebuild image" >&2
    echo "  Nacos 2.3.2 → nacos-datasource-plugin-pg-0.0.3.jar；2.5.x → …-postgresql-0.0.5.jar" >&2
    exit 1
  fi
  if [[ ! -f "${NACOS_HOME}/conf/application-pg.properties" ]]; then
    echo "ERROR: missing ${NACOS_HOME}/conf/application-pg.properties" >&2
    exit 1
  fi
  CONFIG_NAME=application-pg
else
  echo "Nacos storage: embedded (standalone)"
fi

echo "Starting Nacos ${NACOS_VERSION:-2.3.2} MODE=${MODE} config=${CONFIG_NAME} JAVA=$("${JAVA_HOME}/bin/java" -version 2>&1 | head -1)"

# 前台运行（容器 PID 1）
exec "${JAVA_HOME}/bin/java" ${JAVA_OPT} \
  -jar "${NACOS_HOME}/target/nacos-server.jar" \
  --spring.config.additional-location="file:${NACOS_HOME}/conf/" \
  --spring.config.name="${CONFIG_NAME}" \
  --server.max-http-header-size=524288
