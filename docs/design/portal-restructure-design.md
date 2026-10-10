# 门户（Portal）重构 · 系统设计 + 任务分解

| 项 | 内容 |
|---|---|
| 版本 | v1.3（承接 PRD v0.2，仅设计、不写实现；§11 已按用户拍板回填为结论；v1.1→v1.2→v1.3 实现回填，见下方「变更记录」） |
| 日期 | 2026-10-10（v1.2 修订 2026-10-11；v1.3 修订 2026-10-11） |
| 作者 | 高见远（架构师） |
| 上游 | `docs/prd/portal-restructure-prd.md`（v0.2） |
| 关联模块 | mis-admin-web（门户/待办/消息）、mis-admin-bff（透传）、mis-taskflow（消息↔流程关联/回复回写）、mis-migrator（Flyway） |
| 配套图 | `portal-restructure-class.mermaid`、`portal-restructure-sequence.mermaid` |

> 本设计**严格采信** PRD 与现状侦察结论（含文件路径/行号）。硬约束：**Flyway 只追加（新迁移从 V134 起）**、**旧四页保留共存**、**仅门户隐藏左栏**、**只读态不实例化业务组件**、**单层滚动**、**「回退发起人」本轮不做**。

#### 变更记录

| 版本 | 日期 | 变更内容 |
|---|---|---|
| v1.1 | 2026-10-10 | 承接 PRD v0.2；§11「待明确事项」按用户拍板回填为结论（§2.2/§2.3/§2.4/§8 T03 已同步）。 |
| **v1.2** | **2026-10-11** | **实现阶段回填（三项，只改文档）**：<br>①**§1.5 修正 keyword 的 JPQL 写法（必改）**——废弃 `lower(concat('%', :keyword, '%'))`（Hibernate 6 下 null 参数被推断为 `bytea` → PostgreSQL 报 `function lower(bytea) does not exist`，T02 实测踩到并已修复），改为 **Service 层预算小写 `:pattern`、JPQL 中 `:keyword` 仅判空、模糊匹配用 `like :pattern`**；并立**红线**：禁止 `lower(concat('%', :keyword, '%'))`。<br>②**搜索触发语义 → 显式查询（必改）**——§1.5 / §8 T03 / §10-3 的「300ms 防抖」全部改为**显式查询**（输入框 + 「搜索」按钮，回车亦可；仅点搜索/回车才发请求；发起时重置到第 1 页；另提供「重置」）；对齐用户提交 `e1f8632` 给管理页做的一致范式；保留「空串不透传」。<br>③**§1.5 补充说明**——用户 `e1f8632` 已让管理页支持 `keyword` 与「选父含子集」（`lib/api/workflow.ts` 的 `fetchDefinitions` 注释已注明「选父含子集」由调用方展开自身+子孙后传入）；**门户待办页无分类树筛选、不涉及该语义**，两处一致/差异在此写明，避免后续误改。 |
| **v1.3** | **2026-10-11** | **实现阶段回填（消息搜索按子 Tab 作用域）**：T04「消息中心」的搜索语义在 v1.2 中仅表述为「搜索复用」，措辞含糊，导致实现只在前端传了 `msgType`、未打通到后端 `/messages/search`，出现**跨类型串结果 + 静默失效**。本次据 PRD **D-5 / Q3**（各 Tab 内独立搜索、不做跨 Tab 全局）改写 **§8 T04 验收**，并**新增 §3.5「消息搜索的 msgType 作用域」契约**（`/messages/search` 新增**可选** `msgType`；空/缺省跨类型兼容、非空按类型过滤；taskflow `MessageService.search` 空走 `searchInbox`、非空走新增 `searchInboxByType`）；**立 native query 红线**（延续 §1.5 同源教训）：**绑定参数须至少一处被 `=` / 显式 `CAST` 锚定类型**，禁止只出现在 `concat(...)` / `IS NULL` 等不约束类型的语境中；`searchInboxByType` 采用「空值分流放 Service 层 + 无条件等值 `m.msg_type = :msgType`」。**（红线措辞于同轮精修为「锚定」口径：既有 `findInbox` 的 `(:msgType IS NULL OR m.msg_type = :msgType)` 因 `=` 锚定而合规、勿动。）** 同步补记 **§5.2 / §5.3** 本批后端文件（`SysMessageRepository` / `MessageService` / `MessageController` / BFF `TaskflowWebClient` / BFF `MessageController`）。 |

---

## Part A：系统设计

### 1. 实现方案 + 框架选型

#### 1.1 核心技术难点

| # | 难点 | 结论 |
|---|---|---|
| D1 | 六类待办背后是**三个异构接口**（`/tasks/my` 状态族、`/tasks/handled`、`/workflow/instances/my`），字段结构不同（`TaskItem` vs `WfInstance`） | 见 §1.4 **统一行视图模型 + 数据源适配器** |
| D2 | `ProcessShell` 是**整页组件**（PageHeader + `h-full` + 队列逻辑），塞进抽屉需改造 | 见 §2 **加 `embedded` 变体**（不拆分） |
| D3 | 抽屉内三动作**操作对象不同**（同意/驳回=wfTask；转办=sysTask） | 见 §2.3 **按动作路由到不同端点**，用 `WfTask.sysTaskId` 桥接 |
| D4 | 消息无实例线索（`MessageItem` 无 `instanceId`；`notify` 发出 `referenceTaskId=null`） | 见 §3 **新增 `sys_message.instance_id`** |
| D5 | 回复回写目标表未定 | 见 §4 **回写 `wf_history`（新增 `COMMENT` op）**，不建新表 |
| D6 | 三接口均无 keyword；新增端点须登记 `sys_api`（`deny-unmapped:true`） | 见 §1.5 + §3.3 |
| D7 | 门户三 Tab / 抽屉若入 URL 会撞 keep-alive `PAGE_MAP`/`useParams` 坑 | 见 §1.2 **单页内切换 + 抽屉临时态** |

#### 1.2 门户三 Tab：单页内切换（不新增路由）——采纳 PRD §9.1 / D-8

- **不新增路由**，`/portal` 仍由 `keep-alive-outlet.tsx:125` 的 `PAGE_MAP['/portal']=PortalPage` 渲染（`PAGE_MAP` 精确匹配、`DYNAMIC_PAGES` 前缀匹配、`useParams` 恒空全部**天然规避**）。
- `PortalPage` 升级为**容器**：`activeTab: 'home' | 'todo' | 'message'`（`useState`，**不入 URL**）。
- 三个 Tab 各自组件：
  - `PortalHomeTab`：**原样搬移**现有门户内容（欢迎条 + `WorkbenchOverview` + `TaskBoard` + `MessageBoard` + `ProcessBoard` + `AppRail`），满足 PR-09。
  - `PortalTodoTab`：六类子 Tab + 搜索 + 列表 + 抽屉（PR-03/04/05/12）。
  - `PortalMessageTab`：四类子 Tab + 搜索 + 列表 + 抽屉（PR-06/07/18）。
