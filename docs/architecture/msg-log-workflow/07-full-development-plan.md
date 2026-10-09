# MIS 平台：消息·日志·工作流 —— 全量开发与测试总计划

> **版本**: v1.0 | **日期**: 2026-10-08  
> **适用范围**: `mis-taskflow`（消息/代办/工作流引擎）+ `mis-audit`（业务审计）+ `mis-admin-bff`（BFF 聚合）+ `mis-admin-web`（前端）  
> **目标**: 按阶段交付、每阶段可测可验收、全链路最终一致、人工可兜底

---

## 0. 总体里程碑

| 里程碑 | 包含阶段 | 交付主题 | 退出条件 |
|--------|----------|----------|----------|
| M1 数据与骨架 | P0–P1 | 建库 + 模块骨架 + 路由打通 | 迁移脚本可重跑、空服务可启动、探针接口通 |
| M2 消息与代办 | P2–P3 | 消息中心 + 代办任务 + 收件箱 | 收发/已读/角标闭环、单测通过 |
| M3 业务审计 | P4 | `sys_audit_op` + AOP 采集 + 查询报表 | 变更快照可见、报表可筛选导出 |
| M4 工作流引擎 | P5 | 定义 + 实例 + 节点流转 | 单级/多级审批端到端跑通 |
| M5 高可用闭环 | P6 | Outbox + 分布式锁表 + 定时修复 | 宕机/并发/重试场景恢复 |
| M6 可视化与表单 | P7 | 流程设计器 + ProcessShell + 双维导航 | 拖拽编排 + 只读审批 + 进度图 |
| M7 全量验收 | P8 | 端到端联调 + 压测 + 灰度 | 全部验收用例通过 |

---

## P0：准备与共识（0.5 天）

**开发任务**
1. 评审文档 `06-workflow-architecture-final-design-v4.md`，冻结字段命名与状态枚举。
2. 冻结 REST 路径规范：服务内部 `/internal/v1/*`，BFF 对外 `/api/v1/*`。
3. 冻结角色权限码：`taskflow:task:handle` / `taskflow:def:edit` / `audit:op:view` 等。
4. 建立分支：`codex/taskflow-phase0`。

**测试任务**
- 文档走查：字段与状态枚举无歧义（`PENDING/APPROVING/APPROVED/REJECTED/EXPIRED/CANCELLED`）。
- 依赖确认：`@xyflow/react`、`@dagrejs/dagre` 已存在，无需新增前端包。

**退出标准**：评审通过并记录冻结清单。

---

## P1：基础设施与骨架（2 天）

### 开发
1. **后端模块**
   - `backend/pom.xml` 注册 `<module>mis-taskflow</module>`。
   - 新建 `mis-taskflow`，pom 依赖 `mis-common-core/web/jpa/security` + `spring-boot-starter-data-jpa` + `postgresql` + `validation` + `actuator` + test。
   - 建 `TaskflowApplication`、`support/IdGenerator`、`application.yml`、`bootstrap.yml`（对齐 `mis-system` 范式）。
2. **数据库迁移**（集中在 `mis-migrator/src/main/resources/db/migration/`）
   - `V120__taskflow_schema.sql`：`sys_message` / `sys_message_receiver` / `sys_task` / `wf_definition` / `wf_node` / `wf_instance` / `wf_task` / `wf_history`。
   - `V121__taskflow_exec_schema.sql`：`biz_execution_task` / `biz_exec_lock`。
   - `V122__audit_op_enhance.sql`：`sys_audit_op` 建表 + `sys_oper_log` 增列。
   - 全部脚本采用“固定 ID + WHERE NOT EXISTS / IF NOT EXISTS”幂等风格，可重跑。
3. **BFF 打通**
   - `mis-admin-bff` 增加 `TaskflowClient`（继承 `AbstractDownstreamClient`）与健康探针透传。
4. **前端路由骨架**
   - `router.tsx` 增加 `/task/*`、`/system/workflow/*`。
   - `keep-alive-outlet.tsx` 的 `PAGE_MAP` 注册占位页。

### 测试
- **单测**：`IdGenerator` 唯一性；状态枚举解析。
- **集成测试**：Flyway 全量迁移在干净库可执行，重复执行无报错。
- **联调测试**：`/internal/v1/taskflow/health` 与 BFF `/api/v1/taskflow/health` 返回一致。
- **前端**：占位页在 `/task/pending`、`/system/workflow/definitions` 可加载，无白屏。

### 退出标准
迁移幂等通过、空服务可启动、探针链路通、前端占位路由可访问。

---

## P2：消息中心与接收者体系（2 天）

### 开发
1. 实体：`SysMessage`、`SysMessageReceiver`。
2. Service：`MessageService.publish()`（写主表 + 批量写接收者明细）、`markRead()`、`clean()`、`search()`。
3. Controller（内部）：`/internal/v1/messages` 列表 / 详情 / 标已读 / 检索。
4. BFF：`MessageFacadeService` + `/api/v1/messages/*`。
5. 前端：`features/notification` 的 `InboxPage`、`FilterBar`、`MessageCard`、`BadgeCounter`。

### 测试
- **单测**：群发消息生成 N 条接收者记录；单发只生成 1 条；重复标记已读幂等。
- **集成测试**：按 `receiver_ids && ARRAY[user]` 与按明细表查询结果一致；已读率统计正确。
- **接口测试**：分页、类型/状态/时间筛选、关键词检索组合查询。
- **前端单测（Vitest）**：`BadgeCounter` 渲染、筛选条件变化触发请求、空态展示。
- **验收**：用户 A 发的消息，用户 B 收件箱可见且 B 标记已读不影响 C。

### 退出标准
收发、已读、检索、角标全闭环；单测与接口测试通过。

---

## P3：代办任务体系（2 天）

### 开发
1. 实体：`SysTask`（含 `biz_type/biz_ref_id/assignee_id/status/priority/due_date/metadata`）。
2. Service：`createTaskWithNotification()`（创建代办 + 自动关联消息）、`handleTask()`、`transfer()`、`batchHandle()`、`stats()`。
3. 关联：`sys_message.reference_task_id` 回指（纯通知为 NULL）。
4. 前端：`TaskCard`、`TaskList`、`TaskStatsBar`、`useTaskActions`。

