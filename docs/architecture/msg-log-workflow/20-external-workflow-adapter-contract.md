# 20 · 外部工作流 Adapter 契约与联调待确认清单

> **状态**: 🔍 架构核实后定稿 · **r4：并入 D5 撤销决策 + QA 21/22 报告全部定点补丁（D1~D4 已修）**
> **日期**: 2026-10-16（r4）
> **上游**: [19-external-workflow-integration-plan.md](./19-external-workflow-integration-plan.md)、[ADR-022](../../adr/ADR-022-external-workflow-binding.md)
> **决策台账**: 见 [19 §0](./19-external-workflow-integration-plan.md)（🟢 已拍板 / 🟡 待产品确认）
> **审查结论**: [21-external-workflow-review.md](./21-external-workflow-review.md)（r1，QA 实测）+ [22-external-workflow-review-r2.md](./22-external-workflow-review-r2.md)（r2 复审 **PASS_WITH_ISSUES**，已吸收 N1~N6）+ QA R3 回归（**PASS_WITH_ISSUES**，已吸收 **D1~D4 + 补充 a/b**）
> **⚠️ DDL 校对提示**：§6.2 的 `ext_process_instance` 建表段在 r3 中出现过 3 处「散文正确但 SQL 写错」（谓词方向反 / 漏空格 / duplicate column，见 §8 第 15 条 B 类）。**实施时请把 DDL 当代码审，逐字校对。**
> **核实方式**: 公开文档检索（open.seeyon.com V5 REST APIdoc、open.seeyoncloud.com V8 OpenAPI、service.seeyon.com 产品手册）+ 第三方集成平台接口资产。**未接触企业版现场环境。**

---

## 0. 证据等级图例

本文所有结论标注三级，**不得混淆**：

| 等级 | 含义 | 可否直接编码 |
|------|------|-------------|
| ✅ **确证** | 官方文档明文写出接口名/参数/语义 | 可直接编码 |
| 🟡 **推断** | 基于通用 BPM 惯例或文档间接证据的合理解释 | 需沙箱验证后才可编码；**参数必须走配置，不得硬编码** |
| 🔴 **未知** | 文档未覆盖，必须现场问厂商/看沙箱 | **禁止编码**，只留契约占位 |

---

## 1. 结论速览（§10.1 三问最终答案）

### Q1. 离开开始节点

| 环节 | 等级 | 结论 |
|------|------|------|
| `start` 时**不落开始节点**的做法 | ✅ 确证 | `POST /seeyon/rest/bpm/process/start` 的 `data.draft`：`1` = 新建-保存待发，`0` = 新建-发送。**用 `draft=1` 即可让流程停在待发、不进入第一级审批** |
| 是否存在独立「送出待发」API | 🔴 未知 | REST 文档目录（1.1~1.25）**没有独立章节**。V8 OpenAPI 有 `/bpm/case/send` 且 `data.caseId`（流程实例ID）可选 + `data.userCode`（发起人code）—— **强烈暗示可传已有 caseId 完成 draft→sent**，但文档未明示 |
| 替代方案：外部**流程事件/定时任务**触发 | 🟡 推断 | 若无「送出待发」API，退化为 `draft=0` 直接发送，节点人员靠 `freeReplaceNode` 在发送后立即替换（有竞态窗口，首节点可能短暂无人） |

**→ 对规划的修正**：规划 §4 步骤 3 写「start 时停在开始节点」，**正确**；但「activate」的定位需按配置二选一。🔴 **且分支点必须落在 start 那一行，不是 activate 那一行**（QA I1）：

```
draft_mode = DIRECT_SEND       （★ 默认：draft=0 直接发送，随后立即 freeReplaceNode）
draft_mode = DRAFT_THEN_SEND   （draft=1 保存待发 + 独立「送出待发」API；需 C-1 确认后才可启用）
```

**默认 `DIRECT_SEND` 的理由**：`DRAFT_THEN_SEND` 依赖 **C-1 这条尚未确认可行**的路径；把它设为默认等于让 P0 建在未验证前提上。`DIRECT_SEND` 的代价是「首节点待办已生成但人员尚未替换」的**秒级竞态**（缓解：模板首节点预置发起人），这个代价是**已知且可控**的；而 C-1 不可控。

⚠️ **`draft_flag` 必须按 mode 赋值**：`DIRECT_SEND` 无「待发」阶段 ⇒ `draft_flag` 应为 `0` 或 `NULL`；`DEFAULT 1` 在该模式下**必错**（会导致「已有映射」的恢复逻辑误判为「仍在待发」而试图 activate）。

### Q1b. 发起人身份

| 环节 | 等级 | 结论 |
|------|------|------|
| V5 REST 显式传发起人 | ✅ 确证 | `POST /seeyon/rest/flow/{templateCode}` 参数 **`senderLoginName`**。官方原文：「发起的流程以 `sendLoginName` 指定的协同平台用户为发起人，进入后续节点的待办中」 |
| V8 OpenAPI 显式传发起人 | ✅ 确证 | `POST /bpm/case/send` 的 `data.userCode`（**发起人 code**，必填）+ `data.currentUserId`（人员ID，必填）+ `data.orgCode`/`data.orgId` |
| `bpm/process/start` 能否显式传发起人 | 🔴 未知 | 该接口参数表**只列了** `templateCode` / `draft` / `attachments` / `relateDoc` / `subject` / `data`。**没有 senderLoginName**。响应返回 `workitems[].userLoginName` 说明发起人确实被记录，但来源是 token 主体还是参数 → 待确认 |
| 能否进「已发 / 我发起的」 | 🟡 推断 | 计划**不用抄送代替发起人**。走 `userCode`/`senderLoginName` 显式传参时，外部 `col_summary.creator_id` = 该成员，**必然出现在其已发列表**；仅作抄送则只进「待阅」。**这是推断，必须现场用发起人账号点开验证** |
| 集成账号冒充发起人 | ❌ 禁止 | 产品已定；技术上也不成立（creator 与 token 主体是两回事） |

**→ Adapter 契约决策**：`start()` **必须**有 `initiatorRef` 显式参数，**禁止**隐式取 token 主体。若目标版本只能取 token 主体，则退化为「以发起人身份换取 token」策略（`/seeyon/rest/token/{user}/{pwd}`，走**发起人密码/单点票据**，不是集成账号）。

### Q2. 会签 / 同节点多人

| 环节 | 等级 | 结论 |
|------|------|------|
| `freeReplaceNode` 能否多人 | ✅ 确证 | `data.userId` 是**数组**，官方示例 `["-5497257474554312519\|true", "4867812283561102527"]` |
| 会签 vs 或签 | 🟡 推断 | `freeReplaceNode` **只填人，不改节点属性**。会签/或签由**模板节点的 nodePolicy 预先配置**决定。→ 平台侧无法运行时切换会签语义 |
| 另一条会签路径 | ✅ 确证 | `POST /seeyon/rest/bpm/process/addNode`，`changeType`：`1`加签 / `2`知会 / `3`当前会签 / `5`多级会签 / `6`传阅（`submitType`：`1`提交协同） |
| V8 OpenAPI 侧 | ✅ 确证 | `/bpm/work-item/submit` 的 `changeNodeRequestDtos[].changeTypeEnum` 含 `Countersign`、`Assign`、`OrderExecuteAdd`（多人按序执行）、`CountersignInnerAdd` |

**→ 规划 §10 表第 2 行的答案**：
- **多人 = 支持**（P0 可放开「同节点多人」）
- **会签/或签语义 = 不可控**（依赖外部模板配置，平台不承诺）
- **P0 决策：蓝图允许同节点多人，但会签语义按外部模板配置；平台侧 UI 不暴露会签/或签选择。** 不再限制「串行单人」，但也不承诺会签语义正确。

### 🔴 重大修正：freeReplaceNode 不是「追加节点」

规划 §4 步骤 4 写「循环 `freeReplaceNode`：**追加**下一级节点」—— **这是错的**。

✅ 确证：`freeReplaceNode` 官方描述为「**替换流程节点**。新建自由协同和处理流程时的流程编辑都调用这个方法，立即生效」，参数是 `activityId`（**需要替换的节点 ID**）+ `processId` + `caseId` + `data.userId`。

正确模型：

```
外部模板必须预置 N 个「自由流节点」（节点 1..N，处理人留空/占位）
每个外部表单定义 → 一个 templateCode，节点数 N 固定
发起时：start(draft=1) → 对节点 1..N 逐个 freeReplaceNode 填人 → 送出
未使用的节点 → 填发起人自己 / 或按配置跳过
```

**影响（必须写进需求）**：
1. **蓝图节点数 ≤ 外部模板节点数**，超出则**无法映射**，必须报错阻断，不是「追加第 N+1 个」。
2. 因此需要新增蓝图约束：`external_workflow_ref` 必须携带 `node_slots`（外部模板的节点 activityId 列表 + 名称），由外部系统管理员在致远侧配置后登记。
3. 「N 级审批蓝图」从「动态长度」降级为「**动态人员 + 固定槽位**」。**这是本方案最大的约束，必须在管理 UI 上明示模板槽位数**。

---

## 2. 致远侧能力全景（联调前对照表）

| 能力 | 方法 | 路径 | 关键参数 | 等级 |
|------|------|------|---------|------|
| 发起（保存待发） | POST | `/seeyon/rest/bpm/process/start` | `appName=collaboration`, `data.templateCode`, **`data.draft=1`**, `data.subject`, `data.data.formmain*` | ✅ |
| 发起（直接发送） | POST | `/seeyon/rest/bpm/process/start` | 同上，`**data.draft=0**` | ✅ |
| 节点替换 | POST | `/seeyon/rest/bpm/process/freeReplaceNode` | `appName`, `activityId`, `processId`, `caseId`(无则 `-1`), `data.userId[]` | ✅ |
| 加签/会签 | POST | `/seeyon/rest/bpm/process/addNode` | `workitemId`, `changeType`(1/2/3/5/6), `submitType` | ✅ |
| 减签 | POST | `/seeyon/rest/bpm/process/deleteNode` | `activityIdList[]`, `submitType` | ✅ |
| 审批处理（写意见） | POST | `/seeyon/rest/bpm/workitem/finish`（示例代码为 `bpm/process/finish`，**路径不一致**） | `workitemId`, `attitude`(1已阅/2同意/3不同意), `content`, `submitType`(1提交/2暂存) | ✅（路径待现场定） |
| 流程状态 | GET | `/seeyon/rest/flow/state/{flowId}` | `flowId` = **summaryId**（`col_summary.id`） | ✅ 路径 / 🔴 枚举值 |
| 当前待办人员 | GET | `/seeyon/rest/flow/dostaff/{summaryId}` | — | ✅ |
| 流程正文/表单数据 | GET | `/seeyon/rest/flow/data/{flowId}?exportFormat=json` | — | ✅ |
| 表单数据（按 summary/affair） | GET | `/seeyon/rest/form/getformdata/{summaryId\|affairId}` | 二选一 | ✅ |
| 已结束流程 ID（批量补拉） | GET | `/seeyon/rest/flow/FromFinish/{templateCode}/{startTime}/{endTime}` | 模板 code 逗号分隔 | ✅ |
| 流程图图片 | GET | `/seeyon/rest/bpm/process/diagramImg?isRunning=true&processId=&caseId=` | — | ✅ |
| 终止 | POST | `/seeyon/rest/affair/stop` | `affairId`, `repealComment`, `member`(登录名) | ✅ |
| 撤销 | POST | `/seeyon/rest/affair/cancel` | `affairId`, `summaryId`, `member` | ✅ |
| 取回 | POST | `/seeyon/rest/bpm/workitem/takeback` | `workitemId`, `data.isSaveOpinion` | ✅ |
| 查询人员（单位全量） | GET | `/seeyon/rest/orgMembers/all/{accountId}` | `accountId` = 单位 ID，含停用 | ✅ |
| 部门查询 | GET | `/seeyon/rest/orgDepartments/{accountId}` | — | ✅ |
| 部门按编码 | GET | `/seeyon/rest/orgDepartment/code/{code}` | — | ✅ |
| 人员按手机号 | — | 🔴 **路径未确证**（文档目录确认有此能力） | — | 🔴 |
| 人员按登录名 | — | 🔴 路径未确证（目录确认存在） | — | 🔴 |
| 人员对象字段 | — | `id`, `orgAccountId`, `loginName`, `code`, `name`, `orgDepartmentId`, `orgPostId`, `telNumber`, `properties.telnumber` —— ⚠️ **未见 `mobile`** | ✅ |
| **审批意见/轨迹查询** | — | 🔴 **REST 与 V8 OpenAPI 均未提供** | — | 🔴 |

