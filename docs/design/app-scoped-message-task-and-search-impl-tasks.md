# 平台级 vs 应用级：消息 / 待办归属模型 与 全局搜索扩展 —— 任务分解（实现前）

| 项 | 值 |
|---|---|
| 状态 | **实现前任务分解（Implementation Task Breakdown）** —— 仅分解，不含实现 |
| 上游设计 | `docs/design/app-scoped-message-task-and-search-design.md`（已定稿，本文不复制其内容，只做落地拆解） |
| 范围 | **P0**：① 消息 / 待办新增 `app_code`（可空，NULL=平台级）+ **写入侧标注** + 查询侧可选参数 + **`sys_app_biz_binding` 绑定表（V137，已拍板纳入 P0）**；② 全局搜索数据源从「硬编码 SYSTEM_NAV」升级为「遍历全部 `*_NAV` + APP 列表」。 |
| 明确不做 | **APP 自有首页**（维持预设计，不实现）；`GET /api/v1/search` 服务端搜索（P1）；表单/文档/组织纳入搜索（P2） |
| 产出约束 | **只写本文档；不改业务代码、不执行迁移、不 commit** |
| 产出方式 | 任务按「迁移 → 后端实体/仓库/服务/VO/接口 → 前端搜索 → 前端消息/待办传参」排序 |

> ⚠️ **红线（先读）**
> 1. **禁改历史迁移**（含注释）：Flyway checksum 覆盖全文件，改动任一历史 `.sql` 会阻塞整条迁移链。本次**新增两条**：`V136` 与 `V137`。
> 2. **前端一律用 `pnpm`，禁 `npm`。**
> 3. **只产出文件、不执行迁移**（`mvn`/Flyway 由工程/QA 决定何时跑）。
> 4. 端点 **path_pattern 不变** ⇒ **无需重新登记 `sys_api`/`sys_menu_api`**（详见 §3）。

---

## 0. 关键设计缺口裁决：写入侧是否标注 `app_code`

> 🔴 设计文档 §3.1 的 P0 只写了「加列 + 查询侧可选参数」，**未定义写入侧是否落 `app_code`**。若不落，列值恒为 `NULL`、查询过滤（`scope=APP`）恒返回空集 —— **会做出一堆「死列」**，且 QA 无法写出「过滤生效」的用例。

### 0.1 结论（直接给）

**✅ 本次 P0 必须包含写入侧标注。** 理由：

1. **不标注 = 功能不闭环**：查询侧 `WHERE app_code = :code` 永远命中 0 行，APP 归属模型形同虚设。
2. **不标注 = QA 不可验证**：无「可标注的写入口」，测试无法构造「带 app_code 的消息/待办」，任何过滤用例都只能断言空集 —— 测的是 bug 不是功能。
3. **不标注 = 存量语义被破坏**：列若永不写入，则「NULL=平台级」不再是「有意归属平台」，而变成「全部未分类」，设计 §1.3 的语义基础塌陷。
4. **代价可控**：真实创建写入点只有 **2 个漏斗**（消息 1 个、待办 1 个），全部经实地读码确认（见 §0.2），改动面极小。

### 0.2 写入点清单（真实 `类名:方法名`，已实地读码核实）

> 结论：`sys_message` 与 `sys_task` 的**创建**各自**只有一个底层漏斗**；其余都是 UPDATE（必须保留既有 `app_code`，见 §0.4）。

**A. 消息（`sys_message`）唯一创建漏斗：**

| # | 写入点（真实签名） | 位置 | 性质 |
|---|---|---|---|
| M0 | `com.mis.taskflow.service.MessageService:publish(Long tenantId, PublishMessageRequest req)` | `MessageService.java:59`，`messageRepository.save(msg)` 在 `:91` | **唯一 `sys_message` 创建点** |

M0 的**全部上游调用者**（必须逐一决定 `app_code` 来源）：

