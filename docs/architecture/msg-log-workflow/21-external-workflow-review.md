# 21 · 外部工作流方案技术审查报告

> **审查人**:严过关（QA Engineer / software-qa-engineer）
> **审查日期**: 2026-10-16
> **审查对象**: `19-external-workflow-integration-plan.md`(442行)、`20-external-workflow-adapter-contract.md`(607行)、`adr/ADR-022-external-workflow-binding.md`(137行)
> **仓库**: `D:\code\mis-platform` @ `ext-flow` @ `bb228fb7`
> **审查方式**: 文档通读 + 活代码实测（未修改任何被审文件）

---

## 0. 审查结论

| 维度 | 结论 |
|------|------|
| **架构决策本身**（运行时/蓝图分离，`workflow_runtime` 三态） | ✅ **PASS** — 成立，不推翻 |
| **`freeReplaceNode` 语义修正**（替换 ≠ 追加） | ✅ **PASS** — 我用官方原文独立复核，架构师的修正**正确且关键** |
| **方案可施工性** | 🔴 **FAIL** — 6 项阻断，其中 3 项会导致开发返工或产品已定决策被静默推翻 |
| **总体** | 🔴 **FAIL（阻断 Phase B 开工）** |

**理由**：架构师的技术判断（尤其 `freeReplaceNode` 修正、`addNode` 定位、证据分级）是**高质量且正确**的，我逐条复核后没有发现事实性错误。但方案在**与仓库现状对齐**这一层存在系统性缺口：

1. **文档说的比代码做的多**：`supported_form_codes` 双源冲突在 §8.3 只有一句无文件名、无步骤、无工作量的模糊表述（任务方以为有 §13，实际 19 号文档**最大章是 §12**，不存在 §13）；
2. **产品已定决策与活代码正面冲突**：19§5.2/ADR§4 定的「`REJECTED` 是终态、不回 `SAVED`、同单不可再提」，被 `FormRecordService.requireMineEditable():169-171` 的无条件归一逻辑直接推翻，方案**全文未提及**；
3. **P0 承诺的功能在 DDL 层不可实现**：§4 承诺 BUILD_FAILED 后「废弃并重建」，但 `ext_status` 枚举无废弃态、唯一索引又仍被FAILED 行占用 ⇒ 该单据永久无法再发起。

**不建议返工重写方案**。建议按本报告 §7 的行动清单做 2~3 轮定点补丁后即可开工，Phase A（迁移）可并行推进。

---

## 1. 问题清单 — 阻断（🔴 必须关闭后才可开工 Phase B）

### 🔴 B1 — `supported_form_codes` 双源冲突**未被覆盖**，且真实故障面比方案描述的更大

**方案说了什么**：19§8.3 仅一行——
> 「流程侧仍可能存在 `supported_form_codes` 旧白名单路径，需与「绑定在表单侧」对齐」

无文件名、无行号、无步骤、无工作量、**无归属任务**（§9 任务表 A0~E3 共 17 项任务，**没有任何一项**涉及这三处活代码）。

**实测事实**（`V149__form_workflow_binding.sql`）：

```sql
-- 旧列清空（保留物理列；读路径改为反查 form_definition）
UPDATE wf_definition
SET supported_form_codes = '{}', updated_at = NOW()
WHERE deleted = 0 AND supported_form_codes IS DISTINCT FROM '{}';
```

V149 **已经把所有行的 `supported_form_codes` 清空**。由此产生三个方案完全没看到的连锁故障：

| # | 活代码位置 | 现状 | 后果 |
|---|-----------|------|------|
| **B1-a** | `WfDefinitionService.java:299` `findBySupportedFormCode()` | V149 后该列恒为 `'{}'` ⇒ **查询恒返回空** | 🔴 **「一个表单只能关联一个流程」互斥校验事实上已失效**（silent regression）。EXTERNAL 蓝图恰恰要「一个表单绑多个蓝图定义」，这条失效**方向上恰好帮了忙**，但它是**意外的帮**，不是设计——一旦有人发现并「修复」，EXTERNAL 蓝图就会撞墙 |
| **B1-b** | `WfDefinitionService.java:157` `updateSupportedForms()`；端点 `WfDefinitionController.java:52` `PUT /{id}/supported-forms` **仍对外暴露** | 仍能写回 `supported_form_codes` | 一旦被调用：① 互斥校验突然复活，用**已废弃语义**拦截 EXTERNAL 蓝图配置；② `FormDefinitionService.delete():171` 守卫立刻生效，该表单**永久删不掉**，且报错文案「请先修改流程的表单白名单」把管理员**指向错误方向**（真相源已是 `form_definition.workflow_binding_type`） |
| **B1-c** | V149 `chk_form_def_workflow_binding` 要求 EXTERNAL 时 `workflow_definition_id IS NULL` | ADR-022 要求 EXTERNAL 时蓝图**必填非空** | 🔴 **在 V153 上线前，任何给 EXTERNAL 单据绑蓝图的写入都会被 DB 直接拒绝**。这不是「待演进」，是硬阻断 |

**建议改法**（三处都要改，缺一不可）：

| 文件:行 | 改法 | 工作量 |
|---------|------|--------|
| `WfDefinitionService.java:285-307` `validateSupportedForms()` | 改为反查 `form_definition.workflow_binding_type`（真相源），不再查 `wf_definition.supported_form_codes`。**并且**：EXTERNAL 蓝图绑定**不**走这个互斥校验（一个表单可持有多份蓝图供不同外部模板用） | M |
| `WfDefinitionController.java:52` `PUT /{id}/supported-forms` + `WfDefinitionService.java:153-161` `updateSupportedForms()` | **下线该端点**（返回 `VALIDATION_ERROR`「表单关联已迁至表单管理」）。这是**唯一还在写旧列的活路径**，不下线则 B1-b 随时可被触发 | S |
| `FormDefinitionService.java:171-175` | 守卫改为查 `form_definition.workflow_binding_type`（自己这张表）+ 新增「EXTERNAL 蓝图引用」守卫 | S |

**并新增一条V153 迁移前置**：V149 的 CHECK 与 ADR-022 冲突，V153 必须先跑；**在此之前 EXTERNAL 绑定不可写**。建议在 V153 里加一步断言：
```sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM form_definition
             WHERE workflow_binding_type='EXTERNAL' AND workflow_definition_id IS NULL) THEN
    RAISE EXCEPTION 'V153 前置失败：存在 EXTERNAL 且蓝图为空的绑定，须先清理';
  END IF;
END $$;
```

---

### 🔴 B2 — 产品已定决策「`REJECTED` 是终态、不回 `SAVED`」被活代码**直接推翻**，方案全文未察觉

**方案说了什么**（19§5.2、§6.3、ADR§4，三处一致且措辞很强）：
> 「**已定**：外部驳回写入 `form_record=REJECTED`，终态。**不回 `SAVED`**，本单不可改后再提」
> 「`APPROVED` 与 `REJECTED` 均为本单终态，**同一 form_record 不可再提交**」

**实测事实**（`FormRecordService.java`，活代码）：

