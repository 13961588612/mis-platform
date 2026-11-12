# 表单 · 流程（工作流）— 产品与架构决策纪要

| 项 | 内容 |
|----|------|
| 状态 | ✅ 已落地基线（以代码 + Flyway 为准；文档冲突时以实现为准） |
| 日期 | 架构包 2026-09～10；表单分类拆表 V133；本纪要整理 2026-10-14 |
| 权威上游 | [msg-log-workflow/12-complete-design.md](../architecture/msg-log-workflow/12-complete-design.md)（收件箱/待办真相源）、[msg-log-workflow/README.md](../architecture/msg-log-workflow/README.md)、[form-category-split-design.md](../design/form-category-split-design.md)、[05-standard-form-development-guide.md](../architecture/msg-log-workflow/05-standard-form-development-guide.md)、[04-flow-designer-design.md](../architecture/msg-log-workflow/04-flow-designer-design.md) |
| 模块 | `mis-taskflow`（流程/表单/消息/任务）、`mis-admin-web`（设计器 / ProcessShell / 表单管理） |

> 本文是**决策摘要**。细则、接口与任务仍以上游设计为准。  
> ⚠️ `09-unified-inbox-plan.md` **已作废**；`06-*.md` 无 `-v4` 后缀的旧版视为废弃。  
> 门户待办/消息中心产品决策见 [decisions-portal-todo-message.md](decisions-portal-todo-message.md)。

---

## 1. 引擎与模块边界

| 决策 | 结论 |
|------|------|
| 流程引擎 | **自研轻量引擎**，落在 **`mis-taskflow`**（表 `wf_*`），**不是** Phase 1 全局决策里写的「上 Flowable」——该条已过时，以本纪要为准 |
| 表单注册 | 同在 `mis-taskflow`：`form_definition` + `form_category`；BFF 透传 `/api/v1/**` |
| 与 Java 业务库 | 单库 `mis_platform`；Flyway 只追加 |
| 与 Agent | AI 填单等走 ai-platform；**不**与 `sys_task` / `wf_*` 合流为同一套审批真相源 |

---

## 2. 待办 vs 流程任务（真相源）

根因裁定（12-complete-design **A1/A3/D1/D2**）：

| 实体 | 角色 |
|------|------|
| **`sys_task`** | **用户视角待办**的唯一真相源（列表、角标、对外动作） |
| **`wf_task`** | **流程引擎推进状态机**，**独立流转** `status`；支撑会签/或签；**不**对外当独立待办列表 |
| 关系 | 0..1 : 1（有流程节点时 `wf_task.sys_task_id → sys_task`）；业务也可只建 `sys_task` 无 `wf_task` |
| 关联 | 实例线索提升为一等列（如 `sys_task.wf_instance_id`），**禁止**仅靠 `metadata` JSON 藏 `wfInstanceId` 当长期方案 |

**明确否决**：

- ❌ 把 `wf_task` 降级为「身份表」、状态一律由 `sys_task` 单向驱动（会签/或签会卡死）
- ❌ 让 `TaskService` 反向注入 `ProcessService` 统一 handle（Spring Boot 3.2+ 循环依赖，启动失败）
- ✅ 动作出口用**门面**（如 `InboxActionService`）调度：`门面 → ProcessService + TaskService`，单向无环

**`REJECT` 语义**：终止整个流程实例并通知发起人；**不是**「退回发起人重填」（退回本轮不做，见门户决策 D-10）。

---

## 3. 表单与流程的绑定（V149）

| 决策 | 结论 |
|------|------|
| 真相源 | **`form_definition`**：`workflow_binding_type` + 对应字段（`wf_definition.supported_form_codes` **软废弃**） |
| 三种形态 | **NONE** 纯表单 · **LOCAL** 关联一个本地 `wf_definition` · **EXTERNAL** 关联一个外部工作流（系统编码 + 流程标识；运行时对接后续） |
| 基数 | 一个表单只能选一种形态；LOCAL 时多个表单可挂同一本地流程 |
| 写入口 | **一律在表单注册**（创建/编辑） |
| 流程侧 | 仅 **反查 / 查看关联表单**（DTO `supportedFormCodes` 为投影）；编排保存不改关联 |
| 发起校验 | 启动本地流程时：表单须 **ENABLED** 且 **LOCAL 绑定到该定义** |
| 运行时加载 | 实例上的 `started_form_code` 决定加载哪个表单组件 |