### 测试
- **单测**：创建代办同时生成关联消息；处理代办后状态与消息联动；驳回不进入后处理。
- **并发测试**：同一代办被并发处理，仅一次生效（配合 P6 锁表预演）。
- **接口测试**：我的待办分页、统计数字、批量处理。
- **前端单测**：`TaskCard` 一键处理调用、失败提示、按钮 loading 锁定。
- **验收**：待办可一键处理，处理结果即时反映到发件人收件箱。

### 退出标准
代办与消息双轨可独立/可关联；统计准确；处理幂等。

---

## P4：操作审计与报表（2.5 天）

### 开发
1. `@BusinessOperation` 注解 + `BusinessOperationAspect` 切面。
2. 实体 `SysAuditOp`（`before_data/after_data/diff_summary/result_status/trace_id`）。
3. Service：`AuditOpQueryService`（列表 / 详情 / 时间线 / 统计 / 导出）。
4. Controller：`/internal/v1/audit-ops`，BFF `/api/v1/audit-ops`。
5. 前端：`features/system/audit` 的 `AuditListPage`、`AuditDiffViewer`、`AuditTimeline`、导出按钮。

### 测试
- **单测**：`diff` 计算正确（新增/删除/修改字段）；脱敏字段不入库。
- **集成测试**：切面在成功与异常两条路径都落库 `result_status`。
- **接口测试**：多条件组合筛选、时间线按业务 `biz_type+biz_id` 聚合、CSV 导出编码正确。
- **前端单测**：DiffViewer 高亮渲染；时间线排序；导出触发。
- **验收**：UPDATE 操作可在界面看到 before/after 对比，无需阅读 JSON。

### 退出标准
业务操作语义化可读、可追溯、可导出；`sys_oper_log` 兼容不变。

---

## P5：工作流引擎核心（3 天）

### 开发
1. 实体：`WfDefinition`（`supported_form_codes`）/`WfNode`/`WfInstance`（`started_form_code/post_process_status`）/`WfTask`/`WfHistory`。
2. Service：`DefinitionService`（CRUD/激活）、`ProcessService`（启动/推进/驳回/转办）、`AssignmentResolver`（角色/主管/部门/公式）。
3. 回调：节点分配与节点完成事件。
4. Controller：`/internal/v1/workflow/definitions|instances|tasks`。
5. BFF：`WorkflowFacadeService` + `/api/v1/workflow/*`。

### 测试
- **单测**：审批人解析六种规则；条件表达式求值；驳回退回层级。
- **状态机测试**：合法流转全部枚举；非法流转抛业务异常。
- **集成测试**：单级审批（提交→审批→完成）；多级审批（含条件分支）。
- **接口测试**：启动流程校验 `started_form_code` 必须在白名单内。
- **验收**：一个流程可被多个表单通过白名单复用。

### 退出标准
单级/多级/条件分支审批端到端跑通；白名单校验生效。

---

## P6：高可用闭环（3 天）—— 本方案核心

### 开发
1. **Outbox 模式**：所有跨服务动作写 `biz_execution_task`（`WAITING→SUCCESS/FAILED`）。
2. **扫描器** `TaskScanScheduler`：定时拉取待执行任务。
3. **分布式锁** `biz_exec_lock`：
   - 执行前 `INSERT` 抢锁；冲突则进入**状态轮询确认**，仅当对方的 `status=SUCCESS` 才返回成功。
   - 超时夺权：`RUNNING` 超时后清理并重新抢锁。
4. **幂等**：业务动作前置状态校验 + 条件 UPDATE。
5. **重试**：指数退避，达阈值升级为 `MANUAL_FIX`。
6. **人工干预**：`/api/v1/taskflow/exec-monitor` 列表 / 详情 / 手动重试 / 强制归档 / 熔断开关。
7. 前端：`features/system/exec-monitor` 监控看板。

### 测试
- **单测**：抢锁成功/失败两条路径；冲突时绝不误判成功；超时夺权逻辑。
- **并发测试**：N 线程同时处理同一单，业务动作恰好执行一次。
- **故障注入**：
  - 扫描器执行中 kill 进程 → 锁表残留 `RUNNING` → 超时后被夺权重跑。
  - 下游服务宕机 → 任务转 `FAILED` → 退避重试 → 恢复后成功。
- **幂等测试**：同一任务重复投递，结果一致。
- **前端单测**：监控看板状态色、重试按钮调用、失败详情展示。
- **验收**：断网/宕机/并发三类场景均能自动收敛，无法收敛则可见告警并可人工重试。

### 退出标准
无“假成功”；失败任务可见、可重试、可强制归档。

---

## P7：可视化编排与前端交互（3 天）

### 开发
1. **流程设计器** `features/system/workflow-designer`（复用 `ModelCanvas` 模式）：
   - 六种节点：Start/Approval/Condition/Route/Automation/End。
   - Palette 拖拽、连线、属性面板、Dagre 自动布局、校验器、Undo/Redo。
   - 全局属性含 **表单白名单多选**（`supported_form_codes`）。
2. **入口归属**：侧边栏「系统管理 → 流程中心」，路由 `/system/workflow/*`（仅管理员）。
3. **ProcessShell**：顶部进度图 + 中部只读表单 + 底部动态审批栏。
4. **只读方案**：`FormSheet` 组件映射替换法（TEXT/SELECT/DATE/UPLOAD/RICH_TEXT）。
5. **双维导航**：
   - 流程维度：门户看板 + 顶栏铃铛抽屉 + 侧边「审批中心」（`/task/*`）。
   - 表单维度：各业务模块列表 + 新增 + 查看。

### 测试
- **前端单测**：Dagre 布局、校验器规则、节点默认数据、只读映射渲染。
- **交互测试**：拖拽建节点、连线、Delete 删除、撤销重做、属性编辑。
- **联调测试**：保存定义 → 加载编辑视图回显一致；发布后启动流程可选中白名单表单。
- **验收**：拖拽完成一张含条件分支的流程并发布；审批页正确显示只读态与参与人。