- **抽屉为临时态**：`drawerRow`/`drawerId` 用组件内 `useState` 保存，关闭即销毁，**不进 URL**（D-8）。
- Tab 切换**不重置**其它 Tab 的状态成本为零（各 Tab 自持 state），但为省流量可延迟挂载（`activeTab` 命中才渲染对应组件）。建议首屏只挂载 `home`。

#### 1.3 AppLayout 去左栏（仅 `/portal`）

- 在 `app-layout.tsx` 顶部计算：`const hideSidebar = location.pathname === '/portal';`
- 渲染处（:355-425）改为条件渲染：`{!hideSidebar ? (<aside …>…</aside>) : null}`。
- **`navNodes` / `activeAppCode` / `SideNav` 逻辑保持不变**（PRD §9.2）；`resolveActiveHostAppCode('/portal')` 仍返回 `'task'`（仅用于顶栏标题，无副作用）。
- 顶栏（header）、`TabBar`、`CommandPalette`、`Copilot` **全部保留**（B-3）；`/portal` 本来就被 `:152-162` 排除出 keep-alive Tab，故 TabBar 不会多出门户 Tab。
- 折叠按钮位于 `<aside>` 内部，随 aside 一起隐藏，无需额外处理。
- **其它子系统**（`/task/*`、`/kb/*`、`/system/*` …）`hideSidebar=false`，左栏恢复原样。

#### 1.4 待办六类聚合策略 —— **统一行视图模型 + 数据源适配器（strategy）**

**选型结论：不做「强制并表到单一后端接口」（越界 B-6，且 `WfInstance` 与 `TaskItem` 语义不可无损合并）；也不做「六套完全独立的列表渲染」（重复分页/搜索/空态逻辑）。而是取中间路径——定义一个统一行视图模型 `PortalTodoRow`，由三个适配器把三种数据源映射进来，六个子 Tab 共享同一套列表/搜索/分页/抽屉 UI。**

理由：

1. **异构守恒**：`TaskItem` 有 `bizTitle/priority/dueDate/status/metadata`；`WfInstance` 有 `businessType/businessId/definitionCode/initiatorName/status`。统一模型只保留二者并集里**列表行真正需要的字段**（标题、业务类型/编号、状态、责任/发起人、时间、instanceId、taskId、sysTaskId、优先级、逾期），**不强行补全不存在的字段**（缺失即为 `null`，行渲染按类型降级）。
2. **最小改动**：不新增后端聚合接口（B-6），复用三条既有接口 + 后端加 keyword。
3. **单一渲染路径**：六类子 Tab 用一个 `PortalTodoTab` 组件 + `TodoTabConfig[]` 配置数组驱动，避免 6 份复制粘贴。

**`TodoTabConfig`（`src/features/portal/lib/todo-tabs.ts`）**：

| key | label | source | status | 数据源 | 适配器 |
|---|---|---|---|---|---|
| `pending` | 待处理 | `my` | `PENDING` | `/tasks/my?status=PENDING` | `fromTaskItem` |
| `approving` | 审批中 | `my` | `APPROVING` | `/tasks/my?status=APPROVING` | `fromTaskItem` |
| `approved` | 已通过 | `my` | `APPROVED` | `/tasks/my?status=APPROVED` | `fromTaskItem` |
| `rejected` | 已驳回 | `my` | `REJECTED` | `/tasks/my?status=REJECTED` | `fromTaskItem` |
| `mySent` | 我发起的 | `sent` | — | `/workflow/instances/my` | `fromWfInstance` |
| `myHandled` | 我审批的 | `handled` | — | `/tasks/handled` | `fromHandledTask` |

- **D-6 遵循**：六类字面独立，不存在「待处理含审批中」的合并（`pending` 与 `approving` 各自带 `status`）。
- `instanceId`：`my`/`handled` 源经 `wfInstanceId(item)`（`lib/api/wf-instance.ts`）从 `sys_task.metadata` 解析；**无实例的待办降级**——行仍展示，但点击时抽屉不可加载流程详情时提示（复用旧页 `open()` 的降级精神：`my-processed-page.tsx:53-60`）。
- `sysTaskId`：`my`/`handled` 源直接取 `TaskItem.id`（`sys_task.id`），供抽屉「转办」使用。
- 详情三区所需 `wfTaskId` 由抽屉加载 `ProcessDetail.tasks` 后取当前用户 `PENDING` 任务（见 §2.2）。

#### 1.5 搜索 keyword 后端方案（PR-04）

**三接口均只新增 `keyword` 查询参数，路径不变 ⇒ 无需登记 `sys_api`**（`deny-unmapped` 只校验路径，加 query 不触发）。

| 接口 | Repository 方法 | 模糊匹配字段 |
|---|---|---|
| `GET /tasks/my` | `SysTaskRepository.findByAssignee` / `findOpenByAssignee` | `biz_title`、`biz_type`、`biz_ref_id`、`assignee_name` |
| `GET /tasks/handled` | `findHandledByAssignee` | 同上 |
| `GET /workflow/instances/my` | `WfInstanceRepository.findByInitiator` | `business_id`、`business_type`、`definition_code`、`initiator_name` |

**JPQL keyword 写法（v1.2 修正 —— 实测红线，原写法在 Hibernate 6 下会崩）**

分两层：

1. **Service 层预算小写 LIKE 模式**（`TaskService.likePattern` / `ProcessService.likePattern` 共用同一范式）：

   ```java
   String pattern = (keyword == null || keyword.isBlank())
           ? null
           : "%" + keyword.trim().toLowerCase(Locale.ROOT) + "%";
   ```

2. **JPQL 里 `:keyword` 仅用于判空，模糊匹配一律用 `:pattern`**：

   ```
   and (:pattern is null
        or lower(coalesce(t.bizTitle, ''))     like :pattern
        or lower(coalesce(t.bizType, ''))      like :pattern
        or lower(coalesce(t.bizRefId, ''))     like :pattern
        or lower(coalesce(t.assigneeName, '')) like :pattern
        /* 我发起的：businessId / businessType / definitionCode / initiatorName 同理 */)
   ```

   `:pattern` 为 `null` 时整个 keyword 子句**严格退化为原查询**（幂等、零回归）；非空时为已小写串，且 `:pattern` **只出现在 `like` 右侧、被 LIKE 约束为字符串**，**类型无歧义**。

3. **红线（禁止项）**：**禁止在 JPQL 里写 `lower(concat('%', :keyword, '%'))`（及等价的 `'%' || :keyword || '%'`）**。

   > **根因（如实记载）**：该写法在 Hibernate 6 下报错。`:keyword` 只出现在 `concat(...)` 与 `is null` 中、**没有 `=` 或显式 `CAST` 锚定类型**；当同一查询另有被绑为 `null` 的参数（如 `:status is null`）时，Hibernate 把 `:keyword` 推断为 `bytea`，PostgreSQL 报 `function lower(bytea) does not exist`（`'%' || bytea` → `bytea` → `lower(bytea)`）。T02 实测：`WfInstanceRepository.findByInitiator` 加 keyword 后打挂了既有测试 `ProcessServiceIntegrationTest.myInitiated`；`SysAuditOpRepository` 类注释里早有同一现象记录（P8）。**T02 已按上式修复并落地**——`SysTaskRepository` 三方法（`findByAssignee` / `findOpenByAssignee` / `findHandledByAssignee`）与 `WfInstanceRepository.findByInitiator`。

