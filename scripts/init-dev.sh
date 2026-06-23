#!/usr/bin/env bash
# MIS Platform — 本地开发一键初始化（Linux / macOS）
# 用法: ./scripts/init-dev.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$ROOT/deploy/docker-compose.dev.yml"

echo "=== MIS Platform 本地初始化 ==="
echo "仓库根目录: $ROOT"

command -v docker >/dev/null 2>&1 || { echo "错误: 未找到 docker"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "错误: 需要 Docker Compose v2"; exit 1; }

echo ""
echo "[1/3] 启动基础设施..."
docker compose -f "$COMPOSE_FILE" up -d

echo "等待 PostgreSQL 就绪..."
for i in $(seq 1 30); do
  if docker exec mis-postgres pg_isready -U postgres -d mis_platform >/dev/null 2>&1; then
    echo "PostgreSQL 已就绪"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "错误: PostgreSQL 超时，请检查 docker logs mis-postgres"
    exit 1
  fi
  sleep 3
done

echo ""
echo "[2/3] Flyway 迁移..."
if command -v mvn >/dev/null 2>&1; then
  (cd "$ROOT/backend" && mvn -pl mis-migrator flyway:migrate)
  echo "Flyway 迁移完成"
else
  echo "警告: 未找到 mvn，请安装 JDK 17 + Maven 后执行:"
  echo "  cd backend && mvn -pl mis-migrator flyway:migrate"
fi

echo ""
echo "[3/3] 完成"
cat <<'EOF'

基础设施:
  PostgreSQL  localhost:5432  mis / mis123  db=mis_platform
  Redis       localhost:6379
  Nacos       http://localhost:8848/nacos  (nacos/nacos)
  MinIO       http://localhost:9001        (minioadmin/minioadmin)

默认账号（须首次改密）:
  superadmin / Mis@123456
  admin      / Mis@123456  (app=system)
EOF