```java
// :158-172
private FormRecord requireMineEditable(Long tenantId, Long id, Long operatorId) {
    ...
    // :164-165  ← REJECTED 被允许编辑
    if (!FormRecord.STATUS_SAVED.equals(record.getStatus())
            && !FormRecord.STATUS_REJECTED.equals(record.getStatus())) {
        throw new BusinessException(ResultCode.VALIDATION_ERROR, "当前状态不可编辑");
    }
    // :169-171  ← 编辑时无条件归一回 SAVED
    if (FormRecord.STATUS_REJECTED.equals(record.getStatus())) {
        record.setStatus(FormRecord.STATUS_SAVED);
    }
    return record;
}
```

调用点：`FormRecordService.java:79`（`save()` 路径）。

**这不是隐患，是正在发生的矛盾**：EXTERNAL 驳回 → 本地 `REJECTED` → 发起人编辑一下单据 → 状态被归回 `SAVED` → 可再次提交 → 因为旧外部实例已是终态，`uk_ext_inst_active` 谓词 `ext_status IN ('NOT_STARTED','RUNNING')` **挡不住新实例** ⇒ **产品明令禁止的「同一单据二次外部审批」会发生**。

**为什么方案漏了**：19§8.3「与现有实现冲突」只列了 3 项（FormDefinition 实体未吃 V149 字段、`supported_form_codes`、ProcessShell），**没有这一项**。而 LOCAL 路径下这个归一逻辑是**合理的**（LOCAL 支持撤回再发，19§3.2 自己也写了「历史再发起：旧实例保留，新实例新建（与 LOCAL『再发=新实例』一致）」）—— 所以它不会被 LOCAL 测试发现，只会在 EXTERNAL 上炸。

**建议改法**：
1. 在 §8.3 增列此项，标🔴 阻断；
2. `FormRecordService.requireMineEditable()` 的 `REJECTED` 分支改为**按 `form_definition.workflow_binding_type` 分流**：
   - `LOCAL` → 保持现状（归一 `SAVED`，可再发）
   - `EXTERNAL` → **不归一**，且对 `REJECTED` 抛 `VALIDATION_ERROR`「外部审批已驳回，本单不可修改后重提，请新建单据」
3. `toVo()`:179-181 的 `canEdit` / `canStart` / `canWithdraw` 三处判定同步按 `workflow_runtime` 分流；
4. 补一条验收用例：`EXTERNAL + REJECTED` 单据 → 编辑 → 期望 `VALIDATION_ERROR`；`LOCAL + REJECTED` → 编辑 → 期望成功且转 `SAVED`（**防止修坏 LOCAL 现有行为**）。

---

### 🔴 B3 — P0 承诺的「废弃并重建」在DDL 层**不可实现**；失败单据将永久锁死

**方案说了什么**（19§4、20§4，均标P0）：
> 「每步校验 `code=0`；失败 → `build_phase=FAILED`…**保留 caseId，提供「废弃并重建」**」
> 「拼节点失败（P0）：保留 caseId，`build_phase=FAILED`；提供「废弃并重建」」

**问题**：20§6.2 的 DDL 里，「废弃」这个动作**没有任何可落地的状态表示**：

```sql
ext_status  VARCHAR(16) NOT NULL DEFAULT 'NOT_STARTED',
  -- NOT_STARTED / RUNNING / COMPLETED / TERMINATED / REJECTED
  -- BUILD_FAILED 为本地构建态，用 build_phase 表达，不进 ext_status
build_phase VARCHAR(16) NOT NULL DEFAULT 'DRAFTED',
  -- DRAFTED / ASSIGNING / READY / ACTIVATED / DONE / FAILED
```

- BUILD_FAILED 实例 = `build_phase='FAILED'` + `ext_status='NOT_STARTED'`（注释明说）
- `uk_ext_inst_active` 谓词：`WHERE deleted=0 AND ext_status IN ('NOT_STARTED','RUNNING')`
- ⇒ **FAILED 行依然占用唯一索引**

于是「废弃」只有三条路，每条都有问题：

| 尝试 | 问题 |
|------|------|
| 删行 | `caseId` 丢失 ⇒ 无法调外部终止 ⇒ **外部孤儿流程永久累积**（这正是19§8.2 第 6 条自己列的风险，但方案没给闭环手段）；且 20§6.3 回滚说明写「镜像数据可丢」，暗示镜像不是审计真相，删行等于放弃排障证据 |
| 改 `ext_status` | **枚举里没有废弃态**（`TERMINATED` 语义是「外部终止」，不是「本地放弃」） |
| 改 `deleted=1` | 同删行，且丢失审计 |

**净效果**：一条 BUILD_FAILED 实例会让该 `form_record` **永久无法再次发起**，而§4 承诺的 P0 恢复手段不存在 ⇒ P0 有一条**不可交付**的需求。

**建议改法**（二选一，推荐 A）：

- **A（推荐）**：`ext_status` 增加 `ABANDONED`（本地放弃，非外部终态），并把 `uk_ext_inst_active` 谓词改为 `ext_status IN ('NOT_STARTED','RUNNING')`——「废弃」=置`ABANDONED` + `build_phase='FAILED'` + 记 `build_error`，唯一索引自动释放，`caseId` 保留可调外部 `stop`。同时 19§5.1 状态表补一行 `ABANDONED`（**不映射到 `form_record.status`**，不触发后置任务）。
- **B（兜底）**：若产品坚持P0 不做「废弃」按钮，则必须把 §4/§6.2 的「废弃并重建」从 **P0 降级为 P1**，并在管理台明确「失败单据需新建」——但这与「同一 form_record 不可再提交」的产品决策冲突（用户会以为能重提），**须产品重新拍板**。

---

### 🔴 B4 — 后置任务幂等键 `tenant_id + external_case_id + terminal_status` 在方案与DDL 中**均无落点**

**方案说了什么**（19§2.4，标🟡「建议」）：
> 「幂等键**建议**：`tenant_id + external_case_id + terminal_status`」
> 19§9 任务 E1：「后置任务幂等触发 + 状态变化消息策略」，工作量 M，无设计

**实测事实**：

| 检查项 | 结果 |
|--------|------|
| `biz_execution_task` 唯一约束 | 🔴 **没有**。`V121:130-147` 只有两个**普通**索引：`idx_biz_exec_status (tx_status,next_retry_at,created_at)`、`idx_biz_exec_biz (biz_type,biz_ref_id)` |
| `ExecutionTaskService.enqueue()` `:65-81` | 🔴 **无条件 `taskRepository.save(task)`**，无 exists 检查、无唯一键冲突处理 |
| `ProcessService.completeInstance()` `:531` | LOCAL 路径靠**状态机单线程推进**天然不重复，**不是靠幂等键** |
| `ExecutionTaskService` 自己的注释 `:35-36` | 「执行动作本身必须幂等；锁只保证『同一时刻单实例执行』，但**超时夺权会导致重复执行**，故业务实现需以状态前置校验保证幂等」 |

**结论**：EXTERNAL 是**轮询 + 回调双入口 + 集群 Job + 超时夺权重试**的并发模型，与 LOCAL 的单线程状态机完全不同。方案把 LOCAL 的隐式保证直接套到 EXTERNAL，**而幂等键既没落成表结构，也没落成应用层判重逻辑**。光靠「应用层先查再插」在并发下必然有窗口（两个入口同时查到「不存在」→ 都插 → 后置任务执行两次 ⇒ **业务动作重复执行**，如重复发货/重复建单）。

**建议改法**（推荐新建收件表，理由：轮询与回调都需要「先落事件再执行业务」，用 `INSERT ... ON CONFLICT DO NOTHING` 拿到「是我触发的」这个原子结论）：

