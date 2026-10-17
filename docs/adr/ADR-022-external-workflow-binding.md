# ADR-022: 表单外部工作流绑定 — 运行时与本地蓝图分离

## 状态

**已采纳（决策已定；Phase A 实施中）** | 2026-10-16 · r3 修订（2026-10-16）

> 状态字段说明（QA S7）：此前正文写「提议中」，但 19§9 Phase A 已勾选「[x] 规划文档 + ADR-022」与「[x] 架构核实完成」⇒ 状态自相矛盾。**本决策已作出且不推翻**（21 报告 §8 结论：「架构决策本身 PASS，成立，不推翻」），故改为「已采纳」。
> ⚠️ **措辞澄清（QA r2N6-2）**：**不是「Phase A 定稿」** —— 实测 19§9 Phase A 中 V153/V154、甲方前置、**产品拍板 P-1/P-2** 仍是未勾选 `[ ]`，只有文档类条目是 `[x]`。故措辞为「决策已定；Phase A 实施中」，避免被误读为「Phase A 已完成」。
> r2/r3 补充：并入产品决策 **D5（外部撤销按 `TERMINATED` 处理，界面不提供撤销入口）**、架构决定 **D6（新增 `form_record.status='TERMINATED'`）**、QA 复审 **N1~N5** 定点修补。

## 背景

本地表单已支持 `form_record` + LOCAL 流程（保存 → 发起 → 撤回再发）。Flyway `V149` 预留了 `EXTERNAL` 绑定，但约束为与 `LOCAL` **互斥**，且无外部引擎运行时。

产品目标：表单配置时可选择**内部审批流定义**与**外部工作流（致远等）**；真正审批在外部执行；内部定义提供节点顺序与人员蓝图，用于在外部系统动态拼装自由流节点。注入形态支持 JSON、富文本 HTML、长期 iframe URL。

若继续沿用 V149「LOCAL XOR EXTERNAL」，无法表达「外部跑、内部仅蓝图」。

详细能力、致远发起序列、状态对照与分期见：

[`docs/architecture/msg-log-workflow/19-external-workflow-integration-plan.md`](../architecture/msg-log-workflow/19-external-workflow-integration-plan.md)

## 决策

### 1. 运行时与蓝图分离

| 概念 | 取值 | 含义 |
|------|------|------|
| `workflow_runtime` | `NONE` / `LOCAL` / `EXTERNAL` | **唯一**真正执行审批的引擎 |
| `design_template`（本地 `wf_definition`） | EXTERNAL 时**必填** | 仅设计时蓝图：节点顺序、审批/抄送、候选人展开 |
| `inject_mode` | `FORM_JSON` / `RICH_HTML` / `EMBED_URL` | 发起时注入外部的形态 |

- `runtime=LOCAL`：行为保持现有自研/本地流程，不调外部。
- `runtime=EXTERNAL`：**完全不创建**本地审批待办（`sys_task`）。可存外部 `caseId` 与进度镜像，不得因此生成待办或进入本地收件箱待办。
- **禁止**同一单据双引擎双待办。

### 2. 相对 V149 的演进

- 废弃「EXTERNAL 时 `workflow_definition_id` 必须为空」的互斥语义。
- EXTERNAL 运行时允许同时持有：
  - `workflow_definition_id`（蓝图）
  - `external_workflow_system` + `external_workflow_ref`（外部模板）
  - `inject_mode`（及 URL 模式的 `embed_token`）
- 实现时以新 Flyway **追加**调整 CHECK / 列，不改已发布 V149 脚本正文。

### 3. P0 外部系统与发起约束