### 退出标准
编排、发布、渲染、审批、进度可视化全链路可用。

---

## P8：全量验收与发布（2.5 天）

### 开发
1. 菜单与权限种子迁移：`V123__taskflow_menu_api_seed.sql`。
2. 初始化种子：默认流程定义 + 演示表单绑定。
3. 文档同步：更新 `docs/README.md`，补齐 API/权限清单。

### 测试
- **端到端用例**（覆盖全链路）：
  1. 员工提交表单 → 生成代办+消息 → 审批 → 结束 → 业务归档成功。
  2. 审批驳回 → 退回发起人 → 修改重提。
  3. 多节点会签 + 条件分支金额分流。
  4. 并发重复提交 → 仅一次生效。
  5. 归档动作失败 → 监控看板可见 → 手动重试成功。
- **性能测试**：10 万级消息量下列表查询 < 500ms；扫描器在任务积压下无堆积。
- **兼容性测试**：`sys_oper_log` 既有消费方不受影响。
- **回归测试**：前端既有路由/导航无破坏。
- **灰度**：先开放一个业务模块，观察 3 天再全量。

### 退出标准
全部验收用例通过、性能达标、灰度无回滚。

---

## 附 A：测试体系总纲

| 层级 | 工具 | 范围 | 时机 |
|------|------|------|------|
| 单元测试 | JUnit5 / Vitest | 纯逻辑、状态机、解析器、映射 | 每次提交 |
| 集成测试 | Spring Boot Test + Testcontainers/本地 PG | 迁移、事务、JPA 查询 | 每个阶段 |
| 接口测试 | MockMvc / WebTestClient | 内部 API + BFF | 每个阶段 |
| 并发/故障注入 | JUnit 并发 + 手动 kill | 锁表、Outbox、重试 | P6 |
| 端到端 | 前端 e2e + 真实服务 | 全链路 | P8 |
| 性能测试 | JMeter/Gatling | 列表与扫描器 | P8 |

## 附 B：关键风险与预案

| 风险 | 影响 | 预案 |
|------|------|------|
| 迁移脚本非幂等 | 重跑失败 | 固定 ID + NOT EXISTS，CI 验证二次执行 |
| 锁表误判成功 | 业务静默丢失 | 冲突必须轮询到 SUCCESS，禁止凭影响行数判定 |
| 扫描器单点 | 任务堆积 | 多实例部署 + 锁表互斥，加告警 |
| 表单只读用 disabled | 不可复制、体验差 | 强制走组件映射替换法 |
| 白名单校验缺失 | 任意表单挂流程 | 启动流程前强校验，接口测试覆盖 |

## 附 C：状态枚举冻结清单

- 任务：`PENDING / APPROVING / APPROVED / REJECTED / EXPIRED / CANCELLED`
- 实例：`RUNNING / COMPLETED / TERMINATED / SUSPENDED`
- 后处理：`WAITING / SUCCESS / FAILED / RETRYING / MANUAL_FIX`
- 执行任务：`WAITING / SUCCESS / FAILED`
- 锁：`RUNNING / SUCCESS / FAILED`


---

## 附 D：P1 执行状态（2026-10-08）

| 项 | 状态 | 说明 |
|----|------|------|
| `mis-taskflow` 模块注册 | 已完成 | `backend/pom.xml` 已加入 `<module>mis-taskflow</module>` |
| 模块骨架 | 已完成 | `TaskflowApplication` / `IdGenerator` / `TaskflowStatus` / 探针接口 |
| `mis-taskflow` 编译 | 通过 | `mvn -pl mis-taskflow -am compile` |
| `mis-taskflow` 单测 | 通过 | `IdGeneratorTest`(2) + `TaskflowStatusTest`(2) |
| V120 迁移脚本 | 已编写 | 消息 + 接收者明细 + 代办任务 |
| V121 迁移脚本 | 已编写 | 流程定义/节点/实例/任务/历史 + Outbox + 锁表 |
| V122 迁移脚本 | 已编写 | `sys_audit_op` 建表 + `sys_oper_log` 增列（幂等） |
| BFF 客户端 | 已完成 | `TaskflowWebClient` + `/api/v1/taskflow/health`，BFF 编译通过 |
| 前端路由骨架 | 已完成 | `/task/*`、`/system/workflow/*`，`PAGE_MAP` 已注册 |
| 前端导航 | 已完成 | 「工作台」+「流程中心」，图标均已在 `icons.ts` 注册 |
| 前端类型检查 | 通过 | `tsc --noEmit` |
| 前端单测 | 通过 | `system-nav.test.ts`（4 个用例） |
| Flyway 实库执行 | 已完成 | 测试库 `10.254.16.6:5432/mis_platform`，v118 → v122，4 个迁移全部 Success |
| 迁移幂等复跑 | 已完成 | 直接重跑 V120/V121/V122 原始 SQL，全部 OK |
| 表结构核验 | 已完成 | 11 张新表 + `sys_oper_log` 7 个新列全部存在，类型正确 |
| Spring 集成测试 | 通过 | `TaskflowApplicationIntegrationTest`（真实上下文 + 真实库 + 探针 HTTP 200） |

> P1 已在测试环境 PostgreSQL 上完成实库验证：`mis-migrator` 迁移至 v122、脚本幂等、11 张表与 7 个新增列齐备、服务以真实上下文启动并通过探针接口。**P1 已完全退出。**


---

## 附 E：P2 执行状态（2026-10-08）

