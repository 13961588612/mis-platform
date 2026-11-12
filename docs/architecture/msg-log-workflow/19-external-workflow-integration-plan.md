# 19 · 本地表单对接外部工作流系统 — 规划

> **状态**: 📝 规划定稿（待实现）· 已并入产品决策 D5（外部撤销按 `TERMINATED`，界面不提供撤销入口）· **r4：吸收 QA R3 回归 D1~D4 + 补充 a/b**
> **日期**: 2026-10-16（修订 r3）  
> **关联决策**: [ADR-022](../../adr/ADR-022-external-workflow-binding.md)  
> **现状锚点**: Flyway `V149`（EXTERNAL 仅落库）、`V150`（form_record）、ProcessShell、LOCAL 撤回再发
> **审查结论**: 见 [21-external-workflow-review.md](./21-external-workflow-review.md)（r1，QA 实测）+ [22-external-workflow-review-r2.md](./22-external-workflow-review-r2.md)（r2 复审 **PASS_WITH_ISSUES**，已吸收 N1~N6）

---

## 0. 产品决策台账（🟢 已拍板 / 🟡 待产品确认）

> 本节是**跨文档唯一决策源**。19/20/ADR-022 三份文档的表述冲突时以本节为准。

### 0.1 🟢 已拍板

| # | 决策 | 拍板方 | 落点 |
|---|------|--------|------|
| D1 | 外部驳回 → `form_record=REJECTED` + `ext_status=REJECTED`，**终态**，不回 `SAVED`，同单不可再提 | 产品 | §5.2 / §6.3 |
| D2 | EXTERNAL **完全不产生本地待办**（不写 `sys_task`） | 产品 | §5.3 |
| D3 | 保存不自动发起；发起人点「提交」才走外部发起序列 | 产品 | §4 / §6.1 |
| D4 | 抄送缺人警告可提交；审批缺人、发起人缺号禁止提交 | 产品 | §4 |
| **D5** | **🔴 外部撤销语义不推广到外部系统**：`affair/cancel`（外部侧撤销）同步回本地**一律按 `TERMINATED` 处理**；**EXTERNAL 界面不提供「撤销」入口，只提供「终止」**；不新增 `CANCELLED` 状态 | **产品（本轮）** | **§5.1 / §5.2 / §6.3** |
| **D6** | **`form_record.status` 新增 `TERMINATED`**（架构提案，已核实无 CHECK 约束，采纳） | 架构（产品未反对） | **§5.2 / §9 任务 A3'** |
| **D7** | **EXTERNAL 一律「同单不可再提」**；驳回 / 终止 / 废弃重建 **统一**为：**新建 `form_record`，复制原单字段内容，再发起新外部流程**（旧单只读；废弃时旧外部实例仍走 `ABANDONED` + `stop` 清孤儿） | **产品（2026-10-24）** | **§6.3 / §6.4；关闭 P-1** |

### 0.2 🟡 待产品确认（**架构不得自行决定**）

| # | 待确认项 | 背景 | 若不确认的后果 |
|---|---------|------|--------------|
| **P-1** | ~~B3 `ABANDONED` 与「同单不可再提」边界~~ | ✅ **已关闭 → D7**：不区分驳回 vs 构建失败，**均不可在同一 `form_record` 上再提**；统一「复制新建」 | — |
| **P-2** | **`EMBED_URL` 跨站鉴权可行性（C-12）** | embed 页在致域名 `<iframe>` 内加载 ⇒ 第三方 Cookie 场景，现代浏览器 `SameSite=Lax` 默认拦截；签名方案则需 `expires` + HMAC 字段（DDL 已预留） | 若两者皆不可行，`EMBED_URL`（`INJECT_MODE` 第三种形态，工作量 **L**）须从 **P0 降级为 P1**，不能让它建在未验证前提上 |

> ⚠️ **本轮修订明确标注**：D5 是产品主动取舍（牺牲 LOCAL/EXTERNAL 语义一致性），**任何人不得以「顺手对齐」为由推翻**。**P-1 已由 D7 关闭**；P-2 仍开放，架构未自行决定。

---

## 1. 目标与范围

### 1.1 目标

本地表单在保存业务数据后，可对接**外部工作流引擎**完成审批；本系统负责：

1. 发起外部流程（含发起人与节点人员预解析、节点动态拼装）；**发起人身份写入外部系统**，使其在外部「已发 / 我发起的」中可直接打开
2. 查询 / 定时拉取进度与**外部状态 + 当前处理人**（🟡 **审批意见为降级承诺**：C-2 结论是两套 API **均无意见查询接口**，故 P0 展示深链跳转致远，见 [20 §5 C-2](./20-external-workflow-adapter-contract.md)）
3. 接收回调并幂等触发「审批结束后置任务」
4. 套壳页只读浏览 + 发起人提交自检
5. 外部发起流程管理台

P0 外部系统：**致远 Seeyon A8+ 集团版 V9**。

### 1.2 非目标（P0）

- 附件注入外部流程
- 并行网关 / 条件分支直接映射到致远自由流
- 本地审批引擎与外部引擎**双跑**（禁止双待办）
- 外部发起人非本系统用户

### 1.3 与现状差异（必读）

| 点 | 现状（V149） | 本规划 |
|----|--------------|--------|
| 绑定 | `NONE` / `LOCAL` / `EXTERNAL` **互斥** | **运行时**三选一；EXTERNAL 时另绑 **LOCAL 蓝图** |
| 内部流 | 运行时引擎 | EXTERNAL 模式下仅作**设计时节点蓝图** |
| EXTERNAL 运行时 | 无适配器 | 致远 Adapter + 镜像表 |
| ProcessShell 图形进度 | LOCAL 展示 | EXTERNAL 模式**隐藏**，改展示外部意见摘要 |

---

## 2. 外部工作流能力模型

### 2.1 发起 — 注入类型（表单级三选一）

| 代码 | 名称 | 注入内容 | 说明 |
|------|------|----------|------|
| `FORM_JSON` | 表单流程 | 结构化 JSON | 字段映射到外部模板；P0 无附件 |
| `RICH_HTML` | 富文本流程 | 受控 HTML 字符串 | 独立清洗模块，勿与消息 HTML 混用同一入口 |
| `EMBED_URL` | URL 内嵌 | 长期可用的本地套壳 URL | 外部 iframe 打开本表单只读页 |

`EMBED_URL` 安全要求：

- 每个表单一个高熵随机串（防碰撞 / 防枚举）
- URL 绑定 `tenant_id` + `form_code`（及打开时的 `form_record_id`）
- 必须鉴权（登录态或签名）；随机串 alone ≠ 授权
- 支持吊销（表单停用 / token 轮换）
- CSP / Frame 祖先仅放行致远域名

### 2.2 发起 — 通用动作

1. 校验绑定与 `inject_mode`
2. 采集节点蓝图 + 人员手机号（审批 / 抄送），并带上**发起人**手机号
3. **预解析** → 外部 `accountId`；按规则阻断或警告。发起人必须解析成功，并作为外部流程的**起草人 / 发起人**传入，不以集成服务账号代替
4. **幂等**：查本地是否已有有效外部实例映射
5. 无映射 → 创建并拼节点 →（必要时）启动离开开始节点  
   有映射 → 未启动则启动；已启动则只同步
6. 落本地镜像；状态变化可发消息

### 2.3 查询 / 拉取

统一拉取：实例状态、当前节点、历史意见、处理人、时间。  
映射到本地四态（见 §5）。途径：定时 Job、打开单据强制 sync、管理台手工重同步。

### 2.4 回调

外部终态（通过 / 驳回 / 终止）→ 本系统**幂等**执行后置任务（对齐现有 Outbox / `biz_execution_task`）。  
幂等键建议：`tenant_id + external_system + external_case_id`（**不要**再拼 `terminal_status`）。  
理由：§5.1 终态单调 ⇒ 同一 `caseId` 只应有一个业务终态；键里带 `terminal_status` 时，若映射抖动先错写 `COMPLETED` 再来 `REJECTED`，会插进两行、后置任务跑两次。`terminal_status` 仍作为收件表**普通列**落库备查。

### 2.5 其他能力

| 能力 | 说明 |
|------|------|
| 系统连接配置 | 租户级 base_url、认证、超时、启停；密钥不进明文库 |
| 补偿 | 拼节点中途失败、创建成功未推进 |
| 管理台 | 外部发起单据列表与筛选 |
| 审计 | 每次对外 API、预解析失败明细 |

---

## 3. 绑定与数据模型（规划）

### 3.1 产品语义（ADR-022）

```
workflow_runtime   = NONE | LOCAL | EXTERNAL   -- 真正跑审批的引擎
design_template_id = 可选；runtime=EXTERNAL 时必填（指向本地 wf_definition）
inject_mode        = FORM_JSON | RICH_HTML | EMBED_URL
external_system    = e.g. SEYON_A8_V9
external_template  = 致远模板代码 / ID
embed_token        = 表单级长随机串（仅 EMBED_URL）
```

含义：**审批只在外部跑；内部流程定义只提供节点蓝图。**

相对 V149 CHECK 的演进：允许 `EXTERNAL` 同时持有 `workflow_definition_id`（蓝图），不再要求外部字段与本地定义互斥为空。

### 3.2 逻辑表（实现时落 Flyway，名称可微调）

**外部系统**

| 字段 | 说明 |
|------|------|
| code | `SEYON_A8_V9` |
| name / base_url / auth_ref / status | 连接与启停 |
| capabilities | JSON：start、freeReplaceNode、query、activate、callback |

**表单绑定（扩展 form_definition）**

| 字段 | 说明 |
|------|------|
| workflow_runtime | NONE / LOCAL / EXTERNAL |
| workflow_definition_id | LOCAL 运行时 或 EXTERNAL 蓝图 |
| external_workflow_system | 系统 code |
| external_workflow_ref | 模板 code/id |
| inject_mode | 见上 |
| embed_token | URL 模式 |

**外部流程实例镜像**

| 字段 | 说明 |
|------|------|
| form_record_id | 业务单据 |
| external_system / external_case_id | 远端实例 |
| ext_status | 见 §5 |
| build_phase / build_error | 拼节点进度与失败原因 |
| started_at / ended_at / last_sync_at | 时间 |
| opinions_snapshot | 审批意见镜像（JSON）。🟡 **P0 恒为 NULL**：C-2 已确认致远 REST 25 接口与 V8 OpenAPI **均无意见/轨迹查询接口**。保留列是为 C-2 候选④（只读库查 `ctp_opinion`，**需甲方书面批准 + 独立只读账号**）落地时不用再改表 |
| 唯一约束 | 同一 `form_record_id` 仅一条**有效**进行中实例（`uk_ext_inst_active`，见 20 §6.2） |

历史再发起：旧实例保留，新实例新建（与 LOCAL「再发=新实例」一致）。⚠️ **EXTERNAL 下"同单再发起"被 §6.3 收紧**——外部终态（含撤销同步而来的终止）一律不可再提，须新建单据。

### 3.3 适配器接口（本系统侧）

> ⚠️ **本节为概要签名**；权威契约、参数口径（`caseId` vs `affairId`）与优先级见 [20 §3.1](./20-external-workflow-adapter-contract.md)。

```
ExternalWorkflowAdapter
  resolveAccounts(phones) -> matches + failures
  start(template, payload, initiatorAccountId, draftMode) -> caseId
                                              // 发起人=该 accountId；draftMode 决定是否停在待发
  appendNode(caseId, nodeSpec)                // freeReplaceNode
  activate(caseId)                            // 仅 DRAFT_THEN_SEND 模式需要
  fetch(caseId) -> status + currentHandlers
                                              // 🟡 opinions 恒缺（C-2），不承诺返回意见
  terminate(caseId, affairId, operatorRef, reason)  // P0 —— 🔴 界面唯一暴露的终态动作
  // ❌ 不提供 revoke/cancel —— 见下方 D5
```

**🔴 关于 `revoke`（撤销）的契约决策（D5）**：Adapter **不提供** `revoke`/`cancel` 方法。致远侧确有 `POST /seeyon/rest/affair/cancel` 与 V8 `/bpm/case/cancel`（✅ 确证存在，见 20 §2），但：

1. **平台不主动调用** —— 界面不暴露撤销入口，无调用方；
2. **外部侧发生的撤销由轮询识别**，统一映射为 `TERMINATED`，不需要专门的 API 方法；
3. 因此**不写 `revoke` 方法**（避免开发看到签名就以为该做按钮）。若将来产品要放开撤销入口，须重新评估前置校验（见 §6.3 语义差异论证）。

---

## 4. 致远发起序列（P0 标准路径 · 已按文档核实修正）

> **架构修正（2026-10-16）** —— 详见 [20-adapter contract](./20-external-workflow-adapter-contract.md)
>
> 1. `data.draft=1` = 保存待发，**流程停在待发、不落开始节点** ✅ 规划「停在开始节点」成立
> 2. **`freeReplaceNode` 是「替换预置节点」而非「追加节点」** ✅。外部模板必须**预置 N 个槽位**；蓝图节点数 ≤ 槽位数，超出直接拒绝（不是追加第 N+1 个）
> 3. **C-1「送出待发」公开文档未证实**（2026-10-24）✅ 复核：V5 REST 仅有 `start` 的 `draft=0\|1`，**无**对已有 case 的送出接口 ⇒ **P0 锁定 `DIRECT_SEND`**；`DRAFT_THEN_SEND`/`activate` 仅现场沙箱翻案后按租户启用
> 3. 发起人**必须显式传** `userCode`（V8 OpenAPI ✅）/ `senderLoginName`（V5 REST ✅），不能只靠 token 主体