### V8+ OpenAPI（另一套体系，优先评估）

签名：`app-key` + `sign-type: MD5` + `sign = MD5(AppSecret + bodyJson + AppSecret)`

| 能力 | 路径 | 备注 |
|------|------|------|
| 发起/发送 | `/bpm/case/send` | `data.templateCode`, **`data.userCode`(发起人code)**, `data.currentUserId`, `data.parameterData`, `data.caseId`, `data.commandId`, `data.redo` |
| 处理待办 | `/bpm/work-item/submit` | `data.affairId`, `data.userCode`, `data.bpmCommentDto`, `data.changeNodeRequestDtos[]` |
| 取回 | `/bpm/work-item/take-back` | `data.affairId`, `data.userCode` |
| 回退 | `/bpm/case/step-back` | `data.affairId`/`caseId`, `data.pendingNodeId`, `data.selectTargetNodeId`（`start`=回发起节点）|
| 撤销 | `/bpm/case/cancel` | `data.affairId`/`caseId`, `data.userCode` |
| 终止 | `/bpm/case/stop` | `data.caseId`, `data.userCode` |

**✅ 确证的幂等机制**：`requestId`（接入应用内唯一）+ `timestamp`（±5 分钟）+ `data.commandId`（请求唯一标识）+ `data.redo`（超时后是否允许再执行，默认 false）。

→ **强烈建议 P0 改走 V8 OpenAPI**：① 发起人 `userCode` 显式明确；② 自带幂等键；③ 自带 `notifyUrl` **异步回调**（规划 §2.4 的回调需求直接落地）；④ 会签枚举完整。

### 流程状态枚举（🔴 需现场确认）

| 来源 | 枚举 | 等级 |
|------|------|------|
| 官方 `CollaborationEnum.flowState`（ExtSummary 统一待办接口） | `run`=0 / `terminate`=1 / `cancel`=2 / `finish`=3 / `deleted`=4 | ✅（但**对象是 ExtSummary，不是 `/flow/state/{flowId}`**） |
| 第三方集成实践文章（轻易云实战） | `0`=正常结束 / `1`=待发 / `3,4`=审批中 / `5`=撤销 / `6,7`=退回·取回 / `15`=终止 | 🟡（与上表冲突，**不可直接采信**） |
| `ctp_affair.STATE`（事项级，非流程级） | `1`待发 / `2`已发 / `3`待办 / `4`已办 / `5`取消 / `6`回退 / `7`取回 / `8`竞争执行结束 / `15`终止 / `30`重复自动跳过 | ✅ |
| `/seeyon/rest/flow/state/{flowId}` 官方状态映射图 | **文档图片未被抓取到** | 🔴 |

**→ 结论：状态映射必须做成配置驱动的字典表，联调时按现场实际值填。禁止硬编码。**

🔴 **撤销/终止的枚举映射要求（产品决策 D5，见 C-13）**：`cancel=2`、`terminate=1`、`5`、`15` —— **这四个值必须全部映射到 `TERMINATED`**。本地**不区分**「撤销」与「终止」（产品主动决定不把 LOCAL 的撤销语义推广到外部系统），因此**即使外部枚举无法区分，映射结果也相同** ⇒ 该不确定性不影响正确性。
⚠️ 但**漏配任何一个都会导致对应单据永久停在 `RUNNING`**（落入「未识别」→ 拒绝落库 + 退避）。

---

## 3. Adapter 契约（可配置、可替换）

### 3.1 接口定义

> **契约覆盖范围声明（QA I4）**：**P0 契约只覆盖 §9 任务 B1~B5 所需方法**。能力表（§2）里的 `addNode` / `deleteNode` / `workitem/finish` / `takeback` / `step-back` **均未列入 P0 契约**，**未列入者禁止在 P0 调用**。其中 `addNode` 重新定位为 **P1 的运行时会签/或签增强**（见本节末）。

> 🔴 **契约覆盖范围（自 r2 起）**：本契约**不提供** `revoke` / `cancel` 方法，**也不提供** `finish` / `submit` / `addNode` / `deleteNode` / `takeback` / `step-back`（P0 禁止调用，见 §8 第 7 条禁止项）。`endpoint_config` 的 key 清单按 `api_flavor` 分别给出（见 §3.2 原则 1）。

```
ExternalWorkflowAdapter                       // 统一契约，backend/mis-taskflow
  code() -> String                            // 外部系统 code，如 SEYON_A8_V9

  // 能力声明：现场探测后写入 external_workflow_system.capabilities
  capabilities() -> Set<Capability>
     Capability ∈ {START, DRAFT_START, RESOLVE_ACCOUNTS, FREE_REPLACE_NODE,
                   MULTI_ASSIGNEE, QUERY_STATE, QUERY_OPINIONS, QUERY_HISTORY,
                   STOP, CANCEL, CALLBACK, EMBED_URL}
     ⚠️ CANCEL 表示「探测到致远有此能力」，**不表示「平台要调用它」** —— 见下方 terminate/revoke 专项

  // 账号解析：按手机号批量 → 外部人员标识
  resolveAccounts(ResolveQuery{ phones: Set<String>, accountId: String })
      -> ResolveResult{ matches: Map<phone, AccountRef>,
                        failures: List<ResolveFailure{phone, reason}> }

  // 发起（返回 draft 或直接 running，完全取决于 draftMode）
  start(StartCommand{ templateCode, initiatorRef, title, injectMode, payload,
                      draftMode: DIRECT_SEND | DRAFT_THEN_SEND,
                      commandId /* 幂等键；见 §8：对同一次业务发起必须稳定不变 */ })
      -> StartResult{ externalCaseId, externalProcessId, affairId,
                      buildPhase, draftFlag }

  // 逐槽位填人（替换外部模板预置节点的处理人）
  assignNode(AssignCommand{ externalCaseId, externalProcessId,
                            activityId /* 模板预置槽位 */,
                            accountRefs: List<AccountRef> /* 可多人 */,
                            includeSubDept: Boolean })
      -> Boolean

  // 送出击发人待发 → 进入第一级审批
  activate(ActivateCommand{ externalCaseId, initiatorRef, commandId })
      -> Boolean

  // 查询（状态 + 当前节点 + 处理人）
  // 🔴 opinions 在 P0 恒为 null/空（C-2：REST 25 接口与 V8 OpenAPI 均无意见查询接口）
  //    —— 不得假设它有值，也不得因它为空而报错
  fetch(externalCaseId) -> ExtSnapshot{ rawStatus, extStatus /* 映射后 */,
                                        currentNodes, currentHandlers,
                                        opinions /* 🟡 P0 恒缺 */, finishedAt }

  // 🔴 终止：P0，**界面向用户暴露的唯一终态动作**
  // 参数口径差异：V5 REST 需 affairId + member(登录名)；V8 需 caseId + userCode
  //    ⇒ 契约用语义参数，Adapter 内部按 api_flavor 翻译（§3.2 原则 1）
  terminate(TerminateCommand{ externalCaseId, extAffairId,
                              operatorRef, reason })
      -> Boolean

  // ❌ revoke / cancel —— **不提供此方法**（产品决策 D5，见下方专项）

  // 🆕 EMBED_URL 相关（QA I5：19§2.1 的五条安全要求此前全部未落实）
  resolveEmbed(embedToken, openedRecordId?) -> EmbedContext{ tenantId, formCode,
                                          formRecordId, readOnly = true }
  verifyEmbedAuth(embedToken, signature?, expires?, sessionToken?)
                                -> EmbedAuth{ valid, reason?, method: SESSION|SIGNATURE }
  revokeEmbedToken(formDefinitionId, reason) -> Boolean   // 置 embed_token_revoked_at
  getFrameAncestors() -> List<String>             // 读 csp_frame_ancestors
```

#### 🔴 专项：`terminate`（P0）vs `revoke`（**不实现**）—— 防开发误做撤销按钮

| 维度 | `terminate`（终止） | `revoke` / `cancel`（撤销） |
|------|-------------------|---------------------------|
| **优先级** | ✅ **P0 实现** | ❌ **不实现**（**不是 P1，是「平台不提供」**） |
| **谁调用** | 平台（用户在本地界面点「终止」） | **无人调用** |
| **界面入口** | ✅ 有（本地界面 / 管理台） | 🔴 **不存在，且不得新增** |
| **参数** | `externalCaseId` + `extAffairId` + `operatorRef` + `reason` | — |
| **致远接口** | `POST /seeyon/rest/affair/stop` ✅；V8 `/bpm/case/stop` ✅ | `POST /seeyon/rest/affair/cancel` ✅；V8 `/bpm/case/cancel` ✅ —— **能力存在但不用** |
| **本地映射** | `ext_status=TERMINATED` + `form_record=TERMINATED` | （若外部侧自行发生）轮询识别 → **同样是 `TERMINATED`** |

**为什么致远有这个能力，平台却不做（产品决策 D5，主动取舍）**：

1. **语义归属不同**：LOCAL 撤销的前置校验**严格且已在代码中固化** —— 实测 `ProcessService.java:447-463`，仅 `RUNNING` + **本人** + **尚无任何人审批通过**（`hasApproveHistory` 判 `WfHistory.OP_APPROVE`）三项全满足才允许 ⇒ **权限与边界清晰**，允许「撤销后再发起」是安全的。
2. **EXTERNAL 的撤销无法等价判定**：撤销**发生在外部侧**，平台是观察者。「谁有权撤？已审批后能否撤？前置条件是否等价？」—— **均无法确认**。
3. **避免悬空态**：若平台暴露撤销入口而外部拒绝，用户会遇到「本地允许撤销但外部拒绝」的中间态，单据卡在无明确出路的中间态。
4. **⇒ 产品主动牺牲 LOCAL/EXTERNAL 语义一致性**，换取**实现简单、行为可预测**。**这是取舍，不是遗漏。**

**给开发的三条硬约束**：

1. 🔴 **不得**在 `ExternalWorkflowAdapter` 增加 `revoke` / `cancel` 方法。
2. 🔴 **不得**在任何 UI（`process-shell.tsx` / `ext-launch-console-page.tsx` / `ext-progress-panel.tsx`）加「撤销」按钮。EXTERNAL 单据在本地**只有终止**一个终态动作。
3. 🔴 外部侧发生撤销时，**由轮询识别并统一映射为 `TERMINATED`**（不调任何撤销 API）。见 §5 **C-13**。

#### P1 预留（**P0 禁止调用**，见 21 报告 §4）

```
  // P1：运行时加签 / 知会 / 会签 —— 弥补 freeReplaceNode「只填人、不能定会签语义」的缺口
  //   changeType=5 多级会签、node_process_mode(competition=或签)、flowType(分叉)
  // 🔴 但严禁用于「流程未发时拼节点」：addNode 要求 workitemId 是「已存在的待办事项」
  //    （V5 APidoc 1.18：workitemId 对应 ctp_affair.CASE_ID），而 draft=1 阶段
  //    流程停在待发（ctp_affair.state=1），**不存在可操作的 workitemId**
  addNode(AddNodeCommand{ workitemId, changeType, submitType, nodeInfo }) -> Boolean  // P1 only
```

### 3.2 关键设计原则