```sql
-- V154 追加
CREATE TABLE IF NOT EXISTS ext_terminal_event (
    id                 BIGINT PRIMARY KEY,
    tenant_id          BIGINT      NOT NULL,
    external_system    VARCHAR(64) NOT NULL,
    external_case_id   VARCHAR(128) NOT NULL,
    terminal_status    VARCHAR(16) NOT NULL,   -- COMPLETED / REJECTED / TERMINATED
    source             VARCHAR(16) NOT NULL,   -- POLL / CALLBACK / MANUAL
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_ext_terminal_event UNIQUE (tenant_id, external_system, external_case_id, terminal_status)
);
```
轮询与回调**统一走**：`INSERT ... ON CONFLICT DO NOTHING RETURNING id` → 返回 0 行即「已处理过」，直接结束；返回 1 行才投递 `ExecutionTaskService.enqueue(...)`。这样幂等由 **DB 唯一约束**保证，而非应用层时序判断。
同时 19§9 的 E1 工作量从 M 上调至 **L**（新增收件表 + 两条入口改造 + 一致性测试）。

---

### 🔴 B5 — `FormDefinition` 实体**完全没有** V149 四列的 JPA 映射，A3 任务范围被低估

**方案说了什么**（19§8.3）：
> 「`FormDefinition` 实体 / BFF / 管理 UI 尚未吃进 V149 外部字段」
> §9 A3：「领域实体 + 仓储：`FormDefinition` **补外部字段**」，工作量 **M**

**实测事实**：`FormDefinition.java` 全文只有 11 个字段（`id/tenant_id/category_id/code/name/description/status/sort_order/config/deleted/created_by/created_at/updated_at`），**不含** `workflow_binding_type`、`workflow_definition_id`、`external_workflow_system`、`external_workflow_ref`。

全仓 Java 侧搜索 `workflow_binding_type|workflowBindingType|externalWorkflowRef|injectMode|embedToken` ⇒ **零命中**（原生 SQL 反查也没有）。

**为什么这比方案说的严重**：方案写「尚未吃进外部字段」，读起来像「V149 的 LOCAL 绑定已在用，只缺 EXTERNAL 的」。**实际是V149 的四个列（含 LOCAL 的 `workflow_definition_id`）至今没有任何 Java 映射与读路径** —— 也就是说 LOCAL 绑定链路现在也是断的，只是没人用所以没暴露。A3 的真实范围是**新增 4+5=9 个字段映射 + 读写路径 + 枚举常量**，不是「补外部字段」。

**建议改法**：
1. §8.3 改写为：「`FormDefinition` 实体**尚未映射 V149 的任何一列**（含 LOCAL），读路径也不存在反查；A3 需新增 9 个字段映射」；
2. A3 工作量 M → **L**，并在 A3 描述里列出 9 个字段清单；
3. 补一条**前置**：A3 完成前，19§9 的 D1（BFF 接入）无法开工，依赖关系需从 `A1,A3` 扩展为 `A1,A3` 且 A3 前置于 D1（现有依赖已满足，但关键路径图未体现 A3 的分量）。

---

### 🔴 B6 — `ext_process_instance` 的 `form_record` 行锁在方案里被**假定存在**，实际大概率不存在

**方案说了什么**（19§4、20§4，防并发段）：
> 「防并发：**DB 对「有效外部实例」唯一约束**（`uk_ext_inst_active`）+ **服务端行锁** + 前端提交防抖」

**实测事实**：`form_record` 的读取入口是 `FormRecordService.java:112` `formRecordRepository.findByIdAndTenantIdAndDeleted(...)` —— 普通 `@Transactional` 查询，**无 `@Lock(PESSIMISTIC_WRITE)`、无 `SELECT ... FOR UPDATE`**。JPA/MyBatis 默认**不加行锁**，只在 UPDATE 时隐式加行级锁。

**后果**：`uk_ext_inst_active` 是**唯一索引，插入时才冲突**。两个并发提交都会先「查无映射」（都通过）→ 都跑完 start → 都插镜像 → **两个外部流程都已被创建**，第二个才在唯一索引上报错。届时要做的是「废弃并重建」——而 B3 已证明这条路径不可实现 ⇒ **并发双发 = 外部孤儿流程 + 本地单据锁死**。

这不是理论风险：`FormRecordService.startProcess():119` 已有 `if (!STATUS_SAVED.equals(status)) throw` 的**读后写**竞态（check-then-act 无锁），本地路径靠单机部署侥幸不出问题，EXTERNAL 走集群就暴露了。

**建议改法**：
1. 方案 §4 防并发段改为**明确的实现约束**（不是「服务端行锁」这种模糊措辞）：
   ```sql
   SELECT id, status FROM form_record
   WHERE id = :recordId AND tenant_id = :tenantId AND deleted = 0 FOR UPDATE
   ```
   并在 §8 共享约定补一条：「EXTERNAL 发起链路的所有 `form_record` 读取必须 `FOR UPDATE`；`ExtWorkflowLaunchService` 的 `@Transactional` 边界须覆盖 start→落镜像全过程」。
2. 补一条验收用例：并发（2 线程/2 实例）对同一 `form_record` 同时提交 ⇒ **恰好 1 次外部 start**，另一方拿到明确业务错误（非 500）。

---

## 2. 问题清单 — 重要（🟡 不阻断开工，但须在对应Phase 前关闭）

### 🟡 I1 — 19§4 步骤 5 与 20§1 的 `draft_mode` 描述**实质不一致**，且 DDL 默认值选错

| 位置 | 表述 |
|------|------|
| 19§4 步骤 3 | `start(templateCode, initiatorRef, **draft=1**, payload)`（写死） |
| 19§4 步骤 5 | 「`activate(caseId)` → 离开待发…★ 待发送出 API 待现场确认；**无该 API 时按 `draft_mode=DIRECT_SEND` 回退**」—— 读起来 activate 是可选步骤 |
| 20§1 | 「`draft_mode = DRAFT_THEN_SEND`（**默认**，需确认发送接口；P0 首选）/ `DIRECT_SEND`（回退：`draft=0` + 立即 freeReplaceNode）」 |
| 20§4 步骤 3 | 又写死 `start(draft=1)`，步骤 5 才说回退 |

**三个具体问题**：

1. **配置项生效点写在了错误的步骤**。`draft` 是步骤 3 的参数，却在步骤 5 才决定。DIRECT_SEND 下**根本没有 activate 步骤**，19§4 步骤 5「离开待发，进入第一级审批」的前提（draft 已保存）不成立。开发照§4 顺序实现，会把两条互斥路径混进同一个状态机。
2. **DDL 默认值选错**：`draft_mode VARCHAR(24) NOT NULL DEFAULT 'DRAFT_THEN_SEND'`（20§6.2）= 默认走**尚未确认可行**的路径（C-1 是🔴 阻塞）。✅ 确证可行的是 `DIRECT_SEND`。**默认值应设为 `DIRECT_SEND`**，把 `DRAFT_THEN_SEND` 当「C-1 联调确认后再切」的选项。
3. **`draft_flag` 默认值在 DIRECT_SEND 下必错**：`draft_flag SMALLINT NOT NULL DEFAULT 1 -- 1=外部仍处待发`。DIRECT_SEND 无draft 阶段，插入行时该值应��� `0` 或 `NULL`（不适用）。须按 `draft_mode` 区分。