| # | 调用者（真实签名） | 位置 | 场景 | `app_code` 来源（推导规则） |
|---|---|---|---|---|
| M1 | `com.mis.taskflow.controller.MessageController:publish(@RequestParam Long tenantId, PublishMessageRequest)` | `MessageController.java:41` | 外部业务服务发布消息 | **写侧显式**：请求体新增可选 `appCode`，业务服务知道自己属于哪个 APP，直接赋 |
| M2 | `com.mis.taskflow.service.TaskService:createTask(...)` 内 `messageService.publish(...)` | `TaskService.java:81` | 建待办时自动生成关联通知 | **继承同一任务**：用刚解析出的 `task.getAppCode()`（保证任务与通知同源，绝不各自推导） |
| M3 | `com.mis.taskflow.service.TaskService:transferTask(...)` 内 `messageService.publish(...)` | `TaskService.java:204` | 转办给新处理人补发提醒 | **继承既有任务**：用 `task.getAppCode()`（**不可重新推导**，沿袭原待办归属） |
| M4 | `com.mis.taskflow.service.ProcessService:notify(WfInstance instance, ...)` 内 `messageService.publish(...)` | `ProcessService.java:503` | 流程通过/驳回结果通知 | **按业务类型推导**：`resolver.resolveByBizType(instance.getTenantId(), instance.getBusinessType())` |

**B. 待办（`sys_task`）唯一创建漏斗：**

| # | 写入点（真实签名） | 位置 | 性质 |
|---|---|---|---|
| T0 | `com.mis.taskflow.service.TaskService:createTask(Long tenantId, Long operatorId, CreateTaskRequest req)` | `TaskService.java:53`，`taskRepository.save(task)` 在 `:75` | **唯一 `sys_task` 创建点** |

T0 的**全部上游调用者**：

| # | 调用者（真实签名） | 位置 | 场景 | `app_code` 来源（推导规则） |
|---|---|---|---|---|
| T1 | `com.mis.taskflow.controller.TaskController:create(@RequestParam Long tenantId, @RequestParam(required=false) Long operatorId, CreateTaskRequest)` | `TaskController.java:38` | 外部业务服务建待办 | **写侧显式**：请求体新增可选 `appCode`；未传则服务端按 `bizType` 兜底 |
| T2 | `com.mis.taskflow.service.ProcessService:assignNode(WfInstance instance, WfNode node, LocalDateTime now)` 内 `taskService.createTask(...)` | `ProcessService.java:442` | 流程审批节点分派待办 | **按业务类型推导**：`resolver.resolveByBizType(instance.getTenantId(), instance.getBusinessType())`，作为显式 `appCode` 传入 |

### 0.3 推导规则（三段式，服务端兜底）

统一由**新增** `com.mis.taskflow.service.AppScopeResolver` 承载，优先级：

```
app_code = firstNonBlank(
    req.appCode(),                                  // ① 写侧显式（最高优先，业务最清楚）
    binding(tenantId, bizType / businessType),       // ② 服务端按 sys_app_biz_binding 兜底
    null                                             // ③ 兜不住 ⇒ NULL（平台级）
)
```

- **能直接得到的直接赋**：M1 / T1（外部业务服务带 `appCode`）；M2 / M3（继承同源任务）。
- **不能直接得到、但有 `bizType`/`businessType` 的走绑定表**：M4 / T2。
- **兜不住一律 `NULL`**（= 平台级），与设计 §1.3 语义一致。
- **写侧不传时服务端兜底**：`TaskService:createTask` 内部执行上面的 `firstNonBlank`；`MessageService:publish` **自身不再推导**（它拿不到 `bizType`），由内部调用者（M2/M3/M4）负责把已推导值传入。

> ✅ **已拍板（2026-10-11）**：为让 M4 / T2 真能落值，**本次 P0 纳入 `sys_app_biz_binding` 绑定表**（设计 §1.3 已给出 DDL），随 `V137` 建表 + 新增实体/仓储。写入侧由此**真正闭环**（不再是「半闭环」）。种子映射见 §9 #2。

### 0.4 UPDATE 路径（必须保留 `app_code`，禁止清空）

以下方法对**已存在**行 `save`，JPA 按实体回写全字段；只要**不调用** `setAppCode(...)`，既有值即被保留。工程实现时须显式遵守：

| 方法 | 位置 | 要求 |
|---|---|---|
| `TaskService:handleTask(...)` | `TaskService.java:141`（`save` 在 `:162`） | 只改 status/result/completedAt；**不得** `setAppCode` |
| `TaskService:transferTask(...)` | `TaskService.java:179`（`save` 在 `:195`） | 只改 assignee/status/read/viewedAt；**不得** `setAppCode` |
| `MessageService:markRead(...)` | `MessageService.java:199`（`save` 在 `:221`） | 只改 readCount/updatedAt；**不得** `setAppCode` |

---

## 1. 实现顺序任务列表（5 个任务，按依赖排序）

> 说明：本仓为**存量单体**，非 greenfield，故「基础设施任务」= **迁移 + 数据层地基（T01）**。任务按层分组，避免「一文件一任务」。