| # | 原则 | 落地方式 |
|---|------|---------|
| 1 | **API 路径不硬编码** | 全部端点放 `external_workflow_system.endpoint_config` JSONB。**按 `api_flavor` 分别给两套完整 key**（QA I4：原方案的单一 key 清单无法覆盖 V8 路径）：<br>`V5_REST`：`{start, draftStart, assignNode, activate, fetchState, fetchDostaff, fetchData, stop, resolveAccounts, token}`<br>`V8_OPENAPI`：`{caseSend, freeReplaceNode, caseStop, flowState, dostaff, orgMembersAll, tokenIssue}`<br>联调改配置不改代码。⚠️ **P0 不需要 `cancel` key**（D5 不实现撤销） |
| 2 | **状态枚举不硬编码 + 🔴 双重校验** | `status_mapping` JSONB：`{"0":"RUNNING","3":"COMPLETED",...}`，双向（外部→本地 / 本地→外部）。<br>🔴 **(a) 保存时校验（主）**：`status_mapping` 存在按租户一行的 DB 表里、**由管理台运行期 CRUD 写入** ⇒ 仅靠「启动 fail-fast」只能覆盖存量配置，**拦不住运行期新增的错配置**（而这正是它声称要防的场景）。故**管理台写入即校验**：非空、value ∈ 合法枚举、**撤销/终止候选值（`cancel=2`/`terminate=1`/`5`/`15`）全部映射 `TERMINATED`**（C-13）。校验不过**拒绝保存**并返回具体缺失项<br>🔴 **(b) 启动 fail-fast（兜底）**：服务启动时校验存量配置，配错直接启动失败<br>⚠️ **两者缺一不可**：只有 (b) 会让系统带着错配置正常启动后在生产逐单误判；只有 (a) 则历史脏数据无人拦 |
| 3 | **人员标识不硬编码** | 账号对象里同时存 `loginName` / `memberCode` / `memberId`；由 `id_field` 配置决定发哪个字段（V5 用 `loginName`，V8 用 `userCode`） |
| 4 | **手机号字段兼容** | `phone_field_path` 配置，默认尝试 `mobile` → `telNumber` → `properties.telnumber` |
| 5 | **幂等三键** | 本地 `command_id`（唯一索引，**VARCHAR(128)**，🔴 **对同一次业务发起必须稳定不变**）→ 外部 `requestId`/`commandId` → DB 行锁 + 有效实例唯一约束 |
| 6 | **能力缺失可降级** | `capabilities` 声明驱动分支：无 `QUERY_OPINIONS` → 前端隐藏意见区；无 `CALLBACK` → 只靠轮询 |
| 7 | **所有外部调用记审计** | `ext_workflow_call_log`：系统、接口、入参摘要、耗时、错误码，**密钥与 token 脱敏**。⚠️ **`operation='FETCH'` 只记失败不记成功**（见 §6.2 保留策略，否则轮询写爆表：100 实例 × 5min ≈ **2.9 万行/天**） |
| 8 | **🔴 终态单调性（硬约束）** | `ext_status` 迁移只允许 `NOT_STARTED → RUNNING → {COMPLETED \| REJECTED \| TERMINATED}` 与 `NOT_STARTED → ABANDONED`。**任何终态不可被后续轮询/回调改回 `RUNNING`**；违反则记 `sync_error` + 告警，**不落库**。这是防「重复触发后置任务」的最后一道闸 |
| 9 | **🔴 `form_record` 读取加行锁** | EXTERNAL 发起链路的所有 `form_record` 读取必须 `SELECT ... FOR UPDATE`（实测 `FormRecordService.java:112` 是普通 `@Transactional` 查询，**无 `@Lock(PESSIMISTIC_WRITE)`**）；`ExtWorkflowLaunchService` 的 `@Transactional` 边界须覆盖 start→落镜像全过程（QA B6） |

### 3.3 认证（P0 建议走 V8 OpenAPI）

| 项 | V5 REST | V8 OpenAPI |
|----|---------|-----------|
| 取凭证 | `POST /seeyon/rest/token/{user}/{pwd}` | 无需取 token |
| 有效期 | ~23 分钟，需自动刷新 | 由 `app-key` + `sign` 长期有效 |
| 每次签名 | 否（Bearer token） | 是：`MD5(AppSecret + body + AppSecret)` |
| 白名单 | 无 | IP 白名单（需申请） |
| 回调 | 无 | `notifyUrl` 异步回调 |

**风险**：V8 OpenAPI 需在致远侧「启用 API + 新建接入应用 + 应用级 API 授权 + IP 白名单」，是**对方运维动作**，需提前 1~2 周申请。**若现场只能给 V5 REST 账号，Adapter 需同时实现两套认证。**

---

## 4. 致远发起序列（修正版，替换规划 §4）

```
[无有效映射]
  1. 采集本地蓝图：节点槽位顺序 + 每槽位人员手机号 + 发起人手机号
     ★ 校验槽位数 ≤ 外部模板槽位数（node_slots.size()），超出直接拒绝提交
  2. 账号解析（批量/全量 orgMembers 缓存）：手机号 → loginName / memberCode / memberId
     - 发起人解析失败→ 禁止提交（无外部账号 → 无法进「已发」）
     - 审批节点人员缺失     → 禁止提交（展示槽位/节点名/手机号）
     - 抄送人员缺失         → 警告，可提交（产品已定）
  3. ★ 按 draft_mode 分支（配置生效点在本步，不在 activate 步 —— QA I1 修正）

     3-A【DRAFT_THEN_SEND】★ 默认否，需 C-1 确认「送出待发」API 后才可启用
         start(templateCode, initiatorRef, draft=1, payload) → externalCaseId / processId
         ★ 流程停在「待发」，不落开始节点，不进第一级审批
         ★ initiatorRef 必须显式传入（userCode / senderLoginName）
         ★ 集成账号不得冒充发起人；仅做抄送不足以进「已发」
     3-B【DIRECT_SEND】★ 默认值（✅ 确证可行）
         start(templateCode, initiatorRef, draft=0, payload) → externalCaseId / processId
         ★ 流程直接发送；随后立即逐槽位填人
         ⚠️ 代价：首节点待办已生成但人员未替换，秒级竞态 → 模板首节点预置发起人
  4. 逐槽位 assignNode(activityId_k, [people_k])   k = 1..M（M ≤ N）
     - DIRECT_SEND 下本步紧接 3-B；DRAFT_THEN_SEND 下本步发生在「待发」态
     - 每步校验 code=0；失败 → build_phase=FAILED + 记 build_error，**保留 caseId**
     - 未使用槽位（k > M）：填发起人本人 或 按配置跳过（skip_unused_slots）
     ★ **断点续拼（P0）**：每成功一槽位即写 assigned_slots；重启后从断点继续，不从头再来
  5. 仅 3-A：activate(externalCaseId, initiatorRef) → 离开待发，进入第一级审批
     ★ 3-B 下**本步骤不存在**（不是可选分支，是另一条序列）
  6. 落本地镜像 ext_process_instance
     - ext_status: NOT_STARTED → RUNNING
     - 🔴 external_sent: **start 返回 caseId 的那一刻置 1**（外部已真实发出）—— 唯一索引按此判让位（N1）
     - draft_flag: 3-A 置 1（activate 成功后置 0）；3-B 直接置 0
       （🟡 DDL 允许 NULL —— 3-B 无待发阶段，DEFAULT 1 在 3-B 下必错）
  7. 首次 sync

[已有映射 —— 按 external_sent × build_phase × draft_flag 分派]
  - 🔴 external_sent=1 且 build_phase=FAILED/ASSIGNING 且 assigned_slots 非空 → **断点续拼（P0）**
  - 3-A 且 draft_flag=1 且槽位已配完 → activate + sync（第 5 步）
  - 🔴 external_sent=1 且无法续拼 → **必须显式「废弃并重建」**（ABANDONED + 外部 stop）
      ⛔ 不得直接新建：DIRECT_SEND 下会导致致远出现第二个流程（N1）
  - external_sent=0（start 未成功）→ 可直接重试，无外部风险
  - RUNNING → 仅 sync
  - ext_status ∈ {COMPLETED, REJECTED, TERMINATED, ABANDONED} → 只读，禁止再发起

防并发：form_record 行 SELECT ... FOR UPDATE（QA B6：实测无锁）
      + ext_process_instance 有效实例唯一索引 + 前端提交防抖

🔴 轮询 Job 的并发保护【禁止用 biz_exec_lock】—— 见 §8 第 14 条
   正解：FOR UPDATE SKIP LOCKED + LIMIT 的领取式认领（SQL 见 19§7 N2 专项）
```

---

## 5. 联调待确认清单

### 🔴 C-1 送出待发（最高优先级 · 阻塞 activate）

| 项 | 内容 |
|----|------|
| 问题 | `draft=1` 保存待发后，用什么把它送出到第一级审批？ |
| 候选 | ① `POST /seeyon/rest/bpm/process/start` 传 `caseId` 复用（🟡）② V8 `/bpm/case/send` 传 `data.caseId` + `data.userCode`（🟡，参数表支持 `caseId`，语义未明示）③ `draft=0` 直接发送 + 立即 `freeReplaceNode`（✅ 一定可行，但有竞态）④ 现场致远提供专用接口（🔴） |
| 验证方法 | 沙箱：模板 2 节点（发起人→审批人A）。`draft=1` → `freeReplaceNode` 填 A → 分别试 ① ② ③。查 `col_affair.state`：`1`=待发 / `2`=已发 / `3`=待办 |
| 假设错误影响 | 高：整个 §4 序列重排。但 ③ 兜底可用，**平台侧只改 `draftMode` 配置** |
| 回退 | `draft_mode=DIRECT_SEND`。代价：首节点待办生成与人员替换存在秒级竞态，可能首节点短暂无人或落到默认处理人。缓解：模板首节点人员预置为发起人 |

### 🔴 C-2 审批意见/轨迹查询

| 项 | 内容 |
|----|------|
| 问题 | 规划 §2.3 / §6.1 要求展示外部审批意见，**REST 与 OpenAPI 都没有查询接口** |
| 候选 | ① `flow/dostaff/{summaryId}` 只给当前待办人员，无意见 🟡 ② `/seeyon/rest/bpm/process/diagramImg` 只有图片 🟡 ③ V8 OpenAPI 有未公开的 case 详情接口 🔴 ④ **只读库查 `ctp_opinion` 表**（部署同实例时可行，安全边界需甲方批准）🟡 ⑤ `affairs/done` 按人查已办，事项对象可能含意见 🟡 |
| 验证方法 | 沙箱跑完一条 3 级流程，导出 `ctp_opinion` 表结构与内容；再试 ⑤ 看返回字段 |
| 假设错误影响 | 中：意见展示降级为「只显示外部状态 + 当前处理人 + 深链跳转致远」。**功能降级，不阻断主链路** |
| 回退 | 前端隐藏意见区，改「在致远中查看」外链（`URLLINK` 字段 ✅ 确证存在）。 opinions_snapshot 保持 NULL |

### 🔴 C-3 freeReplaceNode 槽位模板

| 项 | 内容 |
|----|------|
| 问题 | `freeReplaceNode` 是**替换预置节点**，外部模板必须预置 N 个空槽位。槽位 `activityId` 从哪来？如何在管理台配置？ |
| 验证方法 | 现场在致远建一个 3 节点自由流模板 → 建一条流程存草稿 → 查 `ctp_process.activity_id` / 前端流程图 DOM 拿 activityId 序列 |
| 假设错误影响 | 高：**蓝图节点数无法映射 = 功能不成立**。这是 §1 修正带来的新约束 |
| 回退 | 无模板槽位则**改用固定模板**：外部为每类表单建 N=max 槽位模板，未用槽位填发起人。**必须先完成此项才能进入 Phase B** |

### 🔴 C-4 人员手机号字段与查询接口

| 项 | 内容 |
|----|------|
| 问题 | 人员对象**未见 `mobile`**，只见 `telNumber` / `properties.telnumber`；「按手机号码取人员信息」接口路径未公开 |
| 验证方法 | 沙箱 `GET /seeyon/rest/orgMembers/all/{accountId}` 全量拉一份，grep 手机号字段名与格式（是否 `+86`、是否加密） |
| 假设错误影响 | 中：解析全失败 → 审批缺人 → 全量阻断。**必须在联调首批验证** |
| 回退 | 改为按 `loginName` / 工号 `code` 匹配（本地用户表加 `external_login_name` 列，由管理员批量导入）；或读 LDAP |

### 🔴 C-5 bpm/process/start 的发起人来源