```
[无有效映射]
  1. 套壳采集：节点顺序、节点内人员、审批/抄送
     ★ 新增校验：蓝图槽位数 ≤ 外部模板槽位数（`external_node_slots`），超出禁止提交
  2. 预解析：手机号[]（含发起人）→ 批量组织 API → 外部人员标识
     - 发起人无账号 → 禁止提交（否则外部系统里没有「他发起的」入口）
     - 审批节点缺人 → 禁止提交，展示槽位/节点名/手机
     - 抄送缺人 → 可配置警告或禁止（默认警告可提交）
  3. 按 draft_mode 分支（★ 配置生效点在此步，见下方 I1 修正）
     ├─ 步骤 3-A【DRAFT_THEN_SEND】start(templateCode, initiatorRef, draft=1, payload) → caseId / processId
     │     ★ 流程停在「待发」，不进入第一级审批；外部发起人 / 起草人必须是 initiatorRef
     │     ★ 集成账号不得冒充发起人；仅把发起人做成抄送不够（抄送进「待阅」，进不了「已发」）
     │     ⚠️ 该模式依赖「送出待发」API（清单 C-1：公开文档未证实，2026-10-24）——**P0 禁止启用**；仅现场沙箱翻案后按租户开
     └─ 步骤 3-B【DIRECT_SEND · 默认 · P0 正路径】start(templateCode, initiatorRef, draft=0, payload) → caseId / processId
           ★ 流程直接发送；外部发起人同上；随后立即逐槽位填人
           ⚠️ 代价：首节点待办已生成但人员未替换，存在秒级竞态 → 模板首节点人员预置为发起人
  4. 逐槽位 assignNode(activityId_k, people_k)   k = 1..M（M ≤ N）
     - DIRECT_SEND 下本步紧接 3-B；DRAFT_THEN_SEND 下本步发生在「待发」态
     - 每步校验 code=0；失败 → build_phase=FAILED（记录 build_error），不继续
     - 未使用槽位（k > M）→ 填发起人本人，或按配置跳过（skip_unused_slots）
  5. 仅 DRAFT_THEN_SEND：activate(caseId) → 离开待发，进入第一级审批
     ★ DIRECT_SEND 下**本步骤不存在**（不是可选分支，是另一条序列）
  6. 落本地镜像 ext_process_instance；ext_status=NOT_STARTED → RUNNING；draft_flag 按 draft_mode 赋值（3-A 置 1，activate 后置 0；3-B 直接置 0）
  7. sync 最新状态

[已有映射 —— 按 external_sent × build_phase × draft_flag 分派]
  - 🔴 external_sent=1 且 build_phase=FAILED/ASSIGNING 且 assigned_slots 非空 → **断点续拼（P0）**：
      从已填槽位之后继续步骤 4。🔴 仅在唯一索引仍占用该行时可用（external_sent=1 恒占用），
      **不存在与「新建」并存的窗口**（这是 N1 修正的核心目的）
  - DRAFT_THEN_SEND 且 draft_flag=1 且槽位已配完 → activate + sync（步骤 5）
  - 🔴 external_sent=1 且无法续拼 → **必须显式「废弃并重建」**（置 ABANDONED + 调外部 stop 清理）
      ⛔ 不得直接新建：否则致远出现第二个流程
  - external_sent=0（start 未成功）→ 🔴 **不得直接新建**：先按 `command_id` 核对外部是否已存在流程
      （start 超时/网络中断时，致远可能已创建但本地没收到 caseId ⇒ 直接新建会产生孤儿，见 §4 缺口专项）
  - RUNNING → 仅 sync
  - ext_status ∈ {COMPLETED, REJECTED, TERMINATED, ABANDONED} → 只读，禁止再发起（见 §6.3）
```

**🔴 I1 修正（`draft_mode` 分支位置）**：`draft` 是**步骤 3** 的参数，原方案在**步骤 5** 才说「无 activate API 时按 `DIRECT_SEND` 回退」——配置生效点写在了错误的步骤。开发照原顺序实现会把两条**互斥**路径混进同一个状态机（DIRECT_SEND 下根本不存在「待发」态，步骤 5 的前提不成立）。现改为：分支上移到步骤 3，步骤 5 只在 `DRAFT_THEN_SEND` 下存在。

**默认值 = `DIRECT_SEND`**（20 §6.2 DDL 已同步）：`DRAFT_THEN_SEND` 依赖 C-1 这条**尚未确认可行**的路径，不能作为默认。`draft_flag SMALLINT DEFAULT 1` 在 DIRECT_SEND 下**必错**（无待发阶段），故 DDL 改为允许 NULL 并按 mode 赋值。⚠️ **但此默认值改动有连带影响 —— 见下方 N1 修正**（`DIRECT_SEND` 下「失败行可自动让槽」的假设不再成立）。

**防并发**：见 §8.3 冲突项 F-2（`form_record` 行必须 `FOR UPDATE`，**B6**：`FormRecordService.java:114` 是普通 `@Transactional` 查询，无 `@Lock(PESSIMISTIC_WRITE)`、无 `SELECT ... FOR UPDATE`；`uk_ext_inst_active` 是唯一索引**插入时才冲突** ⇒ 并发双发会先各自创建外部流程再报错）。

**🔴 N1 修正（r2 的 `build_phase` 谓词在新默认下是错的 —— 两个改动单独看对，合在一起出事）**

**问题链**：`uk_ext_inst_active` 谓词排除 `build_phase='FAILED'`（失败行自动让槽位）**单独看是对的**；但 r2 同时把 `draft_mode` 默认改成了 `DIRECT_SEND`，而 **`DIRECT_SEND` 下外部流程在 `build_phase` 还是 `DRAFTED` 时就已经真实发出去了**（本方案 §4 步骤 3-B 与 R5 都写明「首节点待办已生成」）。

⇒ 原注释那句「**失败行已无外部在途风险**，自动让位比人工确认更不易卡死」**在新默认下是错的**。故障序列：

```
DIRECT_SEND 下第 2 个槽位 assignNode 失败 → build_phase=FAILED
⇒ 谓词不含该行 → 槽位自动让出（无人点任何按钮）
⇒ 用户再点「提交」→ 平台新建实例 → 致远上出现【第二个流程】
⇒ 第一个流程成为外部孤儿（caseId 在本地，但本地认为它已让位）
```

**连带废掉两个 P0**：

| 被废掉的 | 原因 |
|---------|------|
| **断点续拼（P0）** | 唯一索引管不到 `FAILED` 行 ⇒「续拼」与「新建」可并存 ⇒ 续拼等于"再发起一次"，语义已不成立 |
| **「废弃并重建」按钮（P0）** | 不用点也能提交 ⇒ 按钮语义被架空 ⇒ 点它反而是**唯一一种**能显式清理孤儿的方式 |

**修正：谓词按「外部是否已真实发出」判断，而非按 `build_phase`**

引入**显式列** `external_sent SMALLINT NOT NULL DEFAULT 0`（1 = 致远侧已真实创建流程实例），`start` 成功返回 `caseId` 的那一刻置 1：

| 类别 | 判定条件 | `uk_ext_inst_active` 谓词 | 恢复路径 |
|------|---------|--------------------------|---------|
| **未真实发出** | `external_sent = 0`（= `DRAFT_THEN_SEND` + `build_phase='DRAFTED'`，start 未成功） | ✅ **自动让位**（谓词排除 `external_sent=0`） | 直接重试或 `ABANDONED`，**无外部风险** |
| **已真实发出** | `external_sent = 1`（= `DIRECT_SEND` 任意 `build_phase`，或 `DRAFT_THEN_SEND` 已 start 成功） | 🔴 **占用槽位，不自动让位** | **必须**显式走 `ABANDONED`（保留 `caseId` 可调外部 `stop`） |

> ⚠️ 注意：`external_sent=0` **只可能**出现在 `start` 调用**失败**时（`caseId` 尚未返回）。因此「自动让位」这一类的实际覆盖面很小 —— 但它仍必须存在，否则 `start` 反复失败的单据会被 `NOT_STARTED` 永久锁死（这正是 B3 最初要解决的问题）。
> 换个等价表述：**`external_sent=1` 才是「需要显式废弃」的分界线**，`build_phase` 不再参与让位判断。

#### 🔴 `external_sent` 的已知缺口：`start` **超时 / 网络中断**（QA r3 补充 a）

`external_sent` 由**「`start` 成功返回 `caseId`」**驱动。这在正常返回时没问题，但有一种情况它**判不准**：

```
t0  平台向致远发起 start 请求
t1  致远侧【已创建流程实例】
t2  响应在网络上超时 / 连接中断 ⇒ 平台【没收到 caseId】⇒ external_sent 仍为 0
t3  唯一索引自动让位（external_sent=0 在谓词外）
t4  用户再次提交 ⇒ 平台第二次start ⇒ **致远上出现第二个流程**
```

⇒ **与 D2/N1 是同一失败模式**（孤儿外部流程），只是触发路径不同。**根本原因是：`external_sent` 只能表达「平台知不知道」，无法表达「外部到底发没发」。**

**缓解（写入恢复路径，P0）**：**让位前必须先按 `command_id` 核对外部是否已存在流程**，不得仅凭本地 `external_sent` 就直接新建：

| 步骤 | 动作 |
|------|------|
| ① 命中 `external_sent=0` 的让位行 | **不要立刻新建**，先用同一个 `command_id`（§3.2 原则 5：**对同一次业务发起稳定不变**）调 V8 `/bpm/case/send` 并传 `data.commandId` |
| ② 致远返回已有 `caseId` | ⇒ 说明 t1 确实创建过 ⇒ **补写该行**（`external_sent=1` + `external_case_id`），走**续拼**而非新建 ⇒ **零孤儿** |
| ③ 致远报「无此命令」/ 幂等键不存在 | ⇒ 确认外部确实没创建 ⇒ **才允许新建** |

> 🟡 **诚实标注残留风险**：V5 REST 无 `commandId` 参数（仅 V8 OpenAPI 有，已✅ 确证），所以**走 V5 REST 时此缺口无法完全消除**，只能靠「超时后先人工核账再重试」的运维约定兜底。⇒ 这也是**建议 P0 走 V8 OpenAPI** 的又一条理由（原先只从「显式发起人 + 自带幂等 + 回调」三条论证，这是第四条）。

**🔴 验收用例（QA 指定）**：`DIRECT_SEND` 下模拟第 2 槽位 `assignNode` 失败 → 连续点击「提交」3 次 ⇒ **致远侧流程数必须仍为 1**，且本地第 2、3 次点击返回明确业务错误（提示「上次发起未完成，请先废弃重建」），**不得**创建第二个致远流程。

**拼节点失败（P0）**：保留 caseId，`build_phase=FAILED` + 记 `build_error` ⇒ **唯一索引谓词自动让出槽位**；提供「废弃并重建」（置 `ext_status=ABANDONED`）。**断点续拼已提为 P0**（`assigned_slots JSONB` 列 V154 已预留，成本仅状态机逻辑；原列 P1 时任一槽位失败就要人工重建并遗留外部孤儿流程，QA 风险 #1）。

---

## 5. 状态对照

### 5.1 外部实例本地状态（**5 个外部态 + 1 个本地处置态**）

> 📌 **口径统一**（修正 QA S4/I2：19§5.1 标题写「四态」而表格 5 行、ADR-022 写 4 态且漏 `REJECTED`）：
> **外部业务态 5 个**：`NOT_STARTED` / `RUNNING` / `COMPLETED` / `REJECTED` / `TERMINATED`；
> **本地处置态 1 个**：`ABANDONED`（**不是外部状态**，不参与 `status_mapping`，不映射到 `form_record`）。

| 本地 `ext_status` | 类别 | 含义 | 致远侧（对接时再精确枚举） |
|-------------------|------|---------------------------|------|
| `NOT_STARTED` | 外部 | 已建或可提交，尚未真正流转 | 停在开始 / 待发 |
| `RUNNING` | 外部 | 审批中 | 处理中 |
| `COMPLETED` | 外部 | 正常结束（**通过**） | 正常结束 |
| `REJECTED` | 外部 | 外部驳回（终态） | 驳回（终态） |
| `TERMINATED` | 外部 | **终止 / 撤销 / 作废 —— 三者合一** | 终止（`affair/stop`）、撤销（`affair/cancel`） |
| `ABANDONED` | **本地处置态** | 平台主动「废弃并重建」（构建失败且无法续拼时）。**非外部状态、不参与 `status_mapping`、不映射 `form_record`** | —（外部侧无此状态；仍可调 `affair/stop` 清理孤儿） |

#### 🔴 D5：撤销与终止在 EXTERNAL 下**合并为 `TERMINATED`**

| 外部动作 | 接口 | `ext_status` | `form_record.status` | 能否再提 |
|---------|------|-------------|---------------------|---------|
| 驳回（审批人不同意） | 待办提交 `attitude=3` | `REJECTED` | `REJECTED` | ❌ |
| **撤销（发生在外部侧）** | `affair/cancel` / `/bpm/case/cancel` | **`TERMINATED`** | **`TERMINATED`** | ❌ |
| 终止 | `affair/stop` / `/bpm/case/stop` | `TERMINATED` | `TERMINATED` | ❌ |

**三条硬约束**：

1. 🔴 **EXTERNAL 界面不提供「撤销」操作** —— 用户只能对 EXTERNAL 单据执行**终止**。**平台自身不做撤销按钮**，Adapter 亦不提供 `revoke` 方法（§3.3）。开发**不得**因能力表里有 `affair/cancel` 就做按钮。
2. 🔴 **外部侧发生的撤销，同步到本地一律按 `TERMINATED` 处理**，**不得**因其语义接近「撤回」而映射为可再提。
3. ✅ **撤销与终止保持合并为 `TERMINATED`**（不拆分、不新增 `CANCELLED`）；**不新增** `CANCELLED` 状态；**`form_record` 不因撤销而加任何额外列/状态**（只新增与终止共用的 `TERMINATED`，见 §5.2）。

#### 为什么 LOCAL 允许撤销而 EXTERNAL 不允许（主动取舍，非疏漏）

产品**主动**决定不把内部系统的撤销语义推广到外部系统。理由（须写进实现说明，避免后续开发「顺手对齐」）：

| 维度 | LOCAL 撤销 | EXTERNAL 撤销 |
|------|------------|--------------|
| 前置校验 | **严格且已在代码中固化**：`ProcessService.java:447-463` —— 仅 `RUNNING` + **本人** + **尚无任何人审批通过**（`hasApproveHistory` 判 `WfHistory.OP_APPROVE`）。三项全满足才允许，**权限与边界清晰** | **在外部侧难以可靠判定**：谁有权撤？已审批后能否撤？前置条件是否与本地等价？——**均无法确认** |
| 语义归属 | 本地引擎完全可控，状态机在我们手里 | 撤销语义归致远所有，平台只是观察者 |
| 失败模式 | 校验不过 → 明确报错 | **「本地允许撤销但外部拒绝」的悬空态**：用户在本地点了撤销，外部返回失败，单据卡在中间态 |

