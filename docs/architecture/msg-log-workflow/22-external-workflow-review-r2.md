# 22 · 外部工作流方案技术复审报告（r2 修订后）

> **审查人**：严过关（QA Engineer / software-qa-engineer）
> **审查日期**： 2026-10-16（复审 r2）
> **审查对象**：`19-external-workflow-integration-plan.md`(774行)、`20-external-workflow-adapter-contract.md`(869行)、`adr/ADR-022-external-workflow-binding.md`(191行)
> **对照基准**：本人上一轮报告 `21-external-workflow-review.md`（只读）
> **仓库**：`D:\code\mis-platform` @ `ext-flow`
> **审查方式**：文档通读 + **活代码逐条实测复核**（未修改任何 Java/TS/SQL，本报告是本轮唯一新增文件）

---

## 0. 复审结论

| 维度 | 结论 |
|------|------|
| **架构决策本身**（运行时/蓝图分离、D5 撤销并入 `TERMINATED`、D6 新增状态） | ✅ **PASS** — 成立，不推翻 |
| **上一轮 6 项阻断的文档覆盖** | ✅ **6/6 已修**，且我逐条复核**行号与事实全部准确**，无虚报 |
| **6 条技术判断的验证** | ④ 条**成立**、① 条**部分成立**、① 条**前提被后续修改推翻** |
| **方案可施工性** | 🟡 **PASS_WITH_ISSUES** — 3 项新发现，其中 2 项会直接造成生产缺陷 |
| **总体** | 🟡 **PASS_WITH_ISSUES（Phase B 可开工，但 3 个具体任务动手前必须先改文档）** |

**与上一轮的差别**：上一轮 6 个阻断里 4 个是「读源码十分钟就能发现」的类型，本轮**已全部关闭**。这一轮我仍然找到 3 个同类问题 —— 说明**缺陷模式没变，仍是"文档写得很清楚、但与仓库现状/自身逻辑不一致"**。其中 N1、N2 是 r2 修订**自己新引入**的（上一轮不存在）。

**放行范围**：
- ✅ **Phase A 全部放行**（V153/V154 迁移、A3/A3′/A4、B2′）
- 🟡 **Phase B 可开工**，但 **B3（发起序列编排）在 N1 修好前不得动手**
- ⛔ **C1（轮询 Job）在 N2 修好前不得动手**；**E1（后置幂等）在 N3 修好前不得动手**

---

## 1. 架构师 6 条技术判断的独立验证

### ① `form_record.status` 无 CHECK ⇒ 加 `TERMINATED` 不需要 DDL，天然落在所有白名单之外 → ✅ **成立**（附一处需要修正的对比说法）

我独立复核了全部四环，**结论全部正确**：

| 文档断言（位置） | 我的实测 | 判定 |
|---|---|---|
| `V150:16` 裸 `VARCHAR(16) NOT NULL DEFAULT 'SAVED'` | ✅ 逐字一致。且我另跑 `grep -rn "ALTER TABLE form_record" migration/` 与 `grep form_record ... check\|enum\|alter` ⇒ **双零命中**，全仓无 CHECK、无 PG enum、无 ALTER | ✅ |
| `FormRecordService.java:164-167` 白名单只有 `{SAVED, REJECTED}` | ✅ `:164-165` 正是 `!SAVED && !REJECTED` 才抛错 | ✅ |
| `toVo():179-181` 的 `canEdit`/`canStart` 排除 `TERMINATED` | ✅ `:179-180` `canEdit` 白名单同；`:181` `canStart = owner && SAVED` | ✅ |
| `canWithdraw` 排除 `TERMINATED` | ✅ `:182-185` 要求 `IN_PROCESS` | ✅ |
| `startProcess():119` 的 `!SAVED` 天然拒绝再发起 | ✅ 逐字一致 | ✅ |
| `TERMINATED`(10) / `ABANDONED`(9) ≤ `VARCHAR(16)` | ✅ 字符数核算一致 | ✅ |

**「若复用 `REJECTED` 则三个 `can*` 判定要改」——这个对比说法成立**，而且比文档自己写的还更有说服力，我补一条它没说的**决定性理由**：

复用 `REJECTED` 不只是"三个 `can*` 要改"，而是要改**第 4 处**、且是**语义崩塌的那处** —— `requireMineEditable():169-171` 的归一会把 `TERMINATED` 记录直接改写成 `SAVED`，于是 `canStart=true`，**终止的单据立刻可再次提交**。也就是说复用 `REJECTED` 会让 D5 的核心承诺（同单不可复活）**当场失效**。✅ 结论正确。

> **🟡 但我发现一条文档没说的重要事实（对 F-3/B2′ 的定性有影响）**：
> 全仓 grep `STATUS_REJECTED|STATUS_APPROVED` ⇒ **`form_record.status` 从来没有任何代码路径写入 `REJECTED`**。`ProcessService.syncFormRecordStatus` 只有三个调用点：`:221`(REJECT 动作→`SAVED`)、`:496`(withdraw→`SAVED`)、`:524`(完成→`APPROVED`)。
> ⇒ **`:169-171` 的 `REJECTED` 归一分支在 LOCAL 路径下是死代码**；B2 描述的"产品决策被活代码直接推翻"目前**尚未真的发生**。
> ⇒ 这**不改变 B2′ 必须做**的结论（`REJECTED` 一旦由 EXTERNAL 的 `ExtStatusMapper` 写入，问题立即显性化），但定性应从"正在发生的矛盾"改为"**EXTERNAL 落地瞬间触发的 latent 缺陷**"。建议 F-3 改一句措辞，避免开发者误以为 LOCAL 现在就有这个 bug 而去"顺手修"。

---

### ② 前端依赖定位（`process-shell.tsx` 不读 `form_record.status`，真依赖在 `form-test-page.tsx`）→ ✅ **成立**，且我补齐了"是否还有别处"这一问