- P0 仅 **致远 Seeyon A8+ 集团版 V9**。
- 蓝图映射 P0 **放开同节点多人**（`freeReplaceNode` 的 `data.userId` 是数组，✅ 确证），但**不承诺会签语义**（会签由外部模板节点属性决定，平台不可控），UI 不暴露会签/或签选择。
- 🔴 **蓝图节点数 ≤ 外部模板槽位数**（硬约束）：`freeReplaceNode` 语义是「**替换**流程节点…立即生效」，参数为 `activityId`（要替换的节点）⇒ 外部模板必须**预置 N 个槽位**，由甲方在致远侧配置；超出则**直接拒绝提交**，不是「追加第 N+1 个」。蓝图「N 级审批」由「动态长度」降级为「**动态人员 + 固定槽位**」。
- 发起序列（摘要）：人员预解析（含发起人）→ `start` 得 `caseId`（**发起人 = 其外部 accountId**，使其在外部已发列表可直接打开）→ 逐槽位 `freeReplaceNode` →（仅 `DRAFT_THEN_SEND` 时）离开待发 → 本地存映射；已有映射则续拼/补启动/只同步。不以集成服务账号冒充发起人，也不只用抄送代替发起人身份。
- `draft_mode` **默认 `DIRECT_SEND`**（✅ 确证可行）；`DRAFT_THEN_SEND` 依赖尚未确认的「送出待发」API（阻塞 C-1），确认后才可切换。
- 拼节点失败：`build_phase=FAILED` + 记 `build_error`，**保留 caseId**；提供「**废弃并重建**」（置 `ext_status='ABANDONED'` 让出唯一索引槽位）。**断点续拼为 P0**（`assigned_slots` JSONB）。
- 再发起：`APPROVED` / `REJECTED` / `TERMINATED` 均为本单终态，不可在同一 `form_record` 上再提；要重走外部流程须新建单据。

### 4. 状态与后置

- 外部镜像**外部业务态5 个**：`NOT_STARTED` / `RUNNING` / `COMPLETED` / `REJECTED` / `TERMINATED`；另有**本地处置态 1 个**：`ABANDONED`（**非外部状态**，不参与 `status_mapping`，不映射 `form_record`）。
- 与 `form_record`：`SAVED`↔可提交/无映射；`IN_PROCESS`↔`RUNNING`；`APPROVED`↔`COMPLETED`（终态）；`REJECTED`↔`REJECTED`（终态）；**`TERMINATED`↔`TERMINATED`（终态，🆕 见下）**。
- **外部驳回**：`form_record=REJECTED` 且外部镜像 `REJECTED`，均为终态；不回 `SAVED`，同一单据不可再提。
- 🔴 **撤销与终止合并为 `TERMINATED`**：终止（`affair/stop`）与**撤销**（`affair/cancel`）在本地**统一映射 `TERMINATED`**，且 `form_record=TERMINATED`；**不写成驳回**、**不回 `SAVED`**。**EXTERNAL 界面不提供撤销入口，平台不做撤销按钮**（产品决策 D5，详见 §5a）。
- 🔴 **终态单调性（硬约束）**：`ext_status` 迁移只允许 `NOT_STARTED → RUNNING → {COMPLETED | REJECTED | TERMINATED}` 与 `NOT_STARTED → ABANDONED`；**任何终态不可被后续轮询/回调改回 `RUNNING`**，违反则记 `sync_error` + 告警、不落库。
- 终态后置任务与轮询/回调并存时必须**幂等**，且**幂等须同时挡住「重复」与「丢失」**：终态事件统一落 `ext_terminal_event` 收件表（`UNIQUE (tenant_id, external_system, external_case_id, terminal_status)`，轮询与回调走 `INSERT ... ON CONFLICT DO NOTHING RETURNING id`），**收件行与 `biz_execution_task` 投递在同一事务内**（已核实两表同库）⇒ 原子性保证「要么全成、要么全败」，**丢失型缺陷被彻底消除，不需要补偿重投Job**。**丢失型缺陷（投递前崩溃 ⇒ 单据永久卡住且静默无告警）比重复型更难发现**，因此设计时须显式确认「哪个机制保证不丢」——本决策的答案是「单事务原子性」。
- 通过才触发「审批通过」后置任务；驳回**不**触发通过后置任务；终止/撤销同样不触发。
- 🔴 **外部流程「是否已真实发出」是唯一索引的让位判据**：谓词按 `external_sent`（`start` 返回 `caseId` 时置 1）判断，**不看 `build_phase`** —— 因为默认的 `DIRECT_SEND` 下外部流程在 `build_phase` 仍是 `DRAFTED` 时就已真实发出；若按 `build_phase` 让位会导致「构建失败自动让槽 → 用户重提→ 致远出现第二个流程」，第一个成为孤儿。
- 🔴 **周期性动作不得复用 `biz_exec_lock`**：该组件（`DistributedLockService`）经实测语义为**一次性幂等账本**（成功后写 `SUCCESS`，后续见到 `SUCCESS` 直接返回不执行，且 `SUCCESS` 行无生产代码清除）⇒ 用于轮询会导致**每个实例只被轮询一次、外部状态永久冻结**，从而**外部撤销永不识别为 `TERMINATED`**、直接击穿 D5。轮询的正确做法是 `FOR UPDATE SKIP LOCKED` 领取式认领。