**建议改法**：把 `draft_mode` 的分支**上移到步骤 3**，写成两套并列序列（而不是在步骤 5 塞一个回退注释）；DDL 默认值改 `DIRECT_SEND`；`draft_flag` 允许 NULL 或按 mode 赋值。

### 🟡 I2 — 状态「四态 vs 五态」在 19 与 ADR-022 之间不一致，且**缺终态单调性约束**

| 位置 | 态数 |
|------|------|
| 19§5.1 标题 | 「外部实例本地**四态**」 |
| 19§5.1 表格 | **5 行**（NOT_STARTED / RUNNING / COMPLETED / TERMINATED / REJECTED） |
| 19§3.2 `ext_status` 说明 | 5 态 |
| ADR-022§4 | 「四态：NOT_STARTED / RUNNING / COMPLETED / **TERMINATED**」—— **完全没有 REJECTED** |
| 20§6.2 DDL 注释 | 5 态（无 ABANDONED，见 B3） |

**实质问题（比数字不一致严重）**：19§10 第 2e 行 + 20§R1 都写「状态未识别时**拒绝轮询并告警**，不猜」。但这**只防住了「非法枚举值」，防不住「合法枚举值被映射错」**：

- 若`status_mapping` 把 `TERMINATED` 误配成 `COMPLETED` ⇒ **被终止的单据被判为通过** ⇒ 触发 `FINALIZE_BIZ` 后置任务 ⇒ **业务动作错误执行**（20§R1 自己标了「高」风险，但缓解措施不足）。
- 唯一防线是 C-6 的沙箱验证（跑 5 条流程记录返回值）。而 C-6 在 §9 里属**Phase E 联调**（E2「阻塞：全部 C-x」），B4 状态映射编码属 **Phase B** ⇒ **顺序倒了**：映射代码先写、正确性后验。
- 「拒绝轮询」的行为本身也未定义：跳过 ⇒ 该实例永远停在 `RUNNING`、管理台无感；若每轮都告警 ⇒ **告警风暴**（19§8.2 第 10 条只提了「消息风暴」，没覆盖告警通道）。

**建议改法**：
1. **把 C-6 提升为 Gate-1 级前置**（与 C-3 并列）—— 状态映射是整个联动链路的地基，不该在Phase E 才验；
2. 补一条**终态单调性**硬约束（这是防重复触发后置任务的最后一道闸，方案完全没有）：
   > `ext_status` 迁移只允许：`NOT_STARTED → RUNNING → {COMPLETED | REJECTED | TERMINATED}`，以及 `NOT_STARTED → ABANDONED`。**任何终态不可被后续轮询改回非终态**。违反则记 `sync_error` 并告警，不落库。
3. `status_mapping` 服务启动时 fail-fast 校验非空且值域合法（而不是逐条实例拒绝）；
4. 统一「四态/五态」表述（建议统一为「四类终态+ `ABANDONED` 本地态」，并在ADR-022§4 正文补 `REJECTED`）。

### 🟡 I3 — §1.1 目标与 §6.1 界面承诺「审批意见」，但 C-2 结论是**没有查询接口**，四份文档均未回写

- 19§1.1 目标 2：「查询 / 定时拉取进度与**审批意见**」
- 19§3.2：`opinions_snapshot | 审批意见镜像（JSON）`
- 19§6.1-5：「展示外部进度摘要 + **审批意见列表**」
- ADR-022§5：「EXTERNAL 套壳…**展示外部意见**」
- 20§5 C-2 结论：🔴 **REST 与 V8 OpenAPI 均无查询接口** ⇒ 降级为深链跳转

⇒ **开发会照 §1.1 / §6.1 / ADR§5 去实现意见展示**。架构师只在 §10.1 表格里改了一行（19:409），**没有回写目标、界面、ADR 三处**。20§6.2 注释里「致远无查询接口时为 NULL」只是兜底，不足以阻止开发按 §6.1 实现。

**建议改法**：回写 19§1.1 目标 2、19§6.1 第 5 条、ADR-022§5，统一改为「展示外部状态 + 当前处理人 + **深链跳转致远**；`capabilities` 无 `QUERY_OPINIONS` 时隐藏意见区」。**并在 §9 任务表 D3 里明确「意见区按能力隐藏」是P0 范围**，避免 D3 被无限扩到不可能完成的查询实现。

### 🟡 I4 — `addNode` 在能力表（20§2）里，但**不在 Adapter 契约（§3.1）里**，且契约与能力表参数口径不一致

| 能力（20§2） | 契约（20§3.1） |
|--------------|--------------|
| `addNode`、`deleteNode`、`workitem/finish`、`takeback` | ❌ **均无** |
| `stop`（参数 `affairId`/`repealComment`/`member`=登录名） | `terminate(caseId, operatorRef, reason)` |
| `cancel`（参数 `affairId`/`summaryId`/`member`） | `revoke(caseId, initiatorRef, reason)` |

`terminate/revoke` 契约签名用 `caseId`，能力表实现却需要 `affairId` + `summaryId` + `member`（登录名）。V154 里 `ext_affair_id VARCHAR(128) NULL -- 发起事项 affairId（终止/撤销用）` 说明实现要用 affairId ⇒ **契约签名与能力表参数不匹配**，且 `external_system.endpoint_config`（§3.2 原则 1）的 key 清单 `{start,draftStart,assignNode,activate,fetchState,fetchOpinions,stop,cancel,resolveAccounts}` **缺 `caseSend`/`workItemSubmit`/`caseStop`/`caseCancel`**，V8 路径无法一一对应（V8 是 `/bpm/case/send`、`/bpm/case/stop`、`/bpm/case/cancel`，不是 `/bpm/process/start`、`affair/stop`）。

**建议改法**：契约补全或明确声明「P0 契约只覆盖 §9 的 B1~B5 任务所需方法，其余为P1/P2 预留，**未列入契约者禁止在P0 调用**」；`endpoint_config` 的 key 清单按 `api_flavor` 分别给出两套完整 key。

### 🟡 I5 — `EMBED_URL` 安全设计（19§2.1 五条要求）在20 号契约与 DDL 中**全部未落实**

19§2.1 提了 5 条要求（高熵随机串 / URL 绑定 tenant+form+record / 必须鉴权 / 支持吊销 / CSP Frame 祖先仅放行致远）。20 号文档的落实情况：

| 要求 | 契约（§3.1） | DDL（§6） |
|------|-------------|----------|
| 随机串 | ❌ Adapter 无任何 embed 方法 | `embed_token VARCHAR(64)` ✅ |
| 绑定 tenant+form+record | ❌ | ❌ 无字段 |
| **必须鉴权** | ❌ | ❌ |
| **支持吊销** | ❌ | 🔴 **无 `embed_token_revoked_at` / `expires_at`** ⇒ 「token 轮换」**无法表达**（改token = 旧 URL 立即死，无宽限期） |
| **CSP / Frame 祖先** | ❌ | 🔴 `external_workflow_system` **无任何 CSP/frame 祖先配置列** ⇒「仅放行致远域名」**无处配置** |

**并且有一个未识别的可行性风险**（这条建议单独列 🔴 级风险，因为可能让 EMBED_URL 模式整体不成立）：