| 项 | 实测 |
|---|---|
| `process-shell.tsx` 不读 `form_record.status` | ✅ grep `status` 全部命中都是 `wf_instance.status`（`:480`/`:598` `instance.status`）与 `detail.canWithdraw`（`:486`/`:604`）、`t.status`（`:533`/`:534`）。**零处**读单据状态 |
| `form-test-page.tsx:58` `RECORD_STATUS` 缺 `TERMINATED` | ✅ `:58-64` 确认只有 5 个键；`:514` 确认 `RECORD_STATUS[item.status] ?? RECORD_STATUS.SAVED` ⇒ **静默回落成「保存态」** |
| `:446-450` 筛选下拉缺 `TERMINATED` | ✅ 确认只有 SAVED/IN_PROCESS/APPROVED/REJECTED 四个 option |
| **是否还有别处依赖**（主理人要求补查） | ✅ **已穷尽，确认只有这两处**：全前端 `grep -rln "form-records\|FormRecord"` 仅命中 `form-test-page.tsx` + `lib/api/form-records.ts`；全前端 tsx 搜 `'APPROVED'\|'REJECTED'\|'IN_PROCESS'\|'SAVED'` 字面量，其余命中全在 `task-list-page.tsx:27-28`（那是**任务状态** `TASK_STATUS`，与单据状态无关）。**后端侧**：BFF `FormRecordVO.status` 是**透传 `String`**（无枚举），Java 侧除 `FormRecordService`/`ProcessService` 外无第二处判定。**无遗漏** |

**结论：架构师的定位纠正完全正确，A3′ 的两处改动清单是完备的。**

---

### ③ D5 让 C-13 从风险变成"不变式"，代价是 `status_mapping` 必须覆盖四个候选值，漏配 ⇒ 永久卡 `RUNNING` → 🟡 **部分成立**

**成立的部分**：
- 「外部枚举能否区分**不影响正确性**」✅ **成立且推导严密**。D5 把撤销/终止合并为同一个本地值后，①②③ 三套冲突枚举（官方 `cancel=2`/`terminate=1`、第三方 `5`/`15`、`ctp_affair.STATE`）映射结果确实恒同。这是把一个"依赖外部可区分性"的风险转成"无论能否区分都成立"的不变式 —— 推理正确。
- 「必须覆盖 `cancel=2`/`terminate=1`/`5`/`15`」✅ 要求本身正确。
- **「启动 fail-fast 真的落在文档里，不是只写原则」** ✅ **确认落地**，共 7 处交叉写明：`19§7` 扫描表、`19§8.1-4`、`19§8 任务B4`（「状态枚举映射（`status_mapping`，**启动 fail-fast**）」）、`19§8.2 第5条`、`20§3.2 原则2`、`20§5 C-6 缓解①`、`20§8 约定2`、`ADR §4`。**这一条我给满分**，是我上一轮 I2 要求的落地形态。

**不成立 / 需修正的部分**：

1. 🔴 **「漏配 ⇒ 永久卡在 `RUNNING`」的后果评估过重**。文档自己在 `19§6.2` 管理台「操作」列里写了 **终止**，`C3` 任务也提供 `terminate`（P0、界面暴露）⇒ **存在人工出口**，管理员可强制把单据推到 `TERMINATED`。所以准确表述是「**无告警则无限期停留 `RUNNING`，需人工介入**」，而非"永久"。建议改词 —— 这个差别会影响产品对"是否可接受"的判断。

2. 🔴 **fail-fast 有一个架构级的覆盖缺口，文档完全没提**（本条是我认为本轮最实质的新发现之一）：
   `status_mapping` 存在 **`external_workflow_system.status_mapping`**（DB 表，**按租户一行**），**不在 `application.yml`**。而 `external_workflow_system` 是**运行时由管理台 CRUD 写入**的（D1 任务：「BFF 接入… EXTERNAL 绑定管理端 CRUD」，`status=DISABLED` 默认）。
   ⇒ **"服务启动时 fail-fast"只能覆盖启动时已存在的配置行**。运行期新增一个租户、其 `status_mapping` 配错 ⇒ **服务不会启动失败**（服务已在运行），错配置直接进生产。
   ⇒ **fail-fast 拦不住它自己声称要防的场景。** 必须补：**配置写入路径的保存时校验**（D1 管理台保存 `external_workflow_system` 时即时校验 `status_mapping` 非空+值域合法，非法即拒绝保存），fail-fast 只作为"存量配置"的启动兜底。这一点文档零覆盖。

3. 🟡 文档说"漏配 ⇒ 每轮都触发告警 ⇒ 退避"，但 `19§7` 又说"按 `external_system` 级熔断"。**告警是按单据还是按系统聚合、退避的退避粒度是实例级还是系统级**，两处口径未统一 —— 会影响"告警风暴"到底被控住了没有。建议明确。

---

### ④ `TERMINATED` 与 `ABANDONED` 的关系（让位机制同一套、`form_record` 结果相反、收敛到一处 Repository 方法）→ ✅ **成立**，且我验证了收敛的可行性

逐条核对：

| 维度 | 文档断言 | 我的验证 |
|---|---|---|
| 让位机制同一套 | 谓词 `ext_status IN ('NOT_STARTED','RUNNING')` 两者都不命中 ⇒ 自动让位 | ✅ 成立。且我确认**不需要为 `ABANDONED` 改谓词**（它本来就不在两元素集合里），这是对的 |
| `caseId` 都保留、都可调 `stop` | ✅ | ✅ 成立。`20§6.2` DDL 的 `ext_status` 注释确实写明 `ABANDONED` 是本地态、不参与 `status_mapping`、`caseId` 保留 |
| `form_record` 结果相反 | `TERMINATED` 不可再提 / `ABANDONED` 可重建 | ✅ 成立，且**这个相反是正确的、必需的**（正因为相反，才必须有独立 `TERMINATED` 而不能复用 `REJECTED`，与判断①自洽） |
| 「收敛到一处 Repository 方法（`findActiveInstance`）」 | ✅ **可行** | ✅ 成立。判据 = "是否存在命中 `uk_ext_inst_active` 谓词的行"，与 `ABANDONED`/`TERMINATED` 无关，**天然统一** |

**关于主理人问的"是否存在某个状态既不该新建又该走 `ABANDONED` 路径的边界情形"** —— 我构造了状态机全空间（`ext_status` × `build_phase`），结论是：**不存在这样的边界情形**。`ABANDONED` 的语义是"本地放弃、外部从未进入审批"，它**必然**属于"可新建"，与"该不该新建"完全同向，不存在分裂。✅ **收敛建议成立，可以采纳。**