### 5. 界面

- EXTERNAL 套壳：隐藏本地图形化进度；展示**外部状态摘要 + 当前处理人**；发起人提交防抖自检。
- 🟡 **审批意见为降级承诺**（不是 P0 承诺）：致远 REST 25 接口与 V8 OpenAPI **均无意见/轨迹查询接口**（阻塞 C-2）⇒ P0 展示「在致远中查看」**深链**（`URLLINK` ✅ 确证存在）；`capabilities` 无 `QUERY_OPINIONS` 时**直接隐藏意见区**，不做「显示空列表」的自欺实现。**意见查询实现不属于 P0 范围。**
- 🔴 **不提供「撤销」按钮**：EXTERNAL 单据在本地界面**只有终止**一个终态动作（产品决策 D5）。
- 提供「外部发起流程管理」列表（时段、状态等筛选）。

### 5a. 🔴 决策 D5：为什么外部撤销**不**沿用 LOCAL 的语义（主动取舍）

**背景**：内部工作流系统（LOCAL）撤销后**可再次发起**，驳回则不可。产品明确决定**这个语义不推广到外部系统**。

| 外部动作 | `ext_status` | `form_record` | 能否再提 |
|---------|-------------|-------------|---------|
| 驳回（审批人不同意） | `REJECTED` | `REJECTED` | ❌ |
| **撤销（`affair/cancel`，外部侧发生）** | **`TERMINATED`** | **`TERMINATED`** | ❌ |
| 终止（`affair/stop`） | `TERMINATED` | `TERMINATED` | ❌ |

**三条硬约束**：

1. 🔴 **外部工作流在界面上不提供「撤销」操作** —— 用户只能对 EXTERNAL 单据执行**终止**。**平台自身不做撤销按钮**，Adapter 亦不提供 `revoke` 方法。
2. 🔴 **外部侧发生的撤销，同步到本地一律按 `TERMINATED` 处理**，不得因其语义接近「撤回」而映射为可再提。
3. ✅ **撤销与终止在 EXTERNAL 下保持合并为 `TERMINATED`**；**不新增 `CANCELLED` 状态**；**`form_record` 不因撤销而加任何额外列/状态**（只新增与终止共用的 `TERMINATED`）。

**理由（主动取舍，须写进实现说明，防后续开发「顺手对齐」）**：

- **LOCAL 的撤销前置校验严格且已固化**：实测 `ProcessService.java:447-463` —— 仅 `RUNNING` + **本人** + **尚无任何人审批通过**（`hasApproveHistory` 判 `WfHistory.OP_APPROVE`）三项全满足才允许。语义明确、权限清晰，因此允许「撤销后再发起」是安全的。
- **EXTERNAL 的撤销在外部侧难以可靠判定**：撤销**发生在致远那边**，平台是观察者。「谁有权撤？审批后能否撤？前置条件是否与本地等价？」—— **均无法确认**。
- **避免悬空态**：若平台暴露撤销入口而外部拒绝，用户会遇到「本地允许撤销但外部拒绝」的中间态，单据卡在无明确出路的中间态。
- ⇒ **产品主动牺牲 LOCAL/EXTERNAL 语义一致性**，换取**实现简单、行为可预测**。**这是取舍，不是遗漏。**

**落地后果**：`TERMINATED` 一旦写入，该 `form_record` **只读且不可再提**（须新建单据）。已核实这**无需改动任何既有判定** —— `FormRecordService.requireMineEditable():164-167` 与 `toVo():179-181` 的白名单均为 `{SAVED, REJECTED}`，`TERMINATED` 天然落在其外 ⇒ `canEdit=false` / `canStart=false` / 编辑被拒**自动成立**。

**顺带收益**：因为撤销与终止在本地**合并为同一个值**，即使外部状态枚举**无法区分**二者（阻塞 C-13），**映射结果也完全相同** ⇒ 该不确定性**不影响正确性**。这是一个把「依赖外部枚举可区分性」的风险，转成「无论能否区分都成立」的不变式。