> 19§2.1 要求 embed URL「必须鉴权（登录态或签名）」。若采用**登录态**：embed 页在致远域名的 `<iframe>` 内加载本地系统 ⇒ 属**第三方 cookie 场景**，现代浏览器默认 `SameSite=Lax` **会在跨站 iframe 中拒绝发送 Cookie** ⇒ 鉴权直接失败。若采用**签名**：则需 URL 带 `expires` + HMAC，而 DDL 无对应字段。
>⇒ **19§2.1 的两条鉴权路径都未做可行性验证**，方案把「必须鉴权」当成了已定约束。建议把这条加入 C-x 清单（如C-12「EMBED_URL 跨站 iframe 鉴权可行性」），明确 `SameSite=None; Secure` + 独立 `embed_session`，或改签名 URL。

### 🟡 I6 — `embed_token` 唯一索引的 `WHERE deleted = 0` 谓词会造成**跨表单串单**

20§6.2：
```sql
CREATE UNIQUE INDEX IF NOT EXISTS uk_form_def_embed_token
    ON form_definition (embed_token)
    WHERE embed_token IS NOT NULL AND deleted = 0;
```

**回答任务方的问题「是否需要额外处理租户隔离」**：
- **不需要加 `tenant_id`** —— embed_token 是高熵随机串，**全局唯一比租户内唯一更强**（防碰撞目标达成），且 embed 路由是`WHERE embed_token = ?` 单列查询，正好命中该索引。**此处方案是对的**。
- **但谓词 `deleted = 0` 是缺陷**：软删表单后其 token 从唯一索引「释放」⇒ 同一 token 可被**另一个表单**复用。而 embed URL 是**长期可用**的（19§2.1 原文），其生命周期远超表单软删 ⇒ **旧 URL（存在于致远模板、邮件、浏览器历史）会解析到新表单上 ⇒ 越权 / 串单**。

**建议改法**：唯一索引**去掉 `deleted = 0` 谓词**（改为 `WHERE embed_token IS NOT NULL`），token 一经分配即永久占用；吊销用显式 `embed_token_revoked_at` / `embed_token_status` 字段表达（顺带解决 I5 的「轮换无法表达」）。

### 🟡 I7 — `ext_workflow_call_log` 会**被轮询写爆**，且无保留/归档策略

20§3.2 原则 7：「**所有**对外调用必须写 `ext_workflow_call_log`」。但19§7 规定非终态实例每 **1~5 分钟** fetch 一次。按 100 个在途实例、5 分钟间隔估算 **≈ 2.9 万行/天**，而表上只有两个普通索引（`idx_ext_call_log_inst` / `idx_ext_call_log_op`），**无分区、无保留期、无归档、无降采样** ⇒ 表与索引单调膨胀，且 poll 噪音淹没 `START`/`ASSIGN_NODE` 这些真正需要排障的审计记录。

**建议改法**：明确「**`operation=FETCH` 只记失败不记成功**（或单独入`ext_sync_log` 并保留 7 天）」，`START`/`ASSIGN_NODE`/`ACTIVATE` 等变更类操作全量全记；补一条保留策略（保留期 + 定期归档/清理任务，归入 §9 的 E2）。

### 🟡 I8 — 19§9 A0 的产出依赖一个**尚不存在**的列；Gate-1 未落在关键路径上

- 19§9 表格 A0：产出「槽位 activityId 清单」**写入 `form_definition.external_node_slots`**；但该列由 **A1（迁移）** 才创建，而 A0 的依赖列写的是「—」。
-⇒ A0 若真要落库，**必须依赖 A1**；若 A0 只是产出一份文档/Excel 清单（更合理，甲方侧本来就要给），则产出物描述该改。
- 19§9 关键路径写 `A0 → B1 → B2 → B3 → …`，而 Gate-1 卡在 **B3**（"A0 产出槽位清单 → 否则 B3 无法开工"）⇒ **Gate-1 在关键路径图上不可见**，读者会以为 A0 之后一路通畅。

**建议改法**：A0 产出物改为「槽位清单文档（甲方提供，Excel/邮件即可）」，录入动作归入 D1；关键路径改为 `A0 → (Gate-1) → B3`，并在图上标出 Gate-1 位置。

### 🟡 I9 — `ProcessShell` 隐藏本地图形的**触发条件未定义**

19§1.3 / §6.1-5 / §9 D3：EXTERNAL 模式隐藏本地图形化进度。但：
- `process-shell.tsx`（703 行）里 `grep EXTERNAL` ⇒ **零命中**，即当前完全没有 `workflow_runtime` 概念；
- `FormDefinition` 实体也没有该字段的映射（见 B5）；
⇒ D3 需要「先有 `workflow_binding_type` 能传到前端」，这个**跨端字段链路 D3 没写依赖**（D3 依赖 `C1,D2`，而 D2 依赖 `C1,D1`，D1 才做BFF）。建议 D3 依赖显式改为 `C1,D1,D2`。

---

## 3. 问题清单 — 建议（🟢）

| # | 问题 | 证据 | 建议 |
|---|------|------|------|
| **S1** | `external_workflow_ref VARCHAR(256)`（V149）与 `ext_template_code VARCHAR(128)`（V154）存同一物、长度不同 | 20§6.2:478 | 统一；或明确前者是「模板 code / id / URL」后者是快照 |
| **S2** | `auth_ref VARCHAR(256)`「密钥引用，不存明文」，但**没说引用指向哪里**；20§8 说「放配置中心或环境变量」——环境变量是**进程级**，多租户不同密钥无法表达 | 20§6.2:428, §8 | 明确 provider（配置中心路径 + 租户维度），否则多租户密钥无处安放 |
| **S3** | `capabilities` / `endpoint_config` / `status_mapping` 用 JSONB 但**无任何校验** | 20§6.2:431-433 | 加 `jsonb_typeof` CHECK 或 json schema；`status_mapping` 至少校验 value ∈ 五态 |
| **S4** | 「四态」表述在 19§5.1（标题4/表格 5）、ADR§4（4 态，漏 REJECTED）、20§6.2（5 态）三处不一致 | — | 统一口径；随B3 决定是否加入 `ABANDONED` |
| **S5** | `ext_process_instance.form_record_id` 无引用守卫；仓库既有惯例是「字符串软引用无外键，在 Service 里挡」（见 `FormDefinitionService.delete()` 注释） | 20§6.2:463 | 至少在文档声明「镜像表不设防，允许孤儿（只读影子）」，与仓库惯例显式对齐 |
| **S6** | C-2 候选④「只读库查 `ctp_opinion`」标🟡，但这实际需要甲方开**数据库只读账号** —— 比开API 更重的权限请求，且审批意见含个人身份信息 | 20§5C-2 | 明确标注「需甲方书面批准 + 独立只读账号 + 脱敏范围」，否则会误导甲方评估可行性 |
| **S7** | ADR-022 §决策 §3 正文仍写「蓝图映射 P0 **仅串行**节点」「**串行** `freeReplaceNode`」，修正只写在文末「对本决策的影响」 | ADR§3 vs §末 | ADR 是决策记录，**正文必须改**，否则读者按串行单人理解。同时 ADR 状态仍是「提议中」，而 19§9 Phase A 已勾选「[x]规划文档+ADR-022」与「[x]架构核实完成」⇒ 状态字段自相矛盾 |
| **S8** | 本报告 `21-` 与方案文档 `19-`/`20-` 连号，但 21 是**审查报告**不是方案；`msg-log-workflow/README.md` 有文档索引 | — | 在 19/20 顶部加一行「审查结论见 21」；或把审查报告归入 `docs/reviews/` |
| **S9** | 19§8.1 编号重复（两个 `2.`：`2.` 与 `2b.`），以及 `8.2` 从 `6.` 起跳 | 19§8.1-8.2 | 修编号，避免后续引用歧义 |