> ⚠️ **但收敛的前提被 r2 自己破坏了** —— 见下面 N1。`ABANDONED` 之所以能"自动让位"，是因为它被排除在谓词外；而 r2 又额外把 `build_phase='FAILED'` 也排除出谓词，于是**多出一类"既不进 `ABANDONED`、又已让出槽位"的状态**（`ext_status=RUNNING + build_phase=FAILED`）。此时"能否新建"的判据与"该不该新建"**真的分裂了**，而文档没处理。**这是 N1 的根因。**

---

### ⑤ `ext_terminal_event` 与 `biz_execution_task` 同库 ⇒ 可同事务；四环设计同时挡住"重复"与"丢失" → 🔴 **前半成立（前提我已独立证实），后半不成立且有内部矛盾**

#### ⑤-1 「同库」这个前提 —— ✅ **成立，我独立查证了（不采信文档措辞）**

这是整个设计的基石，我按要求自己查：

| 检查 | 方法 | 结果 |
|---|---|---|
| 全仓有几个 Flyway schema 目录 | `find backend -type d -name migration` | ✅ **只有 1 个**：`backend/mis-migrator/src/main/resources/db/migration` |
| `biz_execution_task` 建在哪 | `grep` ⇒ `V121__taskflow_workflow_and_exec_schema.sql:130` | ✅ 在唯一的 mis-migrator 目录 |
| `ext_terminal_event` 会建在哪 | 文档 DDL 头部 `-- V154__ext_process_instance.sql`，且 19§9 A2 明确文件路径 `backend/mis-migrator/src/main/resources/db/migration/V154__...` | ✅ 同一目录 |
| 是否同一数据源 | 逐模块读 `application.yml` 的 `datasource.url` | ✅ **9 个模块全部**指向 `jdbc:postgresql://${DB_HOST:localhost}:${DB_PORT:5432}/${DB_NAME:mis_platform}` —— **同一个库 `mis_platform`** |
| 跨模块同库是否等于同事务可用 | 关键：`ext_terminal_event` 的 Repository 与 `ExecutionTaskService` 是否同模块 | ✅ **都在 `backend/mis-taskflow`** ⇒ 同一 `DataSource` + 同一 JPA `EntityManager` ⇒ `@Transactional` 内同事务**成立** |

**⇒ 「同库同事务、不做跨库妥协」的前提 ✅ 成立。架构师的核实是对的。**

#### ⑤-2 四环设计是否真挡住两个方向 —— 🔴 **不成立：② 与 ③ 逻辑互斥，且 ③ 的安全论证引用了一个不存在的查重**

这是本轮最重要的发现，逐层说明：

**环②的原文**：「事务内：`INSERT ... ON CONFLICT DO NOTHING RETURNING id` → 返回 1 行 ⇒ **同一事务内** `ExecutionTaskService.enqueue()` 投 `biz_execution_task` → 事务成功后置 `DONE`」

**环③的原文**：「因①②同事务，正常路径不会出现 `PENDING` 滞留；滞留**只可能**来自「事务已提交、进程在置 `DONE` 前崩溃」⇒ 补偿 Job 的 `enqueue` 查重保证不会重复投递」

**🔴 矛盾点**：
- 若 `置 DONE` 在**同一事务内** ⇒ 提交后的行**永远是 `DONE`** ⇒ **committed `PENDING` 行在物理上不可能存在** ⇒ **环③的补偿 Job 是死代码，永远扫不到行**。
- 若 `置 DONE` 在**提交之后的新事务**（原文「事务成功后置 `DONE`」正是此读法）⇒ 那么它就**不是**"同事务"，① 的表述失真 ⇒ 且此时存在"提交后崩溃"的 `PENDING` 行，而**该行的 `biz_execution_task` 其实已经投递成功** ⇒ 补偿 Job 重投 ⇒ **重复 `FINALIZE_BIZ` ⇒ 重复发货/重复建单**。

**🔴 更严重：环③用来论证安全的那句话是错的。**
文档写「补偿 Job 的 `enqueue` **查重**保证不会重复投递」。我读了实现 —— `ExecutionTaskService.enqueue()`（`ExecutionTaskService.java:64-81`）：

```java
@Transactional
public Long enqueue(Long tenantId, Long sourceInstanceId, String actionType,
                    String bizType, String bizId, String payloadJson) {
    ...
    task.setId(IdGenerator.nextId());
    ...
    return taskRepository.save(task).getId();   // ← 无条件 save
}
```
**没有任何 exists 检查、没有 ON CONFLICT、没有查重。** 而且我上一轮已核实 `biz_execution_task` **无任何唯一约束**（`V121:130-147` 只有两个普通索引）⇒ **重投必然产生第二条任务行**。

⇒ **环③的整个安全论证建立在一个仓库里不存在的能力上。** 这正是我上一轮 B4 报的同一个洞，**在新设计里被重新引用了一次**。

**⇒ 修正方案（二选一，必须二选一，不能像现在这样两头都写）**：
- **方案 A（推荐，最简单）**：确认 ② 是单事务 ⇒ **删掉环③整个补偿 Job**，把 `process_state` 从枚举降为 `DONE/SKIPPED` 两值（`PENDING` 仅作事务内中间态）。丢失型由原子性彻底根除，无需补偿。
- **方案 B（保留补偿）**：显式承认是**两阶段跨事务**，则必须① `enqueue` 加幂等（`biz_execution_task` 上加 `UNIQUE (action_type, biz_ref_id, ...)` 之类）；② 补偿 Job 用 `UPDATE ... WHERE process_state='PENDING' RETURNING id` 做**原子认领**；③ `process_state` 增加 `IN_FLIGHT` 态防重复认领。

#### ⑤-3 补偿 Job 与轮询 Job 会不会互相踩 —— 🔴 **不会"踩"，但轮询 Job 的锁用法本身是错的（见 N2）**

两者锁键不同（轮询 `('EXT_SYNC', caseId)`、补偿经由 `enqueue` 不加锁），**不存在互踩**。但更严重的问题在轮询侧 —— 见 N2。

#### ⑤-4 `idx_ext_terminal_event_pending` 谓词与补偿 Job 查询条件的蕴含关系 → ✅ **成立，架构师做对了**