### T01 · 数据层与迁移（地基）　`P0`

**目的**：建列 + 索引 + 绑定表（**必做**），实体加字段，仓储加可选过滤。**零业务行为变更**。

**涉及文件（相对路径）**：

| 文件 | 改/新 | 改动要点 |
|---|---|---|
| `backend/mis-migrator/src/main/resources/db/migration/V136__app_scoped_message_task.sql` | **新** | 见 §2 完整 DDL：`sys_message`/`sys_task` 加 `app_code VARCHAR(64) NULL` + 3 索引（含设计 §1.3 部分索引），全 `IF NOT EXISTS` 幂等 |
| `backend/mis-migrator/src/main/resources/db/migration/V137__app_biz_binding.sql` | **新（必做，已纳入 P0）** | 建 `sys_app_biz_binding(tenant_id, biz_type, app_code)`（设计 §1.3 DDL，PK `(tenant_id, biz_type)`，**不建外键**）+ 幂等种子 `PURCHASE_ORDER → system`（`INSERT ... WHERE NOT EXISTS`）。见 §2 附 DDL |
| `backend/mis-taskflow/src/main/java/com/mis/taskflow/domain/entity/SysMessage.java` | 改 | 加 `@Column(name="app_code", length=64) private String appCode;` + getter/setter（追加到末尾，避免影响既有构造/映射） |
| `backend/mis-taskflow/src/main/java/com/mis/taskflow/domain/entity/SysTask.java` | 改 | 同上，加 `appCode` 字段 + getter/setter |
| `backend/mis-taskflow/.../domain/entity/SysAppBizBinding.java` | **新（必做，已纳入 P0）** | 绑定表 JPA 实体（`tenantId`/`bizType`/`appCode` + 时间戳） |
| `backend/mis-taskflow/.../domain/repository/SysAppBizBindingRepository.java` | **新（必做，已纳入 P0）** | `findByTenantIdAndBizType(...)` |
| `backend/mis-taskflow/.../domain/repository/SysMessageRepository.java` | 改 | `findInbox` / `searchInbox` / `searchInboxByType` 各加**可选** `:appCode` / `:platformOnly` 条件（见 §3.2 注） |
| `backend/mis-taskflow/.../domain/repository/SysTaskRepository.java` | 改 | `findByAssignee` / `findOpenByAssignee` / `findHandledByAssignee` 各加**可选** `:appCode` 条件 |

**完成判据**：
- `V136` 在空库与已到 `V135` 的库上**均可重复执行**（幂等）；`sys_message.app_code`、`sys_task.app_code` 存在且可空。
- 实体字段与列名严格一致（`app_code` ↔ `appCode`）；Hibernate `ddl-auto=validate` 下应用可启动、无 schema 校验报错。
- 新查询方法在 `appCode=null` 时 SQL **退化为原查询**（与旧行为逐字等价）。
- 不传 `app_code` 的旧调用编译/运行全绿。

### T02 · 写入侧标注（后端服务）　`P0`　依赖 T01

**目的**：落实 §0.2/§0.3：2 个漏斗打标 + 3 处 UPDATE 保留。

**涉及文件**：

| 文件 | 改/新 | 改动要点 |
|---|---|---|
| `backend/mis-taskflow/.../service/AppScopeResolver.java` | **新** | `resolveByBizType(tenantId, bizType)` + `resolve(tenantId, explicitAppCode, bizType)`（三段式） |
| `backend/mis-taskflow/.../dto/PublishMessageRequest.java` | 改 | **追加**可选 `String appCode`（record 末尾追加，兼容既有 `new PublishMessageRequest(...)` 调用点需同步补 `null`） |
| `backend/mis-taskflow/.../dto/CreateTaskRequest.java` | 改 | **追加**可选 `String appCode` |
| `backend/mis-taskflow/.../service/MessageService.java` | 改 | `publish` 中 `msg.setAppCode(trimToNull(req.appCode()))`（仅显式取值，不推导） |
| `backend/mis-taskflow/.../service/TaskService.java` | 改 | `createTask`：`appCode = firstNonBlank(req.appCode(), resolver.resolveByBizType(tenantId, req.bizType()))` → `task.setAppCode(appCode)`；M2 通知透传 `appCode`；`transferTask`(M3) 透传 `task.getAppCode()`；`handleTask`/`transferTask` 禁止 `setAppCode` |
| `backend/mis-taskflow/.../service/ProcessService.java` | 改 | `assignNode`(T2) 把 `resolver.resolveByBizType(instance.getTenantId(), instance.getBusinessType())` 作为 `appCode` 传入 `createTask`；`notify`(M4) 同理传入 `publish` |

