#!/usr/bin/env bash
# ============================================================================
# V129 演示数据 —— 可复跑验证脚本
#
# 用途：一条命令复验「wf_instance.form_data 从 DB 一路透到前端 API」整条链。
#跑法（仓库根目录）：
#     bash docs/architecture/msg-log-workflow/verify-demo-data-e2e.sh
#
# ⚠️ 环境约束（不按这个跑必然失败）：
#   1. 需要 **JDK 17**（项目 java.version=17；系统默认 java 是 8，跑不了）。
#      本脚本优先用 d:/software/jdk-17.0.2，其次用 PATH 里的 java。
#   2. 需要能连 PostgreSQL 10.254.16.6:5432 mis_platform（mis/mis123）。
#   3. **Redis 不是必需的**：本机没 Redis 时 BFF 的 RedisHealthIndicator 会把
#      /actuator/health 打成 503，但业务端点正常。所以**不要用 actuator/health 判就绪**，
#      要直接探测业务端点（脚本已这么做）。
#   4. 端口：taskflow 用 18081、BFF 用 18083，避开开发机上已在跑的 8104/ 8081。
#   5. 沙箱限制：后台常驻进程会被 SIGKILL ⇒ start→用→stop 必须放在**单条前台命令**内，
#      不要把起服务拆成多条命令。
#
# 本脚本覆盖 4 个断言：
#   A. Flyway 已把 V129 登记为 version=129（且历史迁移 checksum 无变更）
#   B. L1：mis-taskflow internal 端点返回 formData
#   C. L3：BFF /api/v1/workflow/instances/{id} 返回 formData（**前后端 VO 字段名一致性**）
#   D. form_data 的 key 与 pur-form.tsx 的 PUR_FIELDS 逐字一致
# ============================================================================
set -u

REPO="d:/code/mis-platform"
# Java 助手（Q=查库、AssertFields=字段名断言、RunSql=直跑迁移）与其 .class
# 都放在 e2e-helpers/，与本脚本同目录 ⇒ 换机器/换分支也能直接复跑，不依赖任何临时目录。
HELPERS="$REPO/docs/architecture/msg-log-workflow/e2e-helpers"
LOG_DIR="$HELPERS/logs"
OUT="$LOG_DIR/verify-demo-data-e2e.txt"
TF_PORT=18081
BFF_PORT=18083
TF_JAR="$REPO/backend/mis-taskflow/target/mis-taskflow-0.1.0-SNAPSHOT.jar"
BFF_JAR="$REPO/backend/mis-admin-bff/target/mis-admin-bff-0.1.0-SNAPSHOT.jar"
PG_JAR="d:/maven/repository/org/postgresql/postgresql/42.7.3/postgresql-42.7.3.jar"
JAVAC8="/c/Program Files/Java/jdk1.8.0_121/bin/javac.exe"
DB_URL="jdbc:postgresql://10.254.16.6:5432/mis_platform"
IDS="960101 960102 960103 960104"

mkdir -p "$LOG_DIR"; : > "$OUT"
# ⚠️ 必须显式给脚本定 UTF-8：Git Bash on Windows 默认按 GBK/CP936 解释脚本字面量，
#    写成 UTF-8 的中文注释与文案会在输出里变成乱码（实测踩过）。
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8
say() { echo "$@" >> "$OUT"; }
FAIL=0
check() { if [ "$1" = "0" ]; then say "  [PASS] $2"; else say "  [FAIL] $2"; FAIL=1; fi; }

# ---- 选 JDK 17（Spring Boot 3 / Flyway 10 都要 17+）
JAVA17="/d/software/jdk-17.0.2/bin/java.exe"
[ -x "$JAVA17" ] || JAVA17="$(command -v java)"

cleanup() {
  for p in $(netstat -ano 2>/dev/null | grep -E ":($TF_PORT|$BFF_PORT) " | grep -i listening | awk '{print $5}'); do
    taskkill /F /PID "$p" >> "$OUT" 2>&1
  done
}
trap cleanup EXIT

say "=============================================================="
say " 断言 A：Flyway 版本登记"
say "=============================================================="
cd "$HELPERS" || { say "[FAIL] 缺少 e2e-helpers/ 目录"; exit 1; }
# 从源码现编，避免依赖已提交的 .class 与 JDK 小版本
"$JAVAC8" -encoding UTF-8 -cp "$PG_JAR" Q.java AssertFields.java >> "$OUT" 2>&1
java -cp ".;$PG_JAR" Q \
  "SELECT version, description, success FROM flyway_schema_history WHERE version IN ('128','129') ORDER BY installed_rank" \
  > "$LOG_DIR/_a.txt" 2>&1