| 项 | 值 |
|---|---|
| 索引谓词 | `WHERE process_state = 'PENDING'`（`20§6.2`） |
| 补偿 Job 查询条件 | `WHERE process_state='PENDING' AND created_at < now() - interval '10 minutes'`（`19§9` E1③） |
| 是否严格蕴含 | ✅ **蕴含**。查询的 `process_state='PENDING'` 严格强于索引谓词 ⇒ PG 可用该部分索引。**同时索引含 `created_at` 作为第二列，范围条件也能吃到索引定位**。写法正确 |

顺带我也核了 `idx_ext_inst_polling`：谓词 `... AND build_phase IS DISTINCT FROM 'FAILED'`，扫描 SQL 用 `build_phase <> 'FAILED'`。查询为真 ⇒ 谓词必为真 ⇒ 蕴含成立 ✅。（且 `build_phase` 是 `NOT NULL`，两者等价。）**上一轮 Q4 提的"部分索引用不上"问题已正确修复。** ✅

---

### ⑥ 12 条补丁的落地质量抽查 → **4/4 抽查项全部真改，无"只改文档不改实质"**

| 抽查项 | 判定 | 独立证据 |
|---|---|---|
| **第 5 条** 终态单调性是否真在**轮询写库路径**上（而非某个没被调用的校验方法） | 🟡 **成立，但缺命名落点** | ✅ 约束写在 **B4 任务**内（B4 = fetch/状态映射/轮询写库的那个任务，改动文件 `ExtSyncService.java`+`ExtStatusMapper.java`），并在 `19§5.1`、`20§3.2 原则8`、`20§8 约定11`、`ADR §4` 四处复述 ⇒ **确实挂在写路径上，不是游离校验方法**。<br>🟡 但没说清"在 `ExtSyncService` 的哪个方法、落库前哪一步拦截"。按本方案自己的标准（DDL 都给到 SQL 级），这里应给一句命名落点，例如「`ExtSyncService.applySnapshot()` 内、`instanceRepository.save()` 之前断言」。否则实现者可能把校验写成一个没人调用的 public 方法 —— **这正是我上一轮批评过的失败模式**。 |
| **第 6 条** `draft_mode` 分支上移 / 默认值 / `draft_flag` 可空 | ✅ **成立，三项全真改** | ✅ 分支确在**步骤 3**：`19§4:211-218` 是 `3-A DRAFT_THEN_SEND` / `3-B DIRECT_SEND·默认` 两套并列序列；`20§4:293-303` 同构；步骤 5 明确「仅 3-A」（`19§4:223`）。<br>✅ DDL 默认值：`20§6.2` `draft_mode VARCHAR(24) NOT NULL DEFAULT 'DIRECT_SEND'` ✅<br>✅ `draft_flag` 改可空：`draft_flag SMALLINT NULL`，**已去掉 `DEFAULT 1`** ✅，且 `COMMENT ON COLUMN` 说明 `NULL=不适用(DIRECT_SEND)` ✅ |
| **第 10 条** DDL 五项 | ✅ **成立，五项全中** | ① `uk_form_def_embed_token` 谓词**已去掉 `deleted=0`** ⇒ `WHERE embed_token IS NOT NULL` ✅；② `command_id` **已改 `VARCHAR(128)`** ✅；③ 「**对同一次业务发起必须稳定不变**（不得含时间戳）」警告有**三处**（DDL 行内注释 + `COMMENT ON COLUMN` + `20§8 约定9`）✅；④ 四个必须 `String` 的列名**已点名** `external_case_id`/`external_process_id`/`ext_affair_id`/`initiator_ref`，并额外正确区分「同表 `id`/`tenant_id`/`form_record_id`/`created_by` 用 BIGINT 是对的，不要改」✅；⑤ 吊销/过期字段 `embed_token_revoked_at`+`embed_expires_at` 已补 ✅ |
| **第 12 条** ADR 状态自相矛盾 | 🟡 **基本修好，措辞仍有余歧义** | ✅ 状态确实从「提议中」改为「**已采纳**」，且新增了「状态字段说明」解释来由、不再自相矛盾；§3 正文的「仅串行」也已改正文（不只写在文末）✅。<br>🟡 「（**Phase A 定稿**）」仍可被误读为"Phase A 已完成"。实测 `19§9` Phase A 里 V153/V154、甲方前置、产品拍板 P-1/P-2 **仍是未勾选 `[ ]`** ⇒ 只有文档类条目是 `[x]`。建议改为「**已采纳（决策已定；Phase A 实施中）**」，消除"已完成"误读。 |

---

## 2. 上一轮 6 项阻断 + 12 条追加的修复验证表

**每一行我都在活代码里复核了被引用的行号，全部准确。**