**完成判据**：
- 显式带 `appCode` 的发布/建单 → 落库等于该值。
- 未带 `appCode` 但 `bizType` 命中绑定表 → 落库等于绑定值。
- 均不命中 → 落库 `NULL`。
- M2 通知与同任务 `app_code` **一致**；M3 转办提醒沿用原 `app_code`。
- 处理/转办/标已读**不改变** `app_code`（回归断言）。
- 既有单测（`MessageServiceIntegrationTest` 等）编译通过；构造 DTO 处补 `null`。

### T03 · 接口层（可选参数 + VO 字段）　`P0`　依赖 T01

**目的**：读接口加可选 `appCode`/`scope`（不传=现状，零回归）；VO 各 +1 `appCode`；BFF 透传。

**涉及文件**：

| 层 | 文件 | 改/新 | 改动要点 |
|---|---|---|---|
| taskflow 内 | `.../controller/MessageController.java` | 改 | `inbox`/`search` 加 `@RequestParam(required=false) String appCode, String scope`；`publish` 由 body 承接 `appCode` |
| taskflow 内 | `.../controller/TaskController.java` | 改 | `my`/`handled` 加可选 `appCode`/`scope`；`create` 由 body 承接 |
| taskflow 内 | `.../controller/WfProcessController.java` | 改 | `/instances/my` 加可选 `appCode`/`scope` |
| taskflow 内 | `.../service/MessageService.java` / `TaskService.java` / `ProcessService.java` | 改 | 查询方法签名加 `appCode/scope` 参数并透传仓储（scope→谓词映射见 §3.2） |
| taskflow VO | `.../dto/MessageVO.java`、`TaskVO.java`、`WfInstanceVO.java` | 改 | 各**末尾追加** `String appCode` |
| BFF 出站 | `mis-admin-bff/.../controller/MessageController.java` | 改 | `inbox`/`search` 加 `appCode`/`scope` |
| BFF 出站 | `mis-admin-bff/.../controller/TaskController.java` | 改 | `my`/`handled` 加 `appCode`/`scope` |
| BFF 出站 | `mis-admin-bff/.../controller/WorkflowController.java` | 改 | `instances/my` 加 `appCode`/`scope` |
| BFF 出站 | `mis-admin-bff/.../client/TaskflowWebClient.java` | 改 | `inbox`/`searchMessages`/`myTasks`/`handledTasks`/`myProcesses` 加 `appCode`/`scope`（**非空才 put**） |
| BFF model | `mis-admin-bff/.../client/model/MessageVO.java`、`TaskVO.java`、`WfInstanceVO.java` | 改 | 与内层 VO 对齐追加 `appCode` |

**完成判据**：
- **不传** `appCode`/`scope` 时，5 个端点响应与当前**逐字节等价**（零回归）。
- 传 `scope=APP&appCode=kb` 时只返回 `app_code='kb'` 行；`scope=PLATFORM` 只返回 `NULL` 行；`scope=ALL` 含 NULL。
- 响应体 `appCode` 字段随值透出；未标注行返回 `null`。
- **无需**新增/修改任何 `sys_api`/`sys_menu_api`（见 §3.1）。

### T04 · 前端搜索 P0（命令面板）　`P0`　无后端依赖（仅用已有 `/apps`）

**目的**：`command-palette.tsx` 从「硬编码 `SYSTEM_NAV`」改为「遍历全部 `*_NAV` + 并入 `AppItem[]`，带 `app_code`/`app_name` 分组」。

**涉及文件**：

| 文件 | 改/新 | 改动要点 |
|---|---|---|
| `frontend/mis-admin-web/src/lib/search/types.ts` | **新** | `SearchItem` 类型（设计 §2.3）：`{id,type,title,path,icon,appCode,appName,keywords?}`；`id = \`${appCode ?? '_'}:${path ?? title}\`` |
| `frontend/mis-admin-web/src/lib/search/search-registry.ts` | **新** | 引入 `SYSTEM_NAV/AGENT_NAV/KB_NAV/IQD_NAV/FINANCE_NAV/TASK_NAV`，用泛型 `flattenNavLeaves()` 展平，逐份注入 `appCode`（system/agent/kb/iqd/finance/task）；静态 `APP_NAME` 映射得 `appName`；`buildSearchIndex()` 产出 `SearchItem[]`，并入 `type:'app'` 项 |
| `frontend/mis-admin-web/src/components/layout/command-palette.tsx` | 改 | `useMemo` 改用 `buildSearchIndex()`；结果**按 `appCode` 分组**：当前 APP 优先 → 其他 APP → 平台级（`appCode=null`）最后；保留「返回门户」快捷项；分组标签显示 `appName`/「平台级」 |
| `frontend/mis-admin-web/src/lib/api/platform.ts` | 复用 | 复用既有 `fetchApps()`（**非新增端点**）在面板打开时拉取 `AppItem[]`；失败静默降级为纯 `*_NAV` |