⇒ 产品**主动牺牲 LOCAL/EXTERNAL 语义一致性**，换取**实现简单、行为可预测**。这条是**取舍**不是**遗漏**。

#### 轮询扫描范围（含终态单调性）

| 项 | 值 |
|----|-----|
| 扫描 | `ext_status ∈ {NOT_STARTED, RUNNING}` 且 `build_phase <> 'FAILED'`（`idx_ext_inst_polling` 部分索引） |
| 停止 | `REJECTED` / `COMPLETED` / `TERMINATED` / `ABANDONED` 均停止轮询 |
| **终态单调性（🔴 硬约束）** | `ext_status` 迁移只允许 `NOT_STARTED → RUNNING → {COMPLETED \| REJECTED \| TERMINATED}`，以及 `NOT_STARTED → ABANDONED`。**任何终态不可被后续轮询改回 `RUNNING`**（如外部返回 `cancel=2` 后又返回 `run=0`）。违反 ⇒ 记 `sync_error` + 告警，**不落库** |

> **终态单调性是防「重复触发后置任务」的最后一道闸**（QA I2）。`REJECTED` / `COMPLETED` / `TERMINATED` / `ABANDONED` 均为终态，`ext_status` 一旦落入其中，后续任何轮询/回调都不得改写。这是**先于 `status_mapping` 正确性**的防线——即使状态枚举配错（`TERMINATED` 被误配成 `COMPLETED`），只要映射后仍是终态就不会二次触发；而**非终态被误配成终态**才危险，由 C-6 沙箱验证（Gate-1）兜底。
>
> 🔴 **命名落点（QA r2 要求 · 防"没人调用的校验方法"）**：该断言必须落在 **`ExtSyncService.applySnapshot()`** 内、**`instanceRepository.save()` 之前**（而不是一个独立的 public 校验方法），顺序为：
> ```
> fetch() → status_mapping 映射 → 🔴 断言终态单调性 → instance.setExtStatus(...) → save()
> ```
> 违反时：记 `sync_error` + 告警，**不落库**（保持原 `ext_status` 不变）。

### 5.2 与 form_record

> 🔴 **D6 结论：新增 `form_record.status = 'TERMINATED'`**（原方案此格写「—」是漏洞）。

| `form_record.status` | 外部实例 `ext_status` | 说明 |
|-------------|---------|------|
| `SAVED` | 无映射 或 `NOT_STARTED` | 发起人可提交 |
| `IN_PROCESS` | `RUNNING` | 审批中（EXTERNAL 复用此态） |
| `APPROVED` | `COMPLETED` | 通过；终态；触发后置任务（幂等） |
| `REJECTED` | `REJECTED` | **已定（D1）**：外部驳回写入 `form_record=REJECTED`，终态。不回 `SAVED`，本单不可改后再提 |
| **`TERMINATED`（🆕 D6）** | `TERMINATED` | **终止 / 撤销 / 作废统一态**。**不写成 `REJECTED`**（语义不同：驳回是「不同意」，终止是「不再走了」）；**不写成 `APPROVED`**；**不回 `SAVED`**（同单不可复活） |
| （不变更） | `ABANDONED` | **本地处置态，不映射 `form_record`**。旧单只读、**不可再提**（D7）；续办靠「复制新建」 |

**`TERMINATED` 侧的运行时行为**（新增后必须成立的判定）：

| 判定点 | 期望行为 | 现状 |
|--------|---------|------|
| `FormRecordService.requireMineEditable():164-167` | `TERMINATED` 不在 `{SAVED, REJECTED}` 白名单 ⇒ **已天然拒绝编辑** ✅ | 无需改 |
| `toVo():179-181` `canEdit` / `canStart` | `TERMINATED` 不在白名单 ⇒ `canEdit=false`、`canStart=false` ✅ | 无需改 |
| `startProcess():119` | `TERMINATED ≠ SAVED` ⇒ **已天然拒绝再次发起** ✅ | 无需改 |
| `ProcessService.syncFormRecordStatus()` | **仅 LOCAL 路径调用**（`:221` 撤回、`:496` 撤回、`:524` 通过）。EXTERNAL 走 `ExtStatusMapper`，**不得**复用此方法 | 无需改，但**禁止** EXTERNAL 路径调它 |

⇒ **`TERMINATED` 天然落在所有既有白名单之外**，这是选择新增独立状态（而非复用 `REJECTED`）的关键收益：**不改动任何既有判定条件即自动获得「只读 + 不可再提」语义**，也不会与「通过」混淆。

### 5.3 与本地 wf_instance / sys_task（已定）

| 项 | 决定 |
|----|------|
| EXTERNAL 运行时 | **完全不创建**本地待办（`sys_task` 及本地审批任务）。收件箱不出现该单的审批待办 |
| 影子数据 | 允许只存外部 `caseId` 与进度镜像，不得因此生成待办 |
| 通知 | 状态变化可以发消息，消息不是待办 |

---

## 6. 本地界面

### 6.1 套壳打开（EXTERNAL）

1. 仍用当前套壳展示本地表单（只读）
2. **发起人**打开时自检：
   - 无外部实例 → 显示「提交」（防抖）。**「提交」= 发起外部流程**（§4 全序列：预解析 → start → 逐槽位填人 →（DRAFT_THEN_SEND 时）activate → 落映射），不是再次保存本地表单
   - 有实例且 `build_phase=FAILED` 且可续拼 → 显示「继续拼装」（P0 断点续拼）
   - 有实例且 `build_phase=FAILED` 且不可续拼 → 显示「废弃并重建」
   - 有实例且未启动（DRAFT_THEN_SEND 且 `draft_flag=1`）→ 继续步骤 5 activate + sync
   - 有实例且 `RUNNING` → sync 进度
3. **非发起人**：纯浏览，无提交
4. **保存**（若套壳仍有保存）：只写本地 `form_record` / 宽表，状态保持 `SAVED`，**不**调外部 API
5. **隐藏**现有本地图形化进度；改为展示：
   - 🟡 **外部状态摘要**（映射后的 `ext_status` 中文名）+ **当前处理人**（来自 `flow/dostaff`）
   - 🟡 **审批意见区：降级为「在致远中查看」深链**（`URLLINK` ✅ 确证存在）。**`capabilities` 无 `QUERY_OPINIONS` 时直接隐藏该区**，不做「显示空列表」的自欺实现（C-2）
6. 打开时强制 sync；后台 Job 定时拉非终态实例
7. 🔴 **不显示「撤销」按钮**（D5）。EXTERNAL 单据在本地界面**只有终止**一个终态动作；`canWithdraw` 在 EXTERNAL 下必须为 `false`（现有 `toVo():182-185` 依赖 `hasApproveHistory(current_instance_id)`，EXTERNAL 下 `current_instance_id` 恒为 null ⇒ 天然 false ✅，但**不得**为 EXTERNAL 补写 `current_instance_id`）

### 6.2 外部发起流程管理台

筛选：发起时间段、结束时间段、状态、表单、发起人。  
列：单据、外部 caseId、`ext_status`、`build_phase`、最近同步时间、`build_error`。  
操作：查看、手工重同步、废弃重建（权限控制）、终止（**无撤销**，D5）。

### 6.3 再发起

> 🔴 **EXTERNAL 的终态（含「外部撤销同步而来的终止」）不可再提，须新建单据。**

| `ext_status` | 能否在同一 `form_record` 上再发起 | 理由 |
|-------------|------------------------------|------|
| `COMPLETED`（通过） | ❌ 须新建单据（可「复制新建」） | 已通过，重发= 重复业务 |
| `REJECTED`（驳回） | ❌ 须新建单据（可「复制新建」） | D1 + **D7** |
| `TERMINATED`（终止 / **撤销** / 作废） | ❌ 须新建单据（可「复制新建」） | 外部侧流程已终态，不可复活 |
| `ABANDONED`（本地废弃） | ❌ **同单不可再提**；UI 走「复制新建」 | **D7**：与驳回统一口径；旧实例仍 `ABANDONED`+`stop` 清孤儿 |

#### ⚠️ LOCAL 与 EXTERNAL 的再发起语义差异是**有意为之**，不得「顺手对齐」

这条差异看起来像疏漏（同一个 `FormRecordService`、同一张 `form_record` 表、同一个 `requireMineEditable()`），**实为产品主动取舍**：

| 引擎 | 撤回/撤销后 | 代码位置 |
|------|-----------|---------|
| `LOCAL` | 实例 → `WITHDRAWN`，单据 → **`SAVED`**，**允许**修改后再发新实例 | `ProcessService.withdraw():447-463` + `:496` `syncFormRecordStatus(..., SAVED)` |
| `EXTERNAL` | 单据 → **`TERMINATED`**，**不允许**再提，须新建单据 | 本方案 §5.2 / D1 / D5 |

**给后续开发的显式约束**：

1. 🔴 **禁止**为「统一体验」而给 EXTERNAL 加撤销/撤回按钮，或把 `TERMINATED` 归一回 `SAVED`。
2. 🔴 **禁止**修改 `requireMineEditable()` / `toVo()` 中对 `LOCAL` 的既有条件（B2 的分流**只加在 EXTERNAL 分支**，见 §8.3 F-3）——LOCAL 的「撤回再发」是**现有可用功能**，动它会引发回归。
3. 若产品日后要求「EXTERNAL 也能终止后重提」，那是**新决策**，须重新评估 §5.1 D5 的三条理由（尤其「外部撤销前置条件无法等价判定」），**不是本方案的执行细节**。

#### ✅ 「让出槽位」机制统一处理：撤销同步的 `TERMINATED` 与 `ABANDONED` **互不冲突**

任务方要求确认：外部撤销同步成 `TERMINATED` 后旧实例已终态、新实例可建（靠 `uk_ext_inst_active` 谓词不含终态自动让位），这与 `ABANDONED`（B3 路径）**是否冲突**。

**结论：不冲突，且应当统一为同一套机制。** 两者是**同一类机制的两个实例**：

| 维度 | `TERMINATED`（撤销/终止同步而来） | `ABANDONED`（本地废弃重建） |
|------|-----------------------------------|---------------------------|
| **让出槽位的机制** | 谓词 `ext_status IN ('NOT_STARTED','RUNNING')` **不含 `TERMINATED`** ⇒ 自动让位 | 谓词同时排除 `build_phase='FAILED'` ⇒ **自动让位**（`ABANDONED` 亦不在谓词内，双重让位） |
| **`caseId` 是否保留** | ✅ 保留（可用于调外部 `stop` 清理/核账） | ✅ 保留（同） |
| **外部侧是否需清理** | 已由外部终止，无需再调 | ⚠️ **需主动调 `affair/stop`** 清理外部孤儿流程 |
| **`form_record` 结果** | `TERMINATED`（D6）—— **不可再提** | 旧单只读（建议保持 `SAVED` 或加标记）；**不可再提**；业务续走靠 **D7 复制新建** |
| **是否触发后置任务** | ❌ 不触发 | ❌ 不触发 |

**统一处理约定（避免开发写成两套逻辑）**：

1. **单一让位判据**：判断「该 `form_record` 能否新建外部实例」时，**只看「是否存在一条命中 `uk_ext_inst_active` 谓词的行」**，不要为 `TERMINATED` / `ABANDONED` 各写一套 if。判定逻辑收敛到一处（如 `ExtProcessInstanceRepository.findActiveInstance(tenantId, formRecordId)`）。
2. **「让出槽位」与「可否再提」是两个不同问题**（**D7 后二者口径统一为：旧单一律不可再提**）：
   - 让出槽位 = 索引谓词（**自动**）；
   - 可否再提 = **永远否**（驳回 / 终止 / 废弃同口径）；续办 = **复制新建 `form_record` + 新外部流程**。
3. **`ABANDONED` 行的 `caseId` 必须可调 `stop`** —— 这是「本地处置态」与「删行」的本质区别：删行会丢失外部孤儿清理能力与审计证据。

### 6.4 ✅ 已拍板：P-1 → **D7「复制新建」统一口径**

**产品（2026-10-24）**：驳回不能重提；构建失败「废弃」也不在同单重提。**一律**：

1. 旧 `form_record` **只读、不可再提交**；
2. 若有未完成的外部实例 → 置 `ABANDONED`（或已是 `REJECTED`/`TERMINATED`）并视需要 `affair/stop` 清孤儿；
3. **新建**一张 `form_record`，**复制**原单业务字段（不含外部 caseId / 审批轨迹）；
4. 用户在**新单**上发起外部流程（可提供一键「复制并打开新单」；是否自动提交由实现阶段定，默认**只复制不自动发**以防误发）。

| 原方案倾向 | D7 后果 |
|------------|---------|
| 同单 `ABANDONED` 后再点「提交」 | ❌ **取消** |
| 按钮文案「废弃并重建」 | 改为「废弃并复制新建」/「复制新建后再发」（旧外部清孤儿 + 新单） |
| 任务 C3 | **保留** `ABANDONED`+`stop`；**新增**「复制 form_record」能力（P0） |

#### 🔴 N1 验收用例（QA 专项回归 · 必测）

| # | 场景 | 期望 |
|---|------|------|
| **N1-a** | `DIRECT_SEND` 下模拟第 2 槽位 `assignNode` 失败 ⇒ 连续点「提交」**3 次** | 🔴 **致远侧流程数必须仍为 1**；本地第 2、3 次返回明确业务错误「上次发起未完成，请先废弃重建」；**不得**创建第二个致远流程 |
| **N1-b** | 同一 `form_record`，`external_sent=0`（start 调用失败）后重试 | ✅ 允许直接重试（唯一索引已让位），**无外部风险** |
| **N1-c** | `external_sent=1` + 构建失败 + 尝试直接提交（不经废弃） | 🔴 **必须被拒**（唯一索引仍占用） |
| **N1-d** | 断点续拼期间并发另一实例提交同一 `form_record` | 🔴 **续拼与新建不得并存**（唯一索引保证） |