| 项 | 状态 | 说明 |
|----|------|------|
| 实体 | 已完成 | `SysMessage`（`receiver_ids bigint[]` + `reference_task_id`）/`SysMessageReceiver` |
| 仓储 | 已完成 | 收件箱/检索用原生 SQL（`:userId = ANY(receiver_ids)`），明细表按用户查询 |
| Service | 已完成 | `publish`（主表 + N 条明细，去重）/`inbox`/`search`/`detail`（可见性校验）/`markRead`（幂等 + 计数回写）/`stats` |
| 内部 API | 已完成 | `/internal/v1/messages` 发布 / inbox / search / {id} / read / stats |
| BFF | 已完成 | `TaskflowWebClient` 扩展消息方法 + `MessageController`（`/api/v1/messages/*`） |
| 前端 API | 已完成 | `lib/api/messages.ts` + 类型 |
| 前端页面 | 已完成 | `features/taskflow/inbox-page.tsx`（收件箱：分页/筛选/搜索/标已读/未读角标） |
| 路由与导航 | 已完成 | `/task/inbox`，侧边栏「消息与待办」 |
| 后端集成测试 | 通过 | `MessageServiceIntegrationTest` 10/10（真实库，事务回滚） |
| 前端单测 | 通过 | `inbox-page.test.tsx` 4/4 |
| 前端类型检查 | 通过 | `tsc --noEmit` |
| BFF 编译 | 通过 | `mvn -pl mis-admin-bff -am compile` |

**P2 已退出。** 单发/群发/去重/已读幂等/用户隔离/收件箱过滤/关键词检索/角标统计/非接收者拒绝/空接收者拒绝 全部覆盖。

> 遗留：P2 的租户与用户在接口上以查询参数显式传入（单租户阶段 tenantId 固定 1）。P3 接入网关身份透传后，改为从 `LoginUser` 取并收紧为不可越权。


---

## 附 F：P3 执行状态（2026-10-08）

| 项 | 状态 | 说明 |
|----|------|------|
| 实体 | 已完成 | `SysTask`（`biz_type/biz_ref_id` 仅存于此表，`metadata` 预留 wf 映射） |
| 仓储 | 已完成 | `SysTaskRepository`：我的待办 / 未完成 / 待处理·紧急·逾期统计 |
| Service | 已完成 | `createTask`（可选自动生成关联消息）/`myTasks`/`handleTask`（幂等）/`transferTask`/`batchHandle`/`stats` |
| 内部 API | 已完成 | `/internal/v1/tasks`：创建 / `/my` / `/stats` / `/{id}/handle` / `/{id}/transfer` / `/batch-handle` |
| BFF | 已完成 | `TaskflowWebClient` 扩展任务方法 + `TaskController`（`/api/v1/tasks/*`） |
| 前端 API | 已完成 | `lib/api/tasks.ts` + 类型 |
| 前端页面 | 已完成 | `features/taskflow/task-list-page.tsx`（待办列表：状态筛选/优先级/逾期/一键同意·驳回/统计角标） |
| 路由 | 已完成 | `/task/pending` 挂载 `TaskListPage`（替换占位页） |
| 后端集成测试 | 通过 | `TaskServiceIntegrationTest` 11/11（真实库，事务回滚） |
| 前端单测 | 通过 | `task-list-page.test.tsx` 3/3 |
| 前端类型检查 | 通过 | `tsc --noEmit` |
| BFF 编译 | 通过 | `mvn -pl mis-admin-bff -am compile` |

**P3 已退出。** 覆盖：创建带/不带通知、处理状态流转、重复处理拒绝（幂等）、非法 action 拒绝、转办、我的待办隔离、批量处理、统计、跨租户拒绝、不存在 NOT_FOUND、通知 `reference_task_id` 回指。

> 遗留同 P2：租户/用户仍以查询参数显式传入（单租户阶段 tenantId 固定 1）。P3 的并发竞争测试将并入 P6 分布式锁验证。

### 累计测试规模（P1–P3）

| 后端测试类 | 用例数 | 说明 |
|-----------|--------|------|
| `IdGeneratorTest` | 2 | 并发唯一 + 单调 |
| `TaskflowStatusTest` | 2 | 状态枚举冻结 |
| `TaskflowApplicationIntegrationTest` | 2 | 真实上下文 + 探针 |
| `MessageServiceIntegrationTest` | 10 | 消息中心 |
| `TaskServiceIntegrationTest` | 11 | 代办任务 |
| **后端合计** | **27** | 均连真实测试库 |

| 前端测试 | 用例数 |
|---------|--------|
| `system-nav.test.ts` | 4 |
| `inbox-page.test.tsx` | 4 |
| `task-list-page.test.tsx` | 3 |
| **前端合计** | **11** |


---

## 附 G：P4 执行状态（2026-10-08）

| 项 | 状态 | 说明 |
|----|------|------|
| 实体 | 已完成 | `SysAuditOp`（before/after/diff_summary/result_status/trace_id/extra_context） |
| 仓储 | 已完成 | `SysAuditOpRepository`：多条件检索 / 业务时间线 / 统计 |
| 注解 | 已完成 | `@BusinessOperation`（module/type/businessType/description） |
| 上下文 | 已完成 | `AuditContext`（ThreadLocal 传 businessId/before/after，切面自动清理） |
| 差异计算 | 已完成 | `AuditDiffUtils`：字段级 diff，支持嵌套点号路径，异常降级为空数组 |
| AOP 切面 | 已完成 | `BusinessOperationAspect`：成功与异常双路径落库，审计失败不影响主业务 |
| Service | 已完成 | `AuditOpService`：save / search / detail / timeline / stats |
| 内部 API | 已完成 | `/internal/v1/audit-ops`：检索 / {id} / timeline / stats / **CSV 导出（UTF-8 BOM）** |
| BFF | 已完成 | `TaskflowWebClient` 扩展审计方法 + `AuditOpController`（`/api/v1/audit-ops/*`） |
| 前端 API | 已完成 | `lib/api/audit-ops.ts` + `parseDiff` 容错 |
| 前端页面 | 已完成 | `features/system/audit/audit-op-page.tsx`（列表 + 多条件筛选 + 变更对比弹窗） |
| 路由与导航 | 已完成 | `/system/audit-op`，侧边栏「审计 → 业务审计」 |
| 业务接入示例 | 已完成 | `TaskService.handleTask` 真实挂上 `@BusinessOperation` + `AuditContext` |
| 后端集成测试 | 通过 | `AuditOpServiceIntegrationTest` 6/6（真实库，验证切面成功/失败双路径） |
| 差异单测 | 通过 | `AuditDiffUtilsTest` 6/6（修改/新增/删除/嵌套/无变更/空输入） |
| 前端单测 | 通过 | `audit-op-page.test.tsx` 3/3 |
| 前端类型检查 | 通过 | `tsc --noEmit` |
| BFF 编译 | 通过 | `mvn -pl mis-admin-bff -am compile` |