| 项 | 内容 |
|----|------|
| 问题 | 该接口参数表无 senderLoginName。发起人是 token 主体还是可显式传？ |
| 验证方法 | 用集成账号 token 调 start，抓 `col_summary.creator_id`；再用发起人 token 调，对比 |
| 假设错误影响 | 高：若只能取 token 主体，则需为每个发起人换取 token（密码/票据托管，安全评审） |
| 回退 | **改走 V8 `/bpm/case/send`（`userCode` 显式）**，首选方案本就是这条 |

### 🔴 C-6 流程状态枚举（**已提升为 Gate-1 · 与 C-3 并列**）

| 项 | 内容 |
|----|------|
| 问题 | `/flow/state/{flowId}` 返回 Integer，官方映射表是图片未抓到 |
| **为何提到 Gate-1** | 状态映射是整个联动链路的地基，且是**唯一**能防住「**合法**枚举值被映射错 → 终止单据被判通过 → `FINALIZE_BIZ` 业务动作错误执行（重复发货/重复建单）」的防线。原方案**映射代码 Phase B 写、枚举 Phase E 验，顺序倒了**。注意：「未识别时拒绝轮询」只防得住**非法**值，防不住**合法值映射错** |
| 验证方法 | 沙箱跑 **6** 条流程覆盖 待发/审批中/通过/**驳回**/**终止**/**撤销**，逐个记录 `/flow/state/{flowId}` 与（若有）V8 状态字段返回值 |
| 假设错误影响 | 🔴 **高**：状态误判 → 提前触发后置任务（业务动作错误执行）或 终态永不轮询（单据永久卡住） |
| **缓解（三重，缺一不可）** | ① 🔴 **管理台保存时校验（主）**：`status_mapping` 是按租户一行的 DB 表、**由运行期 CRUD 写入** ⇒ 「启动 fail-fast」只覆盖存量，**拦不住运行期新增的错配置**（而这正是它声称要防的场景）。故写入即校验：非空 + value ∈ 合法枚举 + 撤销/终止候选值全映射 `TERMINATED`，不过则**拒绝保存并返回具体缺失项**<br>② 🔴 **启动 fail-fast（兜底）**：启动时校验存量配置，配错则启动失败（不逐条实例拒绝轮询——那会让系统带着错配置正常启动后在生产逐单误判）<br>③ **终态单调性**（§3.2 原则 8）：映射后只要落进终态就不会二次触发；沙箱实测确认（Gate-1） |
| 回退 | `status_mapping` 缺失时**拒绝启动**（不是拒绝轮询）。粗判方案（按 `dostaff` 有无处理人判在途/终态）**仅作最后兜底**，不作默认 |

### 🔴 C-12 EMBED_URL 跨站 iframe 鉴权可行性（**新增 · Gate-1 · 待产品确认 P-2**）

| 项 | 内容 |
|----|------|
| **问题** | 19§2.1 要求 embed URL「**必须鉴权（登录态或签名）**」，方案把它当成已定约束，**但两条路径都未做可行性验证** |
| **路径 A：登录态** | embed 页在**致远域名的 `<iframe>`** 内加载本地系统 ⇒ 属**第三方 Cookie** 场景。现代浏览器（Chrome 80+/Firefox 96+）默认 `SameSite=Lax`，**会在跨站 iframe 中拒绝发送 Cookie** ⇒ 鉴权直接失败。需 `SameSite=None; Secure` + 独立 `embed_session`（非主站 JWT）+ 第三方 Cookie 未被用户禁用的前提 |
| **路径 B：签名** | URL 带 `expires` + HMAC。**但原 DDL 无 `expires_at` 字段**（r2 已补`embed_expires_at`）。且高熵 token 已在 URL 中，再叠加 HMAC 收益有限但复杂度上升 |
| **风险量级** | 🔴 **可能让 `EMBED_URL` 整个模式不成立**。而 B5 任务（三种注入模式 + embed 路由 + 鉴权 + 只读套壳）工作量 **L** —— **不能让L 级任务建在未验证前提上** |
| 验证方法 | ① 沙箱用 iframe 加载本地 embed URL，抓包看 `Cookie` 是否发送；② 检查本地 Auth Cookie 的 `SameSite`/`Secure`/`Domain` 属性与反向代理配置；③ 与甲方确认浏览器策略（企业环境是否统一禁用第三方 Cookie） |
| **假设错误的影响** | **中-高**：不是全局阻断，但**B5 的 EMBED_URL 部分（约占该任务 1/3）会白做**。FORM_JSON 与 RICH_HTML 不受影响 |
| **回退 / 降级** | 🔴 **若两条路径皆不可行** ⇒ `EMBED_URL` 从 **P0 降级为 P1**，B5 工作量由 L 降为 M，`inject_mode` 仅支持 `FORM_JSON` / `RICH_HTML` |
| **🟡 待产品确认（P-2）** | **是否要降级由产品拍板，架构不自行决定。** 在产品确认前：B5 的 EMBED_URL 部分**暂缓开工**（FORM_JSON / RICH_HTML 两部分可先做） |

### 🔴 C-13 撤销与终止的可判定性（**新增 · Gate-4 · 不阻塞开工**）

| 项 | 内容 |
|----|------|
| **问题** | 产品决策 **D5** 已定「外部侧撤销同步回本地**一律按 `TERMINATED` 处理**」。那么轮询**是否需要**区分「外部被撤销」与「外部被终止」？ |
| **多套枚举来源（互相冲突）** | ① 官方 `CollaborationEnum.flowState`：`run=0` / `terminate=1` / **`cancel=2`** / `finish=3` / `deleted=4` —— **可区分**（✅ 但对象是 `ExtSummary`，**不是** `/flow/state/{flowId}`）<br>② 第三方集成实践文章：`5`=撤销 / `15`=终止 —— 与①**冲突**<br>③ `ctp_affair.STATE`（**事项级，非流程级**）：`5`取消 / `15`终止 —— **可区分**，但层级不对 |
| **平台决策** | ✅ **不做区分，统一按 `TERMINATED` 处理**。**这正是 D5 的天然兜底** —— 既然撤销与终止在本地**合并为同一个值**，即使外部枚举**无法区分**，**映射结果也完全相同** ⇒ 该不确定性**不影响正确性** |
| **对 `status_mapping` 的硬要求** | 🔴 **必须把全部撤销/终止候选值都写进映射表**：`cancel=2`、`terminate=1`、`5`、`15` → **全部映射到 `TERMINATED`**。<br>⚠️ **漏配的后果**：某值落入「未识别」⇒ 拒绝落库 + 退避 ⇒ **撤销的单据永远停在 `RUNNING`**，每轮都触发告警与退避，却永远无法进入终态 |
| **假设错误的影响** | **低**（与 C-6 相反，因为已做了「不区分」的兜底）：<br>· 最好情况 = 误映射为 `RUNNING` ⇒ 撤销单据持续轮询、**不停机**，仅浪费资源<br>· 最坏情况 = **误映射为 `COMPLETED`** ⇒ 🔴 触发「审批通过」后置任务，`form_record=APPROVED`，**业务动作错误执行** |
| **兜底不靠枚举，靠三条** | ① `status_mapping` **启动 fail-fast**（配错则系统起不来，**不会带错配置上生产**）；② **终态单调性**（映射后落进终态就不会被改回 `RUNNING`）；③ 某值映射为 `COMPLETED` 必须经 **C-6 Gate-1 沙箱实测**（跑一条撤销流程确认返回值），**不得**凭文档图片猜 |
| 验证方法 | 沙箱跑**两条**流程：① 发起后在致远点「撤销」；② 发起后在致远点「终止」。分别记录状态接口返回值，比对是否可区分 |
| **回退** | **无需回退 —— 统一 `TERMINATED` 就是回退方案本身。** 这是 D5 的额外收益：把一个「依赖外部枚举可区分性」的风险，转成了「**无论能否区分都成立**」的不变式 |
| **界面要求** | 🔴 因不区分，**管理台不显示「撤销 vs 终止」的来源标签**；仅 `raw_status` 保留外部原始值供排障 |

### 🔴 C-7 版本与 API 授权

| 项 | 内容 |
|----|------|
| 问题 | 现场到底是 A8+ V7 / V8 / V9？V8 OpenAPI 是否可用（需启用 API + 接入应用 + IP 白名单）？ |
| 验证方法 | 现场确认版本号；用 `https://域名/service/cip-manager/metadata/open-api?appName=ctp-affair` 查询元数据；申请试跑 |
| 假设错误影响 | 高：决定走 V5 REST 还是 V8 OpenAPI，**决定 Adapter 实现哪一套认证** |
| 回退 | Adapter 同时实现 `LegacyRestAdapter` 与 `V8OpenApiAdapter`，按 `endpoint_config.api_flavor` 切换 |

### 🟡 C-8 ~ C-11（次要）

| # | 项 | 影响 | 验证 |
|---|-----|------|------|
| C-8 | `finish` 接口路径不一致（章节 `/bpm/workitem/finish` vs 示例 `/bpm/process/finish`） | 低（P0 不写意见） | 沙箱二选一试 |
| C-9 | `data.draft` 是 **string**（`"0"`/`"1"`）不是 int | 低 | 联调时按 string 传 |
| C-10 | `freeReplaceNode` 的 `processId` 与 `caseId` 是否都可空、`caseId=-1` 何时用 | 中 | 沙箱逐步试 |
| C-11 | `getformdata` 返回的枚举/人员字段格式 | 中（影响 FORM_JSON 映射） | 沙箱导出 JSON |

---

## 6. 迁移脚本草案（V153+）

> 目标：把 V149 的互斥 CHECK 演进为「EXTERNAL 可同时持有本地蓝图 + 外部模板」；新增注入模式、embed token、外部系统配置表、外部流程实例镜像表。**不修改 V149/V150 正文。**

### 6.1 V153 — 绑定语义演进 + 外部系统配置

```sql
-- V153__external_workflow_runtime_binding.sql
-- 工作流绑定语义演进：运行时与蓝图分离 + 外部系统配置 | PostgreSQL 16 | 幂等
--
-- ## 决策（ADR-022）
--   * workflow_binding_type 保留为「运行时」语义：NONE / LOCAL / EXTERNAL
--   * EXTERNAL 允许同时持有 workflow_definition_id（本地蓝图，不再强制 NULL）
--   * 新增 inject_mode / embed_token
--   * 新增外部系统配置表 external_workflow_system（连接、能力、端点、状态映射）
--
-- ⚠️ 只追加；绝不修改已发布 V1~V152。

-- ===========================================================================
-- 1) 先放宽 CHECK：DROP 再按新语义重建（幂等）
-- ===========================================================================
-- 🔴 存量行断言（必须在 DROP 之前）：
--   V149 的 CHECK 强制 EXTERNAL 时 workflow_definition_id IS NULL。
--   若库中已存在 EXTERNAL 绑定行（灰度/手工写入），新 CHECK 要求其蓝图非空，
--   直接 ADD CONSTRAINT 会**整表校验失败并回滚**，导致 V153 上线失败。
--   故先探明：若命中，必须先决定这些行是「补蓝图」还是「降级为 NONE/LOCAL」。
DO $$
DECLARE
    v_cnt BIGINT;
BEGIN
    SELECT count(*) INTO v_cnt
    FROM form_definition
    WHERE deleted = 0
      AND workflow_binding_type = 'EXTERNAL'
      AND workflow_definition_id IS NULL;

    IF v_cnt > 0 THEN
        RAISE EXCEPTION
            '[V153] 存在 % 行 EXTERNAL 绑定但本地蓝图为空，与新 CHECK 冲突。'
            '请先补齐 workflow_definition_id 或改绑 LOCAL/NONE，再重跑 V153。', v_cnt;
    END IF;
END $$;

ALTER TABLE form_definition DROP CONSTRAINT IF EXISTS chk_form_def_workflow_binding;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_form_def_workflow_binding_v2'
          AND conrelid = 'form_definition'::regclass
    ) THEN
        ALTER TABLE form_definition ADD CONSTRAINT chk_form_def_workflow_binding_v2 CHECK (
            -- NONE：什么都不绑
            (workflow_binding_type = 'NONE'
                AND workflow_definition_id IS NULL
                AND external_workflow_system IS NULL
                AND external_workflow_ref IS NULL)
            -- LOCAL：必须绑本地定义，且不碰外部字段
            OR (workflow_binding_type = 'LOCAL'
                AND workflow_definition_id IS NOT NULL
                AND external_workflow_system IS NULL
                AND external_workflow_ref IS NULL)
            -- EXTERNAL：必须绑外部系统 + 外部模板；本地定义=蓝图，**允许非空**
            OR (workflow_binding_type = 'EXTERNAL'
                AND workflow_definition_id IS NOT NULL     -- 蓝图（ADR-022 反转 V149 互斥）
                AND external_workflow_system IS NOT NULL
                AND external_workflow_ref IS NOT NULL)
        );
    END IF;
END $$;

-- ===========================================================================
-- 2) form_definition 新列
-- ===========================================================================
ALTER TABLE form_definition
    ADD COLUMN IF NOT EXISTS inject_mode VARCHAR(16) NULL;      -- FORM_JSON/RICH_HTML/EMBED_URL

ALTER TABLE form_definition
    ADD COLUMN IF NOT EXISTS embed_token VARCHAR(64) NULL;      -- EMBED_URL 专用高熵随机串

-- 🔴 吊销字段（QA I5）：19§2.1 要求「支持吊销（表单停用 / token 轮换）」，
--    原 DDL 无任何吊销字段 ⇒ 「轮换」无法表达（改 token = 旧 URL 立即死，无宽限期）。
--    revoked_at：置非空即该 token 永久失效；换发新 token 时旧行保留以阻断旧 URL。
ALTER TABLE form_definition
    ADD COLUMN IF NOT EXISTS embed_token_revoked_at TIMESTAMPTZ NULL;  -- 吊销时刻；NULL=有效

-- 签名方案用（C-12 路径 B）；登录态方案可空
ALTER TABLE form_definition
    ADD COLUMN IF NOT EXISTS embed_expires_at TIMESTAMPTZ NULL;       -- URL 签名过期时间

ALTER TABLE form_definition
    ADD COLUMN IF NOT EXISTS external_node_slots JSONB NULL;    -- 外部模板预置槽位 [{activityId,name,order}]

ALTER TABLE form_definition
    ADD COLUMN IF NOT EXISTS external_field_mapping JSONB NULL;-- FORM_JSON 字段映射

-- EMBED_URL 必须有 token；非 EMBED_URL 不得有 token
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_form_def_inject_mode'
          AND conrelid = 'form_definition'::regclass
    ) THEN
        ALTER TABLE form_definition ADD CONSTRAINT chk_form_def_inject_mode CHECK (
            (inject_mode IS NULL AND embed_token IS NULL)
            OR (inject_mode IS NOT NULL
                AND ((inject_mode = 'EMBED_URL' AND embed_token IS NOT NULL)
                  OR (inject_mode <> 'EMBED_URL' AND embed_token IS NULL)))
        );
    END IF;
END $$;

-- 🔴 embed_token 全局唯一（防碰撞 / 防枚举）
--
-- ⚠️ 谓词**刻意不含 `deleted = 0`**（QA I6修正）：
--   原方案谓词为 `WHERE embed_token IS NOT NULL AND deleted = 0` ⇒ 软删表单后其 token
--   从唯一索引「释放」⇒ 同一token 可被**另一个表单**复用。而 embed URL 是
--   **长期有效**的（19§2.1 原文），其生命周期远超表单软删 ⇒ 旧URL（存在于致远模板、
--   邮件、浏览器历史）会解析到**新表单**上 ⇒ **越权 / 串单**。
--   ⇒ token 一经分配即**永久占用**；吊销用 `embed_token_revoked_at` 显式表达。
--
-- 注：不需要加 tenant_id —— 高熵随机串**全局唯一强于租户内唯一**（防碰撞目标更强），
--   且 embed 路由是 `WHERE embed_token = ?` 单列查询，正好命中该索引。
CREATE UNIQUE INDEX IF NOT EXISTS uk_form_def_embed_token
    ON form_definition (embed_token)
    WHERE embed_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_form_def_external_binding
    ON form_definition (tenant_id, external_workflow_system, external_workflow_ref)
    WHERE workflow_binding_type = 'EXTERNAL' AND deleted = 0;

-- ===========================================================================
-- 3) 外部系统配置表
-- ===========================================================================
CREATE TABLE IF NOT EXISTS external_workflow_system (
    id                  BIGINT PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL,
    code                VARCHAR(64)  NOT NULL,          -- SEYON_A8_V9
    name                VARCHAR(128) NOT NULL,
    api_flavor          VARCHAR(32)  NOT NULL DEFAULT 'V5_REST',  -- V5_REST / V8_OPENAPI
    base_url            VARCHAR(512) NOT NULL,
    auth_type           VARCHAR(32)  NOT NULL DEFAULT 'TOKEN',     -- TOKEN / SIGN_MD5
    auth_ref            VARCHAR(256) NULL,             -- 密钥引用，不存明文
    account_id          VARCHAR(64)  NULL,             -- 致远单位 accountId（组织根）
    status              VARCHAR(16)  NOT NULL DEFAULT 'DISABLED',  -- ENABLED/DISABLED
    capabilities        JSONB        NULL,             -- Set<Capability> 字符串数组
    endpoint_config     JSONB        NULL,             -- 按 api_flavor 两套 key（见 §3.2 原则 1）
    status_mapping      JSONB        NULL,             -- {"0":"RUNNING","3":"COMPLETED"} 外部→本地
                                                          -- 🔴 撤销/终止候选值（cancel=2/terminate=1/5/15）全映射 TERMINATED
                                                          -- 🔴 启动时 fail-fast 校验非空 + 值域合法
    -- 🆕 EMBED_URL 安全配置（QA I5：19§2.1「CSP / Frame 祖先仅放行致远域名」此前无处配置）
    csp_frame_ancestors VARCHAR(512) NULL,             -- 逗号分隔的 frame-ancestors 白名单（仅致远域名）
    csp_child_src       VARCHAR(512) NULL,             -- 逗号分隔的 child-src 白名单
    id_field            VARCHAR(32)  NOT NULL DEFAULT 'loginName', -- loginName / memberCode / memberId
    phone_field_path    VARCHAR(64)  NOT NULL DEFAULT 'mobile',    -- mobile→telNumber→properties.telnumber
    -- 🔴 默认值改 DIRECT_SEND（QA I1修正）：
    --   原默认 'DRAFT_THEN_SEND' 指向**尚未确认可行**的路径（C-1 是阻塞项）；
    --   ✅ 确证可行的是 DIRECT_SEND（draft=0）。DRAFT_THEN_SEND 作为
    --   「C-1 联调确认后再切」的选项，切DEFAULT 会让 P0 建在未确认路径上。
    draft_mode          VARCHAR(24)  NOT NULL DEFAULT 'DIRECT_SEND', -- DIRECT_SEND（默认）/ DRAFT_THEN_SEND
    timeout_ms          INT          NOT NULL DEFAULT 15000,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted             SMALLINT     NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_ext_wf_system_code
    ON external_workflow_system (tenant_id, code)
    WHERE deleted = 0;

COMMENT ON TABLE external_workflow_system IS '外部工作流系统接入配置（连接/能力/端点/状态映射；密钥仅存引用）';
```

### 6.2 V154 — 外部流程实例镜像

```sql
-- V154__ext_process_instance.sql
-- 外部流程实例镜像 + 调用审计 | PostgreSQL 16 | 幂等
--
-- ⚠️ 只追加；绝不修改已发布迁移。

-- ===========================================================================
-- 1) ext_process_instance
-- ===========================================================================
CREATE TABLE IF NOT EXISTS ext_process_instance (
    id                    BIGINT PRIMARY KEY,
    tenant_id             BIGINT       NOT NULL,
    -- 🔴 form_record_id 引用声明（QA S5）：与仓库既有惯例一致（字符串软引用无外键，
    --    在 Service 里挡，见 FormDefinitionService.delete() 注释），**镜像表允许孤儿**
    --    （只读影子；外部流程生命周期可能长于本地单据）。🔴 **禁止**在此列加 FK：
    --    会把「外部镜像」绑死成「本地单据的从表」，使孤儿镜像无法保留（丢失排障证据）。
    form_record_id        BIGINT       NOT NULL,
    form_code             VARCHAR(64)  NOT NULL,
    external_system       VARCHAR(64)  NOT NULL,
    external_case_id      VARCHAR(128) NOT NULL,     -- 致远 summaryId / col_summary.id
    external_process_id   VARCHAR(128) NULL,         -- start 响应 processId
    ext_affair_id         VARCHAR(128) NULL,         -- 发起事项 affairId（terminate 用）
    -- 🟡 S1澄清（QA r2 N6-3）：external_template_code 是**发起时的快照**，非绑定真相源
    --   · form_definition.external_workflow_ref VARCHAR(256)（V149）= **绑定真相源**（管理员在管理台配的模板 code/id）
    --   · ext_template_code VARCHAR(128)（V154）= 单次发起时从真相源复制的**快照**，仅供排障对比
    --   ⇒ 二者长度不同（256 / 128）是**有意的**：真相源要容下「模板 code 或 id 或 URL」（S1），
    --     快照只需存实际发出去的那个 code。**读取判定一律以 truth source 为准，禁止用快照驱动业务。**
    ext_template_code     VARCHAR(128) NULL,
    ext_status            VARCHAR(16)  NOT NULL DEFAULT 'NOT_STARTED',
                          -- NOT_STARTED / RUNNING / COMPLETED / TERMINATED / REJECTED
                          -- TERMINATED =终止 / 撤销 / 作废 **三者合一**（产品决策 D5）
                          -- ABANDONED：本地处置态（= 废弃并重建），**非外部状态**、不参与 status_mapping
                          -- ⚠️ 构建失败用 build_phase=FAILED 表达，不进 ext_status（见 uk_ext_inst_active 谓词注释）
    -- 🔴 external_sent：**外部流程是否已真实发出**（1 = 致远侧已创建流程实例并返回 caseId）
--
-- ⚠️ r3 修正（QA N1）：谓词**不能只看 build_phase**。
--   原设计让 build_phase='FAILED' 的行自动让出槽位；但 draft_mode 默认是 DIRECT_SEND，
--   而 DIRECT_SEND 下外部流程在 build_phase 还是 DRAFTED 时**就已经真实发出去了**
--   （首节点待办已生成）。⇒ 失败行自动让位会造成：
--   第2 槽失败 → 自动让槽 → 用户再点提交 → **致远上出现第二个流程**，第一个成为孤儿。
--   连带废掉「断点续拼」（唯一索引管不到 FAILED 行 ⇒ 续拼与新建可并存）与
--   「废弃并重建」按钮（不用点也能提交，按钮语义被架空）。
-- ⇒ 改为按「外部是否已真实发出」判断：external_sent=1 恒占用槽位，
--    必须显式走 ABANDONED（保留 caseId 可调外部 stop）；
--    external_sent=0 只出现在 start 调用失败时（caseId 尚未返回），可安全自动让位。
    external_sent         SMALLINT     NOT NULL DEFAULT 0,
                          -- 0=外部未真实发出（start 未成功返回 caseId）
                          -- 1=外部已真实发出（致远侧已创建流程实例）
                          -- ⚠️ DRAFT_THEN_SEND 下 start(draft=1) 返回后即为 1，
                          --    即使流程仍停在「待发」根本没在跑 —— 「已发出」指的是
                          --    **致远侧已存在流程实例**，不是「已激活/已流转」
    build_phase           VARCHAR(16)  NOT NULL DEFAULT 'DRAFTED',
                          -- DRAFTED / ASSIGNING / READY / ACTIVATED / DONE / FAILED
    build_error           TEXT         NULL,
    -- 🔴 draft_flag 默认改 NULL（QA I1）：DIRECT_SEND 无「待发」阶段，
    --    DEFAULT 1 在该模式下必错。按 draft_mode 赋值：3-A 置 1（activate 后置 0）；3-B 置 0。
    draft_flag            SMALLINT     NULL,          -- 1=外部仍处待发；0=已发送；NULL=不适用（DIRECT_SEND）
    assigned_slots        JSONB        NULL,          -- {activityId:[personRef,...]} 已填槽位（**断点续拼 P0**）
    initiator_ref         VARCHAR(128) NULL,          -- 发起人外部标识（loginName/memberCode）
    initiator_name        VARCHAR(64)  NULL,
    -- 🔴 command_id 改 VARCHAR(128)（QA Q3，原 VARCHAR(64) 偏紧）
    -- 🔴 且**对同一次业务发起必须稳定不变**（不得含时间戳）：
    --    它同时是①本地幂等唯一索引 uk_ext_inst_command ②V8 OpenAPI 的 data.commandId。
    --    若含时间戳 → 重试时生成新值 ⇒ **两个幂等机制同时失效**（本地判不出重复，
    --    外部也认不出重试）⇒ 并发/超时重试会产生重复外部流程。
    command_id            VARCHAR(128) NULL,          -- 幂等键：建议 hash(tenantId + formRecordId + draftMode + templateCode)
    raw_status            VARCHAR(32)  NULL,          -- 外部原始状态值，排障用
    current_nodes         JSONB        NULL,          -- 当前节点/处理人快照
    opinions_snapshot     JSONB        NULL,          -- 审批意见镜像（无查询接口时为 NULL）
    sync_error            TEXT         NULL,
    started_at            TIMESTAMPTZ  NULL,
    ended_at              TIMESTAMPTZ  NULL,
    last_sync_at          TIMESTAMPTZ  NULL,
    created_by            BIGINT       NOT NULL,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted               SMALLINT     NOT NULL DEFAULT 0
);

-- 同一单据仅一条「占用槽位」的外部实例 —— 防并发双发
--
-- 🔴 r3 修正（QA N1）：谓词按 external_sent（外部是否已真实发出）判断，**不再看 build_phase**
--
-- ⚠️ r2 曾用「谓词排除 build_phase='FAILED' 使失败行自动让位」，该设计在
--   draft_mode=DIRECT_SEND（r2 起的新默认）下是错的：
--   DIRECT_SEND 下外部流程在 build_phase 还是 DRAFTED 时就已真实发出，
--   第 2 槽失败→自动让槽→用户再点提交→**致远出现第二个流程**，第一个成为孤儿。
--   且会连带废掉 P0 的「断点续拼」与「废弃并重建」按钮。
--
-- ⇒ 正确谓词：**占用槽位的必须是「已真实发出」的行**（external_sent=1 在谓词内），
--   「尚未真实发出」的行（external_sent=0）排除在谓词外 ⇒ 自动让位。
--   语义：唯一索引「拦住」的行 =仍持有槽位的行 = 外部已存在流程实例的行。
--   external_sent=1 的行恒占用槽位，必须显式走 ABANDONED（保留 caseId 可调外部 stop）。
--
-- 🔴 r4 修正（QA D2）：r3 此处误写成 `external_sent = 0`，与上方注释 180° 反转 ——
--   那会让「未发出」的行占用槽位、「已发出」的行反而让位，等于 N1 完全没修。
CREATE UNIQUE INDEX IF NOT EXISTS uk_ext_inst_active
    ON ext_process_instance (form_record_id)
    WHERE deleted = 0
      AND ext_status IN ('NOT_STARTED', 'RUNNING')
      AND external_sent = 1;         -- 🔴 占槽位者= 外部已真实发出；=0 才自动让位

CREATE INDEX IF NOT EXISTS idx_ext_inst_case
    ON ext_process_instance (tenant_id, external_system, external_case_id)
    WHERE deleted = 0;

-- 轮询扫描范围（Job 走这个索引）；终态与 ABANDONED 均不在谓词内，自动停止轮询
--
-- 🔴 三点设计约束（QA Q4 + N1 + N2）：
--  ① build_phase 必须纳入索引谓词：PostgreSQL 部分索引要求「查询条件蕴含索引谓词」。
--     扫描 SQL 需 `AND build_phase IS DISTINCT FROM 'FAILED'`（跳过构建失败的行，
--     它们无外部状态可查），该条件若不在谓词内则**用不上这个部分索引**，退化为全表扫。
--  ② 🔴 领取必须 `FOR UPDATE SKIP LOCKED` + `LIMIT`（N2：不得用 biz_exec_lock，
--     它是一次性幂等账本，SUCCESS 行永不清理 ⇒ 每实例只轮询一次 ⇒ 状态永久冻结）。
--  ③ 🔴 认领时一并更新 last_sync_at（见 19§7 SQL）—— 该列已在索引中。
CREATE INDEX IF NOT EXISTS idx_ext_inst_polling
    ON ext_process_instance (tenant_id, ext_status, last_sync_at)
    WHERE deleted = 0
      AND ext_status IN ('NOT_STARTED', 'RUNNING')
      AND build_phase IS DISTINCT FROM 'FAILED';   -- 构建失败行无需轮询，无外部状态可查

-- 管理台筛选：发起人 / 时间段 / 状态
CREATE INDEX IF NOT EXISTS idx_ext_inst_console
    ON ext_process_instance (tenant_id, form_code, ext_status, started_at)
    WHERE deleted = 0;

-- 幂等键唯一
CREATE UNIQUE INDEX IF NOT EXISTS uk_ext_inst_command
    ON ext_process_instance (command_id)
    WHERE command_id IS NOT NULL AND deleted = 0;

COMMENT ON TABLE ext_process_instance IS '外部流程实例镜像（只读影子；EXTERNAL 模式不产生本地待办；form_record_id 为软引用，允许孤儿，不设 FK）';
COMMENT ON COLUMN ext_process_instance.build_phase IS '拼装进度：拼装过程与业务状态解耦，失败不污染 ext_status';
COMMENT ON COLUMN ext_process_instance.ext_status IS '外部流程状态；TERMINATED=终止/撤销/作废三者合一（D5）；ABANDONED 为本地「废弃并重建」处置态，非外部状态且不参与 status_mapping';
COMMENT ON COLUMN ext_process_instance.assigned_slots IS '已填槽位，用于 build_phase=ASSIGNING/FAILED 中断后的断点续拼（P0）';
COMMENT ON COLUMN ext_process_instance.opinions_snapshot IS '审批意见镜像；🟡 P0 恒为 NULL —— 致远 REST 25 接口与 V8 OpenAPI 均无意见查询接口（见 C-2）。保留列供 C-2 候选④（只读库查 ctp_opinion，需甲方书面批准 + 独立只读账号）落地';
COMMENT ON COLUMN ext_process_instance.draft_flag IS '1=外部仍处待发（ctp_affair.state=1），activate 成功后置 0；NULL=不适用（draft_mode=DIRECT_SEND 无待发阶段）';
COMMENT ON COLUMN ext_process_instance.command_id IS '幂等键；🔴 对同一次业务发起必须稳定不变（不得含时间戳），它同时是 uk_ext_inst_command 唯一索引与 V8 data.commandId 的载体';

-- ===========================================================================
-- 1b) ext_terminal_event —— 终态事件收件表（B4 / QA B4）
--
-- 为什么需要这张表（不是「应用层先查再插」）：
--   EXTERNAL 是「轮询 + 回调双入口 + 集群 Job + 超时夺权重试」的并发模型，
--   而 biz_execution_task **没有**唯一约束（V121:130-147 只有两个普通索引），
--   ExecutionTaskService.enqueue() 也**无条件** save。
--   「先查再插」在并发下**必然有窗口**（两个入口都查到「不存在」→ 都插 → 后置任务执行两次
--   ⇒ 重复发货/重复建单）。
--   ⇒ 幂等下沉到 **DB 唯一约束**，用 INSERT ... ON CONFLICT DO NOTHING RETURNING id
--     原子地回答「这次终态是不是我触发的」。
-- ===========================================================================
CREATE TABLE IF NOT EXISTS ext_terminal_event (
    id                 BIGINT PRIMARY KEY,
    tenant_id          BIGINT       NOT NULL,
    external_system    VARCHAR(64)  NOT NULL,
    external_case_id   VARCHAR(128) NOT NULL,
    terminal_status    VARCHAR(16)  NOT NULL,   -- COMPLETED / REJECTED / TERMINATED
                                                   -- （TERMINATED 涵盖外部撤销与终止，D5 不区分）
    source             VARCHAR(16)  NOT NULL,   -- POLL / CALLBACK / MANUAL
    -- 🔴 r3 简化（QA N3）：process_state 降为两值，**不需要 PENDING**
    --   r2 的两阶段设计（置 DONE 在事务内 ⇒ 补偿 Job 是死代码；在事务后 ⇒ 丢失窗口重现），
    --   且 r2 论证补偿安全时称的「enqueue 查重」经实测**不存在**
    --   （ExecutionTaskService.enqueue():64-81 是无条件 save，biz_execution_task 无唯一约束）。
    --   ⇒ 收件行与 biz_execution_task 投递**同事务**（已核实同库），
    --     原子性保证「要么全成、要么全败」，丢失型缺陷已彻底消除，无需补偿环。
    process_state      VARCHAR(16)  NOT NULL DEFAULT 'DONE',
                       --固定 DONE（保留列以便将来分库场景演进；当前不写 PENDING）
    biz_task_id        BIGINT       NULL,       -- 投递到的 biz_execution_task.id（便于排障）
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_ext_terminal_event UNIQUE (tenant_id, external_system, external_case_id, terminal_status)
);

-- 🔴 回调/轮询反查同caseId 的全部终态事件（排障用）
CREATE INDEX IF NOT EXISTS idx_ext_terminal_event_case
    ON ext_terminal_event (tenant_id, external_case_id, created_at DESC);

COMMENT ON TABLE ext_terminal_event IS '外部流程终态事件收件表：轮询与回调统一入口，DB 唯一约束保证「不重复触发后置任务」';
COMMENT ON COLUMN ext_terminal_event.process_state IS '固定 DONE。🔴 本列【不参与任何判定】—— 幂等完全由 uk_ext_terminal_event 唯一约束保证（靠 INSERT ... ON CONFLICT DO NOTHING RETURNING id 的返回行数判断「是不是我触发的」）。实现者【不要】先查该列再决定是否投递，那既多余又引入竞态。保留列仅供将来分库场景演进';
COMMENT ON CONSTRAINT uk_ext_terminal_event ON ext_terminal_event IS '幂等由 DB 保证：同一 (租户,系统,caseId,终态) 只处理一次；TERMINATED 不区分撤销/终止(D5)';

-- ===========================================================================
-- 2) ext_workflow_call_log —— 对外调用审计（密钥/token 脱敏）
-- ===========================================================================
CREATE TABLE IF NOT EXISTS ext_workflow_call_log (
    id                BIGINT PRIMARY KEY,
    tenant_id         BIGINT       NOT NULL,
    external_system   VARCHAR(64)  NOT NULL,
    instance_id       BIGINT       NULL,
    operation         VARCHAR(64)  NOT NULL,   -- START/ASSIGN_NODE/ACTIVATE/FETCH/STOP/CANCEL/RESOLVE
    endpoint          VARCHAR(512) NULL,
    request_summary   JSONB        NULL,       -- 脱敏后的入参摘要
    response_code     VARCHAR(32)  NULL,
    response_summary  JSONB        NULL,
    success           SMALLINT     NOT NULL DEFAULT 1,
    error_message     TEXT         NULL,
    cost_ms           INT          NULL,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ext_call_log_inst
    ON ext_workflow_call_log (tenant_id, instance_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ext_call_log_op
    ON ext_workflow_call_log (tenant_id, operation, created_at DESC);

-- 🔴 保留策略（QA I7）：轮询会写爆本表
--   量级：100 个在途实例 × 5 分钟一轮 ≈ **2.9 万行/天**，全是 FETCH 且全成功。
--   后果：表与索引单调膨胀，且poll 噪音淹没 START/ASSIGN_NODE 这些真正需要排障的记录。
-- ⇒ 对策（三条同时）：
--   ① 应用侧：`operation='FETCH'` **只记失败不记成功**（变更类操作全量全记）
--   ② 索引侧：本索引按 created_at 倒序，支持按时间范围清理
--   ③ 运维侧：定期归档/清理任务（保留期建议 30 天，归入 19§9 任务 E2）
CREATE INDEX IF NOT EXISTS idx_ext_call_log_created
    ON ext_workflow_call_log (created_at);

COMMENT ON TABLE ext_workflow_call_log IS '外部工作流 API 调用审计（token/密钥脱敏，不落明文凭证）。⚠️ FETCH 只记失败；建议保留 30 天后归档';
COMMENT ON COLUMN ext_workflow_call_log.operation IS 'START/ASSIGN_NODE/ACTIVATE/FETCH/STOP/TERMINATE/RESOLVE；🔴 不含 CANCEL/REVOKE —— 平台不调用撤销（D5）';
```

### 6.3 回滚

| 步骤 | 回滚动作 |
|------|---------|
| V153 | `DROP CONSTRAINT chk_form_def_workflow_binding_v2` → 重建 V149 原 CHECK（EXTERNAL 强制 `workflow_definition_id IS NULL`）→ 现有 EXTERNAL 绑定需先清空蓝图字段 |
| V154 | 新增 `ext_terminal_event`（含滞留 `PENDING` 行须先清理或随表一起丢）→ 两张旧表 `DROP TABLE`（无外部依赖，镜像数据可丢；但 `caseId` 丢失后无法调外部 `stop`，回滚前应确认无在途外部流程） |
| **V153 附加** | 若已加 `form_record.status` 值域 CHECK，回滚需一并 `DROP CONSTRAINT`（**但须先确认无 `TERMINATED` 状态的行**，否则旧版代码读不出该值） |
| 回滚触发条件 | 致远对接判定不可行（见 §7 B 方案）时，一次性回滚 V153+V154，平台退回纯 LOCAL |

---

## 7. 风险与回退

### 若致远对接最终不可行

| 维度 | 影响 |
|------|------|
| **必须放弃的验收** | 规划 §9 最小验收：「致远出现 N 级审批 + 发起人在致远已发可打开 + 外部通过后本地 APPROVED + 管理台可查」 |
| **仍可保留的成果** | ① `external_workflow_system` / `ext_process_instance` 通用模型与 Adapter 契约（换厂商只改配置 + 新 Adapter 实现）② 注入三模式（FORM_JSON / RICH_HTML / EMBED_URL）对任何外部系统通用 ③ EMBED_URL 路由与只读套壳（对任何 iframe 嵌入通用）④ 绑定语义演进（运行时/蓝图分离）本身有价值 |
| **平台净损失** | 仅「P0 外部系统选型」一项落空。**无业务功能受损**：LOCAL 路径完全不受影响，V149 的 NONE/LOCAL 语义经 V153 回滚后原样 |
| **B 方案** | ① 把 EXTERNAL 模式**降级为「跳转式外部办理」**：本地提交后生成外部待办链接（`URLLINK`），审批在外部点开，本地只按回调/轮询记录状态——**放弃拼节点，保留联动** ② 或直接**不实施 EXTERNAL**，仅保留 V153 的绑定语义演进作为未来能力，V154 镜像表不落 |

### 通用风险

| # | 风险 | 等级 | 缓解 |
|---|------|------|------|
| R1 | 状态枚举错判 → 提前触发后置任务 | 高 | ① `status_mapping` **管理台保存时校验（主）** ② **启动 fail-fast（兜底存量）** ③ **终态单调性** ④ **C-6 提为 Gate-1** 沙箱实测后才放行（QA N4：只做启动 fail-fast 拦不住运行期新增的错配置） |
| R2 | 意见查询接口不存在 → 意见展示落空 | 中 | 前端能力探测隐藏；深链跳转致远。**已回写 19§1.1/§6.1 与 ADR-022 §5 为降级表述**，避免开发按旧承诺实现 |
| R3 | 手机号解析全失败 → 审批缺人全阻断 | 中 | 联调首批验证；备选按 loginName/工号匹配 |
| R4 | 外部用户管理接口限流/无API 权限 | 中 | 全量拉取 + 本地缓存 + 定时刷新，不逐次调 |
| R5 | 发送待发竞态（`DRAFT_THEN_SEND` 路径） | 中 | **默认已改为 `DIRECT_SEND`**（无待发阶段 ⇒ 无此竞态）；若切回 `DRAFT_THEN_SEND` 则模板首节点预置发起人 + 监控告警 |
| R6 | V8 OpenAPI 授权申请周期长 | 中 | 与 V5 REST 并行实现，`api_flavor` 切换 |
| R7 | 致远侧配置（模板槽位）依赖甲方运维 | 高 | C-3 列为 **Gate-1**，**未完成不得开工 Phase B** |
| R8 | EMBED_URL 长 token 泄露 | 中 | 高熵随机 + 吊销（`embed_token_revoked_at`）+ Frame 祖先白名单 + **token 唯一索引不含 `deleted=0`**（防软删后被另一表单复用 ⇒ 串单） |
| R9 | 双击提交 → 外部孤儿流程 | 中 | `uk_ext_inst_active` 唯一索引 + **`form_record` 行 `FOR UPDATE`**（实测原无锁）+ 幂等 `command_id`（**稳定不变**） |
| **R10** 🆕 | **后置任务「丢失型」缺陷**：收件表已写、投递前崩溃 ⇒ 单据永久卡在审批中，**且静默无告警** | 🔴 **高** | 收件行与 `biz_execution_task` **同事务** ⇒ 原子性保证「要么全成、要么全败」，**丢失型已彻底消除，无需补偿 Job**（QA N3）。并发重复由 `ON CONFLICT` 原子性挡住，与补偿机制无关 |
| **R11** 🆕 | **`EMBED_URL` 跨站 iframe 鉴权不可行**（`SameSite=Lax` 默认拦 Cookie）⇒ B5（L 级）部分白做 | 中-高 | C-12 提为 **Gate-1**；**待产品确认 P-2**，不可行则 `EMBED_URL` 从 P0 降级为 P1，B5 降为 M |
| **R12** 🆕 | **撤销被误映射为 `COMPLETED`** ⇒ 触发「审批通过」后置任务，业务动作错误执行 | 中 | D5「统一 `TERMINATED`」已消除「区分」这一风险；剩余风险靠 `status_mapping` **保存时校验 + 启动 fail-fast** + 终态单调性 + C-6 实测（见 C-13） |
| **R13** 🆕 | **误用 `biz_exec_lock` 做周期性动作** ⇒ 首个实例执行后写 `SUCCESS`，该 `biz_type+biz_id` **此后永不执行任何动作** | 🔴 **高**（若发生） | 🔴 **实测确认其语义为「一次性幂等账本」而非互斥量**（`:98` 写 SUCCESS、`:65-66` 见 SUCCESS 直接 return、**全仓无生产代码清SUCCESS**）⇒ 轮询**必须用 `FOR UPDATE SKIP LOCKED`**（见 19§7 N2 专项 + §8 第 14 条） |
| **R14** 🆕 | **`DIRECT_SEND` 下外部流程已发出但本地仍 `build_phase=DRAFTED`** ⇒ 唯一索引自动让槽 ⇒ 重复发起，致远出现第二个流程 | 🔴 **高**（若发生） | 谓词改按 **`external_sent`**（外部是否已真实发出）判断，**不看 `build_phase`**（QA N1）；`external_sent=1` 恒占槽，必须显式走 `ABANDONED` |

---

## 8. 共享约定（供 Engineer）

1. 所有外部 ID 一律 `VARCHAR(128)` 字符串存储（致远是雪花 Long，超 int64 时会精度丢失；**Java 侧必须用 String/BigInteger 收发，禁止 long**）。
   🔴 **必须声明为 `String` 的四个显式列名**（工程上极易漏，故点名）：**`external_case_id` / `external_process_id` / `ext_affair_id` / `initiator_ref`**。
   ⚠️ 同表的 `id` / `tenant_id` / `form_record_id` / `created_by` 用 `BIGINT` 是**正确的**（本地雪花 ID 走 long 没问题）—— 不要把这四列也改成字符串。
2. 外部状态与本地状态**必须**经 `status_mapping` 转换，禁止把外部原始值直接落 `ext_status`（另存 `raw_status`）。`status_mapping` 🔴 **启动时 fail-fast 校验**，配置错直接启动失败 —— 不可「逐条实例拒绝轮询」，那会让系统带着错配置正常启动、在生产逐单误判。
3. 密钥 / token **禁止**明文入库；`auth_ref` 只存引用。⚠️ **须明确 provider**：多租户不同密钥无法用「环境变量」（进程级）承载，须用配置中心（按 `tenant_id` + `external_system` 取路径）。
4. 所有对外调用必须写 `ext_workflow_call_log`，写前脱敏；⚠️ **`FETCH` 只记失败不记成功**（轮询量级 ≈ 2.9 万行/天）。
5. `form_record.status` 与 `ext_process_instance.ext_status` 的映射只在**一个** Service 里维护（`ExtStatusMapper`），禁止散落。
6. 时间统一 `TIMESTAMPTZ`，Java 侧 `Instant`。
7. 本地只存外部 `caseId` 与进度镜像，**任何情况下不得由 EXTERNAL 路径写入 `sys_task`**。
8. 🔴 **【合规硬约束】平台仅代发起人完成「发起」这一个动作。禁止代替真人调用 `bpm/process/addNode`、`bpm/workitem/finish`、`bpm/work-item/submit`。**
   理由（证据链，见 21 报告 §4.4）：`addNode` 要求 `workitemId` 是「已存在的待办事项」（V5 APIdoc 1.18：`workitemId` 对应 `ctp_affair.CASE_ID`），且 `submitType=1`（提交协同）**必然携带 `attitude` 审批意见**（官方示例 `comment_deal: {attitude, content}`）。`attitude` 是审批态度，**只能由正在处理该待办的人提交** ⇒ 调用它等于**替真人提交了审批意见 = 伪造审批人签名**，构成**审计与合规事故**。
   会签 / 知会需求只能通过修改**外部模板节点属性**实现，且须甲方在致远侧完成。
9. 🔴 **禁止 `command_id` 含时间戳** —— 它同时是本地幂等唯一索引与 V8 `data.commandId`；含时间戳会使**两个幂等机制同时失效**。
10. 🔴 **EXTERNAL 界面不提供撤销入口**，Adapter 不提供 `revoke`/`cancel` 方法（产品决策 D5）。撤销与终止在本地**统一映射 `TERMINATED`**。
11. 🔴 **终态单调性**：`ext_status` 迁移只允许 `NOT_STARTED → RUNNING → {COMPLETED|REJECTED|TERMINATED}` 与 `NOT_STARTED → ABANDONED`；**任何终态不可被改回 `RUNNING`**。违反 ⇒ 记 `sync_error` + 告警，**不落库**。
12. 🔴 **EXTERNAL 发起链路的 `form_record` 读取必须 `SELECT ... FOR UPDATE`**（实测 `FormRecordService.java:112` 无行锁）；`ExtWorkflowLaunchService` 的 `@Transactional` 边界须覆盖 start→落镜像全过程。
13. 🔴 **幂等必须同时挡住「重复」与「丢失」**：终态投递走 `ext_terminal_event`，**收件行与 `biz_execution_task` 投递同事务**（已核实同库，可同事务）⇒ 丢失型缺陷已被单事务消除，**不引入补偿 Job**（见 19§9 E1 专项 N3）。**丢失型缺陷是静默的，比重复型更难发现**，所以设计时须显式确认「哪一个环保证不丢」——本轮答案是「单事务原子性」，不是「补偿重投」。
14. 🔴 **`biz_exec_lock`（`DistributedLockService`）严禁用于周期性动作** —— 它是**一次性幂等账本，不是互斥量**。实测语义：`runAction():98` 成功后 `casStatus(RUNNING→SUCCESS)`；`executeWithLock():65-66` 见 `SUCCESS` **直接 return 不执行**；`:70` 只删 `FAILED`、`:80` 只删**超时** `RUNNING`；**全仓无生产代码清除 `SUCCESS` 行**（`deleteByStatus` 其余调用方全在测试清理代码）⇒ `SUCCESS` 行永久存在，该 `biz_type+biz_id` 从此再不执行任何动作。
    - ✅ **适用**：一次性后置任务（`ExecutionTaskService.executeOne():109-110` 的用法，`lockId=bizRefId` 即「这个任务只执行一次」）
    - ⛔ **禁止**：轮询 / 同步 / 重试扫描等**周期性动作** —— 首个实例执行后写 `SUCCESS`，后续所有轮次直接 return ⇒ **该记录状态永久冻结**（对 EXTERNAL 轮询而言，意味着**外部撤销永远不会被识别为 `TERMINATED`，直接击穿产品决策 D5**）
    - ✅ **周期性动作的正确做法**：`FOR UPDATE SKIP LOCKED` 领取 + 认领时打时间戳（见 19§7 N2 专项 SQL）
15. 🔴 **凡引用仓库既有组件作为方案基石，必须同时核对其「语义」与「生命周期」，不能只引用其「存在性」。**
    **（r4 扩展）「方案基石」也包括方案自己产出的 DDL 草案与伪代码 —— 散文正确不等于代码可运行。**
    本轮共 **6 处**同类踩坑，分两类：
    **A. 引用既有组件（只看存在性，没读语义）**
    | 组件 | 方案原先的假设 | 实际语义 | 后果 |
    |------|--------------|---------|------|
    | `biz_exec_lock` / `DistributedLockService` | 互斥量（V121 注释「替代 `synchronized`，集群安全」） | **一次性幂等账本**，`SUCCESS` 行永不清除 | 轮询只跑一次 ⇒ 状态永久冻结 ⇒ 击穿 D5（N2） |
    | `syncFormRecordStatus()`（`ProcessService:500-513`） | 可复用于任意状态同步 | **仅 LOCAL 路径调用**（`:221`/`:496` 撤回、`:524` 通过），会把单据置 `SAVED`/`APPROVED` | EXTERNAL 若复用会把 `TERMINATED` 单据误置 `SAVED` ⇒ 绕过「不可再提」（§5.2） |
    | `hasApproveHistory()`（`FormRecordService:207-210`） | 可复用为通用「是否已审批」判定 | 依赖 `record.current_instance_id`；EXTERNAL 下该字段恒 null ⇒ 恒返回 false | `canWithdraw` 恒 false（结果恰好正确，但**理由是字段为空而非校验生效**）—— 若有人为 EXTERNAL 补写 `current_instance_id`，该保护会静默失效 |
    **B. 自己产出的 DDL 草案 / 伪代码（散文全对，代码写错）**
    | 位置 | 散文说 | 代码实际 | 后果 |
    |------|-------|---------|------|
    | `uk_ext_inst_active` 谓词 | 「`external_sent=1` 的行恒占用槽位，`=0` 自动让位」 | r3 写成 `external_sent = 0`（**180° 反转**） | 照抄即**N1 等于没修**，且与 r2 同一失败模式（D2） |
    | `ext_process_instance.external_sent` 列 | 独立一列 | r3 写成 `external_sentSMALLINT`（**漏空格**） | 照抄即**语法错误**，PG 解析成 `external_sentsmallint`（D1） |
    | `ext_template_code` 列 | 声明一次 | **同一 `CREATE TABLE` 内声明两次** | 照抄即 **duplicate column** 报错（D3） |
    ⇒ **教训**：DDL 与伪代码**必须逐字校对**（列名、逗号、空格、谓词方向），不能因为「散文已经想清楚了」就假定代码与之一致。**建议提审时把 DDL 当代码审。**
16. 🔴 **告警与退避的聚合粒度统一为 `(external_system, raw_status)`** —— 勿按实例逐条告警（100 个实例同状态全挂会产生 100 条告警 ⇒ 告警风暴，淹没真实故障）。19§7、§8.2 第 10 条、R1 三处表述须一致。**单据只记 `sync_error`，退避计数落在 `(external_system, raw_status)` 聚合层**。
17. 🟡 **绑定真相源 vs 发起快照必须分清（S1）**：`form_definition.external_workflow_ref VARCHAR(256)`（V149）是**绑定真相源**（管理员在管理台配置的模板 code/id）；`ext_process_instance.ext_template_code VARCHAR(128)`（V154）是**单次发起时复制的快照**，仅供排障对比。**二者长度不同是有意的**（真相源要容下 code/id/URL）。🔴 **禁止用快照驱动任何业务判定**（改绑只改真相源，历史快照保持原样以便追溯「当时发到哪个模板」）。

---

## 9. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-10-16 | 首版：核实致远 V5 REST + V8 OpenAPI 文档，修正 freeReplaceNode 语义（替换非追加），定稿 Adapter 契约、迁移草案、7 项联调阻塞清单 |
| **2026-10-16 (r2)** | **🔴 落地产品决策 D5（外部撤销 → `TERMINATED`）**：§3.1 **删除 `revoke` 方法**、新增 `terminate` 专项对比表 + 「防开发误做撤销按钮」三条硬约束；`capabilities` 中 `CANCEL` 加注「探测到 ≠ 平台要调用」；新增 **C-13** 撤销可判定性（四套枚举候选值全部映射 `TERMINATED`）；`ext_process_instance.ext_status` 注释明确「TERMINATED = 终止/撤销/作废三者合一」 |
| **2026-10-16 (r2)** | **🆕 C-12 `EMBED_URL` 跨站 iframe 鉴权可行性**（Gate-1，待产品确认 P-2）；**§3.1 补 4 个 embed 方法**（`resolveEmbed`/`verifyEmbedAuth`/`revokeEmbedToken`/`getFrameAncestors`），落实 19§2.1 五条安全要求中此前完全缺失的 4 条 |
| **2026-10-16 (r2)** | **吸收 QA 21 报告**：§6.1 `uk_form_def_embed_token` **谓词去掉 `deleted=0`**（防软删后被另一表单复用 ⇒ 越权串单）+ 补 `embed_token_revoked_at`/`embed_expires_at`/`csp_frame_ancestors`/`csp_child_src`；§6.2 `command_id` **VARCHAR(64)→VARCHAR(128)** 且明确「**对同一次业务发起稳定不变**」；`draft_flag` 改可空 + `draft_mode` **默认改 `DIRECT_SEND`**；`idx_ext_inst_polling` **谓词纳入 `build_phase`**；`form_record_id` 补引用声明（**不设 FK**，允许孤儿）；`ext_workflow_call_log` 补保留策略 + `FETCH 只记失败` |
| **2026-10-16 (r2)** | **新增 `ext_terminal_event` 收件表**（`UNIQUE (tenant_id, external_system, external_case_id, terminal_status)` + `process_state` 两阶段 + `biz_task_id`）⇒ **幂等由 DB 唯一约束保证**；§8 共享约定扩为 14 条；§3.2 设计原则扩为 9 条；**C-6 提为 Gate-1**；新增 **R10/R11/R12** |
| **2026-10-16 (r3)** | **🔴 N1 修正（r2 的两个改动合在一起出事）**：`uk_ext_inst_active` 谓词从「排除 `build_phase='FAILED'`」改为按 **`external_sent`（外部是否已真实发出）**。原因：`draft_mode` 默认改 `DIRECT_SEND` 后，外部流程在 `build_phase` 还是 `DRAFTED` 时**就已真实发出** ⇒ 原「失败行自动让槽」会造成**致远出现第二个流程**、第一个成为孤儿，并连带废掉 P0 的「断点续拼」与「废弃并重建」按钮。新增 `external_sent SMALLINT NOT NULL DEFAULT 0`；§4 序列与 [已有映射] 分派同步改写；新增 **R14** |
| **2026-10-16 (r3)** | **🔴 §8 第 14 条：`biz_exec_lock` 严禁用于周期性动作**。实测确认它是**一次性幂等账本**而非互斥量（`:98` 成功后写 `SUCCESS`、`:65-66` 见 `SUCCESS` 直接 return 不执行、`:70` 只删 FAILED、`:80` 只删超时 RUNNING、**全仓无生产代码清除 `SUCCESS` 行**）⇒ 若用于轮询，**每个实例只被轮询一次、外部状态永久冻结 ⇒ 外部撤销永不识别为 `TERMINATED`，直接击穿 D5**。正解 = `FOR UPDATE SKIP LOCKED`（SQL 见 19§7 N2 专项）。新增 **R13** |
| **2026-10-16 (r3)** | **🟡 N3 修正（E1 两环互斥 ⇒ 采纳 QA 方案 A）**：`process_state` 降为两值（固定 `DONE`）、**删除补偿 Job**（若同事务则补偿是死代码，若异事务则丢失窗口重现）；且 r2 论证补偿安全所称的「`enqueue` 查重」经实测**不存在**（`ExecutionTaskService.enqueue():64-81` 无条件 save，`biz_execution_task` 无唯一约束）⇒ 补偿重投会**真的重复投递**。**已核实两表同库 ⇒ 单事务原子性即彻底消除丢失型**。DDL 删 `idx_ext_terminal_event_pending`、加 `idx_ext_terminal_event_case` |
| **2026-10-16 (r3)** | **🟡 N4 修正：`status_mapping` 双重校验** —— 新增**管理台保存时校验（主）**，因为该配置是按租户一行的 DB 表、**由运行期 CRUD 写入**，仅「启动 fail-fast」只覆盖存量、**拦不住运行期新增的错配置**（而这正是它声称要防的场景）。`fail-fast` 降为存量兜底。§3.2 原则 2、C-6 缓解、R1/R12 同步 |
| **2026-10-16 (r3)** | **🟢 §8 第 15 条（采纳 QA 建议）**：**凡引用仓库既有组件作为方案基石，必须同时核对其「语义」与「生命周期」，不能只引用其「存在性」** —— 列出本轮三处同类踩坑实例（`biz_exec_lock` / `syncFormRecordStatus` / `hasApproveHistory`） |
| **2026-10-16 (r3)** | **🟢 N5：告警与退避聚合粒度统一为 `(external_system, raw_status)`**；§6.1 `idx_ext_inst_polling` 注释补 `FOR UPDATE SKIP LOCKED` 约束；§6.3 回滚补 `external_sent` 说明 |
| **2026-10-16 (r4)** | **🔴 D2 修正（唯一实施阻断）**：`uk_ext_inst_active` 谓词 r3 误写成 `external_sent = 0`，与自家注释 **180° 反转** ⇒ 「未发出」的行占槽、「已发出」的行让位，**等于 N1 完全没修**。已改为 **`external_sent = 1`**（占用槽位者 = 外部已真实发出；`=0` 才自动让位），并补一行显式说明「唯一索引拦住的行 = 仍持有槽位的行」 |
| **2026-10-16 (r4)** | **🔴 D1 修正**：`external_sentSMALLINT` **漏空格** ⇒ PG 会解析成 `external_sentsmallint`、脚本直接语法错误。已补空格并把列注释拆成多行 |
| **2026-10-16 (r4)** | **🔴 D3 修正**：`ext_template_code` 在**同一 `CREATE TABLE` 内声明了两次**（`:647` 与 `:673`）⇒ PG 报 duplicate column。已删除重复声明 |
| **2026-10-16 (r4)** | **🟡 D4 修正**：`external_sent` 列注释第二分支「/待发未激活」错误 —— `DRAFT_THEN_SEND` 下 `start(draft=1)` 返回后即为 1，但流程仍停在待发根本没在跑。已改为「『已发出』指**致远侧已存在流程实例**，不是『已激活/已流转』」 |
| **2026-10-16 (r4)** | **🟡 `process_state` 注释澄清**：写明该列**不参与任何判定**，幂等完全靠 `uk_ext_terminal_event` + `ON CONFLICT ... RETURNING id` 的返回行数；**实现者不要先查该列再决定是否投递**（多余且引入竞态） |
| **2026-10-16 (r4)** | **🟢 §8 第 15 条扩展一格（元教训）**：「方案基石」**也包括方案自己产出的 DDL 草案与伪代码** —— **散文正确不等于代码可运行**。把本轮 6 处踩坑分成 A（引用既有组件，3 处）与 B（自己产出的 DDL/伪代码，3 处）两类列表，并建议「**提审时把 DDL 当代码审**」 |