> 🔴 **但这个不变式会被「实现走样」击穿** —— 若轮询被误实现为「只跑一次」，则外部撤销**永远不会被观察到**，D5 事实上失效。因此 §4 的「周期性动作禁用 `biz_exec_lock`」不是实现细节，而是**D5 的成立前提**。
>
> **方法论教训（r3 新增，适用于所有后续设计）**：**凡引用仓库既有组件作为方案基石，必须同时核对其「语义」与「生命周期」，不能只引用其「存在性」。** 本轮三处踩坑均为「组件确实存在、注释看起来对，但语义与方案假设不符」：
>
> | 组件 | 原先的错误假设 | 实际语义 | 若不修正的后果 |
> |------|--------------|---------|-------------|
> | `biz_exec_lock` / `DistributedLockService` | 互斥量 | **一次性幂等账本**，`SUCCESS` 行永不清理 | 轮询只跑一次 ⇒ 状态冻结 ⇒ **击穿 D5** |
> | `syncFormRecordStatus()` | 通用状态同步 | **仅 LOCAL 路径**调用，会置 `SAVED`/`APPROVED` | EXTERNAL 复用会把 `TERMINATED` 单据误置 `SAVED` ⇒ 绕过「不可再提」 |
> | `hasApproveHistory()` | 通用「是否已审批」判定 | 依赖 `current_instance_id`，EXTERNAL 下恒 null ⇒ 恒 false | 结果恰好正确，但**理由是字段为空而非校验生效**；一旦有人为 EXTERNAL 补写该字段，保护静默失效 |

## 备选方案

| 方案 | 结论 |
|------|------|
| A. 保持 V149 互斥，EXTERNAL 不引用本地定义，节点在外部模板写死 | 否：无法按表单蓝图动态拼人 |
| B. LOCAL 与 EXTERNAL 双跑 | 否：双待办、状态难对齐 |
| C. 运行时 EXTERNAL + 本地蓝图（本决策） | 采用 |

## 后果

### 正面

- 配置心智清晰：内部画链、外部执行。
- 与现有流程设计器资产复用（节点/人）。
- 为多外部系统 Adapter 留扩展点。

### 负面 / 成本

- 需迁移调整 V149 互斥约束与 FormDefinition / 管理 UI。
- 🔴 **实测：`FormDefinition` 实体至今未映射 V149 的任何一列**（含LOCAL 的 `workflow_definition_id`）⇒ **LOCAL 绑定链路当前也是断的**，需新增 9 个字段映射 + 读写路径（工作量 **L**）。
- 依赖致远「离开开始节点」等 API 细节澄清后方可编码闭环。
- EMBED_URL 长期链接带来额外安全设计成本（吊销字段、CSP/frame 祖先配置、跨站鉴权可行性未验证）。
- 🔴 **LOCAL 与 EXTERNAL 的撤销/再发起语义不一致**（LOCAL 可撤销后再发起，EXTERNAL 不可）—— **产品主动取舍**，换取行为可预测。**这是成本，不是缺陷**；任何「顺手对齐」的改动都需重新走产品决策。

## 待确认

见规划文档 §10 / §10.1。

**产品已定**：外部驳回 = `REJECTED` 终态；EXTERNAL 完全取消本地待办；抄送缺人警告可提交；保存不自动发起，「提交」才走外部发起序列；**🆕 外部撤销按 `TERMINATED` 处理且界面不提供撤销入口（D5）**。

**🟡 待产品确认（架构未自行决定）**：

| # | 待确认 | 影响 |
|---|--------|------|
| **P-1** | `ABANDONED`（「废弃并重建」）是否与「同一单据不可再提交」边界冲突 | 它允许构建失败的 `form_record` **重建**；与 D1 禁止 `REJECTED` 重提的边界须产品明确 |
| **P-2** | `EMBED_URL` 跨站 iframe 鉴权可行性（C-12） | 若登录态（`SameSite=Lax` 默认拦 Cookie）与签名皆不可行，`EMBED_URL` 须从 P0 降级为 P1 |

## 已核实结论（2026-10-16 · Architect）

> 核实范围：致远 **V5 REST APIdoc**（open.seeyon.com）、**V8 OpenAPI**（open.seeyoncloud.com）、V8 SP1 产品手册。**未接触企业版现场环境**。
> 完整证据与对照明细见 [19 §10.1](../architecture/msg-log-workflow/19-external-workflow-integration-plan.md) 与 [20 Adapter 契约](../architecture/msg-log-workflow/20-external-workflow-adapter-contract.md)。