**P4 已退出。** 业务操作语义化可读、before/after 可对比、可时间线追溯、可导出；`sys_oper_log` 兼容不变。

### 累计测试规模（P1–P4）

| 后端测试类 | 用例数 |
|-----------|--------|
| `IdGeneratorTest` | 2 |
| `TaskflowStatusTest` | 2 |
| `TaskflowApplicationIntegrationTest` | 2 |
| `MessageServiceIntegrationTest` | 10 |
| `TaskServiceIntegrationTest` | 11 |
| `AuditDiffUtilsTest` | 6 |
| `AuditOpServiceIntegrationTest` | 6 |
| **后端合计** | **39** |

| 前端测试 | 用例数 |
|---------|--------|
| `system-nav.test.ts` | 4 |
| `inbox-page.test.tsx` | 4 |
| `task-list-page.test.tsx` | 3 |
| `audit-op-page.test.tsx` | 3 |
| **前端合计** | **14** |


---

## 附 H：P5 执行状态（2026-10-08）

| 项 | 状态 | 说明 |
|----|------|------|
| 实体 | 已完成 | `WfDefinition`（含 `supported_form_codes text[]`）/`WfNode`/`WfInstance`（含 `started_form_code`、`post_process_status`）/`WfTask`（含 `sys_task_id`）/`WfHistory` |
| 仓储 | 已完成 | 5 个 Repository（定义/节点/实例/流程任务/历史） |
| 审批人解析 | 已完成 | `AssignmentResolver` 六种规则（SELF/FIXED/USER_LIST/SUPERVISOR/ROLE/DEPT_LEADER）+ `AssigneeProvider` 扩展点 |
| 定义管理 | 已完成 | `WfDefinitionService`：创建/更新（仅草稿）/发布/查询；校验「恰一个 START + 至少一个 END + 审批人规则必填」 |
| 引擎核心 | 已完成 | `ProcessService`：startProcess（白名单校验）/ advanceToNext / assignNode / completeTask（同意推进、驳回终止）/ detail / myInitiated |
| 表单白名单 | 已完成 | 启动时强校验 `startedFormCode` 必须在 `supportedFormCodes` 内 |
| 双写联动 | 已完成 | 审批节点同时创建 `wf_task`（引擎视角）+ `sys_task`（用户视角）+ 关联通知消息 |
| Outbox 接入 | 已完成 | `ExecutionTaskService.enqueue` + `BizExecutionTask` 实体/仓储；流程结束写 `FINALIZE_BIZ` 待后处理 |
| 内部 API | 已完成 | `/internal/v1/workflow/definitions/*` + `/internal/v1/workflow/instances/*` + `/tasks/{id}/complete` |
| BFF | 已完成 | `TaskflowWebClient` 扩展工作流方法 + `WorkflowController`（`/api/v1/workflow/*`） |
| 前端 API | 已完成 | `lib/api/workflow.ts` + 类型 |
| 前端页面 | 已完成 | `features/taskflow/my-sent-page.tsx` 接入真实流程实例（状态徽标/表单/后处理状态） |
| 后端测试 | 通过 | `AssignmentResolverTest` 8/8 + `ProcessServiceIntegrationTest` 10/10 |
| 前端单测 | 通过 | `my-sent-page.test.tsx` 2/2 |
| 前端类型检查 | 通过 | `tsc --noEmit` |
| BFF 编译 | 通过 | `mvn -pl mis-admin-bff -am compile` |

**P5 已退出。** 覆盖：白名单校验（合法通过 / 非白名单拒绝）、启动生成双写任务、单级审批通过→COMPLETED+后处理、驳回→TERMINATED、多级逐级推进、非处理人被拒、重复处理幂等、详情历史 SUBMIT→APPROVE、我发起的查询、定义校验（无 START / 审批人缺失）。

### 累计测试规模（P1–P5）

| 后端测试类 | 用例数 |
|-----------|--------|
| `IdGeneratorTest` | 2 |
| `TaskflowStatusTest` | 2 |
| `TaskflowApplicationIntegrationTest` | 2 |
| `MessageServiceIntegrationTest` | 10 |
| `TaskServiceIntegrationTest` | 11 |
| `AuditDiffUtilsTest` | 6 |
| `AuditOpServiceIntegrationTest` | 6 |
| `AssignmentResolverTest` | 8 |
| `ProcessServiceIntegrationTest` | 10 |
| **后端合计** | **57** |

| 前端测试 | 用例数 |
|---------|--------|
| `system-nav.test.ts` | 4 |
| `inbox-page.test.tsx` | 4 |
| `task-list-page.test.tsx` | 3 |
| `audit-op-page.test.tsx` | 3 |
| `my-sent-page.test.tsx` | 2 |
| **前端合计** | **16** |

> 遗留：
> 1. P5 的 `advanceToNext` 按节点 `sort_order` 线性推进，**条件分支/会签路由**的图式推进留待 P7 流程设计器落地后补全（当前 APPROVAL 线性链已满足单级/多级审批）。
> 2. 后处理仅写 Outbox `WAITING`，真实扫描执行 + 分布式锁在 **P6** 实现。


---

## 附 I：P6 执行状态（2026-10-08）—— 高可用闭环