---

## 4. 🔴 重点结论：`addNode` 线索 —— **不能绕开槽位限制**

任务方要求明确结论，不模棱两可。我的结论是：**不能**。「蓝图节点数 ≤ 模板槽位数」这个硬约束**必须保留**。

### 4.1 判断依据（全部来自致远官方文档原文，非推断）

**依据一：`workitemId` 必须是一个「已存在的待办事项」**（V5 REST APIdoc 1.18 节参数表原文）：

> `workitemId(String)` 是 **业务ID，对应 ctp_affair 表 CASE_ID 字段**

`ctp_affair` 是**事项表**（待办/已办/已发/待发）。要有一个 `CASE_ID` 对应的事项，流程必须**已经被发起并流转到某个节点**。

**依据二：`submitType` 的语义是「处理待办时的提交动作」**：

> `submitType(String)` 是 是否需要提交协同 （0：不需要，1：提交协同，2：暂存待办 默认1）

**依据三：`data` 里必须携带审批意见**（官方示例 `jsonData`）：

```java
"'comment_deal': {"
    + "'attitude': '1',"// 1 已阅， 2 同意，  3 不同意
    + "'content': '接口指定回退'"
```
`attitude` 是**审批态度**。这只能由**正在处理该待办的人**提交。

**依据四：`backToMe` 字段印证了「当前有人在处理」的前提**：

> `'backToMe': '1'` // 加签处理后流程是否回到我（0：否，1：是）

「回到我」= 加签处理完成后回到**当前处理人**。这个语义只有在**当前节点正有人处理**时才成立。

**依据五：与 `freeReplaceNode` 同族**。两者都在 `bpm/process/*` 下，都要求 `activityId`/`workitemId` 指向**已存在的节点**。官方对 `freeReplaceNode` 的描述也印证了这套API 家族的一致语义：

> 替换流程节点，新建自由协同和处理流程时的流程编辑都调用这个方法（立即生效）

### 4.2 推论

`addNode` 与 `freeReplaceNode` 是**同一族的「运行中节点操作」**，二者都要求目标节点**已经存在**。因此：

- 在 `draft=1`（待发）阶段，流程停在待发，`ctp_affair.state=1`（待发）**不是待办**，**不存在可操作的 `workitemId`** ⇒ **无法在发起前用 `addNode` 动态构造流程**。
- 换言之，`addNode` 只能做「**流程已经在跑**，某节点处理人给自己加签/知会/会签」，**不能**做「**流程还没发**，先拼出N 级审批链」。
- ⇒ **「模板预置 N 槽位 + 逐槽位 `freeReplaceNode` 填人」是唯一可行模型**，方案的核心约束**正确**。

### 4.3 但`addNode` 有一条方案**没写进契约的独立价值**，建议保留为 P1

`freeReplaceNode` **只填人、不改节点属性**（20§Q2 已确认，会签语义由模板 `nodePolicy` 决定、平台不可控）。而 `addNode` 能改：

| 参数 | 作用 | 对方案的价值 |
|------|------|------------|
| `changeType=5` 多级会签 | 运行时给节点加多级会签 | 弥补 freeReplaceNode「不能定会签语义」的缺口 |
| `add_node_info.node_process_mode` | `all`（全体执行）/ `competition`（竞争执行） | **或签/竞争执行** —— freeReplaceNode 完全做不到 |
| `add_node_info.flowType` | `1` 串发 / `2` 并发 / `5` 与下一节点并发 | 运行时分叉 |
| V8 `changeTypeEnum` | 含 `OrderExecuteAdd`（**多人按序执行**）、`Countersign`、`CountersignInnerAdd`、`LOOP`（节点循环） | 多人按序执行 |

⇒ **建议**：把 `addNode` 明确重新定位为「**P1 的运行时会签/或签增强**」，写进 20§3.1 契约（标注 P1），**不是** P0 的槽位绕过方案。这样既关掉开发期返工风险，又不浪费这条能力（目前它只躺在能力表里，契约无、开发不知道）。

### 4.4 🔴 附带发现：`addNode` 有一条**方案完全没写进禁止清单的合规风险**

由依据三（必须带 `attitude` 审批意见 + `submitType=1提交协同`）可直接推出：

> **调用 `addNode` 必然等于「替真人审批人提交了一次审批意见」。**

平台若在业务中调用它，等于**伪造审批人签名**——审计与合规事故。方案 20§8「共享约定（供 Engineer）」列了 6 条禁止项（不硬编码路径/状态/人员标识、密钥不入库、映射唯一、不写 `sys_task`），**唯独没有「禁止代替真人调用 `addNode` / `workitem/finish` / `work-item/submit`」这条**。

**建议**：20§8 增第7 条：
> 「平台**仅**代发起人完成『发起』动作。**禁止**以集成账号或任何人身份代替真人调用 `bpm/process/addNode`、`bpm/workitem/finish`、`bpm/work-item/submit`（这些接口必然携带 `attitude` 审批意见 = 伪造审批人签名）。会签/知会需求只能通过修改**模板节点属性**实现，且须甲方在致远侧完成。」

---

## 5. 迁移草案可施工性核查（逐条回答任务方 4 个问题）