- 传参：对外 `keyword` 仍为单值字符串；空串在前端**不透传**（不写 `params.keyword`）；后端 `pattern` 由 Service 计算，**不对外暴露**。
- **前端触发语义（v1.2 定稿）：显式查询**——输入框 + 「搜索」按钮（回车亦可触发）；**仅**在点「搜索」/回车时才发起请求；发起搜索时**重置到第 1 页**；另提供「重置」（清空关键词并回第 1 页）。**不采用 300ms 防抖**，与用户提交 `e1f8632` 给管理页做的一致（详见 §10 共享知识 3）。

**（v1.2 补充）与管理页的一致 / 差异** —— 用户提交 `e1f8632` 已让**管理页**（流程定义列表）支持 `keyword` 与「选父含子集」，`frontend/mis-admin-web/src/lib/api/workflow.ts` 的 `fetchDefinitions` 注释已注明「若需『选父含子集』，调用方应先把勾选 id 展开为自身+子孙再传入」。**门户待办页无分类树筛选，不涉及「选父含子集」**；门户仅复刻其「显式查询 + `keyword`」这一点，两处**无需、也不应**为「对齐」而互相改动。

#### 1.6 架构模式

- 前端：**组件化 + 容器/展示分离**（`PortalPage` 容器；各 Tab 自持数据 + 复用 `list-page-skeleton` 全家桶）。状态用**局部 `useState`**（无全局 store），与既有门户/待办/消息页一致。
- 后端：**分层 Service + Repository**（既有 MVC 分层不变），DTO 用 Java `record`，VO 透出字段。
- 复用优先：抽屉复用 `ui/sheet`（范式见 `inbox-page.tsx:266-326`）、`ui/tabs`、`FormShell`、`ReadOnlyFormView`。

---

### 2. 抽屉方案

#### 2.1 待办抽屉：`ProcessShell` **加 `embedded` 变体**（不拆分）——明确结论

**结论：给 `ProcessShell` 增加 `variant: 'page' | 'embedded'`（默认 `'page'`），不把三区拆成独立小组件。**

理由：

- `ProcessShell` 已内聚「三区 + 数据加载 + 动作路由 + 单层滚动不变式」。拆散成 4 个独立组件会**碎片化一个内聚单元**，并把「加载 `ProcessDetail`」「判定 `myPendingTask`」「单层滚动」逻辑复制到多处，回归风险高。
- `page` 分支完全保持现状（含 `PageHeader`、面包屑、P7 队列自动续办、`returnPath`），**零回归**。

**`embedded` 变体的差异（仅在 `variant==='embedded'` 时生效）**：

| 差异点 | page | embedded |
|---|---|---|
| `PageHeader` / 面包屑 | 有 | **去掉**（抽屉自带 SheetHeader：业务单号 + 状态徽标） |
| 外层高度/滚动 | `h-full` + 中部网格 `overflow-auto`（单层滚动点） | **去掉 `h-full`/中部 `overflow-auto`**，改为竖直堆叠 `flex flex-col gap-4`，**由 Sheet 内容区作为唯一 `overflow-auto`** |
| 三区排布 | `lg:grid-cols-3`（表单左 2/3 + 历史右 1/3） | **`grid-cols-1` 竖向堆叠**：①审批进度 → ②只读表单 → ③审批历史 |
| 队列自动续办（P7） | 有 | **关闭**（抽屉内不做跨条跳转） |
| 动作结束 | 自动跳下一条 / 重载 | 调 `onActionDone()` → **关闭抽屉 + 刷新列表** |
| 底部动作栏 | 同意/驳回（仅处理人可见） | 同意/驳回 **+ 转办**（见 §2.3） |

序：保持 PRD 6.5 ASCII 的 ①进度 ②表单 ③审批信息；进度条与历史仍复用现有渲染（`process-shell.tsx:161-191`、`:237-254`），表单复用 `FormShell`。

**单层滚动守则（硬约束）**：`TodoDetailDrawer` 用 `ui/sheet` 的 `SheetContent`（`flex flex-col`）；抽屉内**唯一滚动容器**是内容体 `div`（`min-h-0 flex-1 overflow-auto`）。`embedded` 的 `ProcessShell`、`FormShell`、`ReadOnlyFormView` **一律不得**再加 `overflow-auto`/`max-h`（沿用 `form-shell.tsx:21-24` 的不变式）。

#### 2.2 抽屉内三动作：按动作路由到**正确端点**（勿混用）——明确结论

动作对象与端点固定映射：

| 动作 | 语义 | 操作对象 | 端点 | body / params |
|---|---|---|---|---|
| 同意 APPROVE | 推进 | **wfTask** | `POST /api/v1/workflow/tasks/{wfTaskId}/complete` | `{action:'APPROVE', comment}`；params `{tenantId, operatorId}` |
| 驳回 REJECT | **终止实例并通知发起人** | **wfTask** | `POST /api/v1/workflow/tasks/{wfTaskId}/complete` | `{action:'REJECT', comment}`；params `{tenantId, operatorId}` |
| 转办 transfer | 改处理人 + 置回 PENDING + 补发通知 | **sysTask** | `POST /api/v1/tasks/{sysTaskId}/transfer` | `{newAssigneeId, newAssigneeName, comment}`；params `{tenantId, operatorId}` |

- `wfTaskId` = `ProcessDetail.tasks` 中 `status==='PENDING' && assigneeId===me` 的任务（即现有 `myPendingTask`，`process-shell.tsx:96-101`）。
- `sysTaskId` = `myPendingTask.sysTaskId`（`WfTask`/`WfTaskVO` 已有该字段；`ProcessService.toTaskVo` 已透出 `sysTaskId`）。**若 `sysTaskId==null` ⇒ 转办按钮置灰**（降级，不报错）。
- **统一处理函数**：`ProcessShell.handle(action)` 内部按动作分派——`APPROVE`/`REJECT` 走 wfTask 端点，`transfer` 走 sysTask 端点；**绝不把 `REJECT` 发到 `/tasks/{id}/handle`**（那会绕过流程推进/终止语义），也**不把 transfer 发到 wfTask 端点**（wfTask 无 transfer）。
- 转办需**指定新处理人**：**本轮降级为「输入工号/用户 ID」**——抽屉内「转办」弹轻量输入框，填 `newAssigneeId`（必填）、`newAssigneeName`（可选），走既有 `POST /api/v1/tasks/{id}/transfer`。**不新增候选接口、不给审批角色开放用户管理权限**（`GET /api/v1/users` 绑系统管理菜单 201，审批人无权限）。完整选人器列入后续迭代（§11.1 已定）。
- **只有「待处理/审批中」态可写**：`myPendingTask` 存在才显示动作栏；其余态只读（PR-12 + PRD 6.5）。因 `/tasks/my?status=APPROVING` 的任务与 wfTask 一一对应，审批中态同样可动作。
- 动作成功后：`toast` + `onActionDone()`（关抽屉 + 刷新当前子 Tab 列表）。

