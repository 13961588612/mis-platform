# MIS 任务流 —— 联调与试用手册

> **版本**: v1.0 | **日期**: 2026-10-08  
> **适用**: `mis-taskflow`（消息/代办/工作流/审计/执行监控）

---

## 1. 服务与端口

| 服务 | 端口 | 说明 |
|------|------|------|
| mis-gateway | 8080 | 统一入口（`/api/v1/**` → BFF） |
| mis-admin-bff | 8081 | 聚合层，透传 taskflow |
| **mis-taskflow** | **8104** | 消息 / 代办 / 工作流 / 审计 / 执行监控 |
| mis-audit | 8106 | 登录日志（HTTP 轨迹，保持不变） |

网关无需新增路由：`/api/v1/**` 已统一转发到 BFF，BFF 经 `mis.bff.taskflow-base-url`（默认 `http://localhost:8104`）调用 taskflow。

---

## 2. 数据库迁移

迁移脚本集中在 `backend/mis-migrator`：

| 版本 | 内容 |
|------|------|
| V120 | 消息 / 接收者明细 / 代办任务 |
| V121 | 工作流（定义/节点/实例/任务/历史）+ Outbox + 分布式锁 |
| V122 | 业务审计 `sys_audit_op` + `sys_oper_log` 增列 |
| V123 | 任务流菜单 / sys_api / 菜单绑定 / 管理员授权 / 演示流程 |

执行（幂等，可重复运行）：

```powershell
cd backend\mis-migrator
..\mvn.ps1 flyway:migrate "-Ddb.host=10.254.16.6" "-Ddb.port=5432" `
  "-Ddb.name=mis_platform" "-Ddb.user=mis" "-Ddb.password=mis123"
```

验证：`flyway:info` 应显示最新版本为 **123**。

---

## 3. 本地启动与联调

```powershell
# 1) 基础设施（PG/Redis/Nacos）
docker compose -f deploy/docker-compose.dev.yml up -d

# 2) 后端（按需）
cd backend
.\mvn.ps1 -pl mis-taskflow -am spring-boot:run     # 8104
.\mvn.ps1 -pl mis-admin-bff -am spring-boot:run    # 8081
.\mvn.ps1 -pl mis-gateway -am spring-boot:run      # 8080

# 3) 前端
cd frontend/mis-admin-web
pnpm dev
```

环境变量（`MIS_REMOTE=false` 时直连本地/指定 DB）：

```
DB_HOST=10.254.16.6  DB_PORT=5432  DB_NAME=mis_platform  DB_USER=mis  DB_PASSWORD=mis123
```

---

## 4. 冒烟验证

| 步骤 | 请求 | 期望 |
|------|------|------|
| 探针 | `GET /api/v1/taskflow/health` | `code=0`，`status=UP` |
| 收件箱 | `GET /api/v1/messages/inbox?tenantId=1&userId=1` | `code=0`，分页列表 |
| 待办统计 | `GET /api/v1/tasks/stats?tenantId=1&assigneeId=1` | `{pending, urgent, overdue}` |
| 流程定义 | `GET /api/v1/workflow/definitions?tenantId=1` | 含 `PURCHASE_APPROVAL_DEMO` |
| 业务审计 | `GET /api/v1/audit-ops?tenantId=1` | 分页列表 |
| 执行监控 | `GET /api/v1/exec-monitor?tenantId=1` | 分页列表 |

---

## 5. 前端入口

| 维度 | 路径 | 菜单 |
|------|------|------|
| 流程维度 | `/task/pending` | 工作台 → 我的待办 |
| 流程维度 | `/task/inbox` | 工作台 → 消息与待办 |
| 流程维度 | `/task/my-sent` | 工作台 → 我发起的 |
| 流程详情 | `/task/process/:id` | ProcessShell（进度 + 只读表单 + 审批栏） |
| 管理维度 | `/system/workflow/designer` | 系统管理 → 流程编排（拖拽设计器） |
| 管理维度 | `/system/audit-op` | 系统监控 → 业务审计 |
| 管理维度 | `/system/exec-monitor` | 系统监控 → 执行监控 |

---

## 6. 演示流程

种子 `PURCHASE_APPROVAL_DEMO`（START → 主管审批(SELF) → END，白名单 `PUR_FORM`）：

1. 进入「流程编排」确认定义或自行绘制。
2. 启动实例：
   ```http
   POST /api/v1/workflow/instances/start?tenantId=1
   { "definitionCode":"PURCHASE_APPROVAL_DEMO", "businessType":"PURCHASE_ORDER",
     "businessId":"PO-DEMO-1", "startedFormCode":"PUR_FORM", "formData":"{}",
     "initiatorId":1, "initiatorName":"演示用户" }
   ```
3. 到「我的待办」可见该待办；点击进入 ProcessShell → 同意。
4. 流程完成，实例 `postProcessStatus` 由 `WAITING` →（扫描器执行后）`SUCCESS`。
5. 「执行监控」可观测后处理任务；「业务审计」可见操作记录。

---

## 7. 测试

```powershell
# 后端（真实测试库，事务回滚 / 显式清理）
$env:MIS_DB_TEST="true"; $env:MIS_REMOTE="false"
$env:DB_HOST="10.254.16.6"; $env:DB_PORT="5432"; $env:DB_NAME="mis_platform"
$env:DB_USER="mis"; $env:DB_PASSWORD="mis123"
cd backend; .\mvn.ps1 -q -pl mis-taskflow test

# 前端
cd frontend/mis-admin-web
npx tsc --noEmit
npx vitest run
```

---

## 8. 已知边界

1. **图式流转** ✅ 已支持：`ProcessService.advanceToNext` 优先按 `wf_edge` 推进并求值 `conditionExpr`（条件分支）；`ROUTING` 节点支持会签/或签聚合（`config.routingStrategy = ALL_PASS | ANY_PASS`）。未定义边的历史定义回退 `sort_order` 线性推进。
2. **租户/用户**：接口以查询参数显式传入（单租户阶段 `tenantId=1`），网关身份透传后收紧。
3. **故障注入**：以并发/状态机测试覆盖；真实进程级 kill / 下游宕机注入建议在独立 E2E 环境补充。
4. **执行扫描**：`@Scheduled` 15s 周期，多实例由 `biz_exec_lock` 互斥；`mis.taskflow.scan.fixed-delay-ms` 可调，置 0 关闭需自定义开关。
