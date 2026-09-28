# MIS 平台对接 WrenAI 问数 APP — 规划中心

> 状态：🔴 规划完成 + 已按版本调研修订（MCP-first / 钉 wren-core 新线 `wren: v0.13.3` · 项目 `0.29.2` 2026-08-18）+ **v1.9 三处重大修订落盘（2026-08-22，主理人记录）：① A1 业务改判——落库改道：表级 ACL 等问数配置**不落 ai_platform，改落 `mis_platform` 库**（对齐 mis_kb 项目范式），项目名 **`mis-iqd`**、表前缀 **`iqd_`**（替代 `wren_*`），Java 侧 **`backend/mis-iqd`** 管理，Worker 经配置读取 API + 缓存消费（不直连库）；ADR-019 标记已替代、新增 **ADR-020** 固化新决策；② **命名统一**：项目/表/API/权限码/模块全部收敛 `iqd`，**对接外部 WrenAI 产品的适配层保留 wren**（命名边界见 architecture.md §1.5/§3.3）；③ **维度注册表提前一期 + 双维度一期**：`iqd_row_scope_dimension` 从二期 P2 提为**一期必做**、部门不再特例，一期同时支持「部门权限 + 门店权限」两个维度（§4.2.2 D.8/D.9）** + **v1.8 A1/A5 拍板 + 行级权限放置/扩展设计落盘（2026-08-22：A1 当时确认——表级 ACL 等 `wren_*` 问数配置落 `ai_platform` 库（v1.9 已业务改判，见上）；A5 已确认——列级隔离本期不做、预留后期方案；新增 architecture.md §4.2.2 D.7 行级权限数据三层放置 + 使用链路、D.8 行级维度扩展设计）** + **v1.7 A13 拍板 + 配置模型澄清落盘（2026-08-22：A13 三答已确认——① 业务库部门编码与 mis_org 不统一主数据→需要映射；② 业务库与 mis_platform 非同一实例→物化表（视图不可行）；③ 多数据源每库一张 + 集中定义从中心每日同步到各库；编码对齐决策 X（映射内嵌字典表）定案；新增「配置面 vs 数据面」澄清：权限配置平台统一一处、不存在逐库配置权限；中心每日同步任务细化）** + **v1.5 A12 拍板落盘（2026-08-22：**物化 `dept_path`，`PATH_PREFIX` 为唯一主路径，`CLOSURE_CTE` 不实现**，注入策略精简为 PATH_PREFIX/ENUM/FAIL_CLOSED，`X-Mis-Dept-Scope` 头携带锚点 path）** + **v1.6 部门权限字典表方案落盘（2026-08-22：2a 由「JOIN `sys_dept`」修订为「JOIN/EXISTS 业务库本地 `mis_dept_scope` 字典表/视图」——同实例视图 / 跨实例物化表+幂等同步 / 每库一张 / 编码对齐 A13 待确认）**，待 W0 MCP 工具面实测后进入实现。  
> 日期：2026-08-22｜语言：中文

本目录承载「基于 MIS 平台、自研对接 WrenAI 的问数 APP」全部规划文档。

## 文档导航

> 目录内共 26 篇文档 + 12 张 mermaid 图，按「规划 / 一期 / 二期 / 多连接 / 真机事实」分组，便于按阶段进入。

### 规划四件套（v1.9，需求–架构–任务–部署）