| # | 上一轮问题 | 判定 | 独立证据（我实测的行号） |
|---|-----------|------|----------------------|
| **B1** | `supported_form_codes` 双源冲突 + `PUT /{id}/supported-forms` 未下线 | ✅ **已修** | 三处全部落到 F-1/F-7/A4：① `WfDefinitionService.java:299` `findBySupportedFormCode` ✅ 逐字一致；`validateSupportedForms` 范围 `:285-307`（文档写 `:285-308`，**差 1 行，无实质影响**）；② `WfDefinitionController.java` `@PutMapping("/{id}/supported-forms")` ✅ 实测在 `:51`，方法体到 `:58`（文档写 `:51-57`，**差 1 行**）；`WfDefinitionService.updateSupportedForms():153-161` ✅ 一致；③ `FormDefinitionService.delete()` 守卫实测在 `:167-185`、旧列查询在 `:171`（文档写 `:173-176`，**差 2 行**）。<br>✅ 关键事实复核通过：`V149:85-88` 确实 `UPDATE wf_definition SET supported_form_codes = '{}' WHERE deleted = 0 AND ...` ⇒ **互斥校验已失效**的判断正确。<br>✅ F-6 的 V149 CHECK 也逐字复核：`EXTERNAL` 分支确实要求 `workflow_definition_id IS NULL` ⇒ **硬阻断成立**。<br>✅ 增量价值：F-8 把"意外的帮"登记为知识交接风险，并要求 A4 改造与该登记**同时落地** —— 这是我上一轮没要求但很有价值的一条。 |
| **B2** | `FormRecordService:164-171` REJECTED 归一推翻产品决策 | ✅ **已修（定性需微调，见判断①）** | ✅ 行号逐字准确。修复方案（F-3 / 新任务 **B2′**）正确：按 `workflow_binding_type` 分流、**明确写「不得触碰 LOCAL 分支任何既有条件」**、要求补**双侧**回归用例（防修坏 LOCAL）。<br>🟡 定性建议改为"latent"（全仓无代码写 `form_record=REJECTED`，见判断①）。 |
| **B3** | `ABANDONED` 可行性（废弃并重建在 DDL 层不可实现） | ✅ **已修** | ✅ `ext_status` 增 `ABANDONED` 且明确「非外部状态、不参与 `status_mapping`、不映射 `form_record`」（`19§5.1` 表 + `20§6.2` 注释 + `ADR §4` 三处一致）。<br>✅ 断点续拼**从 P1 提到 P0**，`assigned_slots JSONB` 列已进 DDL，`19§4` 有 `build_phase=ASSIGNING/FAILED 且 assigned_slots 非空 → 从断点继续` 的分派。<br>🔴 **但修复方式引入了新缺陷 N1**（见 §3）。 |
| **B4** | 后置任务幂等收件表 | 🟡 **主体已修，但设计有内部矛盾** | ✅ `ext_terminal_event` 已建（`20§6.2`），`UNIQUE (tenant_id, external_system, external_case_id, terminal_status)` ✅，`INSERT ... ON CONFLICT DO NOTHING RETURNING id` 的原子判重思路 ✅，工作量 M→L ✅，任务 E1 挂 `ExtTerminalEventService.java`+补偿 Job ✅，「拒绝先置 DONE / 拒绝删行重投」的论证 ✅（且"删行丢失审计线索"的理由我认同）。<br>🔴 **但环②与环③互斥、且环③的"查重"不存在 ⇒ N3**。 |
| **B5** | `FormDefinition` 实体零映射，A3 范围被低估 | ✅ **已修，且A3 已上修 L** | ✅ 独立复核：`FormDefinition.java` 共 **13 个字段**（`id/tenantId/categoryId/code/name/description/status/sortOrder/config/deleted/createdBy/createdAt/updatedAt`），**零个** V149 列。`grep 'workflow_binding\|external\|embed\|inject'` ⇒ **零命中**。<br>✅ 文档准确指出「含 LOCAL 的 `workflow_definition_id` 也无映射 ⇒ LOCAL 绑定链路当前也是断的」—— 这是我上一轮强调的关键澄清，被完整保留。<br>✅ A3 上修 **L**、列 9 个字段清单、D3 依赖改为 `C1,D1,D2`（实测 `process-shell.tsx` 零 `workflow_runtime` ⇒ 依赖链判断正确）。 |
| **B6** | 无行锁 | ✅ **已修** | ✅ 独立复核：`FormRecordService.java:114` `formRecordRepository.findByIdAndTenantIdAndDeleted(...)`，**无 `@Lock`、无 `FOR UPDATE`**（文档写 `:112`，是方法体内附近行，**差 2 行**，无实质影响）。<br>✅ `:119` 的 check-then-act 竞态确认存在。修复方案具体到 SQL 级 + 要求 `@Transactional` 边界覆盖 start→落镜像 + 补并发验收用例，`20§8 约定12` 复述。✅ 追加价值：确认 `ProcessService.syncFormRecordStatus` 仅 LOCAL 三处调用（`:221`/`:496`/`:524`），并**明确禁止 EXTERNAL 路径调用它** —— 这条我上一轮没要求，是对的。 |
| **C-2** | 意见查询不存在但文档已承诺展示 | ✅ **已修** | ✅ **四处全部回写**（我上一轮要求的 3 处 + 超额）：`19§1.1` 目标 2 已改「外部状态 + 当前处理人（🟡 审批意见为**降级承诺**）」✅；`19§6.1-5` 改为深链 + `capabilities` 无 `QUERY_OPINIONS` 时**直接隐藏**（不做"显示空列表"的自欺实现）✅；`ADR §5` 已改✅；`19§10-2c` 已标 🔴 ✅。<br>✅ 且 D3 明确「🟡 P0 范围**不含**意见查询实现」，防止 D3 无限扩大。✅ 额外把候选④标注为「**需甲方书面批准 + 独立只读账号**」（我上一轮 S6 的诉求）。 |
| **C-12** | `EMBED_URL` 跨站鉴权 `SameSite=Lax` | ✅ **已修（处理得很干净）** | ✅ `20§5 C-12` 完整列出路径 A（登录态→第三方 Cookie 被 `SameSite=Lax` 默认拦截）与路径 B（签名→需 `expires`+HMAC，**并已补 `embed_expires_at` 字段**）。✅ 提为 **Gate-1 第三项**、列 **P-2 待产品确认**、明确「不可行则 `B5`(L) 须从 P0 降为 P1」、并写「B5 的 EMBED_URL 部分**暂缓开工**，FORM_JSON/RICH_HTML 可先做」。✅ **架构没有自行决定降级**，边界把握准确。 |
| **`EMBED_URL` 五条安全要求未落实** | ✅ **已修（5/5）** | ① 高熵串 `embed_token VARCHAR(64)` ✅ ② 绑定 tenant+form+record ⇒ `20§3.1` 补 `resolveEmbed(embedToken, openedRecordId?) -> EmbedContext{tenantId, formCode, formRecordId, readOnly=true}` ✅ ③ 必须鉴权 ⇒ 补 `verifyEmbedAuth(token, signature?, expires?, sessionToken?) -> EmbedAuth{valid, method: SESSION\|SIGNATURE}` ✅ ④ 支持吊销 ⇒ 补 `revokeEmbedToken()` + `embed_token_revoked_at` 列 ✅（上一轮指出的"轮换无法表达"已解决）⑤ CSP/Frame 祖先 ⇒ 补 `getFrameAncestors()` + DDL **`csp_frame_ancestors`/`csp_child_src` 两列** ✅。<br>✅ 上一轮 S6（谓词去掉 `deleted=0`）也已修，并附完整理由注释。**这一项修得最彻底。** |
| **轮询 Job 无锁** | 🔴 **修法本身有错 ⇒ N2** | ✅ 文档确实补了锁要求（`19§7`、`20§8 约定14`、C1 任务，均写 `('EXT_SYNC', caseId)`）。<br>🔴 **但 `DistributedLockService` 是"一次性幂等账本"语义，不是互斥量** —— 照文档实现会导致每个实例只轮询一次。详见 N2。 |
| **DDL 五项** | ✅ **已修** | 见判断⑥ 第 10 条，五项逐一命中。 |
| 小问题（我上轮 §3 的 S1~S9 / §6 的 1~11） | 🟡 **大部分已修，2 项未修** | ✅ 已修：`draft_mode`(I1)、状态四/五态口径统一(S4，引 S4/19§5.1/ADR§4/20§6.2 四处一致)、`auth_ref` provider 明确为配置中心(S2)、JSONB 校验部分落地(S3，`status_mapping` 有 fail-fast)、`form_record_id` 不设 FK 并对齐仓库惯例(S5)、C-2 候选④权限标注(S6)、ADR 正文修订(S7)、`ext_workflow_call_log` 保留策略 + `FETCH 只记失败`(I7)、A0 产出物改文档 + 关键路径 `A0→(Gate-1)→B3`(I8)、`addNode` 重定位 P1 + 禁止代替真人调用(I4/§4.4 合规硬约束)、`idx_ext_inst_polling` 谓词纳入 `build_phase`(Q4)、`command_id` 稳定性(Q3)、四列 `String` 点名(Q3)。<br>🟡 **未修 1**：`S1` —— `external_workflow_ref VARCHAR(256)`(V149) 与 `ext_template_code VARCHAR(128)`(V154) 仍存同一物、长度不同，**三份文档均未澄清**。<br>🟡 **未修 2**：`S8` —— 本报告仍与方案文档同目录连号（主理人指定写入 `22-`，我遵从，但建议在 19/20 顶部加一行「复审结论见 21/22」）。<br>🟡 部分修：`S3` —— `capabilities`/`endpoint_config` 仍无 `jsonb_typeof` CHECK，只有 `status_mapping` 有 fail-fast。<br>✅ `opissions_snapshot` 拼写已修为 `opinions_snapshot`。 |