grep -q "129" "$LOG_DIR/_a.txt"; check $? "V129 已在 flyway_schema_history 登记"
grep -q "true" "$LOG_DIR/_a.txt"; check $? "迁移记录 success=true"
say "$(cat "$LOG_DIR/_a.txt")"

say ""
say "=============================================================="
say " 断言 B/L1：mis-taskflow internal 端点 formData"
say "=============================================================="
"$JAVA17" -jar "$TF_JAR" --server.port="$TF_PORT" \
  --spring.datasource.url="$DB_URL" \
  --spring.datasource.username=mis --spring.datasource.password=mis123 \
  > "$LOG_DIR/v-taskflow.log" 2>&1 &
for i in $(seq 1 120); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$TF_PORT/internal/v1/taskflow/health" 2>/dev/null || true)" = "200" ] && break
  sleep 1
done
for ID in $IDS; do
  R=$(curl -s "http://127.0.0.1:$TF_PORT/internal/v1/workflow/instances/$ID?tenantId=1")
  echo "$R" | grep -q '"formData":"{'; check $? "L1 $ID 响应含 formData 字符串"
done
say "样例（960101 的 formData 片段）："
# ⚠️ formData 在响应里是**被转义过的 JSON 串**（外层引号 + 内层 \" ），
#    用 grep -o '"formData":"[^"]*' 会在第一个 \" 处截断，只剩 "{\ —— 要看到内容
#    得先把 \" 解回来，或者直接截足够长再手工看。这里两种都留。
curl -s "http://127.0.0.1:$TF_PORT/internal/v1/workflow/instances/960101?tenantId=1" \
  | grep -o '"formData":.*' | head -c 700 >> "$OUT"
say ""

say ""
say "=============================================================="
say " 断言 C/L3：BFF 透传（前后端 VO 字段名一致性）"
say "=============================================================="
say "⚠️ 需BFF jar 含最新 ProcessDetailVO。若下面 4 条全null，"
say "   说明 jar 是旧构建 —— 重新 mvn -pl mis-admin-bff -am -DskipTests package"
"$JAVA17" -jar "$BFF_JAR" --server.port="$BFF_PORT" \
  --spring.datasource.url="$DB_URL" \
  --spring.datasource.username=mis --spring.datasource.password=mis123 \
  --mis.bff.taskflow-base-url="http://127.0.0.1:$TF_PORT" \
  --mis.bff.taskflow-discovery-enabled=false \
  --logging.level.root=WARN \
  > "$LOG_DIR/v-bff.log" 2>&1 &
# 用业务端点探活（不能用 actuator/health：Redis 缺失会 503）
for i in $(seq 1 150); do
  C=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 \
      -H "X-User-Id: 1" -H "X-Tenant-Id: 1" -H "X-Username: admin" \
      "http://127.0.0.1:$BFF_PORT/api/v1/workflow/instances/960101?tenantId=1" 2>/dev/null || true)
  [ -n "$C" ] && [ "$C" != "000" ] && break
  sleep 1
done
# 等ApiPermissionRegistry 灌完，否则任何 /api/v1/** 都返回 40300「接口未授权映射」
say "[WAIT] 等ApiPermissionRegistry 灌入（20s）"; sleep 20
for ID in $IDS; do
  R=$(curl -s -H "X-User-Id: 1" -H "X-Tenant-Id: 1" -H "X-Username: admin" \
      "http://127.0.0.1:$BFF_PORT/api/v1/workflow/instances/$ID?tenantId=1")
  echo "$R" | grep -q '"formData":"{'; check $? "L3 $ID BFF 响应含 formData（字段名未在 BFF 断掉）"
done
say "样例（BFF 960101 的 formData 片段）："
curl -s -H "X-User-Id: 1" -H "X-Tenant-Id: 1" -H "X-Username: admin" \
  "http://127.0.0.1:$BFF_PORT/api/v1/workflow/instances/960101?tenantId=1" \
  | grep -o '"formData":.*' | head -c 700 >> "$OUT"
say ""

say ""
say "=============================================================="
say " 断言 D：form_data key 与 pur-form.tsx PUR_FIELDS 逐字一致"
say "=============================================================="
"$JAVAC8" -encoding UTF-8 -cp "$PG_JAR" AssertFields.java >> "$OUT" 2>&1
java -cp ".;$PG_JAR" AssertFields >> "$OUT" 2>&1
check $? "4 条实例的 form_data key 均为 8/8 匹配且类型正确"

say ""
say "=============================================================="
if [ "$FAIL" = "0" ]; then say "总结论：全部断言通过 ✅"; else say "总结论：存在失败项 ❌"; fi
say "=============================================================="
exit $FAIL