| 文档 | 角色 | 关键内容 |
|---|---|---|
| [prd.md](prd.md) | 产品需求 PRD | 需求 R1–R8：后台自研对接、agent 桥接、可对接清单、权限双闸门、样本/知识增强、后台测试对话、前端引用、执行计划分层；含 P0/P1/P2 与 Q1–Q10 |
| [architecture.md](architecture.md) | 系统架构设计 | 架构结论、D1–D7 难点对策、`iqd_*` 表结构、行级数据范围（RLS）设计细节、三端 DTO 契约、时序图、待明确 A1–A13 |
| [tasks.md](tasks.md) | 任务分解（施工清单） | 按 W0–W4 阶段编排（含规模探针与实测项） |
| [deploy-iqd.md](deploy-iqd.md) | 部署速查（规划版） | 版本钉位、`pip install wrenai` + `wren serve mcp` 初始化、MCP 工具面、官方安全约束 |
| [class-diagram.mermaid](class-diagram.mermaid) | 类图 | 抽取自 architecture.md §4.1 |
| [sequence-diagram.mermaid](sequence-diagram.mermaid) | 时序图集 | architecture.md §5.1–5.8（用户端问数 / 后台测试 / 配置同步 / 增强物料 / 范围授权 …） |
| [baseline-execution.md](baseline-execution.md) | 施工基线 | 把规划四件套与仓库代码现状对齐，输出「可复用 / 需新建 / 需修改」三态结论 |

### 一期：闭环补全与联调

| 文档 | 角色 | 关键内容 |
|---|---|---|
| [mis-iqd-closure-prd.md](mis-iqd-closure-prd.md) | 闭环补全 PRD | 一期实现 + 二期前向设计的简单 PRD |
| [mis-iqd-closure-system-design.md](mis-iqd-closure-system-design.md) | 闭环系统设计 | 架构设计 + 任务分解；配套 [mis-iqd-closure-class.mermaid](mis-iqd-closure-class.mermaid) / [mis-iqd-closure-sequence.mermaid](mis-iqd-closure-sequence.mermaid) |
| [a2ui-integration-checklist.md](a2ui-integration-checklist.md) | A2UI 联调清单 | A2UI 通道端到端联调（聚焦 mis-iqd 问数） |

### 二期：语义模型编辑 / 建模台 / 自愈 / 对话增强

| 文档 | 角色 | 关键内容 |
|---|---|---|
| [mis-iqd-edit-prd.md](mis-iqd-edit-prd.md) | 编辑增量 PRD | 平台侧编辑 tables/relations/cubes/views 并写回 WrenAI MDL |
| [mis-iqd-edit-architecture-review.md](mis-iqd-edit-architecture-review.md) | 编辑架构评审 | 单边风险分析；配套 [mis-iqd-edit-class.mermaid](mis-iqd-edit-class.mermaid) / [mis-iqd-edit-sequence.mermaid](mis-iqd-edit-sequence.mermaid) |
| [mis-iqd-edit-design.md](mis-iqd-edit-design.md) | 编辑增量设计 | 编辑闭环设计；配套 [mis-iqd-edit-design-class.mermaid](mis-iqd-edit-design-class.mermaid) / [mis-iqd-edit-design-sequence.mermaid](mis-iqd-edit-design-sequence.mermaid) |
| [mis-iqd-modeling-prd.md](mis-iqd-modeling-prd.md) | 建模台增量 PRD | 可视化建模台（经典 wren-ui 全量内嵌）；含待拍板 Q1–Q8 |
| [mis-iqd-modeling-system-design.md](mis-iqd-modeling-system-design.md) | 建模台系统设计 | 已拍板 + 已实现并回写；配套 [mis-iqd-modeling-class.mermaid](mis-iqd-modeling-class.mermaid) / [mis-iqd-modeling-sequence.mermaid](mis-iqd-modeling-sequence.mermaid) |
| [mis-iqd-modeling-tasks.md](mis-iqd-modeling-tasks.md) | 建模台任务分解 | 已全部实现（2026-09-22） |
| [mis-iqd-selfheal-prd.md](mis-iqd-selfheal-prd.md) | 自愈增量 PRD | 运维自愈三按钮需求 |
| [mis-iqd-selfheal-design.md](mis-iqd-selfheal-design.md) | 自愈增量设计 | 三按钮设计；配套 [mis-iqd-selfheal-design-class.mermaid](mis-iqd-selfheal-design-class.mermaid) / [mis-iqd-selfheal-design-sequence.mermaid](mis-iqd-selfheal-design-sequence.mermaid) |
| [design-feedback-enhance.md](design-feedback-enhance.md) | 对话增强增量设计 | 来源 / 评价 / 步骤耗时 / 智能体路由（方案 C 定稿） |
| [iqd-standalone-app-design.md](iqd-standalone-app-design.md) | 独立门户增量设计 | 问数从智能体子模块升级为一级应用（菜单 925xx，改 app_id） |