> 现状澄清（如实记载）：`TaskService.handleTask` 的 `REJECT` **不是**退回重填，流程侧 `ProcessService` 语义为**终止整个实例**。「回退发起人」本轮**不做**（B-8 / D-10）。

#### 2.3 消息抽屉

- 普通消息形态：标题 + 摘要 + 元信息（类型/分类/发送人/时间/已读）+ 完整正文 + 附件；**无回复入口**。
- **流程通知形态**（`detail.instanceId != null`）：正文**+** 只读表单（`FormShell`，`fetchProcessDetail(instanceId)` 取 `formData`）**+** 回复区（输入框 + 提交）。**本轮定稿：仅「表单内容 + 回复区」，不叠加审批进度/审批信息**（§11.3 已定）。
- 抽屉范式直接沿用 `inbox-page.tsx:266-326`（`Sheet side="right"`）。

#### 2.4 抽屉宽度

**定稿：`SheetContent className="w-full max-w-[560px]"`**（既有范式为 `max-w-[480px]`，PRD 6.5 允许 480–640；取 560 以容纳三区表单，§11.2 已定）。PR-17 响应式属 P2，本轮不做。

---

### 3. PR-08 消息 ↔ 流程实例关联

#### 3.1 字段设计定夺：**新增专用列 `sys_message.instance_id`，不复用 `reference_task_id`**

| 方案 | 结论 | 理由 |
|---|---|---|
| 复用 `reference_task_id` | ✗ 否决 | 其语义 = **关联代办(sys_task)**（`SysMessage` 注释、`TaskService.createTask`/`transferTask` 均按此用）。用它关联流程实例需**二跳** `reference_task_id → sys_task.metadata.wfInstanceId`（脏 JSON，PRD §9.7 明确点名脆弱），且 `notify` 发出的通知 `referenceTaskId=null` 根本无线索 |
| **新增 `instance_id BIGINT NULL`** | ✓ **采纳** | 一条直接软引用 `wf_instance.id`（无外键，与 `started_form_code`/`category_id` 一脉）。PR-07（看表单）与 PR-18（回复回写）都变成**单跳定位**。`reference_task_id` 原样保留，不破坏既有 APPROVAL 消息↔代办链路 |

#### 3.2 `ProcessService.notify` 写入实例线索

- 现状 `notify(...)`（`ProcessService.java:458-469`）发的通知 `referenceTaskId=null`，无实例线索。
- 改法：`PublishMessageRequest` **新增组件 `Long instanceId`**，`notify` 传 `instance.getId()`；`MessageService.publish` 写入 `msg.setInstanceId(...)`。
- `PublishMessageRequest` 是 `record`（位置参数），**全部 `new PublishMessageRequest(...)` 调用点必须同步补参**（共 3 处）：`ProcessService.notify`、`TaskService.createTask`、`TaskService.transferTask`（后两者传 `null`）。
- `notify` 由 `completeInstance`（APPROVED）与 `completeTask` REJECT 分支触发，两处天然持有 `instance`。
- 通知失败仍 `catch` 静默（不阻断流程），既有行为不变。

#### 3.3 接口透出字段 + 迁移号

- **VO 透出（新增两字段）**：`MessageVO`、`MessageDetailVO` += `instanceId: String`、`canReply: boolean`。
  - `canReply` 判定（服务端计算）：`msgType == 'NOTIFY' && instanceId != null` ⇒ `true`；否则 `false`。（普通消息/无实例一律 `false`，前端据此隐藏回复入口，落空 §5.2 降级定义。）
- **迁移版本：`V134`**（当前最新 V133）。文件 `backend/mis-migrator/src/main/resources/db/migration/V134__message_instance_link_and_reply_api.sql`，**只追加，绝不改 V120–V133**。内容：
  1. `ALTER TABLE sys_message ADD COLUMN IF NOT EXISTS instance_id BIGINT NULL;`
  2. `CREATE INDEX IF NOT EXISTS idx_msg_instance ON sys_message (instance_id);`
  3. 登记新端点 `sys_api`：**95072** = `POST /api/v1/messages/{id:[0-9]+}/reply`（module 95010，parent 95010，`type='api'`，幂等三条件）。
  4. 绑定 `sys_menu_api`：**95092** → 菜单 **95003**（`taskflow:message:view`，V123 已授权 role_id=1）。
  5. （**可选**）回填历史 APPROVAL 消息的 `instance_id`：经 `reference_task_id → sys_task.metadata->>'wfInstanceId'` 关联，仅当 metadata 可解析。**默认不做**（脏 JSON + 低价值，标记 P2，见 §11）。
- **ID 段位核实**：`sys_api` 已占 95020–95048、95050–95056、95060–95065、95066–95071 ⇒ **95072 起空闲**；`sys_menu_api` 已占 95020–95048、95050–95059、95076、95080–95091 ⇒ **95092 起空闲**。

#### 3.4 BFF 透传

- 新增端点经 BFF 透传：`TaskflowWebClient.replyMessage(...)` + BFF `MessageController` 新增 `@PostMapping("/{id}/reply")`。
- `instanceId`/`canReply` 随既有 inbox/search/detail 响应自动透传（BFF `client/model` 的 `MessageVO`/`MessageDetailVO` 同步补两字段，否则反序列化丢字段）。

#### 3.5 消息搜索的 `msgType` 作用域（v1.3 补充）——**与子 Tab 绑定，不做跨 Tab 全局**

**契约（PRD D-5 / Q3）**：门户「消息中心」的搜索**按当前子 Tab 的 `msgType` 作用域**——四类子 Tab（`APPROVAL` / `NOTIFY` / `REMIND` / `SYSTEM_ALERT`）**各自独立搜索**，在某个子 Tab 内搜关键词**只返回该类型**消息，**不做跨类型 / 跨 Tab 全局**。搜索框位于子 Tab 行内（PRD 布局图第 202 行）。

> **v1.3 回填动机（如实记载）**：v1.2 的 §8 T04 仅写「+ 搜索复用」，措辞不足以表达该作用域，导致实现方只在前端传了 `msgType`、未打通到后端 `/messages/search`（后端 `MessageService.search` 与 BFF `search` 均无 `msgType`），出现「在审批子 Tab 搜关键词会把通知/提醒/系统告警结果也搜出来」的**跨类型串结果 + 静默失效**。现补齐后端。

**接口与分层**：