**完成判据**：
- 搜索词命中 kb/agent/iqd/finance/task 的任一页面（此前**完全搜不到**）。
- 结果按 APP 分组，当前 APP 项置顶，平台级/未归属置底。
- 无匹配时展示「无匹配结果」，键盘上下/回车行为不变。
- **零新增后端端点**；`fetchApps()` 失败不影响 `*_NAV` 部分可用。

### T05 · 前端消息/待办传参 + 布局集成　`P0`　依赖 T03、T04

**目的**：消息/待办查询接入可选 `appCode`/`scope`（默认不传=现状）；收尾联调。

**涉及文件**：

| 文件 | 改/新 | 改动要点 |
|---|---|---|
| `frontend/mis-admin-web/src/lib/api/messages.ts` | 改 | `MessageQuery` 加可选 `appCode`/`scope`；`buildQuery` 式**空白不透传**（仿 `tasks.ts:48`） |
| `frontend/mis-admin-web/src/lib/api/tasks.ts` | 改 | `TaskQuery` 加可选 `appCode`/`scope`，并入 `buildQuery` |
| `frontend/mis-admin-web/src/lib/api/wf-instance.ts` | 改 | `fetchMyProcesses` 参数加可选 `appCode`/`scope` |
| `frontend/mis-admin-web/src/features/portal/tabs/portal-message-tab.tsx` | 改 | `load()` 的 `params` 纳入 `scope/appCode`（**来源缺省不设 ⇒ 现状**） |
| `frontend/mis-admin-web/src/features/portal/tabs/portal-todo-tab.tsx` | 改 | 三来源调用（`my`/`handled`/`sent`）统一纳入可选 `scope/appCode` |

**完成判据**：
- 不设置 `scope/appCode` 时，门户消息/待办加载与当前**行为完全一致**（零回归，可对比接口参数）。
- 传入 `scope=APP&appCode=kb` 时前端正确透传到 URL 查询串（可用「传参链路」测试断言）。
- `pnpm build` / `pnpm lint` 通过；既有门户冒烟测试（`portal-page.smoke.test.tsx` 等）全绿。

---

## 2. 迁移 V136 内容（**只产出文件、不执行**）

> 幂等策略对齐 `V134`：`ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`；全程 `NOW()`。命名与注释以中文，风格对齐既有迁移。

```sql
-- V136__app_scoped_message_task.sql
-- 平台级 vs 应用级：消息 / 待办归属模型（P0） | PostgreSQL 16 | 幂等：可重复执行
--
-- ## 为什么需要它
-- 门户「消息 / 待办」需要按「归属哪个 APP」过滤；APP 归属用可空 app_code 表达：
--   app_code IS NULL  = 平台级（系统公告 / 跨应用通知 / 平台运维待办）
--   app_code = 'code' = 应用级（某 APP 的业务消息 / 待办）
-- 存量数据天然 NULL = 平台级，**不回填**（设计 §3.2-c 建议）。
--
-- ## 为什么用 code 而非数字 id
-- sys_app 主键是分段数字 ID（跨环境不稳定，设计 F11）；全链路一等标识是 code（F10）。
--
-- ## 幂等
--   * ALTER TABLE ... ADD COLUMN IF NOT EXISTS  —— 天然幂等
--   * CREATE INDEX IF NOT EXISTS                 —— 天然幂等
--
-- ⚠️ 只追加；绝不修改 V1~V135（checksum 变更会阻塞整条迁移链）。

-- 1) 加列
ALTER TABLE sys_message ADD COLUMN IF NOT EXISTS app_code VARCHAR(64) NULL;
ALTER TABLE sys_task    ADD COLUMN IF NOT EXISTS app_code VARCHAR(64) NULL;

-- 2) 索引（设计 §1.3）
--    应用级过滤：单列等值 + 时间/受理人
CREATE INDEX IF NOT EXISTS idx_msg_app_time  ON sys_message (tenant_id, app_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_app_stat ON sys_task    (tenant_id, app_code, assignee_id, status);
--    平台级过滤：app_code IS NULL 数据量通常小 → 部分索引
CREATE INDEX IF NOT EXISTS idx_msg_platform  ON sys_message (tenant_id, created_at DESC) WHERE app_code IS NULL;

-- 自检（取消注释手动执行）：
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
--   WHERE table_name IN ('sys_message','sys_task') AND column_name='app_code';
-- SELECT indexname FROM pg_indexes WHERE indexname IN
--   ('idx_msg_app_time','idx_task_app_stat','idx_msg_platform');
```