| # | 问题 | 结论 | 依据 / 改法 |
|---|------|------|-----------|
| **Q1** | V149 已落库不可改正文（Flyway checksum 覆盖全文件含注释），方案用 `DROP CONSTRAINT IF EXISTS` + `DO $$` 幂等重建 —— 写法对吗？ | 🟡**写法基本对，但有一处真实缺陷** | ✅ **对的部分**：V149 正文确实不能改（Flyway checksum 含注释），追加 V153 是唯一正解；`DROP ... IF EXISTS` + `DO $$` 里 `IF NOT EXISTS (pg_constraint)` 判断的幂等结构正确，重复执行安全；`conrelid='form_definition'::regclass` 限定同表，避免同名约束在其他表上误判——写法规范。<br>🔴 **缺陷**：V153 **没有处理存量 EXTERNAL 行**。V149 的 CHECK 允许 `EXTERNAL + workflow_definition_id IS NULL` 存在（V149 自己就是这么定义的），而 V153 新 CHECK 要求 `EXTERNAL ⇒ workflow_definition_id IS NOT NULL` ⇒ 若库里已有这类行，`ADD CONSTRAINT` **直接失败、迁移中断、发布卡死**。当前因 Java 侧无任何写路径（见 B5）+ `V149` 回填只产生 `LOCAL`，实际风险低，但**运维/DBA 可直接改库**。⇒ 必须在 V153 的 `DO $$` 重建 CHECK **之前**加断言（见 B1 建议的 SQL）。<br>🟡 另建议：约束**同名替换**（`DROP` 后 `ADD` 同名 `chk_form_def_workflow_binding`）而非换名 `_v2`，减少中间无约束窗口与认知负担；`ADD CONSTRAINT` 会全表扫 +持 ACCESS EXCLUSIVE 锁，`form_definition` 是配置表量小可接受，但建议在脚本注释里标明锁行为 |
| **Q2** | 新列 `embed_token` 用部分唯一索引 `uk_form_def_embed_token` —— 是否需要额外处理租户隔离？ | ✅ **不需要加 `tenant_id`；但谓词有缺陷** | 高熵随机串**全局唯一强于租户内唯一**，防碰撞目标已达成；embed 路由是 `WHERE embed_token = ?` 单列查询，正好命中该索引。**方案此处是对的**。<br>🔴 **但 `WHERE deleted = 0` 是缺陷**：软删后 token 从索引释放 → 可被另一表单复用，而 embed URL **长期有效**（19§2.1）⇒ 旧 URL 解析到新表单 ⇒ **越权/串单**。改法：谓词去掉 `deleted = 0`，吊销改用显式 `embed_token_revoked_at` 字段（一并解决 I5 的「轮换无法表达」） |
| **Q3** | `ext_process_instance` 外部 ID 用 `VARCHAR(128)`（致远雪花 Long 超 int64）—— 是否还有其他字段有溢出风险？ | 🟡 **VARCHAR(128) 方向正确，但长度依据不足、且有一个真实溢出点** | ✅ 正确：官方示例 `activityId="-5597257474554312519"`、`processId="8492409909120645741"` 均在 int64 内，但官方明文写「数字类型的字符串」⇒ **用 String 收发、禁止 long** 是对的（20§8 已写，good）。<br>🟡 **长度**：128 够用，但 `uk_ext_inst_command` 的 `command_id VARCHAR(64)` 偏紧——若 `command_id` 采用 `tenantId + formRecordId + draftMode + 时间戳` 拼接，64 字符可能不够；且 §3.2 原则 5 要求 `command_id` 有唯一索引，值若含时间戳则**重试会生成新值→幂等失效**（这是个未被发现的语义冲突，见 I4 补充）。建议 `command_id VARCHAR(128)` 且**明确其生成规则必须对「同一次业务发起」稳定不变**（否则 V8 的 `commandId` 幂等与本地唯一索引双双失效）。<br>🔴 **真实溢出点不在长度在类型**：`biz_execution_task.biz_ref_id VARCHAR(128)`（V121:136）—— 若按B4 建议把 `external_case_id` 放进去则够用；但**若把 `tenant_id + caseId + terminal_status` 拼进去做幂等键**（不建收件表的备选方案），128 也够。**真正的风险是 Java 侧**：20§8 已写「必须String/BigInteger收发，禁止 long」，但 `ext_process_instance` 的 **`id`、`tenant_id`、`form_record_id`、`created_by` 用的是 `BIGINT`** —— 本地雪花 ID 走 long 没问题，**只要 `external_*` 四列（`external_case_id`/`external_process_id`/`ext_affair_id`/`initiator_ref`）在 Java 实体上严格声明为 `String`**。建议 20§8 增列这四个字段名作为「必须 String」的显式清单（现在只写了原则没点名列名，工程上容易漏）。 |
| **Q4** | 有没有遗漏的索引、约束、外键？ | 🔴 **有 4 处遗漏 + 1 处冗余** | **遗漏 1（🔴）**：`ext_terminal_event` 收件表（见 B4）—— 后置任务幂等**当前完全没有 DB 约束兜底**。<br>**遗漏 2（🔴）**：`ext_process_instance` 缺 `form_record` 引用守卫（与仓库「软引用只在 Service 挡」惯例不一致，见 S5）。<br>**遗漏 3（🟡）**：`external_workflow_system` 缺 CSP / frame 祖先配置列（I5），导致「Frame 祖先仅放行致远域名」**无处配置**。<br>**遗漏 4（🟡）**：`ext_workflow_call_log` 无保留/归档策略（I7）。<br>**冗余（🟡）**：`uk_ext_inst_command ON (command_id) WHERE command_id IS NOT NULL AND deleted=0` —— **单列唯一、不含 `tenant_id`**。`command_id` 若不含租户前缀则跨租户可能撞（虽然雪花前缀下概率极低）；且 §3.2 原则 5 同时要求它「唯一索引」+「幂等键」，两个语义混在一列（见 Q3）。<br>**不缺失的**：`idx_ext_inst_polling` / `idx_ext_inst_console` / `idx_ext_inst_case` 覆盖了 Job 扫描、管理台筛选、回调反查三类查询，**索引设计本身是合理的** —— 唯一问题是 `idx_ext_inst_polling` 的谓词含 `ext_status IN ('NOT_STARTED','RUNNING')`，而扫描 SQL 若要排除 BUILD_FAILED 需额外写 `AND build_phase <> 'FAILED'`，**该条件用不上部分索引**（PostgreSQL 部分索引要求查询条件蕴含索引谓词）⇒建议把 `build_phase` 一并纳入索引谓词。 |

---

## 6. 其他遗漏与风险（任务方第 5 点）

| # | 风险 | 等级 | 说明 / 建议 |
|---|------|------|-----------|
| **1** | **轮询 Job 的 `BUILD_FAILED` 恢复路径不闭环** | 🔴 | 19§4「[已有映射] `build_phase=ASSIGNING` 且仍 draft → 继续第 4 步（断点续拼，**P1**）」⇒ **P0 阶段 BUILD_FAILED 的唯一出路是「废弃并重建」，而该动作在 DDL 层不可实现（B3）**。且P0 不做断点续拼 ⇒ 任一槽位 `freeReplaceNode` 失败就要人工重建并遗留外部孤儿流程。**建议**：把断点续拼从 P1 提到 **P0**（成本很低——`assigned_slots JSONB` 列V154 已预留，只差状态机逻辑），否则 P0 的可用性风险被严重低估 |
| **2** | **轮询 Job 无并发保护** | 🔴 | `idx_ext_inst_polling` 没有「抢占」语义，多实例 Job 会同时 poll 同一行并同时写`form_record` + 同时发消息（违反 19§7「避免每轮轮询都推送」的**意图**，因为并发下双方都认为状态变了）。仓库**已有 `DistributedLockService` / `biz_exec_lock`（`V121:152`，PK=`(biz_type, biz_id)`，注释明写「替代 `synchronized`，集群安全」）** ⇒ `biz_type='EXT_SYNC'`、`biz_id=caseId` 即可复用。**方案 §9 C1 的描述里完全没提锁**，建议明确写入 |
| **3** | **`EMBED_URL` 安全设计全部未落实** | 🔴 | 见 I5（契约无方法、DDL 无吊销字段、无 CSP 配置、跨站 iframe 鉴权可行性未验） |
| **4** | **后置任务幂等键无落点** | 🔴 | 见 B4 |
| **5** | **19§1.1 / §6.1 / ADR§5 承诺的「审批意见展示」与 C-2 结论矛盾** | 🟡 | 见 I3 |
| **6** | **致远调用审计表被轮询写爆** | 🟡 | 见 I7 |
| **7** | **状态映射验证顺序倒置**（Phase B 写代码，Phase E 才验枚举） | 🟡 | 见 I2，建议 C-6 升为 Gate-1 |
| **8** | **`draft_mode` 默认值指向未确认路径** | 🟡 | 见 I1 |
| **9** | **`command_id` 语义未定义稳定生成规则**，同时承担「本地幂等唯一索引」+「V8 `commandId`」双重语义 | 🟡 | 见 Q3 |
| **10** | **外部调用无熔断/降级**：外部系统全挂时，轮询 Job 会把每条实例都打成 `sync_error` 并逐条告警；且 §7 规定 1~5 分钟一轮 —— 无退避（backoff） | 🟢 | 建议加指数退避 + 「外部系统级」熔断开关（`external_workflow_system.status=DISABLED` 已有，可复用为「暂停轮询」开关，但语义未定义） |
| **11** | **`opissions_snapshot` 拼写错误** | 🟢 | 20§6.2 注释里 `opinions_snapshot` 正确，但 DDL 注释写的是 `opissions_snapshot`（`:523`）—— 统一 |