- `GET /api/v1/messages/search` **新增可选 `msgType`**；**空 / 缺省时跨类型**（与现状一致，兼容旧调用），**非空时按类型过滤**。仅新增 query 参数、路径不变 ⇒ **无需登记 `sys_api`**（同 §1.5）。
- taskflow `MessageService.search(tenantId, userId, keyword, msgType, page, size)` 增 `msgType` 形参：
  - 空 / 缺省 → 走既有 `SysMessageRepository.searchInbox`（跨类型，零回归）；
  - 非空 → 走**新增** `SysMessageRepository.searchInboxByType`（按类型过滤）。
- 前端：搜索请求随当前子 Tab 带上 `msgType`；切换子 Tab 时以该 Tab 类型**显式重查**（触发语义同 §1.5「显式查询」）。

**红线（延续 §1.5 同源教训 —— 「锚定」口径）**：native query 中的绑定参数**必须至少有一处被 `=` 或显式 `CAST` 锚定类型**，**不得只出现在 `concat(...)` / `IS NULL` 这类不约束类型的语境中**——否则 PG / Hibernate 无法推断参数类型（T02 的 `:keyword` 因而被推断为 `bytea`，报 `function lower(bytea) does not exist`）。

> **说明（同源对照，勿误改）**：既有 `SysMessageRepository.findInbox` 的 `(:msgType IS NULL OR m.msg_type = :msgType)` **因 `=` 已把参数锚定为 varchar（`msg_type` 列类型）而安全**，属**合规写法、无需修改**（可一直正常运行的根因就在此）。真正失锚的是 T02 的 `:keyword`——它**只**出现在 `concat('%', :keyword, '%')` 与 `is null` 中、**没有任何 `=` / 显式 CAST**，才被推断成 `bytea`。本次新增 `searchInboxByType` 采用「Service 层分流 + 无条件等值 `m.msg_type = :msgType`」，**并非因其更「正确」，而是可读性更清晰的选择**（与 `findInbox` 的等价方案二选一，二者不冲突）；空值分流放在 Service 层（空走 `searchInbox`、非空走 `searchInboxByType`）。

---

### 4. PR-18 回复回写

#### 4.1 目标表定夺：**追加 `wf_history`（新增 op `COMMENT`），不另建 `wf_comment` 表**——明确结论

| 方案 | 结论 | 理由 |
|---|---|---|
| **`wf_history` 追加 `COMMENT` 记录** | ✓ **采纳** | ①PRD §5.2 明确回复语义 = 「写入流程审批历史」「与审批留痕合一」（US-8）；②`wf_history` 已有 `instance_id/node_code/operator_id/operator_name/comment(text)/created_at` 全部所需字段，**零建表**；③`ProcessShell` 审批历史区（`:237-254`）**自动渲染**，零额外前端代码；④回复**不改流程状态、不推进节点**（动作性质），无需独立表承载 |
| 另建 `wf_comment` 表 | ✗ 否决 | 会引入「审批信息区第二条渲染路径 + 新表 + 新 CRUD」，收益仅为「回复与审批分离展示」，与 PRD「合一」诉求相反 |

落点：`ProcessService.recordHistory(instanceId, currentNodeCode, operatorId, operatorName, WfHistory.OP_COMMENT, null, null, comment, now)`。
- `WfHistory` 新增常量 `public static final String OP_COMMENT = "COMMENT";`
- `node_code` 为 NOT NULL ⇒ 取 `instance.getCurrentNodeCode()`，为 null 时回退占位（如实例当前无节点则用首个节点码 / 常量 `-`）。
- `from_node`/`to_node` 传 `null`（纯评论，不流转）。

#### 4.2 新增端点（taskflow + BFF）

- **taskflow**：`POST /internal/v1/messages/{id}/reply`，body `ReplyMessageRequest{ @NotBlank String content }`，params `{tenantId, operatorId}`。
- **编排归属（关键）**：回复要读消息（`MessageService`）又要写 `wf_history`（`ProcessService` 的地盘）。**为避免循环依赖**（`ProcessService` 已依赖 `MessageService`，反向注入会成环），把回复编排放在 **`ProcessService.replyToMessage(tenantId, messageId, operatorId, operatorName, content)`**：它用已注入的 `MessageService` 读消息拿 `instanceId`，再用本地 `historyRepository` 追加 `COMMENT`。`MessageController` 注入 `ProcessService` 并路由该端点。
  - 校验：消息不存在 → 404；`instanceId==null` → `VALIDATION_ERROR`（「该消息无关联流程，暂不支持回复」）；实例不存在 → 404。
- **BFF**：`MessageController` 新增 `@PostMapping("/{id}/reply")` → `TaskflowWebClient.replyMessage`。
- **权限**：新端点已登记 `sys_api 95072` 并绑菜单 95003（`deny-unmapped:true` 下必须），否则 403。

#### 4.3 前端入口显隐规则

- 消息抽屉内：`detail.canReply === true` ⇒ 显示回复输入框 + 提交按钮；否则**隐藏入口**并可提示「该消息无关联流程，暂不支持回复」（§5.2 降级）。
- 提交成功：**就地回显**本条回复（本地 echo）+ `toast`；若抽屉已加载流程详情，则**重新拉 `fetchProcessDetail`** 刷新「审批信息」区（回复已作为 `COMMENT` 出现在 `wf_history`）。

---

### 5. 文件列表（新增 / 修改）

#### 5.1 前端 `frontend/mis-admin-web`

**新增**
- `src/features/portal/tabs/portal-home-tab.tsx`（搬移现有门户内容，PR-09）
- `src/features/portal/tabs/portal-todo-tab.tsx`（六类子 Tab + 搜索 + 列表 + 抽屉宿主）
- `src/features/portal/tabs/portal-message-tab.tsx`（四类子 Tab + 搜索 + 列表 + 抽屉宿主）
- `src/features/portal/components/todo-detail-drawer.tsx`（待办抽屉：Sheet `max-w-[560px]` + `ProcessShell embedded` + 三动作 + 转办输入框 + 「在完整页打开」入口）
- `src/features/portal/components/message-detail-drawer.tsx`（消息抽屉：正文 + 流程表单 + 回复区）
- `src/features/portal/lib/todo-tabs.ts`（`TodoTabConfig[]` 六类配置）
- `src/features/portal/lib/todo-adapters.ts`（`fromTaskItem`/`fromHandledTask`/`fromWfInstance`）
- `src/features/portal/types.ts`（`PortalTodoRow` 视图模型）
- 测试：`src/features/portal/__tests__/portal-tabs.test.tsx`
- 测试：`src/features/portal/__tests__/todo-tabs.test.tsx`
- 测试：`src/features/portal/__tests__/message-reply-drawer.test.tsx`
- 测试：`src/components/layout/__tests__/app-layout-portal.test.tsx`（左栏隐藏/恢复）

**修改**
- `src/features/portal/portal-page.tsx`（三 Tab 容器 + 抽屉状态）
- `src/features/taskflow/process-shell.tsx`（加 `variant` / `embedded` / `onActionDone` / 转办动作 / 动作分派）
- `src/components/layout/app-layout.tsx`（仅 `/portal` 条件渲染 `<aside>`）
- `src/lib/api/messages.ts`（`MessageItem`/`MessageDetail` 加 `instanceId`/`canReply`；新增 `replyMessage`）
- `src/lib/api/tasks.ts`（`fetchMyTasks`/`fetchHandledTasks` 加 `keyword`）
- `src/lib/api/workflow.ts`（`fetchMyProcesses` 加 `keyword`）