---

## 7. 定时抓取与消息

| 项 | 规划 |
|----|------|
| 扫描范围 | `ext_status ∈ {NOT_STARTED, RUNNING}` 且 `build_phase <> 'FAILED'`；`REJECTED` / `COMPLETED` / `TERMINATED` / `ABANDONED` 停止（命中 `idx_ext_inst_polling` 部分索引） |
| 频度 | 处理中 1～5 分钟可配；终态停止 |
| **并发保护** | 🔴 **必须用 `FOR UPDATE SKIP LOCKED`（零新表）** —— 详见下方 N2 专项。**⛔ 严禁复用 `biz_exec_lock`**（它是**一次性幂等账本**，不是互斥量） |
| 退避 | 外部系统全挂时不逐条告警 ⇒ 按 **`(external_system, raw_status)` 聚合**退避与告警（**聚合粒度统一**，勿按实例逐条；否则 100 个实例同状态全挂会产生 100 条告警） |
| 打开单据 | 额外强制 sync |
| 消息 | 仅状态变化 / 轮到关键人 / 终态；避免每轮轮询都推送 |
| **状态未识别时** | 拒绝落库 + 告警 + **按 `(external_system, raw_status)` 聚合退避**（不是每轮每条都告警 ⇒ 告警风暴）。`status_mapping` **保存时校验 + 启动时 fail-fast 兜底**（见 N4） |

### 🔴 N2 专项：`biz_exec_lock` 是**一次性幂等账本**，**不是互斥量** —— 轮询禁用

**这一条是 r2 的错误引用，本轮修正。** 我此前只读了 `V121:152` 的注释「替代 `synchronized`，集群安全」就把它当互斥量用，**没有读 `DistributedLockService` 的实现语义**。逐行复核后确认它与互斥量的语义**根本不同**：

| 机制 | 行为 |
|------|------|
| `:91-93` `tryAcquire` | `INSERT` 抢锁（PK 冲突即失败） |
| `:95-105` `runAction` | 动作成功后 `casStatus(RUNNING→SUCCESS)` |
| `:65-66` 冲突分支 | 看到 `SUCCESS` ⇒ **`return ALREADY_SUCCESS`，直接返回、不执行动作** |
| `:70` | 只删 `FAILED` |
| `:80` | 只删**超时**的 `RUNNING`（>5min，夺权） |
| — | **🔴 全仓无任何生产代码清除 `SUCCESS` 行**（已 grep：`deleteByStatus` 的调用方只有 `:70` FAILED、`:80` 超时 RUNNING；其余命中全在测试清理代码里） |

⇒ **`SUCCESS` 行一旦写入就永久存在，该 `biz_type + biz_id` 组合从此再不执行任何动作。** 这正是它的设计意图 —— `ExecutionTaskService.executeOne():109-110` 用 `lockType = bizType`、`lockId = bizRefId`（**一个具体后置任务的 ID**），即「**这个任务只应被执行一次**」的账本。

**⛔ 若用它做轮询，后果是灾难性的**：第一个实例轮询该实例成功后写 `SUCCESS`，之后**所有轮次、所有实例**都在 `:65` 直接 return ⇒ **该 `form_record` 的外部状态永久冻结** ⇒ 🔴 **外部发生的撤销永远不会被识别为 `TERMINATED`，直接击穿产品刚拍板的 D5**。

**正确做法：`FOR UPDATE SKIP LOCKED`（零新表，PostgreSQL 16 原生）**：

```sql
-- 领取一批待轮询实例：多实例并发领取，彼此跳过已锁定的行，零冲突零等待
WITH claimed AS (
    SELECT id
    FROM ext_process_instance
    WHERE deleted = 0
      AND ext_status IN ('NOT_STARTED', 'RUNNING')
      AND build_phase IS DISTINCT FROM 'FAILED'
      AND (last_sync_at IS NULL OR last_sync_at < now() - interval '5 minutes')
    ORDER BY last_sync_at NULLS FIRST
    LIMIT :batch_size                      -- 🔴 必须 LIMIT：SKIP LOCKED 无 LIMIT 会锁全表
                                          -- 🔴 且 batch_size ≤ 20（15s×20=300s < 5min 保护期，见下表）
    FOR UPDATE SKIP LOCKED
)
UPDATE ext_process_instance p
SET last_sync_at = now(), updated_at = now()
FROM claimed c
WHERE p.id = c.id
RETURNING p.id;
-- ⚠️ 领取与「更新 last_sync_at」同事务；fetch 外部接口在本事务【之外】调用
--    （外部 HTTP 不可持有 DB 行锁，否则 15s 超时 × 批量会拖垮连接池）
```

| 要点 | 说明 |
|------|------|
| **🔴 必须 `LIMIT`** | `SKIP LOCKED` 不加 `LIMIT` 会遍历并锁定全部候选行 |
| **🔴 `batch_size ≤ 20`** | 领取与 `fetch` 分离 ⇒ 行锁在**领取事务提交时即释放**，而 `fetch` 在事务外 ⇒ **单批总耗时 = `batch_size × timeout_ms`**。取 `20 × 15s = 300s = 5min`，须严格小于 5 分钟的轮询保护期，否则同一行会被两实例并发 fetch。**剩余代价（可控）**：外部调用量翻倍 + 连接池压力；**不丢、不重复**（不重复投递由 N3 同事务判重兜住，终态回退由单调性断言兜住） |
| **领取与 fetch 分离** | `FOR UPDATE` 事务**只做「认领 + 打时间戳」**；外部 `fetch()` 在事务外调用。**绝不能**持有行锁跨越外部 HTTP 调用，否则 15s 超时 × 批量会拖垮连接池 |
| **认领即去重** | `last_sync_at` 在领取时更新 ⇒ 同一行在同一轮不会被第二个实例领取。**这才是「防并发轮询」的真实需求** |
| **🟡 崩溃窗口的运维代价（QA 补充）** | 时间戳打在**领取时**而非成功后 ⇒ 实例在 fetch 期间崩溃时：**不丢、不重复**，最坏是**这一轮白跑，5 分钟后自动重来**。⚠️ **这是安全的设计，但运维排障时可能误判成 bug** —— 看到 `last_sync_at` 是 5 分钟前而外部状态却没更新，属预期行为而非故障 |
| **替代原方案** | 原方案写「复用 `biz_exec_lock`」是**误用**；`FOR UPDATE SKIP LOCKED` 零新表、无生命周期问题、语义正确 |

---

## 8. 逻辑漏洞与已识别风险

### 8.1 P0 必须先确认（阻塞详细设计）

1. **离开开始节点 API** — **已核实**：`data.draft=1` 保存待发即为「不落开始节点」✅。**送出待发**独立接口：**公开文档未证实**（清单 **C-1**，2026-10-24 复核）⇒ `draft_mode` 配置二选一，**P0 锁定 `DIRECT_SEND`**（✅ 确证可行）；`DRAFT_THEN_SEND` **不得**作默认/必经。分支生效点在 **§4 步骤 3**，不是步骤 5（QA I1）。
2. **同节点多人** — **已核实**：`freeReplaceNode` 的 `data.userId` 是数组，**支持多人** ✅；会签/或签语义由外部模板节点属性决定，平台不可控 → 蓝图放开多人，但 UI 不暴露会签/或签选择。
3. **🔴 外部模板槽位（阻塞 Phase B）** — `freeReplaceNode` 是「替换预置节点」，外部模板必须预置 N 个槽位。蓝图节点数 ≤ 槽位数，超出直接拒绝。**未完成槽位登记前不得开工 Phase B**（清单 **C-3**，Gate-1）。
4. **🔴 流程状态枚举**（QA I2 要求提到 Gate-1）— `/flow/state/{flowId}` 官方映射表是图片未抓到 ⇒ `status_mapping` 配置化 + **启动 fail-fast**。**必须从 Phase E 提前到 Phase B 之前**：状态映射是整个联动链路的地基，且它是唯一能防住「合法枚举值被映射错 → 终止单据被判通过 → `FINALIZE_BIZ` 业务动作错误执行」的防线（清单 **C-6**）。原方案映射代码 Phase B 写、枚举 Phase E 验，**顺序倒了**。
5. **预解析失败规则** — **已定**：审批缺人必禁；抄送警告可提交；发起人缺号必禁；发起人须写入外部发起人字段（D4）。
6. **V149 互斥 CHECK** — 实现时按 ADR-022 追加迁移调整（工程项，非产品选择题）。**V153 上线前任何 EXTERNAL 绑蓝图的写库都会被 DB 拒绝**（硬阻断，见 §8.3 F-6）。
7. **EMBED_URL** — 实现约束：长随机串 + 鉴权 + 吊销 + Frame 祖先（工程项）。🔴 但**跨站 iframe 鉴权可行性未验证**（清单 **C-12**，Gate-1，待产品确认 **P-2**）。
8. **🔴 外部撤销的可判定性（本轮新增，阻塞项 C-13）** — 见下方专项。

#### 🔴 C-13（新增）：轮询如何区分「外部被撤销」与「外部被终止」

| 项 | 内容 |
|----|------|
| **问题** | D5 已决定「外部撤销同步回本地**一律按 `TERMINATED` 处理**」。那么轮询**是否需要**区分「外部被撤销」与「外部被终止」？ |
| **技术上是否可区分** | 🟡 **不确定**。致远状态枚举有多套互斥来源（20 §2）：<br>① 官方 `CollaborationEnum.flowState`：`cancel=2` / `terminate=1` —— **可区分**<br>② 第三方实践文章：撤销=`5`、终止=`15` —— 与①**冲突**<br>③ `ctp_affair.STATE`（事项级，非流程级）：`5`取消 / `15`终止 —— **可区分**，但对象不是流程 |
| **平台决策** | ✅ **不做区分，统一按 `TERMINATED` 处理**。这正是 D5 的天然兜底：既然撤销与终止在本地**合并为同一个值**，即使外部枚举无法区分，**映射结果也完全相同** ⇒ 该不确定性**不影响正确性**，只影响 `raw_status` 排障时的可读性 |
| **对 `status_mapping` 的要求** | `cancel=2` / `5` / `terminate=1` / `15` **全部映射到 `TERMINATED`**。映射表配置时**必须把这四个值都写进去**，否则「未识别状态 → 拒绝落库 + 退避」会因撤销单据而触发退避，**撤销的单据将无限期停留 `RUNNING`**<br>🟡 **准确表述（QA r2 修正）**：**不是「永久卡死」，而是「无告警则无限期停留 `RUNNING`，需人工介入」** —— 因为管理台「操作」列已有**终止**（`C3` 任务 `terminate`，P0、界面暴露）⇒ **存在人工出口**，管理员可强制把单据推到 `TERMINATED`。这个差别会影响产品对「是否可接受」的判断 |
| **假设错误的影响** | **低**（与C-6 相反）。若外部实际枚举既非①②③中任一套：<br>· 最好情况 = 误映射为 `RUNNING` ⇒ 撤销单据持续轮询、不停机、仅浪费资源<br>· 最坏情况 = **误映射为 `COMPLETED`** ⇒ 🔴 触发「审批通过」后置任务，`form_record=APPROVED`，**业务动作错误执行**（重复发货/重复建单）<br>⇒ **兜底不靠枚举，靠三条硬约束**：① `status_mapping` **启动 fail-fast**（配错则系统起不来，不会带错配置上生产）；② **终态单调性**（§5.1）：映射后只要落进终态就不会被改回`RUNNING`；③ 若某值映射为 `COMPLETED`，必须经 C-6 Gate-1 沙箱**实测验证**过（跑一条撤销流程确认返回值），**不得**凭文档图片猜 |
| **验证方法** | 沙箱跑两条流程：① 发起后在致远点「撤销」；② 发起后在致远点「终止」。分别记录 `/flow/state/{flowId}` 与（若有）V8 状态字段返回值 |
| **回退** | 无需回退——**统一 `TERMINATED` 就是回退方案本身**。这是 D5 的额外收益：把一个「依赖外部枚举可区分性」的风险，转成了一个「无论能否区分都成立」的不变式 |

### 8.2 P1 易踩坑

6. start 成功、拼节点失败 → 外部孤儿流程 → 断点续拼（P0）/ 废弃重建（P0，**已可执行**）  
7. 回调 + 轮询双到 → 后置任务必须幂等（**由 DB 唯一约束保证**，见 E1）  
8. 双击提交 → DB 唯一约束 + `form_record` 行锁 + 前端防抖  
9. **终止 / 撤销 / 驳回已三者分开**：驳回 = `REJECTED`；终止与**撤销合并** = `TERMINATED`。🔴 **本地与界面均不提供撤销入口**（D5）  
10. 消息风暴 **与告警风暴**：状态未识别时**按 `(external_system, raw_status)` 聚合**告警与退避（🔴 **单据只记 `sync_error`，退避计数落聚合层**）—— 若退避落单据级，100 个实例各自退避 ⇒ 告警量仍是 100 倍，等于没控住。与 §7 扫描表、20§8 第 16 条、R1 三处口径一致  
11. FORM_JSON 缺字段映射会卡发起  
12. 富文本体积与 XSS  
13. 管理台时间以本地落库的 `started_at/ended_at`（由 sync 写入）为准  
14. 🆕 `external_sent` 判不准`start` **超时/网络中断**（致远已建流程但本地没收到 `caseId`）⇒ 让位前须按 `command_id` 核对外部，见 §4 缺口专项  
15. 🆕 轮询认领「先标记后执行」窗口：fetch 期间崩溃 ⇒ **不丢不重复**，最坏一轮白跑、5 分钟后重来（**运维可能误判成 bug，实属预期**），见 §7 N2 专项  

### 8.3 与现有实现冲突（开工前处理 · QA 实测）

> 本节是**完整冲突清单**（修正 QA B1：原版本只有 3 行 stub，无文件名、无行号、无步骤、无工作量）。每条给出**文件:行号 + 改动步骤 + 工作量 + 归属任务**。
> 🔴 事实基础：`V149__form_workflow_binding.sql:85-88` 执行了 `UPDATE wf_definition SET supported_form_codes = '{}'` ⇒ **旧列已被全表清空**。