---

## 3. 新增问题

### 🔴 N1（阻断 · B3 开工前必须修）—— `uk_ext_inst_active` 自动让位 × `DIRECT_SEND` 新默认值 = **可创建第二个外部流程**

**这是 r2 修订自己新引入的缺陷，上一轮不存在。**

**两个 r2 改动单独看都对，合在一起出事**：
- 改动 X：`uk_ext_inst_active` 谓词加了 `AND build_phase IS DISTINCT FROM 'FAILED'`（`20§6.2`），并写「代价：构建失败后**允许**直接重新提交（不再强制先点废弃）。这是有意的——**失败行已无外部在途风险**，自动让位比人工确认更不易卡死」
- 改动 Y：`draft_mode` 默认从 `DRAFT_THEN_SEND` 改成 **`DIRECT_SEND`**（判断⑥ 已验证改对了）

**冲突**：在 `DIRECT_SEND`（新默认）下，**外部流程在 `build_phase` 还是 `DRAFTED` 时就已经真实发出去了**。文档自己在 `19§4` 步骤 3-B 写明「流程**直接发送**」、`20§5 C-1` 写明「首节点待办已生成但人员未替换，存在秒级竞态」、R5 写明「首节点待办生成与人员替换存在秒级竞态」。

⇒ **「失败行已无外部在途风险」这句话在新默认下是错的。** 时序：

```
t0  step 3-B  start(draft=0)      → 外部流程已在致远运行，首节点待办已生成
t1  step 4   assignNode 第 1 槽成功、第 2 槽失败(code≠0)
t2            build_phase=FAILED  → 谓词排除 FAILED ⇒ 槽位自动让出
t3  用户再点「提交」            → 判据(findActiveInstance)查不到活跃行 ⇒ 放行
t4            start(draft=0) 第二次 ⇒ **致远上出现第二个流程**
t5            而 t0 那个流程仍在跑，人员还是错的/默认的
```

后果：**① 两个外部审批流并行跑同一张单据；② t0 的流程成为无人认领的孤儿（正是 19§8.2 第 6 条要防的）；③ 若有人对 t0 流程"补一个 `stop`"（`19§6.3` 统一处理约定第 3 条要求 `ABANDONED` 行必须可调 `stop`），可能**误杀正在被人正常处理的那个流程**。**

**而且它同时废掉了两个 P0 交付物**：
- `19§4` 分派表「`build_phase=FAILED` 且 `assigned_slots` 非空 → **断点续拼（P0）**」：新行已占槽位，但**唯一索引管不到 `FAILED` 行**，所以这个"续拼"与"新建"可以并存 ⇒ 可能同时续拼旧行、又新建新行 ⇒ **两个流程**。
- C3「废弃并重建」：既然槽位自动让位，用户**根本不需要点这个按钮** ⇒ 该 P0 按钮的语义（"显式确认放弃"）被架空。

**修法（建议采用第 1 种，最小改动）**：
1. **把 `DIRECT_SEND` 与「自动让位」二者解耦** —— 谓词改为按「外部是否已真实发出」判断，而非按 `build_phase`：
   ```sql
   -- ✅ 建议：只有「外部确实还没发出」才自动让位
   WHERE deleted = 0
     AND ext_status IN ('NOT_STARTED','RUNNING')
     AND NOT (ext_status = 'RUNNING' AND draft_flag = 0)   -- 已真实发出 ⇒ 占位不放
   ```
   即：`DRAFT_THEN_SEND` 下的失败行可自动让位（外部仅停在待发，无在途审批）；`DIRECT_SEND` 下的失败行**必须**显式「废弃并重建」（由 `ABANDONED` 让位，并调外部 `stop` 清理）—— 这正是文档原本的设计意图。
2. 或：保留现谓词，但把 `draft_mode` 为 `DIRECT_SEND` 时的 `build_phase='FAILED'` 行**排除出"可提交"判定**，强制走 C3 按钮。
3. 无论哪种，**必须补一条验收用例**：`DIRECT_SEND` + 第 2 槽失败 + 再次提交 ⇒ 期望「**拒绝**并提示先废弃重建」，且致远侧流程数**仍为 1**。

---

### 🔴 N2（阻断 · C1 开工前必须修）—— 复用 `biz_exec_lock` 做轮询会导致**每个实例只被轮询一次**

**这是"照文档实现必然出错"的典型，也是本轮最贵的发现。**

我完整读了锁的三层实现：