> 旧四页（`task-list-page.tsx`/`inbox-page.tsx`/`my-sent-page.tsx`/`my-processed-page.tsx`）与路由 **保留共存、不改**（D-3）。

#### 5.2 后端 `backend/mis-taskflow`

**新增**
- `dto/ReplyMessageRequest.java`（`record{ @NotBlank String content }`）
- 测试：`src/test/java/com/mis/taskflow/service/ProcessServiceReplyTest.java`（回复→`wf_history` `COMMENT`）
- 测试：`src/test/java/com/mis/taskflow/service/MessageInstanceLinkTest.java`（`notify` 写入 `instanceId`）
- 测试：`src/test/java/com/mis/taskflow/service/TaskKeywordSearchTest.java`
- 测试：`src/test/java/com/mis/taskflow/service/MessageSearchScopeTest.java`（v1.3：`search` 带 `msgType` 按类型过滤、缺省跨类型）

**修改**
- `domain/entity/SysMessage.java`（+`instanceId` 字段/getter/setter）
- `domain/entity/WfHistory.java`（+`OP_COMMENT` 常量）
- `dto/PublishMessageRequest.java`（+`Long instanceId`）
- `dto/MessageVO.java` / `dto/MessageDetailVO.java`（+`instanceId`/`canReply`）
- `service/MessageService.java`（`publish` 写 `instanceId`；`toVo`/`detail` 补两字段；**v1.3**：`search` 增 `msgType` 形参——空走 `searchInbox`、非空走 `searchInboxByType`，空值分流在 Service 层）
- `service/ProcessService.java`（`notify` 传 `instanceId`；新增 `replyToMessage`；`recordHistory` 复用）
- `service/TaskService.java`（`createTask`/`transferTask` 的 `PublishMessageRequest` 补 `instanceId=null`；`myTasks`/`handledTasks` 加 `keyword`）
- `controller/MessageController.java`（+`POST /{id}/reply`；注入 `ProcessService`；**v1.3**：`/search` 加可选 `msgType` 入参）
- `controller/TaskController.java`（`/my`、`/handled` 加 `keyword` 入参）
- `controller/WfProcessController.java`（`/instances/my` 加 `keyword` 入参）
- `domain/repository/SysTaskRepository.java`（三查询加 `keyword`）
- `domain/repository/WfInstanceRepository.java`（`findByInitiator` 加 `keyword`）
- `domain/repository/SysMessageRepository.java`（**v1.3**：新增 `searchInboxByType`——`m.msg_type = :msgType` **无条件等值**，禁止把 `:msgType` 放进 `IS NULL`）

#### 5.3 后端 `backend/mis-admin-bff`

**修改**
- `client/TaskflowWebClient.java`（+`replyMessage`；`myTasks`/`handledTasks`/`myInitiated` 加 `keyword`；**v1.3**：`searchMessages` 加 `msgType`）
- `controller/MessageController.java`（+`POST /{id}/reply`；**v1.3**：`/search` 加可选 `msgType` 透传）
- `controller/TaskController.java`（`/my`、`/handled` 透传 `keyword`）
- `controller/WorkflowController.java`（`/instances/my` 透传 `keyword`）
- `client/model/MessageVO.java` / `MessageDetailVO.java`（+`instanceId`/`canReply`）

#### 5.4 迁移 `backend/mis-migrator`

**新增**
- `src/main/resources/db/migration/V134__message_instance_link_and_reply_api.sql`

---

### 6. 数据结构与接口（类图）

见配套文件 **`docs/design/portal-restructure-class.mermaid`**（含前端组件/视图模型/适配器 + 后端实体/VO/DTO/Service/Repository/BFF，并标注 `[新增]/[修改]/[复用]`）。

新增/修改端点签名（速查）：

```
# 前端 lib/api （BFF 对外路径）
fetchMyTasks({tenantId,assigneeId,status?,keyword?,page?,size?})      GET  /api/v1/tasks/my
fetchHandledTasks({tenantId,assigneeId,keyword?,page?,size?})         GET  /api/v1/tasks/handled
fetchMyProcesses(tenantId,initiatorId,status?,page?,size?,keyword?)   GET  /api/v1/workflow/instances/my
fetchProcessDetail(instanceId,tenantId)                               GET  /api/v1/workflow/instances/{id}
replyMessage(messageId,userId,content)                                POST /api/v1/messages/{id}/reply   # 新增
searchMessages({tenantId,userId,keyword,msgType?,page?,size?})        GET  /api/v1/messages/search       # v1.3：+可选 msgType（空=跨类型）

# taskflow 内部（BFF → taskflow）
TaskService.myTasks(...keyword)          @Controller GET  /internal/v1/tasks/my
TaskService.handledTasks(...keyword)     @Controller GET  /internal/v1/tasks/handled
ProcessService.myInitiated(...keyword)   @Controller GET  /internal/v1/workflow/instances/my
ProcessService.replyToMessage(...)       @Controller POST /internal/v1/messages/{id}/reply   # 新增
MessageService.search(...msgType)        @Controller GET  /internal/v1/messages/search      # v1.3：+msgType（空→searchInbox，非空→searchInboxByType）

# 数据结构（新增字段）
PublishMessageRequest(..., Long instanceId)     # record 追加组件
ReplyMessageRequest(@NotBlank String content)   # 新增 record
MessageVO(..., String instanceId, boolean canReply)          # 追加
MessageDetailVO(..., String instanceId, boolean canReply)    # 追加
SysMessage.instanceId: Long                     # 新列 sys_message.instance_id
WfHistory.OP_COMMENT = "COMMENT"                # 新常量
```

---

### 7. 程序调用流程（时序图）

见配套文件 **`docs/design/portal-restructure-sequence.mermaid`**，含两条主线：
- ①**门户待办点击 → 抽屉加载流程详情 → 三动作（同意/驳回/转办）**：覆盖六类列表加载、`ProcessDetail` 加载、`wfTask` vs `sysTask` 两条动作路由。
- ②**消息点击 → 抽屉（流程通知）→ 回复回写审批意见**：覆盖 `instanceId` 判定、流程表单加载、`replyToMessage` → `wf_history(COMMENT)`、降级分支。

---

### 8. 任务分解（Part B）

#### 8.1 切分与顺序（结论：**后端先行主线 T02 独立可并行；前端 T01 打底，T03/T04 依赖 T01，联调在 T05**）

- **后端 T02 与前端 T01 无相互依赖，可并行开发**（T02 独立交付迁移+接口；T01 用既有接口即可跑通骨架）。
- 前端搜索（T03）与回复（T04）的**完整能力**依赖 T02（keyword/instanceId/canReply/reply），故 T03/T04 在 T01 之后、与 T02 尾部并轨；联调收口在 T05。
- 共 **5 个任务**（≤5 硬上限），每个 ≥3 文件，配置/迁移不分散。