### 多连接对接与跨机器部署（方案 A）

| 文档 | 角色 | 关键内容 |
|---|---|---|
| [mis-iqd-mcp-multiconn-prd.md](mis-iqd-mcp-multiconn-prd.md) | 多连接增量 PRD | 多连接（多业务库）问数需求；方案 A 已拍板 |
| [mis-iqd-mcp-multiconn-design.md](mis-iqd-mcp-multiconn-design.md) | 多连接增量设计 | 方案 A 精炼版架构设计 |
| [mis-iqd-mcp-deploy-incremental.md](mis-iqd-mcp-deploy-incremental.md) | 部署层增量修订 | 方案 A × 跨机器事实（v0.2 决策锁定） |
| [wren-mcp-agent-deploy.md](wren-mcp-agent-deploy.md) | 跨机器部署 Runbook | WrenMcpAgent 控制面 9100 / 数据面 9101（落地版 v0.2） |
| [wrenai-w0-verify-checklist.md](wrenai-w0-verify-checklist.md) | W0 真机验证清单 | 跨机器部署逐项执行表（配合 ops runbook §2.2 W0-B） |

### 真机实测事实与运维手册

| 文档 | 角色 | 关键内容 |
|---|---|---|
| [wrenai-013-field-notes.md](wrenai-013-field-notes.md) | **WrenAI 0.13.3 真机实测笔记** | 真机踩坑全记录：① **真源 = YAML 工程，`target/mdl.json` 只是 `context build` 产物**（任何 build 都会覆盖它 → 只写产物是易失的）；② 读取方不一致（`context show` / `validate` / **MCP** 读 YAML；`cube list` / `cube query` 读 `target/mdl.json`）；③ 文件 schema：`models/*/metadata.yml`（**每列必填 type**，计算列需 type+expression）、`relationships.yml`（**必须 mapping**，`join_type` 是**基数枚举**不是 `INNER`）、**cube 唯一落点 `cubes/<name>/metadata.yml`**（`views/` 是 SQL 视图，必须有 statement）；④ 7 条错误原文与修法；⑤ 平台已落地的三件套镜像 + 耐久性实测。**升级 wren 版本后需逐条复测。** |
| [wrenai-ops-runbook.md](wrenai-ops-runbook.md) | 真机运营 Runbook | mis-iqd × WrenAI 真机联调与日常运维手册（含 W0-B） |
| [mis-iqd-modeling-runbook.md](mis-iqd-modeling-runbook.md) | 建模台运营 Runbook | 建模台日常运维与故障处置 |
| [mis-iqd-modeling-verify-checklist.md](mis-iqd-modeling-verify-checklist.md) | 建模台验收清单 | T05 集成验收 · 真机验证逐项执行表 |

## 关键架构结论（速览）