### V137 内容（**已拍板纳入 P0，只产出文件、不执行**）

> 用途：承载 §0.3 的推导规则第②段（`biz_type/business_type → app_code` 兜底），让 M4/T2 两条内部流程路径真正落值。**不建外键**（对齐 `V134`/`V1` 的软引用风格）。

```sql
-- V137__app_biz_binding.sql
-- 平台级 vs 应用级：业务类型 → APP 归属绑定表（P0） | PostgreSQL 16 | 幂等：可重复执行
--
-- ## 为什么需要它
-- 写入侧标注（§0.3）需要把「有 biz_type/business_type 但无显式 app_code」的写入按绑定表兜底，
-- 使 ProcessService.notify(M4) / ProcessService.assignNode(T2) 两条内部路径也能落 app_code。
--
-- ## 为什么用 code 而非数字 id
-- 全链路一等标识是 sys_app.code（设计 F10）；数字 id 跨环境不稳定（设计 F11）。
--
-- ## 幂等
--   * CREATE TABLE IF NOT EXISTS —— 天然幂等
--   * 种子 INSERT ... WHERE NOT EXISTS / ON CONFLICT DO NOTHING —— 天然幂等
--
-- ⚠️ 只追加；绝不修改 V1~V136（checksum 变更会阻塞整条迁移链）。

CREATE TABLE IF NOT EXISTS sys_app_biz_binding (
    tenant_id  BIGINT      NOT NULL,
    biz_type   VARCHAR(64) NOT NULL,   -- 对应 sys_task.biz_type / wf_instance.business_type
    app_code   VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_app_biz_binding PRIMARY KEY (tenant_id, biz_type)
);

-- 种子（已拍板：唯一一条，其余业务类型待业务登记，勿臆造）
INSERT INTO sys_app_biz_binding (tenant_id, biz_type, app_code, created_at, updated_at)
SELECT 1, 'PURCHASE_ORDER', 'system', NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM sys_app_biz_binding WHERE tenant_id = 1 AND biz_type = 'PURCHASE_ORDER'
);

-- 自检（取消注释手动执行）：
-- SELECT tenant_id, biz_type, app_code FROM sys_app_biz_binding ORDER BY tenant_id, biz_type;
```

---

## 3. 接口层：端点与登记

### 3.1 需加可选参数的端点（5 个，**均为已有端点**）

| # | 端点（对外 `/api/v1/...`） | 现状 `sys_api` | 本次改动 |
|---|---|---|---|
| 1 | `GET /tasks/my` | 已登记 `95025` | **加**可选 `appCode` / `scope` |
| 2 | `GET /tasks/handled` | 已登记 `95048` | **加**可选 `appCode` / `scope` |
| 3 | `GET /workflow/instances/my` | 已登记 `95036` | **加**可选 `appCode` / `scope` |
| 4 | `GET /messages/inbox` | 已登记 `95020` | **加**可选 `appCode` / `scope` |
| 5 | `GET /messages/search` | 已登记 `95021` | **加**可选 `appCode` / `scope` |

> ✅ **是否需要重新登记 `sys_api`/`sys_menu_api`：不需要。**
> 依据：`deny-unmapped` 校验以 **`http_method` + `path_pattern`** 为准（见 `V134` 注释与本仓既有端点表），**查询参数不参与 path_pattern**。给已有端点加可选 query 参数 ⇒ path_pattern 不变 ⇒ 无需 `DELETE/INSERT`。
> ⚠️ **反向约束**：本次**不新增任何端点**。若后续有人把 `scope` 做成独立端点（如 `/messages/inbox-by-app`），则**必须**配套登记 `sys_api` + 绑定 `sys_menu_api`，否则 403。本文档范围内**无此需求**。

### 3.2 `scope` 谓词映射（后端统一约定）