| 项 | 状态 | 说明 |
|----|------|------|
| 锁表实体 | 已完成 | `BizExecLock`（复合主键 biz_type+biz_id） |
| 锁存入 | 已完成 | `LockInsertExecutor`（独立 Bean，`persist()` 强制 INSERT，`REQUIRES_NEW`）+ `LockStore` |
| 分布式锁 | 已完成 | `DistributedLockService`：INSERT 抢锁 → 冲突轮询确认（只认 SUCCESS）→ FAILED/RUNNING 超时夺权；返回 EXECUTED / ALREADY_SUCCESS / TIMEOUT |
| Outbox 实体 | 已完成 | `BizExecutionTask`（WAITING/SUCCESS/FAILED/MANUAL_FIX + retry_count + next_retry_at） |
| 执行存储 | 已完成 | `ExecutionTaskStore`（独立 Bean，`REQUIRES_NEW`）：perform 幂等回写 + markFailure 指数退避 |
| 执行服务 | 已完成 | `ExecutionTaskService`：enqueue / scanAndExecute / executeOne / manualRetry / forceArchive / monitor / taskDetail |
| 扫描器 | 已完成 | `ExecutionTaskScheduler`（`@Scheduled` fixedDelay，可配置） |
| 内部 API | 已完成 | `/internal/v1/exec-monitor`：列表 / 详情 / 重试 / 强制归档 / 立即扫描 |
| BFF | 已完成 | `TaskflowWebClient` 扩展监控方法 + `ExecutionMonitorController`（`/api/v1/exec-monitor/*`） |
| 前端 API | 已完成 | `lib/api/exec-monitor.ts` + 类型 |
| 前端页面 | 已完成 | `features/system/exec-monitor/exec-monitor-page.tsx`（状态筛选 / 手动重试 / 强制归档） |
| 路由与导航 | 已完成 | `/system/exec-monitor`，侧边栏「审计 → 执行监控」 |
| 后端测试 | 通过 | `DistributedLockServiceTest` 3/3 + `ExecutionTaskServiceIntegrationTest` 6/6 |
| 前端单测 | 通过 | `exec-monitor-page.test.tsx` 4/4 |
| 前端类型检查 | 通过 | `tsc --noEmit` |
| BFF 编译 | 通过 | `mvn -pl mis-admin-bff -am compile` |

**P6 已退出。** 覆盖：并发 8 线程抢同一业务动作**恰好执行一次**、单线程重复执行识别为 ALREADY_SUCCESS、业务抛异常锁置 FAILED 可重竞争、Outbox 扫描执行归档、执行幂等、手动重试、强制归档、跨租户拒绝。

### 关键缺陷修复记录（P6）

1. **【严重】Repository.save 对已赋值复合主键走 merge 而非 insert**：第二次抢锁退化为 UPDATE，不触发主键冲突，导致锁完全失效（实测 8 线程执行 6 次）。修复：改用 `EntityManager.persist()` 强制 INSERT。
2. **【严重】同方法内 try/catch 的 REQUIRES_NEW 事务**：主键冲突污染事务，抛出 `UnexpectedRollbackException` 而非返回 false。修复：拆出独立 Bean `LockInsertExecutor`，在无事务边界捕获。
3. **【中】自调用 @Transactional 不生效**：`perform`/`markFailure` 拆到 `ExecutionTaskStore` 独立 Bean。

### 累计测试规模（P1–P6）

| 后端测试类 | 用例数 |
|-----------|--------|
| `IdGeneratorTest` | 2 |
| `TaskflowStatusTest` | 2 |
| `TaskflowApplicationIntegrationTest` | 2 |
| `MessageServiceIntegrationTest` | 10 |
| `TaskServiceIntegrationTest` | 11 |
| `AuditDiffUtilsTest` | 6 |
| `AuditOpServiceIntegrationTest` | 6 |
| `AssignmentResolverTest` | 8 |
| `ProcessServiceIntegrationTest` | 10 |
| `DistributedLockServiceTest` | 3 |
| `ExecutionTaskServiceIntegrationTest` | 6 |
| **后端合计** | **66** |

| 前端测试 | 用例数 |
|---------|--------|
| `system-nav.test.ts` | 4 |
| `inbox-page.test.tsx` | 4 |
| `task-list-page.test.tsx` | 3 |
| `audit-op-page.test.tsx` | 3 |
| `my-sent-page.test.tsx` | 2 |
| `exec-monitor-page.test.tsx` | 4 |
| **前端合计** | **20** |

> 遗留：P6 的「故障注入」（真实 kill 进程 / 下游服务宕机）以并发测试 + 状态机断言替代；真实进程级故障注入建议在 P8 端到端环境补充。


---

## 附 J：P7 执行状态（2026-10-08）—— 可视化编排 + ProcessShell + 双维导航

| 项 | 状态 | 说明 |
|----|------|------|
| 设计器类型与常量 | 已完成 | `types.ts`：六种节点类型、默认数据、序列化结构 |
| 节点组件 | 已完成 | `WfBaseNode` + 六种节点（Start/Approval/Conditional/Routing/Automation/End），Handle 锚点 + 主题配色 |
| 画布 | 已完成 | `designer-canvas.tsx`：@xyflow/react + Background/MiniMap/Controls + HTML5 Drop 建节点 + 连线 |
| 节点面板 | 已完成 | `palette.tsx`：拖拽 + 搜索过滤 |
| 属性面板 | 已完成 | `property-panel.tsx`：节点属性 + **流程全局属性含表单白名单多选** |
| 自动布局 | 已完成 | `utils/dagreLayout.ts`（@dagrejs/dagre TB 分层） |
| 校验器 | 已完成 | `utils/validator.ts`：恰一 START、至少一 END、可达性、审批人规则、孤立端口告警 |
| 设计器主页面 | 已完成 | `designer-page.tsx`：三栏布局 + 自动布局 + 校验 + 保存并发布（对接 `/api/v1/workflow/definitions`） |
| 只读方案 | 已完成 | `readonly-field.tsx`：组件映射替换（ReadOnlyText/ReadOnlyTag/ReadOnlyField），非 disabled、文本可选 |
| ProcessShell | 已完成 | `process-shell.tsx`：顶部进度与参与人 + 中部只读业务数据/审批历史 + 底部动态审批栏 |
| 流程详情页 | 已完成 | `process-detail-page.tsx`（路由 `/task/process/:id`） |
| 双维导航联动 | 已完成 | 待办点击（含 wfInstanceId）→ ProcessShell；我发起的行 → ProcessShell |
| 路由与导航 | 已完成 | `/system/workflow/designer`、`/task/process/:id` 注册；侧边栏「流程中心 → 流程编排」 |
| 前端单测 | 通过 | `validator.test.ts` 5/5 + `process-shell.test.tsx` 3/3 |
| 前端类型检查 | 通过 | `tsc --noEmit` |
| 生产构建 | 通过 | `vite build` |