- `BizExecLockRepository`：PK `(biz_type, biz_id)`，另有 `casStatus` 与 `deleteByStatus`。
  **实测：全仓 `deleteByStatus` 的调用点只在 `DistributedLockService`（且仅删 `FAILED` 与超时的 `RUNNING`）与三个测试文件里。`SUCCESS` 行从不被删。**
- `DistributedLockService.executeWithLock()`（`:47-88`）：
  ```java
  if (tryAcquire(...)) return runAction(...);      // INSERT 成功 → 执行
  // 冲突分支：轮询确认
  if (BizExecLock.SUCCESS.equals(lock.getStatus()))
      return LockOutcome.ALREADY_SUCCESS;          // ← 直接返回，★不执行动作★
  ```
- `runAction()`（`:95-105`）：成功只 `casStatus(RUNNING → SUCCESS)`，**不删行**。

⇒ **`biz_exec_lock` 的语义是"这个业务动作是否已经成功执行过"的一次性幂等账本（适合 `FINALIZE_BIZ`），不是"同一时刻互斥"的互斥量。**

**照 `19§7` / `20§8 约定14` / C1 任务写的 `biz_type='EXT_SYNC'`、`biz_id=caseId` 调用 `executeWithLock` 会发生什么**：

```
第 1 轮轮询：INSERT('EXT_SYNC', caseId) 成功 → 执行 fetch → casStatus(SUCCESS)  ★行留在表里
第 2 轮轮询：tryAcquire → PK 冲突 → false
             → 进确认循环 → find() 看到 status=SUCCESS
             → return ALREADY_SUCCESS   ★★ 不执行 fetch ★★
第 3 轮、第 4 轮…… 同上，永远不执行
```

⇒ **单据在第一次轮询后状态就永久冻结，之后永远停在 `RUNNING`（或首次取到的任意状态）。这与 D5「外部撤销靠轮询识别为 `TERMINATED`」直接冲突 —— 撤销单据将永久不被识别。**

**修法（二选一，必须写进文档）**：
- **方案 A（推荐，PG 原生、零新表）**：轮询**不用锁表**，改用 `FOR UPDATE SKIP LOCKED` 抢占：
  ```sql
  SELECT ... FROM ext_process_instance
  WHERE ext_status IN ('NOT_STARTED','RUNNING') AND build_phase IS DISTINCT FROM 'FAILED'
  ORDER BY last_sync_at NULLS FIRST
  FOR UPDATE SKIP LOCKED LIMIT :batch;
  ```
  这天然满足 `19§7` 的真实意图（多实例不并发处理同一行），且**没有"成功后行残留"问题**，也不需要 `STALE_THRESHOLD`/`POLL_TIMEOUT` 这些为"一次性动作"设计的参数。
- **方案 B**：复用 `biz_exec_lock`，但**必须把 `biz_id` 做成轮次作用域**（如 `caseId + ':' + roundBucket`，bucket = `epochMinute/pollInterval`），并在每轮结束后**显式删除锁行**。同时必须在 `20§8` 增一条约定：「**`biz_exec_lock` 是执行一次性的幂等账本，`SUCCESS` 行永不删除；严禁用于周期性动作。若用于轮询，必须轮次化锁键 + 用后删锁**」—— 这条约定是本次事故的根因，不写进去下次还会踩。

> 附带：`19§7` 给锁的**理由**（「否则多实例 Job 会同时 poll 同一行、同时改 `form_record`、同时发消息」）是对的，但 `SKIP LOCKED` 才是这个理由的正解；`executeWithLock` 是"防同一动作执行两次"，与"防并发轮询"是两个不同的问题。

---

### 🟡 N3（重要 · E1 开工前必须修）—— E1 的环②与环③互斥，且环③的"查重"在仓库里不存在

完整推导见判断 **⑤-2**。一句话结论：**现在的文档同时承诺"单事务"和"需要补偿 Job 扫 PENDING"，这两件事互斥；而补偿 Job 的安全性论证引用了 `ExecutionTaskService.enqueue()` 的查重能力，但该方法（`:64-81`）是无条件 `save`，且 `biz_execution_task` 无唯一约束 ⇒ 补偿 Job 一旦触发就会重复投递后置任务（重复发货/重复建单）。**

请按 ⑤-2 的**方案 A（删补偿 Job，`process_state` 降两值）** 或 **方案 B（显式两阶段 + 加 `biz_execution_task` 幂等键 + 原子认领）** 二选一改写。**我推荐方案 A**：单事务已经彻底消除了丢失型缺陷，补偿 Job 是多余且有害的。

---

### 🟡 N4（重要）—— 「启动 fail-fast」覆盖不到运行期新增的租户配置（见判断 ③-2）

`status_mapping` 在**按租户一行的 DB 表**里，由管理台运行期 CRUD 写入。启动 fail-fast 只覆盖启动时已存在的行 ⇒ **运行期配错不会 fail-fast，直接进生产**。必须补「配置保存时校验」，fail-fast 降为存量兜底。这是 `B4` 任务（状态映射）必须包含的一步，目前文档零覆盖。

---

### 🟡 N5（重要）—— 告警/退避的聚合粒度前后不一致（见判断 ③-3）

`19§7` 同时写了「未识别 ⇒ 退避（不是每轮都告警 ⇒ 告警风暴）」与「按 `external_system` 级熔断 + 指数退避」，但没说清退避计数落在哪一级（单据级 or 外部系统级）。若落单据级，100 个实例各自退避 ⇒ 告警量仍是 100 倍。需明确：**建议按 `(external_system, raw_status)` 聚合退避**，单据只记 `sync_error`。

---

### 🟢 N6（建议）—— 两处措辞与一处拼写

1. **「永久卡在 `RUNNING`」** → 改为「**无告警则无限期停留 `RUNNING`，管理台「终止」可人工出口**」（判断 ③-1）。
2. **ADR 状态「已采纳（Phase A 定稿）」** → 建议「**已采纳（决策已定；Phase A 实施中）**」，避免被读成 Phase A 已完成（判断 ⑥-12；实测 Phase A 仍有 4 项未勾选）。
3. **`S1` 未修**：`external_workflow_ref VARCHAR(256)`(V149) 与 `ext_template_code VARCHAR(128)`(V154) 存同一物、长度不同，三份文档均未澄清是「同一物」还是「快照」。
4. 行号微差（**均无实质影响**，但建议校准以免后续按图索骥落空）：`validateSupportedForms` 实际 `:285-307`（文档 `:285-308`）；`WfDefinitionController` 端点实际 `:51-58`（文档 `:51-57`）；`FormDefinitionService.delete()` 旧列查询实际 `:171`（文档 `:173-176`）；`startProcess` 读取实际 `:114`（文档 `:112`）。