| scope | SQL 谓词 | 用途 |
|---|---|---|
| `ALL`（默认 / 不传） | **不加 `app_code` 条件** | 门户三 Tab 现状，**零回归** |
| `APP` | `app_code = :appCode` | APP 自有首页（本次不实现首页，仅打通参数） |
| `PLATFORM` | `app_code IS NULL` | 平台级专区（可选） |

> ⚠️ **实现注意**：native query 中形如 `(:appCode IS NULL OR m.app_code = :appCode)` 会触发 Hibernate/PostgreSQL 的**参数类型推断缺陷**（本仓既有注释已记录 `could not determine data type of parameter` / `lower(bytea)` 事故）。两种安全写法（二选一）：
> 1. **Java 侧分支**：`scope==ALL` 走原查询、`scope==APP` 走带**无条件等值** `AND m.app_code = :appCode` 的查询、`scope==PLATFORM` 走 `AND m.app_code IS NULL`——即拆成 3 个方法，避免 null 参与 `IS NULL` 比较。（**推荐**，与 `searchInboxByType` 的既有范式一致）
> 2. 若坚持单 SQL，务必把 `:appCode` 只用于等值列锚定，`scope` 用字符串比较而非 null 二义。

---

## 4. 前端搜索 P0：改造说明

**现状**（`command-palette.tsx:7,19-40`）：只 `import { SYSTEM_NAV, flattenSystemNavLeaves }`，索引 = 18 叶 + 1「返回门户」，**不调 API**、**不含 APP 信息**、**只覆盖系统管理**。

**目标**：遍历**全部 `*_NAV`**（已存在 6 份：`SYSTEM_NAV` / `AGENT_NAV` / `KB_NAV` / `IQD_NAV` / `FINANCE_NAV` / `TASK_NAV`）+ 并入 `AppItem[]`，产出带 `app_code`/`app_name` 的 `SearchItem[]`，按 APP 分组。

**改动/新增文件**：

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/lib/search/types.ts` | 新增 | `SearchItem` 定义（**跨文件唯一来源**，见 §5） |
| `src/lib/search/search-registry.ts` | 新增 | `NAV_SOURCES` 表：`[{ appCode:'system', nav:SYSTEM_NAV }, {appCode:'agent', nav:AGENT_NAV}, {appCode:'kb',...}, {appCode:'iqd',...}, {appCode:'finance',...}, {appCode:'task',...}]`；用泛型 `flattenNavLeaves()`（`system-nav.ts:106`，注释已声明「可吃 AGENT_NAV / KB_NAV」）展平并注入 `appCode`；`buildSearchIndex(apps?: AppItem[])` 返回 `SearchItem[]` |
| `src/components/layout/command-palette.tsx` | 改 | 用 `buildSearchIndex()` 替换硬编码；分组渲染（当前 APP 优先/其他 APP/平台级）；保留「返回门户」；可选 `fetchApps()` 合并 `type:'app'` |

**分组与排序**：以当前路由解析出的 APP（`resolveActiveHostAppCode`，`host-apps.ts:51`）为「当前 APP」→ 该项置顶；其余 APP 次之；`appCode=null`（平台级）最后。

**零后端改动保证**：P0 只消费既有 `*_NAV` 与既有 `GET /apps`（`fetchApps`），**不新增端点**。

---

## 5. 共享知识 / 跨文件约定

1. **命名统一**：DB 列 `app_code`（snake_case，`VARCHAR(64) NULL`）；Java/TS 字段 `appCode`（camelCase）；HTTP query 参数名 `appCode`；`scope` 取值 `ALL | APP | PLATFORM`（默认 `ALL`）。
2. **NULL 语义唯一**：`app_code IS NULL` = 平台级。**禁止**用 `''`、`'0'`、数字 id 代替。
3. **标识只用 code**：跨层 APP 标识一律 `sys_app.code`（字符串）；**禁止**把数字 `sys_app.id` 透给前端/落库（设计 F10/F11）。
4. **`SearchItem` 唯一定义处**：`frontend/.../src/lib/search/types.ts`；`id` 规则 `\`${appCode ?? '_'}:${path ?? title}\``（稳定唯一键）。
5. **VO 追加约定**：`MessageVO`/`TaskVO`/`WfInstanceVO` 及 BFF `client/model/*` 的 `appCode` **一律末尾追加**，减少既有构造点改动；record 构造调用点同步补参。
6. **DTO 追加约定**：`PublishMessageRequest`/`CreateTaskRequest` 的 `appCode` **一律末尾追加**；既有 `new PublishMessageRequest(...)`（`TaskService:78/201`、`ProcessService:503`、测试类）需补 `null` 或传入推导值。
7. **UPDATE 不清空**：`handleTask`/`transferTask`/`markRead` **禁止** `setAppCode`。
8. **前端包管理**：仅 `pnpm`。
9. **迁移只追加**：新增 `V136` 与 `V137`；**不得**改动历史迁移任一字节。

