# 全局决策记录

> 状态：✅ 已确认（2026-06-23 持续更新，2026-07-21 Sprint 2 服务边界）| 变更请同步 ADR 与 schema 文档

## 1. 产品与范围

| 项 | 决策 |
|----|------|
| Phase 1 数据库 | 单库 `mis_platform`（ADR-001） |
| Phase 1 功能 | F1/F2 不做；F3/F4/F5/F6 做（改密、个人中心、**多 Tab**、**AI 占位**）；**门户九宫格 + APP 切换**（仅 `system` 可进，其它占位） |
| 流程引擎 | **自研 `mis-taskflow`（`wf_*`）**；早期「Phase 2 Flowable」作废，详见 §5.3 |
| UI 语言 | 默认中文，i18n 预留 |
| 生产部署 | Kubernetes |
| LLM | Phase 3 |

## 2. 安全与权限

| 项 | 决策 |
|----|------|
| 认证 | JWT + Refresh Cookie；**mis-auth 独立服务** |
| superadmin | `sys_platform_user`，管理全租户 |
| 租户 admin | 每租户 `admin`，`is_tenant_admin=1`，**不可删自己** |
| 内置角色 | 仅 `TENANT_ADMIN`；`DEPT_MANAGER` 等后期自建 |
| 权限通配符 | **不支持** |
| 默认密码 | `Mis@123456`；**首次登录强制改密** |
| 测试账号 | Phase 1 **不预置** |
| 权限存储 / API 鉴权 | ADR-009/011/012；PDP = **mis-iam**（ADR-008 / ADR-016） |

## 3. 组织与岗位

| 项 | 决策 |
|----|------|
| 部门 | `sys_dept` + `sys_dept_category`（ADR-013） |
| 岗位 | `sys_post_type` + `sys_post` + `sys_employee_post`（ADR-014） |
| 兼职 | 员工可多岗任职 |

## 4. 工程栈

| 项 | 决策 |
|----|------|
| Java | Maven 多模块 |
| 服务边界 | **mis-auth**（认证）与 **mis-iam**（身份+权限）**分开**；**不**再拆 mis-user / mis-rbac |
| 组织人事 | **mis-org**（组织/部门/员工/岗位）；员工不进 mis-iam |
| 服务间 HTTP | BFF WebClient；领域 RestClient；**内部直连**（不经 Gateway） |
| 缓存 | Redis 单级（ADR-006） |
| 持久层 | **Spring Data JPA**（ADR-015） |
| Flyway | `mis-migrator` |
| SonarQube | Phase 1 **不接入** |
| 本地开发 | **Docker Compose 基础设施 + IDE 直跑** 应用服务（双模式） |

## 5. 财务辅助 / 遗留对接（2026-09-09）

| 项 | 决策 |
|----|------|
| POS 对账迁入 | React 重写进 host；路径 `/finance/bank-account/pos-account/*`；菜单：财务辅助→银行账目→POS对账（ADR-021） |
| 下游 | 仍调 `bip-bank-receipt`；浏览器不直连旧网关；BFF 反代 + `sys_api` 鉴权 |
| 老令牌 | BFF 经共享 `SmpTokenExchangeService`（`mis.bff.smp`）兑令牌；头默认 `HC-SMP-Authorization`；令牌不下发浏览器 |

## 5.1 问数样本对分类（2026-10-13）

| 项 | 决策 |
|----|------|
| 入口 | 问数 App → 知识与规则 → 样本对 Tab（`/iqd/enhance?tab=sqlpair`）；分类管理内嵌该 Tab，不另开菜单 |
| 作用域 | **按连接（项目）一棵树**（`iqd_sql_pair_category.connection_id`）；不与 `biz_category` / `kb_category` 复用表 |
| 挂载 | `iqd_sql_pair.category_id` 可空软引用；「未分类」为 UI 虚拟节点（`category_id IS NULL`） |
| 运行时 | **不改变** Wren sync / Worker few-shot 注入范围（仍按连接全量拉取） |
| 删分类 | 有子节点或有样本挂载时拒绝 |

## 5.2 门户 · 待办事项 · 消息中心（2026-10-10；消息抽屉口径 2026-10-14 修订）