#### F-1 🔴 「一个表单只能关联一个流程」互斥校验**事实上已失效**（QA B1-a）

| 项 | 内容 |
|----|------|
| **位置** | `WfDefinitionService.java:299`（在 `validateSupportedForms()` 内，`:285-307`）→ `definitionRepository.findBySupportedFormCode(tenantId, code)` |
| **实测事实** | `V149:85-88` 已把全表 `supported_form_codes` 置为 `'{}'` ⇒ **该查询恒返回空** ⇒ **互斥校验从未生效**（silent regression） |
| **对 EXTERNAL 的影响** | 🔴 **方向上恰好有利**：EXTERNAL 蓝图需要的正是「一个表单绑多份蓝图」（不同外部模板），失效的互斥校验不构成障碍。**但这是意外的帮，不是设计** —— 一旦有人「修复」它（改回读 `form_definition` 反查并真正拦截），**EXTERNAL 蓝图立刻撞墙** |
| **改动步骤** | ① `validateSupportedForms()` 改为反查 `form_definition.workflow_binding_type`（真相源）；② **但 EXTERNAL 蓝图绑定不走这个互斥校验**（一个表单可持有多份蓝图供不同外部模板用）；③ 补一条单测锁定「EXTERNAL 不受该校验约束」 |
| **工作量** | **M** |

#### F-2 🔴 `form_record` 行锁在方案里被假定存在，实际不存在（QA B6）

| 项 | 内容 |
|----|------|
| **位置** | `FormRecordService.java:114`（`startProcess()` 内）—— `formRecordRepository.findByIdAndTenantIdAndDeleted(...)` 是普通 `@Transactional` 查询，**无 `@Lock(PESSIMISTIC_WRITE)`、无 `SELECT ... FOR UPDATE`** |
| **后果** | `uk_ext_inst_active` 是**唯一索引，插入时才冲突**。两个并发提交都会先「查无映射」（都通过）→ 都跑完外部 `start` → **两个外部流程都已被创建**，第二个才在唯一索引上报错 ⇒ 并发双发 = 外部孤儿流程 + 本地单据锁死（B3 已证明恢复路径曾不可实现） |
| **非理论风险** | `startProcess():119` 已有 `if (!STATUS_SAVED.equals(status)) throw` 的 **check-then-act 竞态**，LOCAL 路径靠单机部署侥幸不出问题，EXTERNAL 走集群就暴露 |
| **改动步骤** | ① EXTERNAL 发起链路的所有 `form_record` 读取改 `SELECT ... FOR UPDATE`；② `ExtWorkflowLaunchService` 的 `@Transactional` 边界**须覆盖** start→落镜像全过程；③ 补并发验收用例（2 线程/2 实例对同一 `form_record` 同时提交 ⇒ 恰好 1 次外部 `start`，另一方拿到明确业务错误而非 500） |
| **工作量** | **M** |

#### F-3 🔴 产品已定的「`REJECTED` 是终态、不回 `SAVED`」被活代码**直接推翻**（QA B2）

| 项 | 内容 |
|----|------|
| **位置（实测）** | `FormRecordService.java:164-171` `requireMineEditable()` —— `:164-165` 允许 `REJECTED` 进入编辑；`:169-171` **无条件**归一回 `SAVED`。调用点 `:79`（`update()` 路径）。同一判定在 `toVo():179-181` 的 `canEdit` 同样放行 `REJECTED` |
| **🟡 定性（QA r2 修正）** | ⚠️ **「正在发生的矛盾」措辞过重 —— 实为「latent 缺陷，EXTERNAL 落地瞬间触发」**。实测：`syncFormRecordStatus()` 的三个调用点分别传 `SAVED`（`:221` REJECT 动作 / `:496` 撤回）与 `APPROVED`（`:524` 完成）⇒ **全仓没有任何代码路径写入 `form_record.status = REJECTED`** ⇒ `:169-171` 的归一分支在 LOCAL 路径下目前是**死代码**。<br>⇒ **这不改变 B2′ 必须做**，但**措辞必须改**：避免开发者误以为 LOCAL 现在就有这个 bug 而去「顺手修」LOCAL 分支（那恰好会踩坏现有行为）。真实风险是：**B4 的 `ExtStatusMapper` 一旦把 `REJECTED` 写入，问题立即显性化** ⇒ B2′ 必须与 B4 同批上线 |
| **为什么 LOCAL 下合理** | LOCAL 支持撤回再发（`ProcessService.withdraw()`），所以这个归一逻辑是**正确的现有行为**，**不会被 LOCAL 测试发现** |
| **在 EXTERNAL 上的后果** | 外部驳回 → `form_record=REJECTED` → 发起人编辑一下 → 状态被归回 `SAVED` → `canStart=true` → 可再次提交 → 旧外部实例已是终态，`uk_ext_inst_active` **挡不住新实例** ⇒ **产品明令禁止的「同一单据二次外部审批」会发生**（⚠️ 见上方「定性」：这是 **EXTERNAL 上线后立即显性化**的缺陷，LOCAL 路径当前是死代码） |
| **改动步骤** | 🔴 `requireMineEditable()` 的 `REJECTED` 分支改为**按 `form_definition.workflow_binding_type` 分流**：<br>· `LOCAL` → **保持现状**（归一 `SAVED`，可再发）—— **不得触碰任何既有条件**<br>· `EXTERNAL` → **不归一**，且对 `REJECTED` 抛 `VALIDATION_ERROR`「外部审批已驳回，本单不可修改后重提，请新建单据」<br>② `toVo():179-181` 的 `canEdit` / `canStart` / `canWithdraw` 三处同步按 `workflow_binding_type` 分流<br>③ 补双侧回归用例：`LOCAL+REJECTED → 编辑 → 成功且转 SAVED`（**防修坏 LOCAL**）；`EXTERNAL+REJECTED → 编辑 → VALIDATION_ERROR` |
| **工作量** | **M** |
| **归属** | 新增任务 **B2′**（见 §9） |

#### F-4 🔴 `FormDefinition` 实体**完全没有** V149 任何一列的 JPA 映射（QA B5）

| 项 | 内容 |
|----|------|
| **实测事实** | `FormDefinition.java` 全文 13 个字段，**不含** `workflow_binding_type` / `workflow_definition_id` / `external_workflow_system` / `external_workflow_ref`。全仓 Java 侧搜 `workflow_binding_type|workflowBindingType|externalWorkflowRef|injectMode|embedToken` ⇒ **零命中** |
| **关键澄清** | 方案原文写「尚未吃进外部字段」读起来像「V149 的 LOCAL 绑定已在用，只缺 EXTERNAL」。**实际是 V149 四列（含 LOCAL 的 `workflow_definition_id`）至今没有任何 Java 映射与读路径** ⇒ **LOCAL 绑定链路当前也是断的**，只是没人用所以没暴露 |
| **改动步骤** | A3 新增 **9 个字段映射**：`workflow_binding_type` / `workflow_definition_id` / `external_workflow_system` / `external_workflow_ref`（V149 四列）+ `inject_mode` / `embed_token` / `external_node_slots` / `external_field_mapping`（V153 新增）+ **枚举常量**；并实现**读写路径 + 供 BFF 反查的方法**（F-1 依赖它） |
| **工作量** | **L**（原估 M，已上修） |

#### F-5 🟡 `process-shell.tsx` 无 `workflow_runtime` 概念，EXTERNAL 分支缺触发条件（QA I9）

| 项 | 内容 |
|----|------|
| **实测事实** | `process-shell.tsx`（703 行）`grep EXTERNAL` ⇒ **零命中**。它读的是 `wf_instance.status`（`instance.status === 'RUNNING' / 'WITHDRAWN'`）与 `detail.canWithdraw`，**完全不读 `form_record.status`** |
| **含义** | ① D3 需先有 `workflow_binding_type` 经 BFF 传到前端，**这个跨端字段链路 D3 未写依赖**；② **好消息**：新增 `form_record.status='TERMINATED'` **不需要改 `process-shell.tsx`**（它不消费该字段），前端枚举依赖在 `form-test-page.tsx`（见 §9 A3′） |
| **改动步骤** | D3 依赖显式改为 `C1, D1, D2`（原 `C1,D2`）；`form_record.status` 的渲染与筛选在 `form-test-page.tsx` 处理 |
| **工作量** | S（依赖修正） |

#### F-6 🔴 V149 CHECK 与 ADR-022 直接冲突，写库被 DB 拒绝（QA B1-c）

| 项 | 内容 |
|----|------|
| **位置** | `V149__form_workflow_binding.sql:35-47` `chk_form_def_workflow_binding` —— `EXTERNAL` 分支要求 `workflow_definition_id IS NULL` |
| **冲突** | ADR-022 要求 EXTERNAL 时蓝图**必填非空** ⇒ **V153 上线前，任何给 EXTERNAL 单据绑蓝图的写入都被 DB 直接拒绝**。这不是「待演进」，是**硬阻断** |
| **改动步骤** | V153 必须 `DROP CONSTRAINT IF EXISTS chk_form_def_workflow_binding` + 按新语义重建；**并在 DROP 之前加「存量 EXTERNAL 行断言」**（若库中已存在 `EXTERNAL + workflow_definition_id IS NULL` 的行，`ADD CONSTRAINT` 会**整表校验失败并回滚 ⇒ 发布卡死**）；建议**同名替换**（DROP 后 ADD 同名）而非换名 `_v2`，减少中间无约束窗口 |
| **工作量** | M（含在 A1） |

#### F-7 🔴 `PUT /{id}/supported-forms` 仍对外暴露，是唯一还在写旧列的活路径（QA B1-b）

| 项 | 内容 |
|----|------|
| **位置** | `WfDefinitionController.java:52-58`（`@PutMapping` 在 `:52`，方法体至 `:58`）→ `WfDefinitionService.java:153-161` `updateSupportedForms()` → `:157` 调 `validateSupportedForms()` 并 `:159` 写回 `def.setSupportedFormCodes()` |
| **双重后果** | ① 一旦被调用 ⇒ **互斥校验突然复活**，用**已废弃语义**拦截 EXTERNAL 蓝图配置；② 写回旧列后 `FormDefinitionService.delete():167-185` 的守卫（`:171-175` `countBySupportedFormCode`）立即生效 ⇒ 该表单**永久删不掉**，且报错文案「请先修改流程的表单白名单」把管理员**指向错误的真相源方向**（真相源已是 `form_definition.workflow_binding_type`） |
| **改动步骤** | ① **下线该端点**（返回 `VALIDATION_ERROR`「表单关联已迁至表单管理」）；② `FormDefinitionService.delete():167-185` 删除守卫改为查 `form_definition.workflow_binding_type`（自己这张表）+ 新增「EXTERNAL 蓝图被引用」守卫；③ 修正报错文案指向真相源 |
| **工作量** | **S**（端点下线）+ **S**（守卫改造） |
| **门禁** | **Gate-3**：A4 未完成 ⇒ 该端点仍可被调用 ⇒ 表单永久不可删 |

#### F-8 🔴 旧列互斥校验失效是「意外的帮」（风险登记，不改代码）

见 F-1。**必须在代码注释与本文档双处登记**：`V149` 清空旧列导致的互斥校验失效，**对 EXTERNAL 恰好有利但是意外**；任何「修复」动作都必须先确认不会阻断 EXTERNAL 多蓝图绑定。**这属于知识交接风险，不是代码缺陷** —— 故 A4 的 `validateSupportedForms()` 改造（改为反查真相源 + EXTERNAL 例外）**必须与本登记同时落地**，否则改造本身就会撞死 EXTERNAL。

### 8.4 任务归属：新增 **A4「双源收敛」**（QA B1 · M）

| 子项 | 内容 | 文件:行 | 工作量 |
|------|------|--------|------|
| A4-1 | `validateSupportedForms()` 改反查 `form_definition.workflow_binding_type`；**EXTERNAL 蓝图绑定不参与该互斥校验** | `WfDefinitionService.java:285-307`（校验体 `:299`） | M |
| A4-2 | **下线 `PUT /{id}/supported-forms`**（唯一还在写旧列的活路径） | `WfDefinitionController.java:52-58` + `WfDefinitionService.java:153-161` | S |
| A4-3 | 删除守卫改造：查真相源 + 新增「EXTERNAL 蓝图引用」守卫 + 修正文案 | `FormDefinitionService.java:167-185`（守卫 `:171-175`） | S |
| A4-4 | V153 加**存量 EXTERNAL 行断言**（F-6） | `V153__external_workflow_runtime_binding.sql` | S |

**依赖**：A1（V153）、A3（`FormDefinition` 字段映射，F-1/F-4 的反查依赖它）。**门禁**：Gate-3。  

---

## 9. 分阶段落地

### Phase A — 决策与模型

- [x] 规划文档（本文）+ ADR-022  
- [ ] 架构核实 §10.1（离开开始节点 / 发起人身份 / 会签）后回填 §4  
- [x] 产品拍板：驳回终态、无本地待办、提交才发、抄送警告可提交  
- [x] 🆕 **产品拍板 D5：外部撤销按 `TERMINATED` 处理，界面不提供撤销入口**（§0.1 / §5.1）
- [x] 🆕 **架构决定 D6：`form_record.status` 新增 `TERMINATED`**（§0.1 / §5.2，改动清单见任务 A3′）
- [x] 🆕 **产品拍板 D7 / 关闭 P-1**：EXTERNAL 同单不可再提；驳回与废弃统一「复制新建后再发」（§0.1 / §6.4）
- [ ] 🟡 **产品待拍板**：P-2（`EMBED_URL` 跨站鉴权可行性）—— 见 §0.2，**架构未自行决定**  

- [x] **架构核实完成**（2026-10-16）：见 [20-adapter contract](./20-external-workflow-adapter-contract.md)
- [ ] Flyway V153（绑定演进 + `external_workflow_system`）+ V154（`ext_process_instance` + **收件表** + 调用审计）→ DDL 草案见 20 文档 §6
- [ ] 🔴 **甲方前置**：现场确认外部模板槽位（清单 C-3）+ 申请 API 授权（清单 C-7）  
- [ ] 同步 `docs/project/decisions.md`、permissions（若有新菜单）