#### 8.2 任务列表

**T01 · 门户骨架 + 去左栏（基础）** ｜ P0 ｜ 依赖：无
- 文件：`portal-page.tsx`（三 Tab 容器）、`portal-home-tab.tsx`（搬移现有内容）、`portal-todo-tab.tsx`（壳）、`portal-message-tab.tsx`（壳）、`app-layout.tsx`（去左栏）、`types.ts`。
- 验收：`/portal` 顶栏下方出现「首页/待办事项/消息中心」三 Tab，默认首页且内容与现状一致；`/portal` 不渲染 `<aside>`、主区占满宽度；进入 `/task/*`、`/kb/*` 等左栏恢复；`navNodes`/`activeAppCode` 逻辑未变；无新增路由。

**T02 · 后端：消息↔流程关联 + 回复回写 + 搜索 keyword** ｜ P0 ｜ 依赖：无（可与 T01 并行）
- 文件：迁移 `V134__message_instance_link_and_reply_api.sql`；taskflow：`SysMessage`、`WfHistory`、`PublishMessageRequest`、`ReplyMessageRequest`、`MessageVO`、`MessageDetailVO`、`MessageService`、`ProcessService`、`TaskService`、`MessageController`、`TaskController`、`WfProcessController`、`SysTaskRepository`、`WfInstanceRepository`；BFF：`TaskflowWebClient`、`MessageController`、`TaskController`、`WorkflowController`、`client/model/MessageVO`&`MessageDetailVO`；测试 3 个。
- 验收：`notify` 产生的 NOTIFY 消息 `instance_id` 非空、`canReply=true`；`POST /messages/{id}/reply` 追加一条 `wf_history(operation=COMMENT)` 且出现在 `GET /workflow/instances/{id}` 的 history；三接口 `keyword` 生效且不传时**行为与现状完全一致**；`V134` 幂等可重跑、`sys_api 95072` 已登记并绑 95003；`MigrationIdempotency` 类测试保持绿；**未修改任何历史迁移**。

**T03 · 前端：待办六类聚合 + 搜索 + 待办抽屉（含 ProcessShell embedded + 三动作 + 完整页入口）** ｜ P0 ｜ 依赖：T01（搜索完整功能软依赖 T02）
- 文件：`portal-todo-tab.tsx`、`todo-detail-drawer.tsx`、`lib/todo-tabs.ts`、`lib/todo-adapters.ts`、`types.ts`、`process-shell.tsx`（embedded/动作分派/转办/完整页入口）、`tasks.ts`、`workflow.ts`；测试 `todo-tabs.test.tsx`。
- 验收：六类子 Tab 字面独立、各自计数/筛选正确（D-6）；每类支持关键词搜索（**显式查询**：点「搜索」/回车才发起请求、发起时重置到第 1 页、另设「重置」清空并回第 1 页；**不做 300ms 防抖**）；点击行**不整页跳转**，右侧划入抽屉展示①审批进度②只读表单③审批信息；「待处理/审批中」态显示三动作，同意/驳回走 `/workflow/tasks/{id}/complete`、转办走 `/tasks/{id}/transfer`（**转办弹「输入工号/用户 ID」输入框**）；`sysTaskId==null` 时转办置灰；抽屉底部保留「在完整页打开」入口跳 `/task/process/{instanceId}`（PR-11）；`page` 变体（旧 `/task/process/{id}`）零回归；单层滚动。

**T04 · 前端：消息四类 + 抽屉流程表单 + 回复回写** ｜ P0 ｜ 依赖：T01、T02
- 文件：`portal-message-tab.tsx`、`message-detail-drawer.tsx`、`messages.ts`；测试 `message-reply-drawer.test.tsx`；**v1.3 补记本批后端改动**——taskflow：`SysMessageRepository.java`（+`searchInboxByType`）、`MessageService.java`（`search` +`msgType`）、`MessageController.java`（`/search` +`msgType`）；BFF：`TaskflowWebClient.java`（`searchMessages` +`msgType`）、`controller/MessageController.java`（`/search` +`msgType`）。
- 验收：四类子 Tab（审批/通知/提醒/系统告警），**搜索按当前子 Tab 的 `msgType` 作用域**（各子 Tab 内独立搜索，对齐 PRD D-5 / Q3，**不做跨类型/跨 Tab 全局**；`/messages/search` 带当前 `msgType`，缺省才跨类型）；点击划入抽屉；`canReply=true` 显示回复入口并可提交，提交后**就地回显**且流程「审批信息」区出现该 `COMMENT`；`canReply=false` 隐藏入口并提示；流程通知抽屉展示只读表单。

**T05 · 集成、样式统一与回归** ｜ P0 ｜ 依赖：T01、T02、T03、T04
- 文件：`portal-*` 收口微调、`ui/tabs` 统一接入（PR-10）、全局样式核对（主色 `#4f46e5`/圆角 4px/表头标签 13px/单层滚动）、测试 `portal-tabs.test.tsx`、`app-layout-portal.test.tsx`；`tabs.tsx`（如需）。
- 验收：三 Tab 与两抽屉端到端跑通；空态/加载/错误/无搜索结果态统一（PR-13）复用 `EmptyState`/`ListLoading`/`ListError`；旧四页回归通过；无嵌套滚动；门户不出现左栏且其它子系统无变化。

---

### 9. 依赖包列表

**无新增第三方依赖。**
- 前端：复用 `@radix-ui/react-dialog`（`ui/sheet`）、既有 `ui/tabs`、`lucide-react`、`sonner`、`react-router-dom`。
- 后端：复用 Spring Web / WebFlux(WebClient) / Spring Data JPA / Flyway / Jakarta Validation（`ReplyMessageRequest` 用 `@NotBlank`）。
- 迁移：无新依赖（PostgreSQL 16 原生列/索引）。

---

### 10. 共享知识（跨文件约定）