| 核实项 | 结论 | 等级 |
|--------|------|------|
| 离开开始节点 | `POST /seeyon/rest/bpm/process/start` 的 `data.draft`：`1`=保存待发 / `0`=新建-发送。**「不落开始节点」成立** | ✅ 确证 |
| 送出待发接口 | REST 25 个接口中**无独立章节**；V8 `/bpm/case/send` 支持 `data.caseId` 但语义未明示 | 🟡 推断 |
| 发起人显式传参 | V5 `senderLoginName` ✅；V8 `data.userCode`（必填）✅ | ✅ 确证 |
| 进「已发/我发起的」 | 推断：creator 归属正确即在已发列表；抄送只进待阅 | 🟡 推断 |
| 同节点多人 | `freeReplaceNode` 的 `data.userId` 为**数组**，支持多人 | ✅ 确证 |
| 会签语义 | 由模板节点 nodePolicy 决定，`freeReplaceNode` 只填人 → 平台不可控 | 🟡 推断 |

### 对本决策的影响

1. **§3「蓝图映射 P0 仅串行节点」需放宽**：多人已确证支持，改为「蓝图放开多人，但**不承诺会签语义**，UI 不暴露会签/或签选择」。
2. 🔴 **新发现硬约束（决策 §2 的补充）**：`freeReplaceNode` 官方语义是「**替换**流程节点…立即生效」，参数为 `activityId`（要替换的节点），**不是追加节点**。因此：
   - 外部模板必须**预置 N 个槽位**（处理人留空/占位），由甲方在致远侧配置；
   - 本地蓝图节点数 **≤ 槽位数**，超出**直接拒绝提交**（原「再追加第 N+1 个」不成立）；
   - `form_definition` 需新增 `external_node_slots` JSONB 登记槽位 `activityId` 列表；
   - 「N 级审批蓝图」由「动态长度」降级为「**动态人员 + 固定槽位**」。
3. **发起人身份从「待确认」升为「契约强制」**：Adapter `start()` 必须有 `initiatorRef` 显式参数，禁止隐式取 token 主体；若目标版本只认 token 主体，则退化为「以发起人身份换取 token」。
4. **建议改走 V8 OpenAPI**：`/bpm/case/send` 同时提供 ① 显式 `userCode` 发起人 ② `requestId` + `commandId` 幂等键 ③ `notifyUrl` 异步回调（直接落地 §4 的回调需求）。前提是甲方完成「启用 API + 接入应用 + IP 白名单」。
5. 🆕 **r2：`command_id` 的生成规则必须「对同一次业务发起稳定不变」** —— 它同时是本地幂等唯一索引与 V8 `data.commandId`；若含时间戳，**两个幂等机制会同时失效**。

### 仍然阻塞（须联调/甲方确认）

| # | 阻塞项 | 影响 |
|---|--------|------|
| C-1 | 送出待发 API | §3 序列步骤「activate」；回退 `draft_mode=DIRECT_SEND` |
| C-2 | 审批意见/轨迹查询接口（REST 与 OpenAPI **均无**） | 界面意见区降级为深链跳转致远 |
| **C-3** | **外部模板槽位 `activityId` 清单** | **最高优先级：未解决则蓝图无法映射，Phase B 不得开工** |
| C-4 | 人员手机号字段（未见 `mobile`，仅 `telNumber`/`properties.telnumber`） | 账号解析可能全失败 |
| C-5 | `bpm/process/start` 的发起人来源 | 决定是否需换取发起人 token |
| C-6 | `/flow/state/{flowId}` 状态枚举（官方映射表为图片未抓到） | 🔴 状态误判会提前触发后置任务。**已提升为 Gate-1**（原 Phase E 才验，顺序倒置）；缓解 = `status_mapping` **启动 fail-fast** + **终态单调性** |
| C-7 | 现场版本（V7/V8/V9）与 API 授权 | 决定 V5 REST 还是 V8 OpenAPI |
| **C-12** 🆕 | **`EMBED_URL` 跨站 iframe 鉴权可行性** | 🔴 第三方 Cookie 被 `SameSite=Lax` 默认拦截；两条鉴权路径皆未验证 ⇒ 可能让整个 `EMBED_URL` 模式不成立。**Gate-1；待产品确认 P-2** |
| **C-13** 🆕 | **撤销 vs 终止的可判定性** | 🟡 **不影响正确性** —— 因 D5「统一映射 `TERMINATED`」，无论外部枚举能否区分，结果相同。**但 `status_mapping` 必须覆盖全部候选值**（`cancel=2`/`terminate=1`/`5`/`15`），漏配 ⇒ 撤销单据永久停在 `RUNNING` |

**结论**：本决策（运行时与蓝图分离）**成立且无需推翻**。但 §3 的「串行限制」与「自由流动态追加节点」两处已按上述结论修订正文。