---

## 6. 验收点（供 QA 写测试）

| 任务 | 可验证判据 |
|---|---|
| T01 | 迁移在空库 & 到 V135 库上重复执行均成功；两列存在且可空；应用启动通过 schema validate；新查询在 `appCode=null` 时与旧 SQL 等价 |
| T02 | 显式传 `appCode` → 落库一致；仅 `bizType` 命中绑定 → 落库为绑定值；都不命中 → `NULL`；M2 通知与任务 `app_code` 相同；M3 沿用原值；handle/transfer/markRead 后 `app_code` 不变 |
| T03 | 5 端点不传参 → 响应与现状逐字节等价；`scope=APP&appCode=kb` 只返回 kb 行；`scope=PLATFORM` 只返回 NULL 行；`scope=ALL` 含 NULL；响应含 `appCode`；无新增 `sys_api` 记录 |
| T04 | 搜到 kb/agent/iqd/finance/task 页面；按 APP 分组、当前 APP 置顶、平台级置底；键盘导航不变；零新增端点 |
| T05 | 不设参→行为不变（对比请求参数）；设参→URL 正确透传；`pnpm build`/`lint`/门户冒烟全绿 |

---

## 7. 依赖图

```mermaid
graph TD
    T01[T01 数据层与迁移<br/>V136(+V137) · 实体 · 仓储] --> T02[T02 写入侧标注<br/>AppScopeResolver · 2 漏斗 + 3 保留]
    T01 --> T03[T03 接口层<br/>5 端点可选参数 · VO +1 字段 · BFF 透传]
    T04[T04 前端搜索 P0<br/>SearchItem · search-registry · command-palette] --> T05[T05 前端消息/待办传参<br/>api 层 · portal 两 Tab]
    T03 --> T05
    T02 -.验证过滤需真实数据.-> T05
```

---

## 8. 汇总

- **任务总数**：**5**（T01–T05）。
- **总改动/新增文件**：**35 个**（已含 V137 与绑定实体/仓储，均为确定纳入 P0 的口径）。
  - 迁移：**2 新增**（`V136`、`V137`）
  - mis-taskflow：`SysMessage`/`SysTask` 实体、2 仓储、3 DTO + 3 VO、3 Controller、3 Service、1 新 `AppScopeResolver`、`SysAppBizBinding` 实体/仓储
  - BFF：3 Controller、1 `TaskflowWebClient`、3 `client/model` VO
  - 前端：1 改 `command-palette`、2 新 `lib/search/*`、3 `lib/api/*`、2 门户 Tab

---

## 9. 已拍板事项（2026-10-11）

> 原「待明确事项」已全部由用户拍板，结论如下（措辞对齐文档 🟩/🟦 图例）。

1. 🔴→🟩 **`sys_app_biz_binding` 纳入本次 P0。** 用 **`V137`** 建表 + 新增 `SysAppBizBinding` 实体 / `SysAppBizBindingRepository` 仓储。写入侧由此**真正闭环**：M4（`ProcessService:notify`）/ T2（`ProcessService:assignNode`）两条内部流程路径可落 `app_code`，不再恒 `NULL`。
2. 🔴→🟩 **种子映射已定：`PURCHASE_ORDER → system`（唯一一条）。** 写入 `V137` 幂等种子（`INSERT ... WHERE NOT EXISTS`）。**其余业务类型待业务登记**，实现时**不得臆造**其它映射。
3. 🟦 **T05 定位为「参数打通（plumbing）」。** 默认不传 `appCode`/`scope`、保持零回归；**不新增**「当前 APP 选择」交互（APP 自有首页本次不实现，传参链路暂无真实消费者）。
4. 🟦 **`scope=PLATFORM` 不做 UI。** 仅打通后端谓词（`app_code IS NULL`）与前端参数，不新增「平台级专区」界面。
5. 🟩 **存量不回填。** 存量 `app_code` 恒 `NULL` = 平台级（对齐设计 §3.2-c）；APP 首页查询默认不含 NULL 行。