- **版本/部署**：已钉新 `wren`（wren-core）线 **`wren: v0.13.3`**（项目 `0.29.2`，2026-08-18），弃用经典三服务 Docker REST 栈假设；`pip install wrenai` + `wren serve mcp @127.0.0.1` 本机进程（数据不出域），平台仅对接。
- **桥接（MCP-first）**：新增 `mis-iqd` Python Worker 接入既有 `mis-copilot` Coordinator，**服务端本地持有 MCP client** 连本机 `wren serve mcp`（不分 REST/MCP 两期）；**前端/用户端绝不直连 MCP**（官方约束：localhost + 无 bearer-token + 默认只读）。
- **落库（v1.9 改判）**：连接配置/范围/ACL/样本/知识/审计统一落 **`mis_platform` 库**（对齐 mis_kb 范式，表前缀 `iqd_`，Java 侧 `backend/mis-iqd` 管理，Flyway `V71__iqd_schema.sql`）；**Worker 不直连库**，经配置读取 API（`/internal/v1/iqd/**`）+ 本地缓存 + 变更事件/定期刷新消费（缓存不可得 fail-closed 45204），BFF 对外经 `/api/v1/iqd/**` HTTP 读写；ADR-019 已替代、ADR-020 固化新决策。
- **权限（五件套）**：BFF `iqd:*` 功能码（L1）+ Worker 侧表级 ACL 二次裁定（fail-closed，**与版本无关**；**v1.9 A1 改判：表级 ACL 等 `iqd_*` 问数配置落 `mis_platform` 库，Java 侧 `backend/mis-iqd` 管理，Worker `IqdConfigClient` API+缓存消费，ADR-020 替代 ADR-019**）+ **行级数据范围（RLS 注入，A11 已确认本期 2026-08-22；v1.4 规模策略：`X-Mis-Dept-Scope` 锚点+范围语义 + 注入前 `resolve_inject_strategy` 规模分层；v1.5 A12 已确认：物化 `dept_path`、`PATH_PREFIX` 唯一主路径、`CLOSURE_CTE` 不实现、策略精简 PATH_PREFIX/ENUM/FAIL_CLOSED、头携带锚点 path；v1.6：2a JOIN 载体改为业务库本地 `mis_dept_scope` 部门权限字典表；v1.7 A13 已确认：`mis_dept_scope` 为物化表 + 中心每日同步（每日全量 upsert 幂等）+ 编码映射 X（dept_id=业务库编码 + mis_dept_id/dept_path=平台），**配置面 vs 数据面**：权限配置平台统一一处、不存在逐库配置权限；**v1.8：行级权限数据三层放置 + 使用链路见 architecture.md §4.2.2 D.7（平台侧=配置+裁定 / mis-org 侧=授权源头 / 业务库侧=数据载体），行级维度扩展设计见 D.8**；**v1.9：维度注册表一期必做（`iqd_row_scope_dimension` 种子 dept+store，`row_scope.type` 废弃改维度实例），双维度一期（部门 + 门店，一表可多维度 AND 叠加），BFF 头注入按维度注册表遍历（`X-Mis-Dept-Scope` + `X-Mis-Stores`），store 维度实例化（ENUM 扁平 + `user.store_ids` 行权 + `mis_store_scope`/复用主数据），Worker 配置消费改 API+缓存（D.7.3）**，见 architecture.md §4.2.2 D.6/D.7/D.8/D.9）** + 结果字段脱敏（唯一出口 `masking.py`，对齐 `03-security.md`；**v1.8 A5 已确认：列级隔离本期不做，预留列 ACL 扩展位见 §4.2.2 D.10**）+ 问数审计（`iqd_ask_log`）。核心场景：A 部门用户不能看 B 部门销售数据；A 门店用户不能看 B 门店数据（v1.9 双维度）。
- **引用/计划**：引用优先走新线原生 `get_context`/`list_knowledge`，`sqlglot` 血缘降级保留；归一化「引用来源」与「步骤化执行计划」；前端**不暴露原始 SQL**，后台可见全量含 SQL。

## 进入实现前的必拍板项