1. **API 响应契约**：统一 `{code, data, message}`；前端一律经 `unwrap()`/`code!==0 throw` 处理。
2. **传参格式（对齐既有「逗号串」范式）**：多值参数用单值逗号串（如既有 `categoryIds.join(',')`）；`keyword` 为单值字符串，空串**不透传**。
3. **搜索交互（v1.2 定稿：显式查询）**：输入框 + 「搜索」按钮（回车亦可触发）；**仅点「搜索」/回车才发起请求**；发起时**重置到第 1 页**；另提供「重置」（清空关键词 + 回第 1 页）。**不采用 300ms 防抖**，与用户提交 `e1f8632` 的管理页（`fetchDefinitions`）范式一致。
4. **路由/状态**：门户三 Tab 单页内切换、抽屉为临时态，**一律不入 URL**（规避 keep-alive `PAGE_MAP`/`useParams`）。
5. **单层滚动**：抽屉内容体是**唯一** `overflow-auto`；`ProcessShell(embedded)`/`FormShell`/`ReadOnlyFormView` **不得**再加滚动容器或 `max-h`。
6. **只读渲染**：抽屉表单复用 `FormShell`/`ReadOnlyFormView`；**只读态不实例化业务组件**（沿用 `form-shell.tsx` 约束）。
7. **动作端点纪律**：同意/驳回=wfTask 端点（`/workflow/tasks/{id}/complete`）；转办=sysTask 端点（`/tasks/{id}/transfer`）；**禁止混用**；`sysTaskId` 缺失时转办降级置灰。
8. **可复用组件**：`ui/sheet`（右侧，`lib` 内 `isPortaledFloatingTarget` 已处理嵌套浮层）、`ui/tabs`、`EmptyState`/`ListLoading`/`ListError`、`PaginationFooter`、`FormShell`、`ReadOnlyField/ReadOnlyText`、`wfInstanceId`、`TaskStatusBadge`。
9. **命名**：前端门户域前缀 `portal-`；视图模型 `PortalTodoRow`；后端新增 DTO 用 `record`。
10. **UI 规范**：主色 `#4f46e5`（走 primary token，**勿硬编码**）；圆角 4px；表头/标签 13px；表格/列表**单层滚动**（禁嵌套、禁 flex 拉伸）。
11. **Flyway 纪律**：**只追加**；新迁移 `V134` 起；**绝不修改 V120–V133**（checksum 变更会阻塞整条链）；新端点必须登记 `sys_api` 并绑授权菜单（`deny-unmapped:true`）。
12. **`PublishMessageRequest` 是 record**：新增 `instanceId` 组件后，**所有 `new PublishMessageRequest(...)` 调用点必须同步补参**（3 处：`ProcessService.notify`、`TaskService.createTask`、`TaskService.transferTask`）。
13. **常量**：`WfHistory.OP_COMMENT = "COMMENT"`；`canReply = (msgType=='NOTIFY' && instanceId!=null)`。
14. **边界**：旧四页保留共存；仅 `/portal` 隐藏左栏；不改其它子系统布局；「回退发起人」不做。
15. **keyword 检索写法（红线）**：Service 层预算小写 `pattern = "%" + keyword.trim().toLowerCase(Locale.ROOT) + "%"`（`null` / 空白 → `null`）；JPQL 中 `:keyword` **仅判空**、模糊匹配用 `like :pattern`；**禁止 `lower(concat('%', :keyword, '%'))`**（Hibernate 6 下 null 参数被推断为 `bytea` → PostgreSQL `lower(bytea) does not exist`）。详见 §1.5。
16. **参数类型锚定（v1.3，红线「锚定」口径）**：native query 中的绑定参数**必须至少有一处被 `=` 或显式 `CAST` 锚定类型**，**不得只出现在 `concat(...)` / `IS NULL` 这类不约束类型的语境中**（否则 PG/Hibernate 推断不出类型：T02 的 `:keyword` 被推断为 `bytea` → `lower(bytea) does not exist`）。既有 `findInbox` 的 `(:msgType IS NULL OR m.msg_type = :msgType)` **因 `=` 锚定而合规、勿动**；本次新增 `searchInboxByType` 用「Service 层分流 + 无条件等值」是更清晰的等价选择。配套：消息搜索按子 Tab 作用域、`/messages/search` 的 `msgType` 空/缺省跨类型、非空按类型过滤（PRD D-5/Q3），详见 §3.5。

---

### 11. 已明确事项（结论）

> 本节原为「待明确事项」，经用户 2026-10-10 全部拍板，**已就地回填为结论**。§2.2 / §2.3 / §2.4 / §8（T03）已同步。v1.1→v1.2 的实现回填另见 **11.8 / 11.9 / 11.10**；v1.2→v1.3 的实现回填另见 **11.11**（消息搜索按子 Tab 作用域）。

| # | 事项 | 结论（已拍板） | 落地 |
|---|---|---|---|
| 11.1 | 转办选人数据来源 | ✅ **本轮降级为「输入工号/用户 ID」**：不新增候选接口、不给审批角色开放用户管理权限（`GET /api/v1/users` 绑系统管理菜单 201，审批人无权限）。抽屉内「转办」弹轻量输入（`newAssigneeId` 必填、`newAssigneeName` 可选），走既有 `POST /api/v1/tasks/{id}/transfer`。完整选人器列入后续迭代 | §2.2 |
| 11.2 | 抽屉宽度 | ✅ 采纳 **`max-w-[560px]`** | §2.4 |
| 11.3 | 流程通知抽屉内容 | ✅ 仅「**表单内容 + 回复区**」，**不叠加**审批进度/审批信息 | §2.3 |
| 11.4 | `canReply` 口径 | ✅ 维持 **`msgType=='NOTIFY' && instanceId!=null`** | §3.3 / §4.3 |
| 11.5 | Q4/Q5（六类/四类计数徽标、未读红点规则） | ✅ 本轮 **不做**（PR-14/PR-16 缓） | — |
| 11.6 | 历史 APPROVAL 消息 `instance_id` 回填 | ✅ **不做**（P2，脏 JSON 低价值） | §3.3 步骤 5 确认「默认不做」 |
| 11.7 | 抽屉内「在完整页打开」入口（PR-11） | ✅ **保留，纳入 T03**（抽屉底部跳 `/task/process/{instanceId}`） | §8 T03 |
| 11.8 | 门户搜索触发语义 | ✅ **显式查询**：输入框 + 「搜索」按钮（回车亦可），仅点搜索/回车才发请求、发起时重置到第 1 页，另设「重置」；**不采用 300ms 防抖**（对齐用户 `e1f8632` 管理页） | §1.5 / §8 T03 / §10-3 |
| 11.9 | keyword 的 JPQL 写法 | ✅ **Service 层预算 `:pattern`（已小写）、JPQL 仅 `like :pattern`、`:keyword` 仅判空**；**红线：禁止 `lower(concat('%', :keyword, '%'))`**（Hibernate 6 `bytea` 崩，T02 已修） | §1.5 / §10-15 |
| 11.10 | 门户 vs 管理页分类筛选 | ✅ 管理页支持「选父含子集」（调用方把勾选 id 展开为自身+子孙再传入，见 `fetchDefinitions` 注释）；**门户待办页无分类树、不涉及**；两处无需、也不应为「对齐」互相改动 | §1.5 |
| 11.11 | 消息中心搜索作用域（v1.3） | ✅ **按子 Tab 的 `msgType` 作用域**，各子 Tab 内独立搜索、不做跨类型/跨 Tab 全局（PRD D-5/Q3）；后端 `/messages/search` 新增可选 `msgType`；**红线（「锚定」口径）：绑定参数须至少一处被 `=`/`CAST` 锚定**——`findInbox` 因 `=` 锚定合规勿动，`searchInboxByType` 用无条件等值仅为更清晰 | §3.5 / §8 T04 / §10-16 |

> 无残留待决项。如后续需要 PR-14/PR-16（11.5）或历史数据回填（11.6），属新一轮增量，不在本轮范围。