### Phase B — 致远适配器 P0

- [ ] 账号批量解析 + 失败明细  
- [ ] start（按 `draft_mode` 两套分支，**默认 `DIRECT_SEND`**）→ 逐槽位 freeReplaceNode →（`DRAFT_THEN_SEND` 时）activate
- [ ] fetch 状态 / 当前处理人（🟡 意见无接口，降级深链）
- [ ] 幂等发起 + `build_phase=FAILED` + **断点续拼（P0，已提级）**

### Phase C — 注入三模式

- [ ] FORM_JSON 映射  
- [ ] RICH_HTML 生成 + 清洗  
- [ ] EMBED_URL 长 token 路由 + 鉴权 + 只读（🔴 前置 C-12 / P-2 未定，可能整体降级）

### Phase D — 门户与管理台

- [ ] 发起人自检提交  
- [ ] 隐藏本地图形进度，展示外部状态 + 当前处理人 + 深链（意见区按能力隐藏）
- [ ] 轮询 Job（**`FOR UPDATE SKIP LOCKED` 领取式认领**；⛔ 禁用 `biz_exec_lock`）+ 回调入口  
- [ ] 「外部发起流程管理」列表  

### Phase E — 后置与消息

- [ ] 终态幂等触发原审批后任务（**`ext_terminal_event` 收件表 + 丢失型防护**，见 E1 专项）  
- [ ] 状态变化消息策略  

### 分阶段任务列表（有序 · 含依赖 · 工作量）

> 🔴 = **不可施工，须先联调/甲方确认**。S≈0.5~1 人日 / M≈2~3 人日 / L≈5 人日。

| # | 任务 | 依赖 | 工作量 | 阻塞 | 主要改动文件（相对路径） |
|---|------|------|--------|------|--------------------------|
| **A0** | 🔴 **甲方前置：外部模板槽位登记 + API 授权申请** | — | M | **C-3 / C-7** | 无代码。**产出物 = 「槽位 `activityId` 清单文档」（甲方提供，Excel/邮件即可）**；**录入动作归入 D1**（不再直接写库，见 QA I8） |
| A1 | 迁移 V153：绑定语义演进（`DROP CONSTRAINT` + 同名重建 + **存量 EXTERNAL 行断言** F-6）+ `inject_mode`/`embed_token`/`embed_token_revoked_at`/`external_node_slots`/`external_field_mapping` + `external_workflow_system`（含 **CSP/frame 祖先配置列**） | A0(并行可做) | M | — | `backend/mis-migrator/src/main/resources/db/migration/V153__external_workflow_runtime_binding.sql` |
| A2 | 迁移 V154：`ext_process_instance`（含 **`external_sent`**、`ABANDONED`、`command_id VARCHAR(128)`、**`uk_ext_inst_active` 谓词用 `external_sent = 1`**）+ **`ext_terminal_event` 收件表**（**`process_state` 固定 `DONE`、不参与判定、无补偿 Job**）+ `ext_workflow_call_log`（**含保留策略**）<br>🔴 **实施前逐字校对 DDL**（r4 的 D1/D2/D3 三处抄写错误全部出在这一段） | A1 | M | — | `backend/mis-migrator/src/main/resources/db/migration/V154__ext_process_instance.sql` |
| **A3** | 领域实体 + 仓储：`FormDefinition` 新增 **9 个**字段映射（F-4）+ 完整读写路径 + **供 A4 反查的方法**；新增 `ExtProcessInstance` / `ExternalWorkflowSystem` / **`ExtTerminalEvent`** / `ExtWorkflowCallLog` + Repository | A1,A2 | **L** | — | `backend/mis-taskflow/src/main/java/com/mis/taskflow/domain/entity/`、`.../domain/repository/` |
| **A3′** | 🆕 **`form_record.status='TERMINATED'` 落地（D6）**：<br>① `FormRecord.java` 加常量 `STATUS_TERMINATED = "TERMINATED"`（`:19-23`）<br>② `form-test-page.tsx` `RECORD_STATUS` 映射加 `TERMINATED: {text:'已终止'}`（`:58-64`）<br>③ 同文件状态筛选下拉加 `<option value="TERMINATED">已终止</option>`（`:446-450`）<br>④ V153 加 `form_record.status` 值域 CHECK（**可选加固**，见下方说明）<br>**🔴 不需要改 `process-shell.tsx`**（已核实该文件不读 `form_record.status`） | A1 | **S** | — | `FormRecord.java:19-23`、`frontend/mis-admin-web/src/features/taskflow/form-test-page.tsx:58-64` 与 `:446-450`、V153 |
| **A4** | 🔴 **双源收敛**（详见 §8.4）：`validateSupportedForms()` 改反查 `workflow_binding_type`（EXTERNAL 例外）；**下线 `PUT /{id}/supported-forms`**；`FormDefinitionService.delete():167-185` 守卫改造 + 修正文案 | A1,A3 | **M** | — | `WfDefinitionController.java:52-58`、`WfDefinitionService.java:153-161` 与 `:285-307`、`FormDefinitionService.java:167-185` |
| B1 | 🔴 **Adapter 契约 + 认证骨架**（`ExternalWorkflowAdapter` 接口、DTO、`capabilities` 能力探测、`api_flavor` 切换 V5_REST/V8_OPENAPI、`endpoint_config` 端点读取） | A0 | M | **C-5 / C-7** | 新增 `.../ext/adapter/ExternalWorkflowAdapter.java`、`.../ext/adapter/dto/*.java`、`.../ext/config/ExtWorkflowProperties.java` |
| B2 | 账号解析 `resolveAccounts`（全量 `orgMembers/all/{accountId}` + 本地缓存 + `phone_field_path` 多级回退 + 失败明细） | B1 | M | **C-4** | 新增 `.../ext/adapter/SeyonOrgAdapter.java`、`.../ext/service/ExtAccountResolveService.java` |
| **B2′** | 🔴 **EXTERNAL 编辑/再发起拦截**（F-3 / QA B2）：`requireMineEditable()` 与 `toVo()` 的 `canEdit`/`canStart`/`canWithdraw` 按 `workflow_binding_type` 分流。**🔴 只在 EXTERNAL 分支加拦截，不得触碰 LOCAL 分支任何既有条件**；补双侧回归用例 | A3,B2 | **M** | — | `FormRecordService.java:79`（调用点）、`:164-171`（归一逻辑）、`:179-181`（`canEdit`/`canStart`/`canWithdraw`） |
| B3 | 🔴 **发起序列编排**：按 `draft_mode` 两套分支 → 逐槽位 `assignNode` →（`DRAFT_THEN_SEND` 时）`activate`；`build_phase` 状态机、**`external_sent` 置位（start 返回 caseId 时置 1，N1）**、**`assigned_slots` 断点续拼（P0）**、幂等 `command_id`（**对同一次业务发起稳定不变**）、`form_record` 行 `FOR UPDATE`（F-2） | B2′,A2 | **L** | **C-1 / C-3** | 新增 `.../ext/service/ExtWorkflowLaunchService.java`、`.../ext/service/ExtBuildStateMachine.java` |
| B4 | 查询与状态映射 `fetch`：状态枚举映射（`status_mapping`，**管理台保存时校验 + 启动 fail-fast** N4）、当前节点/处理人、意见（🟡 恒缺，C-2）、未识别状态拒绝落库 + 按 `(external_system, raw_status)` 聚合退避 + 告警、**终态单调性**、**撤销/终止全部候选值统一映射 `TERMINATED`**（C-13） | B3 | M | **C-2 / C-6 / C-13** | 新增 `.../ext/service/ExtSyncService.java`、`.../ext/support/ExtStatusMapper.java`、`.../ext/support/StatusMappingRegistry.java` |
| B5 | 注入三模式：FORM_JSON 映射 / RICH_HTML 清洗 / EMBED_URL token 路由 + 鉴权 + 只读 + 吊销（🔴 前置 C-12 / **P-2 待产品确认**） | B3 | **L** | **C-12** | 新增 `.../ext/support/InjectPayloadBuilder.java`、`.../ext/support/RichHtmlSanitizer.java`、路由 `.../controller/EmbedFormController.java` |
| C1 | 定时拉取 Job（扫 `idx_ext_inst_polling`，仅非终态，**🔴 用 `FOR UPDATE SKIP LOCKED` + `LIMIT` 领取式认领，禁止用 `biz_exec_lock`** —— 见 §7 N2 专项）+ 打开单据强制 sync + 手工重同步 + 按 `(external_system, raw_status)` 聚合退避 | A2,B4 | M | C-6 | 新增 `.../service/ExtSyncScheduler.java`（🔴 **不引入 `DistributedLockService`**） |
| C2 | 回调入口 `notifyUrl`（**统一走 `ext_terminal_event` 收件表**，见 E1 专项）；无回调时退化为纯轮询 | B4 | M | C-7 | 新增 `.../controller/ExtCallbackController.java` |
| **C3** | 🔴 **终止**（`terminate`，P0）+ **废弃**（`ABANDONED`+`stop` 清孤儿）+ **复制新建**（D7：新 `form_record` 拷贝字段，旧单不可再提）。🔴 **不实现 `revoke`**（D5）。文案勿再暗示「同单重提」 | B3 | M | **D7** | `ExtWorkflowLaunchService` + FormRecord 复制 API |
| D1 | BFF 接入 V149 外部字段 + EXTERNAL 绑定管理端 CRUD（含槽位登记、字段映射、模板 code） | A1,A3 | M | — | `backend/mis-taskflow/src/main/java/com/mis/taskflow/controller/FormDefinitionController.java`、`.../dto/` |
| D2 | 发起人自检提交（防抖、槽位校验、缺人阻断/警告分级、build_phase 展示、废弃重建） | C1,D1 | **L** | — | `frontend/mis-admin-web/src/features/taskflow/process-shell.tsx`（+ 同名 test） |
| D3 | EXTERNAL 分支 UI：隐藏本地图形进度、展示外部状态/当前处理人、**意见区按 `capabilities` 隐藏或降级为深链**（🟡 P0 范围**不含**意见查询实现） | C1,**D1**,D2 | M | C-2 | 同上 + 新增 `frontend/mis-admin-web/src/features/taskflow/ext-progress-panel.tsx` |
| D4 | 外部发起流程管理台（时段/状态/表单/发起人筛选；查看、手工重同步、**终止**、废弃重建；**无撤销按钮**） | C1,D1 | M | — | 新增 `frontend/mis-admin-web/src/features/taskflow/ext-launch-console-page.tsx` |
| **E1** | 🔴 **后置任务幂等触发 + 丢失型防护**（**单事务方案，见下方专项**；**不引入补偿 Job**，N3）+ 状态变化消息策略（仅状态变化/关键人/终态，防风暴） | C2 | **L**（原 M ↑） | — | `.../service/ExecutionTaskService.java`、`.../service/MessageService.java`、新增 `.../ext/service/ExtTerminalEventService.java` |
| E2 | 联调收敛：按 20 文档 §5 清单逐项填配置（`status_mapping`/`endpoint_config`/`draft_mode`/`phone_field_path`），跑通最小验收 | A0~E1 | **L** | **全部 C-x** | 仅改 `external_workflow_system` 配置行 |
| E3 | 文档同步：`docs/project/decisions.md`、权限/菜单、运维手册（外部系统接入配置） | E2 | S | — | 文档 |

**关键路径**：`A0 → (Gate-1) → B3 → B4 → C1 → D2 → D3 → E2`
**可并行**：`A1‖A2‖A0‖A3′‖A4`、`C1‖C2‖C3`、`D1‖C2`、`D4‖D3`

**门禁（Gate）**：
- **Gate-1（三个并列前置，缺一不可）**：
  - ① **C-3 外部模板槽位 `activityId` 清单**（A0 产出文档，录入归 D1）⇒ 否则 B3 无映射目标，**Phase B 不得开工**
  - ② 🆕 **C-6 流程状态枚举**（QA I2 要求从 Phase E 提前到 Phase B 之前）⇒ 状态映射是整个联动链路的地基，且是**唯一**能防住「合法枚举值被映射错 → 终止单据被判通过 → `FINALIZE_BIZ` 业务动作错误执行」的防线。原方案映射代码 Phase B 写、枚举 Phase E 验，**顺序倒了**
  - ③ 🆕 **C-12 EMBED_URL 跨站 iframe 鉴权可行性**（待产品确认 **P-2**）⇒ 若登录态与签名皆不可行，B5（工作量 **L**）须从 **P0 降级为 P1**，**不能让 L 级任务建在未验证前提上**
- **Gate-2**：C-1 **公开侧已关闭**（P0=`DIRECT_SEND`）/ C-4 有结论 → 否则 E2 无法验收；`DRAFT_THEN_SEND` 不在 Gate-2 必选项
- **Gate-3**：A4 完成 → `PUT /{id}/supported-forms` 若仍对外暴露，写回旧列会触发删除守卫，使表单永久不可删
- **Gate-4** 🆕：**C-13 撤销/终止可判定性** ⇒ **不阻塞开工**（统一 `TERMINATED` 使其不影响正确性），但 `status_mapping` 配置**必须包含全部撤销/终止候选值**（`cancel=2` / `5` / `terminate=1` / `15`），否则撤销的单据会因「未识别」而永久停在 `RUNNING`

> ⚠️ **A3 范围修正（据 QA B5 实测）**：`FormDefinition` 实体实测仅 13 个字段，**V149 四列（`workflow_binding_type` / `workflow_definition_id` / `external_workflow_system` / `external_workflow_ref`）在 Java 侧零命中** —— 即 **LOCAL 绑定链路当前也是断的**，不只是缺 EXTERNAL。A3 需新增 **9 个字段映射**（含 `inject_mode` / `embed_token` / `embed_token_revoked_at` / `external_node_slots` / `external_field_mapping`）**及完整读写路径**，工作量由 M 上修为 **L**。