1. **A4+Q1（版本已钉，转 W0 实测）**：版本钉新线 `wren: v0.13.3`；W0 重点验证 `wren serve mcp` 工具面（`get_context`/`recall_queries`/`list_knowledge` 原生引用、只读 + localhost 无鉴权、`wren context build` 流程、凭证 server-side），据此定 `iqd_mcp_client.py` 工具常量；**v1.4 加规模探针（超大 IN 阈值 / 部门树规模与 path 现状）；v1.5：3b 方言矩阵降级为仅记录不阻塞、新增 3d `dept_path LIKE` 前缀实测；v1.6：3d 实测对象更新为 mis_dept_scope 形态、新增 3e 库边界与编码对齐盘点；v1.7：3e 库边界已确认（非同一实例），剩余聚焦「业务库 DEPTID 编码体系盘点 + 与 mis_org 的映射可行性」；v1.9：3e 新增门店维度盘点（门店主数据表/层级/编码映射/用户门店授权，支撑 store 维度实例化）**。
2. **A12（✅ 已确认 2026-08-22，主理人记录）：mis-org 物化 `dept_path`，`PATH_PREFIX` 为唯一主路径，`CLOSURE_CTE` 不实现。** 决策依据（成本/方言风险/零依赖）见 [architecture.md §8](architecture.md) A12 行；落地设计（列定义/维护/回填/2a vs 2b/头携带锚点 path）见 §4.2.2 D。**剩余执行确认**：mis-org DDL（V70）与 `DeptService` 维护逻辑由 T-W2-02a 实施；**v1.6 修订：字典表改为业务库本地 `mis_dept_scope` 注册进 WrenAI MDL 可见范围，`sys_dept` 不再直接进 WrenAI**；**v1.7（A13 已确认）：`mis_dept_scope` 为物化表 + 中心每日同步 + 映射（dept_id=业务库编码 + mis_dept_id/dept_path=平台，见 D.6）**——探针 3d 实测 mis_dept_scope 物化表形态的 JOIN/EXISTS，探针 3e 聚焦编码盘点与映射可行性。
3. **A13（✅ 已确认 2026-08-22，主理人记录）：部门编码对齐与字典表形态。** 三答：**① 业务库部门编码与 mis_org 不统一主数据（暂时无关）→ 需要映射；② 业务库与 mis_platform 非同一实例 → 物化表（视图不可行）；③ 多数据源每库一张 + 集中定义从中心每日同步到各库**。据此定案决策 **X（映射内嵌字典表）**（dept_id=业务库编码 + mis_dept_id/dept_path=平台，中心侧映射；推荐理由/映射来源/配置下拉数据源/工作量影响见 §4.2.2 D.6.3）；同步任务归属 ai-platform 定时作业（每日全量 upsert 幂等、失败告警 + 降级 45204）见 D.6.4；**配置面 vs 数据面：权限配置平台统一一处，不存在逐库配置权限**（D.6.6）。**剩余执行确认**：T-W0-01 探针 3e 聚焦编码盘点与映射可行性，T-W2-02a 落地物化表 + 中心日同步 + 映射维护。
4. **A1（✅ 已确认 2026-08-22，主理人记录，v1.8；✅ 业务改判 2026-08-22，v1.9）：表级 ACL 落库位置改道 `mis_platform`。** **v1.8 原裁定**：表级 ACL 等 `wren_*` 问数配置落 `ai_platform` 库（Python 侧统一管理，BFF 经 HTTP 读写，不新建 Java 领域服务），曾发 ADR-019 固化（`docs/adr/ADR-019-wren-query-acl-ai-platform.md`，已接受）。**v1.9 业务改判**：问数配置改落 **`mis_platform` 库**（对齐 mis_kb 范式），新建 Java 模块 **`backend/mis-iqd`** 统一管理，BFF 对外 `/api/v1/iqd/**`，Worker 经 `IqdConfigClient` 调 `/internal/v1/iqd/**` + 本地缓存消费（不直连库，fail-closed 45204）；**ADR-019 标记已替代，新增 ADR-020 固化新决策**（架构一致性依据见 architecture.md §8 A1）。
5. **A5（✅ 已确认 2026-08-22，主理人记录，v1.8）：列级隔离本期不做、预留后期方案。** 业务已书面接受「脱敏 ≠ 权限」；预留位点见 architecture.md §4.2.2 D.10（`column_acl` 数据位 / 脱敏与列 ACL 分层 / SQL 投影列裁剪注入位点），本期不建不启用；敏感表用「拆视图 + 表级 ACL」变通。

> **必拍板状态（v1.9）**：A1 已改判落 mis_platform（ADR-020）；**必拍板清单已清空**（A12/A13 此前已确认；维度注册表一期 + 双维度一期已确认）；剩余为 **W0 MCP 工具面实测（A4+Q1）**与执行期确认项（A2 运维同机部署、A3 wren-ui 随包、A6 S-07 读接口、A7 452xx 码段、A8 模拟角色、A9 多库、A10 网关 SSE）。

详见 [architecture.md §8](architecture.md) 待明确事项与 [prd.md §9](prd.md) 待确认问题。