---

## 4. 表单模型（分类 vs 表单）

演进结论（**以 V133 / form-category-split 为准**，覆盖早期「单表 parent_id 双用」方案）：

| 决策 | 结论 |
|------|------|
| 目标模型 | **`form_category`（分类树）** + **`form_definition.category_id`（软引用）** |
| 语义 | 分类是表单的**属性**，不再是表单的**父级** |
| 分类树 | 邻接表 `parent_id`（`0`=根），可任意深度；镜像已跑通的 `wf_category` 范式 |
| 未分类 | `category_id` 允许 **NULL**；UI 显示「未分类」；**不**强制 seed「未分类」桶 |
| 旧列 | `form_definition.parent_id` / `kind`：**保留列、代码停读写**（不 DROP，保迁移验收测试） |
| `/tree` | 表单树端点语义取消；对应 `sys_api` 可休眠保留，避免破坏幂等测试计数 |
| 列表过滤 | `GET .../form-definitions?categoryId=`（query，不改 path 登记） |

菜单：表单管理挂**系统管理**下，与「流程中心」平级（表单是跨流程公共资产）。

---

## 5. 前端：ProcessShell 与设计器

| 决策 | 结论 |
|------|------|
| **ProcessShell** | 流程外壳接管审批态；表单组件只负责数据渲染 |
| 按钮 | 同意/驳回/转办等由外壳按节点与权限注入，**不写死在表单内** |
| 进度 | 顶部进度条基于 `wf_history` |
| 只读态 | 审批视图用「组件映射替换」等方案保持视觉一致、交互只读 |
| **流程设计器** | 基于 **@xyflow/react** 的可视化编排（BPMN 风格画布），非 Flowable Modeler |
| 全屏 | 编排器以全屏 Dialog / 专用壳承载（见 17 / designer 实现） |

标准化表单开发 SOP：见 `05-standard-form-development-guide.md`（一个 `formCode` 一个组件文件、注册表挂载）。

---

## 6. 消息与流程（交叉）

| 决策 | 结论 |
|------|------|
| 桥接 | **不**再引入已废弃的 `sys_biz_reference`；消息侧用可定位实例的字段（如 `instance_id` / `reference_task_id`） |
| 发通知 | 流程完成/驳回等通知须带上实例/任务线索，避免收件箱「无上下文」 |
| 门户回复 | 回复 = 写 `wf_history`（审批意见）；详见 [decisions-portal-todo-message.md](decisions-portal-todo-message.md) |

实时推送：**WebSocket 判死**；可见性用轮询 → SSE（12-complete **A6**）。文档中旧 WebSocket 承诺以代码为准。

---

## 7. 可靠性（流程后置）

设计基线（综合架构 / 实现按代码核对）：

| 机制 | 用途 |
|------|------|
| Outbox / 本地任务表 | 审批结束等动作先落库再异步执行，防丢指令 |
| 分布式锁表 | 替代内存锁，防并发双执行 |
| 失败重试 / 人工兜底 | `post_process_status` 等监控与重试（执行监控能力） |

---

## 8. 与全局 `decisions.md` 的差异说明

| 旧表述（decisions.md §1） | 现行结论 |
|---------------------------|----------|
| 「流程引擎 Phase 2 Flowable」 | **已改为自研 `mis-taskflow`**；Flowable 若再引入须另开 ADR，不默认回退本文 |

---

## 9. 文档与代码入口

| 类型 | 路径 |
|------|------|
| 有效设计基线（收件箱/待办） | `docs/architecture/msg-log-workflow/12-complete-design.md` |
| 目录总览 | `docs/architecture/msg-log-workflow/README.md` |
| 表单分类拆表 | `docs/design/form-category-split-design.md` + `V133__form_category_split.sql` |
| 表单开发 SOP | `docs/architecture/msg-log-workflow/05-standard-form-development-guide.md` |
| 流程设计器 | `docs/architecture/msg-log-workflow/04-flow-designer-design.md` |
| 后端 | `backend/mis-taskflow/` |
| 前端设计器 / 外壳 | `frontend/mis-admin-web/src/features/system/workflow-designer/`、`features/taskflow/` |
| 全局索引 | [decisions.md](decisions.md) §5.3 |