## 修订记录

| 日期 | 说明 |
|------|------|
| 2026-10-16 | 首版提议 |
| 2026-10-16 | 补充：发起人身份必须写入外部流程 |
| 2026-10-16 | 已定：外部驳回 `REJECTED` 终态；EXTERNAL 不写本地待办 |
| 2026-10-16 | **补「已核实结论」**：三问收敛（确证/推断/未知分级）；修正 `freeReplaceNode` 为「替换预置节点」→新增槽位数硬约束；多人放开、会签不承诺；发起人升为契约强制；记录 C-1~C-7 阻塞项 |
| **2026-10-16 (r2)** | **🔴 状态字段改正文**：「提议中」→「**已采纳（Phase A 定稿）**」（此前与 19§9 Phase A 已勾选完成自相矛盾，QA S7） |
| **2026-10-16 (r2)** | **🔴 §3 正文修订**（不再只写在文末）：「仅串行节点」→「**放开多人 + 不承诺会签语义**」；补「**蓝图节点数 ≤ 模板槽位数**」硬约束；`draft_mode` 默认 `DIRECT_SEND`；断点续拼提 **P0** |
| **2026-10-16 (r2)** | **🆕 §5a 新增决策 D5**：外部撤销按 `TERMINATED` 处理、**界面不提供撤销入口**；含三条硬约束 + LOCAL/EXTERNAL 语义差异的主动取舍论证（引 `ProcessService.java:447-463` 实测） |
| **2026-10-16 (r2)** | **🆕 §4 补 `TERMINATED`（第六个 `form_record` 状态）** + `ABANDONED` 本地处置态 + **终态单调性硬约束** + **幂等须同时挡「重复」与「丢失」**（`ext_terminal_event` 收件表 + 同事务） |
| **2026-10-16 (r2)** | **§5 界面降级修订**：删除「展示外部意见」的 P0 承诺 ⇒ 改为「外部状态 + 当前处理人 + **深链跳转致远**；无 `QUERY_OPINIONS` 能力则隐藏意见区」（C-2）。**§4 补 `REJECTED`**（此前四态表述漏项，QA S4） |
| **2026-10-16 (r2)** | **🟡 保留两项待产品确认**：**P-1** `ABANDONED` 与「不可再提交」的边界；**P-2** `EMBED_URL` 跨站鉴权可行性（C-12，Gate-1）。新增 **C-13**（撤销可判定性，不阻塞开工）；**C-6 提升为 Gate-1** |
| **2026-10-16 (r3)** | **🔴 §4 幂等设计修正（N3）**：**删除补偿重投 Job** —— 收件行与 `biz_execution_task` 投递**同事务**即彻底消除丢失型（原设计「置 `DONE` 同事务 ⇒ 补偿是死代码 / 异事务 ⇒ 丢失窗口重现」两难，且原论证所称的「`enqueue` 查重」经实测**不存在**：`enqueue():64-81` 无条件 save、`biz_execution_task` 无唯一约束）。`process_state` 降为两值 |
| **2026-10-16 (r3)** | **🔴 §4 新增两条硬约束**：**① 唯一索引按 `external_sent`（外部是否已真实发出）让位，而非 `build_phase`**（N1：`DIRECT_SEND` 下外部在 `build_phase` 仍是 `DRAFTED` 时就已发出，按 `build_phase` 让位会产生**致远第二个流程** + 第一个成孤儿，并连带废掉 P0 的断点续拼与废弃重建）；**② 周期性动作禁用 `biz_exec_lock`**（N2：其实为**一次性幂等账本**，`SUCCESS` 行无生产代码清除 ⇒ 轮询会**状态永久冻结** ⇒ 外部撤销永不识别为 `TERMINATED` ⇒ **直接击穿 D5**）。正解 `FOR UPDATE SKIP LOCKED` |
| **2026-10-16 (r3)** | **🟢 §5a 追加方法论教训**：**凡引用仓库既有组件作为方案基石，必须核对其「语义」与「生命周期」，不能只引用「存在性」** —— 本轮三处同类踩坑：`biz_exec_lock` 当互斥量用（→ 击穿 D5）、`syncFormRecordStatus` 当通用状态同步用（→ 会把 `TERMINATED` 单据误置 `SAVED`，绕过「不可再提」）、`hasApproveHistory` 在 `current_instance_id` 为空时恒返回 false（结果恰好正确但**理由是字段为空而非校验生效**） |