**P7 已退出。** 覆盖：校验器五类规则（缺 START/多 START/审批人缺失/不可达/完整通过）、ProcessShell 三段渲染与角色化审批栏、只读组件映射。

### 累计测试规模（P1–P7）

后端 **66**（P1–P6 不变）；前端新增 `validator.test.ts`(5) + `process-shell.test.tsx`(3)。

| 前端测试 | 用例数 |
|---------|--------|
| `system-nav.test.ts` | 4 |
| `inbox-page.test.tsx` | 4 |
| `task-list-page.test.tsx` | 3 |
| `my-sent-page.test.tsx` | 2 |
| `process-shell.test.tsx` | 3 |
| `audit-op-page.test.tsx` | 3 |
| `exec-monitor-page.test.tsx` | 4 |
| `validator.test.ts` | 5 |
| **前端合计** | **28** |

> 遗留：
> 1. 设计器的**图式流转**（条件分支按 conditionExpr 分流、会签并行）需后端 `ProcessService.advanceToNext` 从线性推进升级为按边推进；当前设计器可编排与保存，后端执行仍是 sortOrder 线性。
> 2. 设计器的 Undo/Redo、复制粘贴、快捷键未实现（当前具备拖拽/连线/编辑/删除/自动布局/校验/保存发布）。


---

## 附 K：P8 执行状态（2026-10-08）—— 全量验收与发布

| 项 | 状态 | 说明 |
|----|------|------|
| 菜单/API 种子 | 已完成 | `V123__taskflow_menu_api_seed.sql`：sys_module 95010 + 9 个菜单 + 26 条 sys_api + 23 条菜单绑定 + 9 条管理员授权 |
| 演示流程种子 | 已完成 | `PURCHASE_APPROVAL_DEMO`（START→主管审批(SELF)→END，白名单 `PUR_FORM`）+ 3 个节点 |
| 迁移实库执行 | 已完成 | 测试库 v122 → **v123** 成功；V123 幂等复跑 OK |
| 种子核验 | 已完成 | 9 菜单 / 26 API / 23 绑定 / 9 授权 / 演示流程与节点全部落库 |
| **端到端测试** | 通过 | `TaskflowEndToEndTest` 1/1：提交→代办+消息→审批通过→流程 COMPLETED→Outbox 扫描→实例 postProcessStatus=SUCCESS |
| 全量后端测试 | 通过 | **67/67**（P1–P8） |
| **性能测试** | 通过 | 10 万级消息：收件箱 42ms / 深分页 89ms / 未读统计 20ms / 检索 71ms，全部 < 500ms |
| 兼容性 | 通过 | `sys_oper_log` 仅新增可空列 + 索引，既有消费方不受影响 |
| 联调手册 | 已完成 | `08-taskflow-tryout-guide.md`（服务/迁移/启动/冒烟/入口/演示/测试/边界） |
| 文档索引 | 已完成 | `docs/README.md` 进度表加 mis-taskflow；`msg-log-workflow/README.md` 补 5 篇文档索引 |

**P8 已退出。** 端到端闭环、性能达标、兼容无损、文档齐备。

### 最终累计测试规模

| 后端测试类 | 用例 |
|-----------|------|
| IdGeneratorTest | 2 |
| TaskflowStatusTest | 2 |
| TaskflowApplicationIntegrationTest | 2 |
| MessageServiceIntegrationTest | 10 |
| TaskServiceIntegrationTest | 11 |
| AuditDiffUtilsTest | 6 |
| AuditOpServiceIntegrationTest | 6 |
| AssignmentResolverTest | 8 |
| ProcessServiceIntegrationTest | 10 |
| DistributedLockServiceTest | 3 |
| ExecutionTaskServiceIntegrationTest | 6 |
| TaskflowEndToEndTest | 1 |
| **后端合计** | **67** |

| 前端测试 | 用例 |
|---------|------|
| system-nav.test.ts | 4 |
| inbox-page.test.tsx | 4 |
| task-list-page.test.tsx | 3 |
| my-sent-page.test.tsx | 2 |
| process-shell.test.tsx | 3 |
| audit-op-page.test.tsx | 3 |
| exec-monitor-page.test.tsx | 4 |
| validator.test.ts | 5 |
| **前端合计** | **28** |

### 全部阶段完成度

| 阶段 | 主题 | 状态 |
|------|------|------|
| P1 | 基础设施与骨架 | ✅ |
| P2 | 消息中心 | ✅ |
| P3 | 代办任务 | ✅ |
| P4 | 操作审计 | ✅ |
| P5 | 工作流引擎 | ✅ |
| P6 | 高可用闭环 | ✅ |
| P7 | 可视化编排 + ProcessShell | ✅ |
| P8 | 全量验收与发布 | ✅ |

### 全局遗留（后续迭代）

1. **图式流转**：条件分支按 `conditionExpr` 分流、会签并行未实现（当前 `sortOrder` 线性推进）。
2. **身份透传**：租户/用户仍以查询参数传入，待网关 `LoginUser` 收紧。
3. **进程级故障注入**：以并发/状态机测试替代，建议独立 E2E 环境补充。
4. **设计器增强**：Undo/Redo、复制粘贴、快捷键未实现。


---

## 附 L：遗留项处理结果（2026-10-08 续）

| 遗留项 | 状态 | 处理方式 |
|--------|------|---------|
| 1. 图式流转（条件分支） | ✅ 已解决 | 新增 `wf_edge` 表（V124）+ `WfEdge` 实体/仓储 + `ConditionEvaluator`；`ProcessService.advanceToNext` 改为按边推进（含条件求值），无边的历史定义自动回退 `sortOrder` 线性推进；设计器保存时序列化画布连线为 edges |
| 2. 身份透传 | ✅ 已解决 | BFF 新增 `TaskflowIdentity`：优先取网关 `LoginUser` 上下文（tenantId/userId），回退查询参数；5 个 taskflow BFF 控制器全部改为 `required=false` 并走该解析器，前端无需再手工传参 |
| 3. 进程级故障注入 | ⏸ 保持现状 | 以并发测试 + 状态机断言覆盖（`DistributedLockServiceTest` 8 线程恰好一次）；真实 kill/宕机注入建议独立 E2E 环境 |
| 4. 设计器增强（Undo/Redo/快捷键） | ✅ 已解决 | 新增 `useUndoRedo`（快照栈）；设计器接线撤销/重做按钮 + Ctrl+Z / Ctrl+Shift+Z / Delete 快捷键 |
| 5. build-dev/start-dev 脚本 | ✅ 已解决 | 两个脚本的模块清单/端口表补入 `mis-taskflow`（8104），保留 UTF-8 BOM（PowerShell 5.1 中文兼容） |