---

## 4. 给主理人的签字意见

### 4.1 可以放行的部分 ✅

| 项 | 意见 |
|---|---|
| **Phase A 全部任务** | ✅ **放行**。A1/A2/A3/A3′/A4 的事实基础我已全部复核为真（V149 CHECK、V150 无约束、单库同 datasource、`FormDefinition` 13 字段零映射、`process-shell` 不读单据状态、互斥校验已失效）。A3′ 的 S 级改动清单完备无遗漏。 |
| **ADR-022 架构决策本身** | ✅ **放行，不推翻**。运行时/蓝图分离成立；D5、D6 与既有代码一致；「顺手对齐」的防护约束写得很到位。 |
| **B2′（EXTERNAL 编辑/再发起拦截）** | ✅ **放行**。方案正确，且「不得触碰 LOCAL 分支」的约束 + 双侧回归用例的要求是对的。**这是本轮质量最高的一条修复。** |
| **C3 / B5 / D1~D4 / E2 / E3** | ✅ 放行（E2 依赖 B4，B4 依赖 N3 修好；B5 的 EMBED_URL 部分按 P-2 暂缓，文档已正确处理）。 |

### 4.2 必须再改才能动手的部分 ⛔

| 序 | 问题 | 必须先改 | 卡住哪个任务 |
|---|------|---------|------------|
| **1** | **N1** —— `uk_ext_inst_active` 的 `build_phase` 自动让位 × `DIRECT_SEND` 新默认 ⇒ 可创建第二个外部流程、孤儿流程、且两个 P0 交付物（断点续拼 / 废弃并重建）被架空 | 改谓词或改判定，使「外部已真实发出」的失败行**必须**走显式 `ABANDONED`；补 `DIRECT_SEND` + 中途失败 + 再次提交的验收用例 | **B3** |
| **2** | **N2** —— `DistributedLockService.executeWithLock` 是**一次性幂等账本**（`SUCCESS` 行永不删除，冲突时返回 `ALREADY_SUCCESS` 且不执行）。照 `('EXT_SYNC', caseId)` 用 ⇒ **每实例只轮询一次，撤销单据永久不被识别** | 改用 `FOR UPDATE SKIP LOCKED`（推荐），或轮次化锁键 + 用后删锁；并在 `20§8` 增「`biz_exec_lock` 严禁用于周期性动作」的约定 | **C1** |
| **3** | **N3** —— E1 环②（单事务）与环③（补偿 Job）互斥；环③的"查重"在 `enqueue()` 里不存在 ⇒ 补偿 Job 一旦触发就重复投递后置任务 | 方案 A（删补偿 Job、`process_state` 降两值，**推荐**）或方案 B（显式两阶段 + 加 `biz_execution_task` 幂等键 + `UPDATE...RETURNING` 原子认领） | **E1** |
| **4** | **N4** —— `status_mapping` 是按租户的 DB 配置行，启动 fail-fast 覆盖不到运行期新增配置 | B4 增加「管理台保存 `external_workflow_system` 时即时校验」，fail-fast 降为存量兜底 | **B4** |
| **5** | **N5** —— 告警/退避的聚合粒度未统一 | 明确按 `(external_system, raw_status)` 聚合退避 | **C1** |

### 4.3 一句话结论

> **架构师这一轮的修订质量很高**：上一轮 6 个阻断**全部关闭**，且我逐条复核**没有一条虚报行号或夸大事实** —— 这在文档评审里并不常见，值得肯定。D5/D6 两个决策与仓库现状**完全吻合**（`TERMINATED` 确实天然落在所有白名单之外、确实不需要 DDL），`process-shell.tsx` 的定位纠正是对的，四环设计的**并发判重思路**（`ON CONFLICT DO NOTHING RETURNING id`）是对的，「同库同事务」的前提我独立查证**成立**。
>
> **但本轮仍有 3 个必须修的问题，且性质与上一轮完全相同 —— 「文档写得比代码/逻辑更确定」。** N2 尤其关键：它藏在「必须复用 `biz_exec_lock`」这句**看起来很有仓库依据**的修法里（引了 `V121:152` 的真实注释），而 `DistributedLockService` 的真实语义恰恰与轮询需求相反 —— 这不是笔误级别的问题，是**引用了真实证据却没读懂被引用对象的语义**。
>
> **建议**：不需要重写，5 条定点补丁（3 条阻断 + 2 条重要）即可。补完后 Phase B 可全量开工。
>
> **不建议现在开工 B3/C1/E1 三个任务** —— 它们是问题 1/2/3 的直接受害者，先改文档再动手，避免返工。

### 4.4 我这边的下一步

补丁落地后我会做**专项回归**（沿用上一轮 `21§7.4` 的用例集，并新增 4 条）：

| 用例 | 期望 |
|------|------|
| `DIRECT_SEND` + 第 2 槽 `assignNode` 失败 + 再次提交 | **拒绝**并提示先「废弃并重建」；**致远侧流程数仍为 1**（覆盖 N1） |
| 单实例被连续轮询 3 轮 | 3 轮**都真实调用** `fetch`，状态随外部变化正确更新（覆盖 N2） |
| 轮询 Job 完成后查 `biz_exec_lock` | 不残留 `SUCCESS` 行，或锁键含轮次（覆盖 N2） |
| 补偿 Job 连续两轮扫同一滞留行 | 按选定方案：方案 A ⇒ **无补偿 Job**；方案 B ⇒ `biz_execution_task` **只有 1 条**（覆盖 N3） |

同时会补一条**防回归的文档约定**：`20§8 共享约定` 建议加第 15 条 ——「**凡引用仓库既有组件作为方案基石，必须同时核对其语义与生命周期，不能只引用其存在性**」（`biz_exec_lock`、`syncFormRecordStatus`、`hasApproveHistory` 三处都属于这类）。

---

*本报告仅新增 `22-external-workflow-review-r2.md` 一个文件，未修改 19/20 号文档、ADR-022 及任何 Java/TS/SQL 源码。*