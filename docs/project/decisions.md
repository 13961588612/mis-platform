# 全局决策记录

> 状态：✅ 已确认（2026-06-23 持续更新，2026-07-21 Sprint 2 服务边界）| 变更请同步 ADR 与 schema 文档

## 1. 产品与范围

| 项 | 决策 |
|----|------|
| Phase 1 数据库 | 单库 `mis_platform`（ADR-001） |
| Phase 1 功能 | F1/F2 不做；F3/F4/F5/F6 做（改密、个人中心、**多 Tab**、**AI 占位**）；**门户九宫格 + APP 切换**（仅 `system` 可进，其它占位） |
| 流程引擎 | Phase 2 Flowable |
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

## 5.2 表单外部工作流（2026-10-16）

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