| 项 | 决策 |
|----|------|
| 定位 | `/portal` 为个人工作聚合台：三 Tab「首页 / 待办事项 / 消息中心」；详情用右侧抽屉，不整页跳转离开门户壳 |
| 左栏 | **仅门户**隐藏 sidebar；其它子系统保留 |
| 待办 | 六类子 Tab 字面独立 + 各 Tab 内搜索；增量「全部」= 服务端 UNION 分页（禁前端拼页） |
| 消息 | 四类 `APPROVAL/NOTIFY/REMIND/SYSTEM_ALERT`；「通过」= `NOTIFY`；搜索按子 Tab `msgType` 作用域 |
| 关联 | 消息须能关联流程实例（`instance_id`；缺省可由 `reference_task_id → wf_task` 反查） |
| 消息抽屉 | 有关联流程 → 嵌入 **ProcessShell(embedded)**：当前审批人可立即同意/驳回（意见=审批栏 comment），否则只读；**关闭独立「回复」入口**（`canReply` 恒 false）。无关联流程 → 仅正文 |
| 抽屉动作 | 同意 / 驳回 / 转办；**不做**退回发起人；驳回=终止实例 |
| 旧页 | `/task/pending|inbox|my-sent|my-processed` 保留共存 |

**全文纪要**：[decisions-portal-todo-message.md](decisions-portal-todo-message.md)  
**PRD / 设计**：`docs/prd/portal-restructure-prd.md`、`docs/design/portal-restructure-design.md`、`docs/design/portal-matters-aggregation-design.md`

## 5.3 表单 · 流程 / 工作流（2026-10-14）

| 项 | 决策 |
|----|------|
| 引擎 | 自研轻量引擎在 **`mis-taskflow`**；表单同模块（`form_definition` + `form_category`） |
| 真相源 | **`sys_task`** = 用户待办；**`wf_task`** = 引擎状态机（会签/或签），二者独立流转；门面调度，禁止 Task↔Process 循环依赖 |
| 绑定 | 真相源在 **`form_definition`（NONE/LOCAL/EXTERNAL）**；流程侧只读反查；`supported_form_codes` 软废弃（V149） |
| 表单分类 | **`form_category` + `category_id` 软引用**（V133）；旧 `parent_id`/`kind` 停写不 DROP |
| 前端 | **ProcessShell** 管审批动作；表单只渲数据；设计器 **@xyflow/react** |
| 驳回 | 终止实例（非退回发起人）；实时推送不以 WebSocket 为准 |

**全文纪要**：[decisions-form-workflow.md](decisions-form-workflow.md)  
**权威上游**：`docs/architecture/msg-log-workflow/12-complete-design.md`、`docs/design/form-category-split-design.md`

## 5.4 表单外部工作流（2026-10-16）

| 项 | 决策 |
|----|------|
| 绑定模型 | `workflow_runtime` = NONE / LOCAL / EXTERNAL；EXTERNAL 时本地流程定义仅作**节点蓝图**，审批在外部跑（ADR-022，提议中） |
| P0 外部系统 | 致远 Seeyon A8+ 集团版 V9 |
| 注入形态 | FORM_JSON / RICH_HTML / EMBED_URL（表单级三选一）；P0 无附件 |
| 发起人 | 预解析为外部账号并作为外部流程发起人写入，使其在外部「已发」中可直接打开；解析失败禁止提交 |
| 双待办 | **已定**：EXTERNAL **完全取消**本地待办，不写 `sys_task`，不进本地收件箱待办 |
| 外部驳回 | **已定**：`form_record=REJECTED` 终态，不回 `SAVED`，本单不可再提；终止/撤销不记成驳回 |
| 发起时机 | **已定**：保存只落本地；发起人点「提交」才走外部发起序列（预解析→start→拼节点→activate） |
| 抄送缺人 | **已定**：警告可提交；审批缺人 / 发起人缺号禁止 |
| 规划全文 | [`docs/architecture/msg-log-workflow/19-external-workflow-integration-plan.md`](../architecture/msg-log-workflow/19-external-workflow-integration-plan.md) |
| 相对 V149 | 演进互斥 CHECK：EXTERNAL 可同时持有蓝图 `workflow_definition_id` 与外部模板字段（追加迁移，不改已发布脚本） |


## 6. 待定

| 项 | 状态 |
|----|------|
| 团队分工 | 待定 |
| 致远离开开始节点 / 发起人指定方式 / 会签 | **待架构**对照致远 A8+ V9 文档核实，见规划 §10.1 |

## 7. Schema 状态

**SQL 已生成并持续追加** — `docs/db/migrations/`：

| 版本 | 说明 |
|------|------|
| V1 / V2 | 建表 + 种子 |
| V3 | `sys_module` → mis-iam / mis-org |
| V4 | API path 对齐 |
| V5 | `sys_app` 门户字段（kind/runtime/description/portal_group）+ 占位 APP |

执行：`cd backend && .\mvn.ps1 -pl mis-migrator flyway:migrate`