> ⚠️ **A3′ 是否需要 DDL（架构已实测核实，可直接施工）**：
> **实测结论**：`form_record.status` 在 `V150__form_record_and_pur_form_store.sql:16` 是**裸 `VARCHAR(16) NOT NULL DEFAULT 'SAVED'`** —— 已 grep 全部 migration 脚本确认：**全仓无任何 CHECK 约束、无 PostgreSQL enum 类型、无 `ALTER TABLE form_record`**。因此：
>
> | 项 | 是否必须 | 说明 |
> |----|---------|------|
> | Java 常量 `STATUS_TERMINATED` | ✅ **必须** | 否则无法写入该状态 |
> | 前端 `RECORD_STATUS` 映射 | ✅ **必须** | `form-test-page.tsx:514` 是 `RECORD_STATUS[item.status] ?? RECORD_STATUS.SAVED` —— **缺失会静默回落成「保存态」显示**，语义误导且看不出是终态 |
> | 前端状态筛选下拉 | ✅ **必须** | 否则管理页**筛不出** `TERMINATED` 单据 |
> | DDL（CHECK 约束） | ⚪ **可选加固** | 仓库既有风格（`chk_form_def_workflow_binding`、`biz_exec_lock.status` 注释）都显式列枚举值域，**建议加**。代价：将来新增状态须再改约束。**长度已核实安全**：`TERMINATED`(10) 与 `ABANDONED`(9) 均 ≤ `VARCHAR(16)`，无截断风险 |
> | 🔴 `process-shell.tsx` | ❌ **不需要改** | 已实测：该文件（703 行）**不读 `form_record.status`**，它消费的是 `wf_instance.status`（`instance.status === 'RUNNING'` / `'WITHDRAWN'`）与 `detail.canWithdraw`。前端枚举依赖在 `form-test-page.tsx` |
>
> 🔴 **无论是否加 CHECK，都已核实 `toVo()` 三个 `can*` 判定无需改动** —— `TERMINATED` 不在 `{SAVED, REJECTED}` 白名单内 ⇒ `canEdit=false` / `canStart=false` **天然成立**（详见 §5.2）。

#### 🔴 E1 专项：幂等必须**同时挡住「重复」与「丢失」**（QA B4-③）

**问题**：`ext_terminal_event` 插入与 `biz_execution_task` 投递若不在同一事务，会产生**丢失型缺陷**：

```
先插 terminal_event（标记已处理）→ 投递 FINALIZE_BIZ 时崩溃
⇒ 后置任务永久丢失且永不重试（下次轮询见已存在 ⇒ 认为已处理而跳过）
```

**「重复执行」与「永久丢失」是方向相反的两种故障，幂等必须同时挡住两个**：

| 故障型 | 触发条件 | 表现 | 发现难度 |
|-------|---------|------|---------|
| **重复型** | 轮询与回调同时到达，双方都判「未处理」 | 后置任务执行两次 ⇒ **重复发货 / 重复建单** | 🟡 中（业务侧异常数据会暴露） |
| **丢失型** | 收件表已写、投递前崩溃 | 后置任务**永不执行** ⇒ 单据卡在审批中，业务以为已通过 | 🔴 **高 —— 静默的** |

> **丢失型比重复型更难发现**：重复会报错（异常数据、重复单据至少会被人注意到）；**丢失是静默的** —— 后置任务「本就不该执行」时不可见，不会有任何告警，单据只是永远停在审批中。因此设计必须**优先保证不丢**，再保证不重。

**设计结论（r3 修正 · N3）：单事务即已彻底消除丢失型 ⇒ 删掉补偿 Job，`process_state` 降为两值**

r2 的设计有**两个互斥的环**（QA 指出，核对后成立）：

| r2 的写法 | 矛盾 |
|-----------|------|
| 环②「置 `DONE`」在**同一事务内** | ⇒ committed 行永远是 `DONE` ⇒ **补偿 Job（环③）是死代码**，永不命中 |
| 环②「置 `DONE`」在**事务提交后** | ⇒ 就不是同事务了 ⇒ 崩溃窗口重新出现 ⇒ **回到丢失型缺陷** |
| 环③ 论证安全性时称"`enqueue` 会查重" | 🔴 **不成立**：实测 `ExecutionTaskService.enqueue():64-81` 是**无条件 `taskRepository.save(task)`，无任何 exists 检查**，且 `biz_execution_task` **无唯一约束** ⇒ 补偿重投会**真的重复投递** |

**⇒ 采纳 QA 的推荐方案 A：单事务 + 无补偿环。** 已核实 `ext_terminal_event` 与 `biz_execution_task` **同库**（同一个 mis-migrator schema），**可以放进同一个 `@Transactional`**：

| 环节 | 做法 |
|------|------|
| **① 幂等判定（原子）** | `INSERT INTO ext_terminal_event(...) ON CONFLICT DO NOTHING RETURNING id` |
| **② 返回 0 行** | ⇒ 该 `(tenant, system, caseId)` 已收过终态 ⇒ 判定「已处理」⇒ **直接结束，不投递**（与 `terminal_status` 是否相同无关） |
| **③ 返回 1 行** | ⇒ 同一事务内继续：更新 `ext_status` / `form_record` + `ExecutionTaskService.enqueue()` + 置 `process_state='DONE'` |
| **④ 原子性保证** | ①②③ 同事务 ⇒ **要么全成（收件行 + 后置任务都在），要么全败（下次轮询/回调重试即可）** |

**为什么单事务就足够（丢失型已被消除）**：

- r2 担心的丢失窗口是「收件行已提交、投递未提交」。**同事务后这个窗口不存在** —— 两者要么同时可见，要么同时不可见。
- 崩溃发生在事务提交**前** ⇒ 全部回滚 ⇒ 下次轮询**看不到收件行** ⇒ 会重新处理 ⇒ **不丢**。
- 崩溃发生在事务提交**后** ⇒ 收件行与后置任务**都已存在** ⇒ 后置任务会被 `scanAndExecute()` 正常捞起执行 ⇒ **不丢**。
- **并发重复**由 `ON CONFLICT` 的原子性挡住（两个入口只有一个拿到 `id`），**与补偿机制无关**。

**⇒ 因此 `process_state` 简化为两值**（`DONE` / 未写入），**不需要 `PENDING`**：

> 🔴 **若将来确实要引入补偿重投**（例如收件表与任务表分库），**不能靠应用层时序判断去重** —— 必须同时提供 DB 级方案（给 `biz_execution_task` 加 `UNIQUE (biz_type, biz_ref_id, action_type)`，或让补偿 Job 也走 `ON CONFLICT`）。**本轮不引入补偿 Job，因为单事务已够用，多加一个死代码环反而掩盖了真正的原子性保证。**

**为什么 E1 工作量 M → L**：新增收件表实体 + Repository + **两条入口（轮询 / 回调）统一改造** + **事务边界设计**（跨外部 HTTP 调用的分段处理）+ **一致性测试**（至少 3 例：① 并发双投只产生 1 条任务；② 投递前崩溃 → 回滚 → 重试后正常产生 1 条；③ 重复投递不产生第 2 条）。

### 最小验收

配置一类业务表单 → 发起人提交 → 致远出现 N 级审批，且该发起人在致远「已发 / 我发起的」能打开 → 本地 `IN_PROCESS` / `RUNNING` → 外部通过后本地 `APPROVED` 且后置任务只执行一次 → 管理台按时段 / 状态可查。

---

## 10. 待确认清单（产品）

| # | 问题 | 结论 |
|---|------|------|
| 1 | freeReplaceNode 之后如何离开开始节点 | **公开文档已复核（2026-10-24）**：`draft=1` 保存待发 ✅；**无**独立「送出待发」章节（V5 REST / V8 均未明示对已有 case 二次送出）。→ **P0 锁定 `DIRECT_SEND`**；`DRAFT_THEN_SEND` 仅沙箱翻案后按租户启用。**C-1 公开侧关闭** |
| 1b | start 如何指定发起人 | **已定契约**：`initiatorRef` **必填显式传**。V5 REST 用 `senderLoginName`✅；V8 OpenAPI 用 `data.userCode`✅（`bpm/process/start` 参数表未列发送人字段，需确认是否取 token 主体）。能否进「已发 / 我发起的」= 🟡 推断（creator 归属正确即在已发），**联调实测确认** |
| 2 | 会签展开方式 | **已核实**：`freeReplaceNode` 的 `data.userId` **支持多人**✅。会签/或签由模板节点属性决定，平台不可控 → **P0 放开多人，不承诺会签语义，UI 不暴露会签/或签** |
| 2b | 外部模板槽位映射（新增） | **🔴 阻塞**：`freeReplaceNode` 是替换非追加，外部模板须预置 N 个槽位，蓝图节点数 ≤ N。槽位 `activityId` 需甲方提供并登记到 `external_node_slots`。**阻塞 C-3** |
| 2c | 审批意见/轨迹查询 | **🔴 未知**：REST 与 V8 OpenAPI **均无查询接口**。回退：隐藏意见区 + 深链跳转致远（`URLLINK`✅）。**阻塞 C-2** |
| 2d | 人员手机号字段 | **🔴 未知**：人员对象未见 `mobile`，仅见 `telNumber`/`properties.telnumber`；「按手机号取人员信息」接口路径未公开。→ `phone_field_path` 多级回退配置。**阻塞 C-4** |
| 2e | 流程状态枚举 | **🔴 未知**：`/flow/state/{flowId}` 官方映射表是图片未抓到 → `status_mapping` 配置化，未识别时拒绝落库 + 退避 + 告警。**启动 fail-fast**。**🔴 已提升为 Gate-1**（原 Phase E 才验，顺序倒置）**阻塞 C-6** |
| **2f** | 🆕 **撤销 / 终止的可判定性** | **🟡 不确定，且不影响正确性**：多套枚举来源冲突（官方 `cancel=2`/`terminate=1`；第三方 `5`=撤销 /`15`=终止；`ctp_affair.STATE` 亦可区分）。⇒ **平台统一按 `TERMINATED` 处理**，无论能否区分结果相同。**阻塞 C-13（Gate-4，不阻塞开工）** |
| **2g** | 🆕 **外部撤销 vs 终止是否要区分展示** | **🟢 已定（D5）**：**不区分**。界面不提供撤销入口；外部侧发生的撤销同步为 `TERMINATED`。仅 `raw_status` 保留原值供排障 |
| 3 | 外部驳回后 form_record 态 | **已定**：`REJECTED` 终态，不回 `SAVED`，本单不可再提 |
| 4 | EXTERNAL 本地待办 | **已定**：完全不写 `sys_task`，收件箱无本地审批待办 |
| 5 | 保存是否自动发起 | **已定**：否。保存只落本地；发起人点「提交」才走外部发起序列（预解析→start→拼节点→activate） |
| 6 | 抄送缺人 | **已定**：警告可提交；审批缺人、发起人缺号仍禁止 |

### 10.1 架构核实结论（已完成 2026-10-16）

**核实对象**：致远 V5 REST APIdoc（open.seeyon.com）、V8 OpenAPI（open.seeyoncloud.com）、V8 SP1 产品手册；**未接触企业版现场环境**。
**完整证据、对照表、适配器契约与 11 项联调清单见 [20-external-workflow-adapter-contract.md](./20-external-workflow-adapter-contract.md)。**

| 核实项 | 结论 | 等级 | 对方案的影响 |
|--------|------|------|-------------|
| 离开开始节点 | `POST /seeyon/rest/bpm/process/start` 的 `data.draft`：`1`=保存待发 / `0`=新建-发送。**「不落开始节点」成立** | ✅ 确证 | §4 步骤 3 成立 |
| 「送出待发」接口 | REST/OpenAPI **无**「已有 caseId → 送出」条文（2026-10-24 复核） | 🔴 公开未证实 | **P0 锁定 `DIRECT_SEND`**；`DRAFT_THEN_SEND` 非默认；**C-1 公开侧关闭** |
| 发起人身份 | V5：`senderLoginName`✅；V8：`data.userCode`（必填）✅；「进已发」= creator 归属 → 🟡 推断 | ✅/🟡 | Adapter `start()` 强制 `initiatorRef` 显式参数，禁止隐式取 token 主体；**C-5 阻塞** |
| 同节点多人 | `freeReplaceNode` 的 `data.userId` 为数组，官方示例含 2 个元素 | ✅ 确证 | **放开多人**（原规划「P0 只允许串行单人」作废） |
| 会签语义 | 由模板节点 nodePolicy 决定，`freeReplaceNode` 只填人 | 🟡 推断 | 平台不承诺会签语义；UI 不暴露会签/或签 |
| 🔴 **freeReplaceNode 语义修正** | 官方描述为「**替换**流程节点…立即生效」，参数为 `activityId`（要替换的节点） | ✅ 确证 | **原 §4「循环追加下一级」错误**。改为「模板预置 N 槽位 + 逐槽位替换」，蓝图节点数 ≤ 槽位数，超出拒绝。**C-3 阻塞，Phase B 前置** |
| 账号批量解析 | `GET /seeyon/rest/orgMembers/all/{accountId}`（单位全量，含停用）✅；人员对象含 `id`/`orgAccountId`/`loginName`/`code`/`telNumber`/`properties.telnumber`，**未见 `mobile`** | ✅/🔴 | 「按手机号取人员信息」接口**路径未公开**；手机号字段需多级回退。**C-4 阻塞** |
| 流程状态查询 | `GET /seeyon/rest/flow/state/{flowId}`（flowId=summaryId）✅ 路径；**枚举值映射表为图片，未抓到** | ✅/🔴 | `status_mapping` 配置化；未识别时拒绝轮询并告警，**不猜**。**C-6 阻塞** |
| 审批意见/历史查询 | **REST 25 接口与 V8 OpenAPI 均无查询接口** | 🔴 未知 | 意见展示降级为深链跳转致远。**C-2 阻塞** |
| 终止 | `POST /seeyon/rest/affair/stop`（`affairId`/`repealComment`/`member`）✅；V8 `/bpm/case/stop` ✅ | ✅ 确证 | `terminate` **P0 实现**（界面向用户暴露） |
| 撤销 | `POST /seeyon/rest/affair/cancel`（`affairId`/`summaryId`/`member`）✅；V8 `/bpm/case/cancel` ✅ | ✅ 确证 | 🔴 **平台不调用**（D5：界面不提供撤销入口）。仅当**外部侧**发生撤销时由**轮询识别为 `TERMINATED`** ⇒ **不实现 `revoke` 方法**。**阻塞 C-13** |
| 🆕 **`form_record.status` 值域** | **无 CHECK 约束**：`V150:16` 是裸 `VARCHAR(16) NOT NULL DEFAULT 'SAVED'`；已 grep 全部 migration 确认无 CHECK / 无 PG enum / 无 `ALTER TABLE form_record`。前端枚举在 `form-test-page.tsx:58-64` 与筛选 `:446-450`；`process-shell.tsx` **不读该字段** | ✅ 确证（本地） | **D6：新增 `TERMINATED`**，改动清单见 A3′（S 级，无强制 DDL） |
| 当前待办人员 | `GET /seeyon/rest/flow/dostaff/{summaryId}` ✅ | ✅ 确证 | `fetch()` 可组装状态+当前处理人 |
| V8 OpenAPI 幂等 | `requestId` + `timestamp`(±5min) + `data.commandId` + `data.redo` | ✅ 确证 | **P0 建议改走 V8 OpenAPI**：发起人显式 + 自带幂等 + `notifyUrl` 回调 |
| 版本/授权 | 需甲方「启用 API + 新建接入应用 + AppKey/Secret + IP 白名单」 | 🔴 未知 | 决定走 V5 REST 还是 V8 OpenAPI。**C-7 阻塞，需提前 1~2 周申请** |