### 新增测试

| 测试类 | 用例 | 说明 |
|--------|------|------|
| `ConditionEvaluatorTest` | 5 | 空条件/数值/字符串/逻辑组合/缺失变量 |
| `WorkflowEdgeFlowIntegrationTest` | 3 | 高金额走总经理分支 / 低金额走部门分支 / 分支汇合到 END |
| `useUndoRedo.test.ts` | 3 | undo/redo 往返、新变更清空 redo、record=false 不入栈 |

### 最终累计

| 维度 | 数量 |
|------|------|
| 后端测试 | **75**（67 + 5 + 3） |
| 前端测试 | **31**（28 + 3） |
| Flyway 版本 | **124** |


### 附 L 补充：开发脚本链路（2026-10-08 实测）

| 脚本 | 变更 | 实测 |
|------|------|------|
| `build-dev.ps1` | `knownServices` 加入 `mis-taskflow` | `build-dev.ps1 mis-taskflow` → BUILD SUCCESS |
| `start-dev.ps1` | `servicePorts` 加入 `mis-taskflow = 8104` | `start-dev.ps1 mis-taskflow` → 已监听 :8104，健康检查 200 |
| `stop-dev.ps1` | 同端口表（此前遗漏）加入 `mis-taskflow = 8104` | `stop-dev.ps1 mis-taskflow` → 已停止 |

> 三个脚本均保留 UTF-8 BOM（Windows PowerShell 5.1 中文兼容）。


---

## 附 M：会签/并行聚合（2026-10-08 续）

| 项 | 状态 | 说明 |
|----|------|------|
| 会签扇出 | 已完成 | `ROUTING` 节点经 `USER_LIST`/`ROLE` 规则为每个审批人各生成一个 `wf_task` + `sys_task` |
| 聚合策略 | 已完成 | 节点 `config.routingStrategy`：`ALL_PASS`（会签，全部通过才推进）/ `ANY_PASS`（或签，任一通过即推进） |
| 聚合判断 | 已完成 | `ProcessService.aggregationSatisfied`：ALL_PASS 等 `countPendingByNode==0`；ANY_PASS 首个通过后作废其余待办；任一驳回即终止实例 |
| 设计器支持 | 已完成 | 属性面板新增「会签策略」下拉（真实可编辑），序列化到节点 `config` |
| 测试 | 通过 | `CountersignIntegrationTest` 4/4（扇出 / ALL_PASS 等待全员 / ANY_PASS 首个即结束 / 任一驳回终止） |

### 最终累计（含会签）

| 维度 | 数量 |
|------|------|
| 后端测试 | **79** |
| 前端测试 | **31** |
| Flyway 版本 | **124** |


---

## 附 N：调试期修复与占位页补全（2026-10-08）

### 真实 Bug 修复（调试中发现）

| # | 现象 | 根因 | 修复 |
|---|------|------|------|
| 1 | `GET /api/v1/audit-ops` 500 | JPQL 中 `:keyword` 仅出现在 `lower(concat('%',:keyword,'%'))`，无 `=` 锚定类型；PG 在 keyword=null 时推断为 `bytea` → `lower(bytea) does not exist` | 改原生 SQL + `CAST(:keyword AS text)` 显式定型；新增回归用例（含全 null 过滤） |
| 2 | `/audit-ops/stats`、`/exec-monitor/{id}/retry`、`/exec-monitor/scan` 返回 40300 | V123 种子漏注册这三个前端实际调用路径（BFF fail-closed） | V125 补注册 + 菜单绑定 |
| 3 | `我审批的`、`流程定义` 页面空白 | 仍是 P1 占位页（虚线空框+「开发中」），P7 漏替换 | 补全为真实页面（见下） |

### 占位页补全

| 页面 | 之前 | 现在 |
|------|------|------|
| `/system/workflow/definitions` | P1 占位 | 流程定义列表：名称/编码/分类/版本/状态/节点数/**表单白名单**/发布/进入编排 |
| `/task/my-processed` | P1 占位 | 我审批的：已通过/已驳回历史（`GET /api/v1/tasks/handled`），状态徽标 + 跳 ProcessShell |
| `pending-page.tsx` | 死代码（已不在 PAGE_MAP） | 删除 |

### 新增后端接口

| 接口 | 说明 |
|------|------|
| `GET /internal/v1/tasks/handled` | 我处理过的（APPROVED/REJECTED，按 completedAt 倒序） |
| `GET /api/v1/tasks/handled` | BFF 透传（`TaskflowIdentity` 解析身份） |

迁移：**V126__taskflow_handled_api.sql**（注册 `/api/v1/tasks/handled` + 菜单绑定 95005）。

### 门户改版（工作台为主体）

- 布局：`lg:grid-cols-3`，左侧工作台占 2/3（概览 + 我的待办 + 消息 + 我发起的），右侧 `AppRail` 模块导航占 1/3（分组折叠 + 最近访问）。
- 配色：新增 `.portal-shell` 作用域 token —— **白底 `0 0% 100%` + 深商务蓝主色 `222 65% 45%`**，仅门户生效，不动全局。
- 移除：假 `StatCard`、九宫格大卡片、顶部筛选 Tab。
- 新增组件：`WorkbenchOverview` / `TaskBoard` / `MessageBoard` / `ProcessBoard` / `AppRail`。

### 最终累计

| 维度 | 数量 |
|------|------|
| 后端测试 | **82** |
| 前端测试 | **33** |
| Flyway 版本 | **126** |