---

## 7. 给主理人的行动建议

### 7.1 立即（本周内，方案补丁，不动代码）

| 序 | 动作 | 责任 |
|----|------|------|
| 1 | **补写 19§8.3「与现有实现冲突」** —— 现有 3 项基础上增 2 项并标🔴：<br>① `FormRecordService.requireMineEditable():169-171` 的 `REJECTED → SAVED` 归一（B2）<br>② `FormDefinition` 实体**完全未映射** V149 四列（含 LOCAL），A3 范围需重估（B5） | Architect |
| 2 | **把 `supported_form_codes` 三处活代码落到 §9 任务表**（B1）—— 新增任务 **A4「双源收敛」**：`validateSupportedForms` 改反查真相源 + 下线 `PUT /{id}/supported-forms` + `FormDefinitionService.delete()` 守卫改造 + V153 前置断言。工作量 **M**，依赖 A1 |
| 3 | **`ext_status` 增加 `ABANDONED`**（B3），或把「废弃并重建」从 P0 降级并请产品重新拍板。**这一项需要产品拍板，请主理人决策** | 架构 + 产品 |
| 4 | **§9 任务 E1 拆细**（B4）：新增「ext_terminal_event 收件表 + 轮询/回调统一入口」，工作量 M → **L** | Architect |
| 5 | **回写 4 处「审批意见」承诺**（I3）：19§1.1、19§6.1、ADR§5统一为「深链跳转 + 能力隐藏」 | Architect |
| 6 | **ADR-022 状态字段与正文修订**（S7）：状态从「提议中」改为「已采纳（Phase A 定稿）」；§3正文的「仅串行」「串行 `freeReplaceNode`」直接改为「放开多人、不承诺会签语义 + 槽位数硬约束」，不要只写在文末 | Architect |
| 7 | **`draft_mode` 分支上移到 §4 步骤 3**，DDL 默认值改 `DIRECT_SEND`，`draft_flag` 按 mode赋值（I1） | Architect |
| 8 | **20§8 共享约定增 2 条**：①禁止代替真人调用 `addNode`/`finish`/`submit`（§4.4）；②`external_case_id`/`external_process_id`/`ext_affair_id`/`initiator_ref` 四列 Java侧必须 `String`（Q3） | Architect |

### 7.2 开工前必须拿到（Gate 级）

| Gate | 内容 | 现状 |
|------|------|------|
| **Gate-1** | A0 产出外部模板槽位 `activityId` 清单（C-3） | 已有 ✅，但产出物应改为文档而非直接落库（A0 依赖的列由 A1 才建，I8） |
| **Gate-1（新增）** | **C-6 流程状态枚举** —— 建议从Phase E 提前到 Phase B 之前（I2）。理由：状态映射是联动链路地基，且它是**唯一**能防住「合法枚举值映射错→终止单据被判通过→后置任务错误执行」的防线 |
| **Gate-1（新增）** | **EMBED_URL 跨站 iframe 鉴权可行性**（I5）—— 若不可行，EMBED_URL 模式 P0 应直接降级为 P1，不要让 B5 任务（工作量 L）建在一个未验证的前提上 |

### 7.3 Phase A 可立即并行开工（不受本次审查结论影响）

- **A1（V153迁移）** 可开工，但须补 B1 的前置断言 SQL 与 Q1 的存量 EXTERNAL 行断言
- **A2（V154迁移）** 可开工，但须补 B4 的 `ext_terminal_event` 表、I6 的 `embed_token` 谓词修正、I5 的 CSP/吊销字段、B3 的 `ABANDONED`
- **A0（甲方前置）** 与 A1/A2 并行，纯协调工作

### 7.4 关于测试（QA 侧承诺）

B2/B6 修复后，我会补以下回归用例，**防止修复 LOCAL 现有行为时踩坏 LOCAL**：

| 用例 | 期望 |
|------|------|
| `LOCAL` + `REJECTED` 单据 → 编辑保存 | 成功，状态转 `SAVED`（**现状行为，必须不变**） |
| `EXTERNAL` + `REJECTED` 单据 → 编辑保存 | `VALIDATION_ERROR`，状态保持 `REJECTED` |
| `EXTERNAL` + `APPROVED` 单据 → 编辑保存 | `VALIDATION_ERROR`（现状已支持，补测） |
| 并发 2 线程对同一 `form_record` 提交外部发起 | 恰好 1 次外部 `start`；另一方业务错误（非 500） |
| 同一 `external_case_id` + `COMPLETED` 重复投递（轮询 + 回调各一次） | `biz_execution_task` 只有 1 条 `FINALIZE_BIZ` |
| `ext_process_instance` 置 `ABANDONED` 后再次提交同一 `form_record` | 成功（唯一索引已释放） |
| 外部系统返回未识别状态码 | 不落库 + 告警 + `ext_status` 不变；连续 3 次后进入退避 |
| 外部先 `TERMINATED` 后被误配成 `COMPLETED` | **终态单调性拦截**：不覆盖、不触发后置任务 |
| `embed_token` 软删后被另一表单复用 | **应失败**（唯一索引不含 `deleted=0`） |

---

## 8. 总体评价

**架构师的技术判断本身是可靠的**，我逐条复核未发现事实性错误，三处最关键的修正我都独立验证成立：

1. **`freeReplaceNode` 是「替换」不是「追加」** —— 我用官方原文复核（`activityId` = 「需要替换的节点ID」、描述为「替换流程节点，新建自由协同和处理流程时的流程编辑都调用这个方法」），**修正正确且是本次审查最有价值的发现**。若没这个修正，整个 Phase B 会建在错误模型上。
2. **证据分级（✅确证/🟡推断/🔴未知）制度** —— 这是本方案最值得称道的部分，明确写了「🔴 未知 → 禁止编码，只留契约占位」。请**保持**这个标准。
3. **`addNode` 未被误用为追加路径** —— 架构师把它放进能力表但没声称它能绕开槽位，**判断是对的**（虽然没给出像我§4 那样的证据链）。

**主要缺陷不在技术判断，而在「文档与仓库现状的对齐」**。方案花了 441+607 行做外部世界的核实，但对本地仓库的现状核验只有 19§8.3 的 3 行stub，且其中一条（`supported_form_codes`）在 V149 已经清空列的前提下写了句不准确的话。这导致 6 个阻断问题里有 4 个（B1/B2/B3/B5）是「读代码 10 分钟就能发现」的类型。

**建议**：不必重写方案。按 §7.1 做 8 条定点补丁 + §7.2 拿 3 个 Gate 结论，即可开工。

---

*本报告仅新增 `21-external-workflow-review.md` 一个文件，未修改 19/20 号文档、ADR-022 及任何 Java/TS/SQL 源码。*