**结论**：三个原始问题（离开开始节点 / 发起人身份 / 会签）**均已从「完全未知」推进到「有文档依据 + 契约化 + 可配置回退」**。**C-1（2026-10-24）**：公开文档**未证实**独立「送出待发」⇒ **P0 锁定 `DIRECT_SEND`**，公开侧关闭；其余阻塞仍为 C-2 / C-3 / C-4 / C-6，其中 **C-3 最高优先级**：不解决则「蓝图节点数 ≤ 模板槽位数」硬约束无法落地，Phase B 不能开工。

---

## 11. 相关代码与迁移（现状）

| 路径 | 说明 |
|------|------|
| `V149__form_workflow_binding.sql` | NONE/LOCAL/EXTERNAL 互斥落库（`:35-47` CHECK，**待 V153 演进**）；`:85-88` **已把 `supported_form_codes` 全表清空** |
| `V150__form_record_and_pur_form_store.sql` | form_record 生命周期（`:16` status = **裸 `VARCHAR(16)`，无 CHECK**） |
| `V121__*.sql` | `biz_execution_task`（**无唯一约束**，`enqueue()` 无条件 save ⇒ 后置任务幂等不能靠它）+ **`biz_exec_lock`**（`:152`，PK=`(biz_type,biz_id)`）—— 🔴 **实测为「一次性幂等账本」非互斥量，轮询禁用**，见 §7 N2 专项 |
| `FormRecord.java` | 单据状态常量（`:19-23`，**5 个，无 `TERMINATED`** ⇒ D6 新增第 6 个） |
| `FormRecordService.java` | `:114` **无行锁**（F-2）；`:164-171` **REJECTED→SAVED 归一**（F-3）；`:179-181` `canEdit`/`canStart` |
| `ProcessService.java` | LOCAL 启动 / 撤回(`:447-463` 严格前置) / 同步单据(`:499-511` `syncFormRecordStatus`，**仅 LOCAL 路径**) |
| `WfDefinitionService.java` | `:285-307` 互斥校验（**已失效**，F-1）；`:153-161` `updateSupportedForms()`（唯一写旧列活路径，F-7） |
| `WfDefinitionController.java` | `:52-58` `PUT /{id}/supported-forms`（**须下线**，F-7） |
| `FormDefinitionService.java` | `:167-185` 删除守卫（`:171-175` 查旧列，须改造，F-7） |
| `FormDefinition.java` | **完全未映射 V149 任何一列**（F-4）—— LOCAL 绑定链路当前也是断的 |
| `process-shell.tsx` | 套壳审批 UI（703 行；**不读 `form_record.status`**，EXTERNAL 分支需新增，零命中） |
| `form-test-page.tsx` | 单据列表页（`:58-64` `RECORD_STATUS` 映射、`:446-450` 状态筛选、`:514` 缺失回落 `SAVED` ⇒ **D6 必须改此文件**） |

---

## 12. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-10-16 | 首版规划：能力、绑定、致远序列、状态对照、漏洞、分期 |
| 2026-10-16 | 发起时必须把发起人写入外部流程，使其在外部系统可直接查看 |
| 2026-10-16 | 已定：外部驳回 → `REJECTED` 终态；EXTERNAL 完全不产生本地待办 |
| 2026-10-16 | 已定：抄送缺人警告可提交；保存不自动发起，「提交」= 走外部发起序列 |
| 2026-10-16 | 1 / 1b / 2 改为待架构对照致远文档核实（§10.1） |
| 2026-10-16 | **架构核实完成**：§10.1 三问全部收敛（确证/推断/未知分级）；🔴 **修正 freeReplaceNode 语义为「替换预置节点」而非追加**，蓝图节点数须 ≤ 外部模板槽位数；§4 序列重排；§10 补 4 项新阻塞；新增 [20-adapter contract](./20-external-workflow-adapter-contract.md)（证据、对照表、Adapter 契约、V153/V154 DDL 草案、11 项联调清单、R1~R9 风险）；§9 补 A0~E3 有序任务分解 |
| **2026-10-16 (r2)** | **🆕 落地产品决策 D5「外部撤销 → `TERMINATED`」**：新增 §0 决策台账；§5.1 补撤销/终止合并说明 + **三条硬约束**（界面不提供撤销入口 / 外部撤销一律按 `TERMINATED` / 不新增 `CANCELLED`）+ **LOCAL 与 EXTERNAL 语义差异的主动取舍论证**（引 `ProcessService.java:447-463` 实测）；§5.2 补 `TERMINATED` 映射；§6.3 补**显式「不得顺手对齐」约束**；§6.4 补**让位机制统一分析**（`TERMINATED` 与 `ABANDONED` 互不冲突，同一 `uk_ext_inst_active` 机制）；新增 **C-13**（撤销可判定性） |
| **2026-10-16 (r2)** | **🆕 D6：新增 `form_record.status='TERMINATED'`**。**已实测核实：`form_record.status` 无 CHECK 约束（`V150:16` 裸 `VARCHAR(16)`）⇒ 无强制 DDL**；前端枚举在 `form-test-page.tsx`（**不是 `process-shell.tsx`**，后者不读该字段）⇒ 改动清单 = 任务 **A3′（S 级）**；`toVo()` 三个 `can*` 判定已核实无需改（`TERMINATED` 天然落在白名单外） |
| **2026-10-16 (r2)** | **吸收 QA 21 报告全部 12 条定点补丁**：§8.3 重写为 F-1~F-8 完整冲突清单（含文件:行号 + 步骤 + 工作量）；新增 **A3′/B2′** 任务与 **A4 双源收敛**（M）；§4 `draft_mode` 分支上移至步骤 3 + 默认改 `DIRECT_SEND`；断点续拼提为 **P0**；`ext_status` 增 `ABANDONED`；新增 `ext_terminal_event` 收件表 + **E1 丢失型缺陷专项设计**（M→L）；§7 补 `biz_exec_lock`；C-6 提到 **Gate-1**、`status_mapping` **启动 fail-fast**；补**终态单调性**硬约束；4 处「审批意见」承诺统一降级为深链；§8.1 编号修复 |
| **2026-10-16 (r2)** | **🟡 保留两项待产品确认（架构未自行决定）**：**P-1** `ABANDONED` 与「同一单据不可再提交」的边界（§6.4）；**P-2** `EMBED_URL` 跨站鉴权可行性（C-12），若不可行 `B5`（L）须从 P0 降级 |
| **2026-10-16 (r3)** | **🔴 N1 修正（r2 两个改动合在一起出事 · QA 复审发现）**：`uk_ext_inst_active` 谓词从「排除 `build_phase='FAILED'`」改为按 **`external_sent`**（外部是否已真实发出）。因 `draft_mode` 默认改 `DIRECT_SEND` 后，外部流程在 `build_phase` 仍是 `DRAFTED` 时**就已真实发出** ⇒ 原「失败行自动让槽」会造成**致远出现第二个流程**、第一个成孤儿，并连带废掉 P0 的「断点续拼」与「废弃并重建」按钮。含 [已有映射] 分派改写 + **N1-a~d 验收用例**（§6.4） |
| **2026-10-16 (r3)** | **🔴 N2 修正（r2 误引组件语义 · 主理人已独立复核确认）**：**`biz_exec_lock` 是「一次性幂等账本」不是互斥量** —— 实测 `runAction():98` 写 `SUCCESS`、`executeWithLock():65-66` 见 `SUCCESS` 直接 return、`:70` 只删 FAILED、`:80` 只删超时 RUNNING、**全仓无生产代码清 `SUCCESS`** ⇒ 若用于轮询则**每实例只轮询一次、外部状态永久冻结 ⇒ 外部撤销永不识别为 `TERMINATED`，直接击穿 D5**。**改用 `FOR UPDATE SKIP LOCKED` + `LIMIT`**（§7 新增 N2 专项，含完整 SQL 与三条实现约束）；**⛔ 轮询禁用 `biz_exec_lock`**（20§8 第 14 条） |
| **2026-10-16 (r3)** | **🟡 N3 修正（E1 两环互斥 · 采纳 QA 方案 A）**：`process_state` 降为两值、**删除补偿 Job**（同事务 ⇒ 补偿是死代码；异事务 ⇒ 丢失窗口重现）；且 r2 论证补偿安全所称的「`enqueue` 查重」**实测不存在**（`ExecutionTaskService.enqueue():64-81` 无条件 save）。**已核实两表同库 ⇒ 单事务原子性即彻底消除丢失型**；E1 专项重写 |
| **2026-10-16 (r3)** | **🟡 N4 修正**：`status_mapping` 增加**管理台保存时校验（主）**，`fail-fast` 降为存量兜底 —— 因该配置由**运行期 CRUD 写入**，只做启动 fail-fast 拦不住运行期新增的错配置 |
| **2026-10-16 (r3)** | **🟢 N5**：告警与退避聚合粒度统一为 **`(external_system, raw_status)`**（§7 / §8.2 第 10 条 / R1 三处对齐；单据只记 `sync_error`，退避计数落聚合层） |
| **2026-10-16 (r3)** | **🟢 顺带吸收 QA 22 的 N6 四项**：① 「永久卡在 `RUNNING`」→ 改为「**无告警则无限期停留 `RUNNING`，管理台「终止」可人工出口**」（存在人工出口，影响产品对可接受性的判断）；② **F-3 定性从「正在发生的矛盾」改为「latent 缺陷，EXTERNAL 落地瞬间触发」** —— 实测 `syncFormRecordStatus` 三个调用点只传 `SAVED`/`APPROVED`，**全仓无代码写 `form_record=REJECTED`** ⇒ LOCAL 下 `:169-171` 是死代码；**结论不变（B2′ 仍必须做，且必须与 B4 同批上线），但措辞必须改**，避免开发者误以为 LOCAL 现在就有此 bug 而去「顺手修」；③ **S1澄清**（20§6.2 + §8 第 17 条）：`external_workflow_ref`(256)=绑定真相源 / `ext_template_code`(128)=发起快照，**长度不同是有意的**，禁止用快照驱动业务；④ **行号校准**：`validateSupportedForms` `:285-308→285-307`、`WfDefinitionController` `:51-57→52-58`、`FormDefinitionService.delete()` 守卫 `:173-176→171-175`、`startProcess` 读取 `:112→114`。另补**终态单调性的命名落点**（`ExtSyncService.applySnapshot()` 内、`save()` 之前），防实现成没人调用的校验方法 |
| **2026-10-16 (r4)** | **✅ 吸收 QA R3 回归的 D1~D4（20§6.2 DDL 草案抄写错误，主理人已复核为真）**：**D2** 谓词方向写反（已改 `external_sent = 1`，**这是唯一实施阻断**）、**D1** 漏空格、**D3** duplicate column、**D4** 注释第二分支错误。本文档（19）的 N1 散文描述经核对**本来就是对的**（`:272`「谓词排除 `external_sent=0`」），错的是 20 的可粘贴 SQL |
| **2026-10-16 (r4)** | **🟡 补 QA 补充 a：`external_sent` 的 `start` 超时/网络中断缺口** —— 致远可能已建流程但本地没收到 `caseId` ⇒ `external_sent=0` 让位 ⇒ 第二个流程。§4 新增缺口专项：**让位前先按 `command_id` 核对外部**（三步），并诚实标注「V5 REST 无 `commandId` 参数 ⇒ 走 V5 时无法完全消除」（这是建议走 V8 的**第四条**理由）；§4 [已有映射] 与 §8.2 第 14 条同步 |
| **2026-10-16 (r4)** | **🟡 补 QA 补充 b：`FOR UPDATE SKIP LOCKED` 的两个窗口代价**（§7 N2 专项）—— 🔴 **`batch_size ≤ 20`**（`20×15s=300s < 5min` 保护期，否则同一行被两实例并发 fetch）；🟡 **崩溃窗口安全但会被运维误判成 bug**（时间戳打在领取时 ⇒ 一轮白跑、5 分钟后自动重来，属预期） |
| **2026-10-16 (r4)** | **🟡 补齐 N5 第三处对齐**：`§8.2` 第 10 条原写「三处对齐」但实际未改，现补上（`(external_system, raw_status)` 聚合 + **单据只记 `sync_error`、退避计数落聚合层**），另加第 14/15 条新坑位 |
| **2026-10-24** | **✅ C-1 公开文档复核关闭**：致远 V5 REST BPM 集成仅有 `start` 的 `draft=0|1`（新建发/新建待发），**无**对已有 case 的「送出待发」章节；V8 `/bpm/case/send` 亦无明示。⇒ **P0 锁定 `DIRECT_SEND`**；`DRAFT_THEN_SEND`/`activate` 仅现场沙箱翻案后按租户启用。§0 决策注 / §4 步骤 3 / §9 核实表 / Gate-2 已同步 |
