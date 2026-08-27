# 增量 PRD：mis-iqd 多连接对接 WrenAI MCP（方案 A 精炼版）

> 文档角色：mis-iqd 集成 WrenAI 的**「多连接（多业务库）问数」增量 PRD**，作为 `wren_mcp_registry.py`（进程管理器）与相关改造的需求输入。方案 A 已拍板，本文只描述**相对现有单端点设计新增/变更了什么**，不重写已落地能力。
> 状态：🔶 草案（待主理人/架构师拍板 Open Questions）｜日期：2026-08-29｜语言：中文
> 关联：架构 `mis-iqd-mcp-multiconn-design.md`（v0.1，高见远）；现状基线 `baseline-execution.md`；运维自愈 `mis-iqd-selfheal-prd.md`（⚠️ 需随本增量重定范围，见 §6）；`wrenai-ops-runbook.md` §2.3。

---

## 0. 增量触发背景（仅讲变更动机）

- **已落地（不重写）**：`AskOrchestrator.ask` 链路 `get_context → dry_plan(问题→SQL) → 注入行级范围 → 血缘断言(fail-closed) → dry_run → run_sql`；查询通道 `iqd_mcp_client.py` 连 Nacos 中**单一** `wren.mcp-host:mcp-port`（127.0.0.1:8080），调 `dry_plan`/`dry_run`/`run_sql`/`get_context`；管理面 `iqd_cli.py` 天然多库。
- **硬约束（已核实）**：`wren serve mcp` **一进程 = 一 project = 一业务库**，启动即绑定 MDL + 单一 profile，运行期不可切换；HTTP 默认 127.0.0.1、无 bearer-token。
- **冲突**：「多 IQD 连接共用单一 MCP 端点」与 wren 单进程单库约束矛盾。
- **本次增量（方案 A 精炼版，已拍板）**：每连接拉起独立 `wren serve mcp` 进程（独立端口 + 绑定该连接 project 目录）+ 新增进程管理器 `wren_mcp_registry.py`（端口分配/启停/健康/崩溃重启）；`iqd_mcp_client` 改为按 `connId` 路由；MDL 同步按连接异步触发（build + memory index，就绪门禁）；凭证经 `${ENV}` 注入不落盘。

---

## 1. 增量产品目标

> **一句话**：让平台能为**每个 IQD 连接（每个业务库）独立拉起、回收、监控其 WrenAI 问数服务（MCP 进程）**，在遵守 wren「一进程一库」硬约束的前提下，支撑**多业务库隔离问数**，且进程生命周期与凭证安全对运维透明可控。

---

## 2. 增量用户故事（运维 / 平台管理员视角）

- **US1**：作为平台管理员，我希望为**每个 IQD 连接独立拉起/停止其 WrenAI 问数服务（MCP 进程）**，以便多个业务库各自隔离问数、互不干扰。
- **US2**：作为平台管理员，我希望**连接被禁用/删除时自动回收其 MCP 进程与端口**，以便不残留僵尸进程、不泄漏端口段。
- **US3**：作为运维，我希望在连接管理页**看到每个连接的 MCP 进程状态、监听端口、最近健康检测时间**，以便在问数异常时快速定位是哪个连接的进程挂了。
- **US4**：作为平台，我希望**语义模型保存后按连接异步重建 MDL，并在就绪后才拉起该连接的 MCP 进程（就绪门禁）**，以便问数请求永远打到已就绪的语义上下文、不会出现「问到一半 project 未编译」。

---

## 3. 需求池（P0 / P1 / P2，仅增量部分）

> 优先级：P0 = 本期必须（多连接问数可用的最小闭环）；P1 = 应做（可观测 + 启动集成 + 门禁，运维完备性）；P2 = 二期增强。每条含可测验收口径。

### 3.1 P0 — 多连接问数最小闭环

| 编号 | 需求（增量） | 验收标准（可测） |
|---|---|---|
| REQ-P0-1 | **每连接 MCP 进程生命周期管理**：`wren_mcp_registry.py`（WrenMcpProcessManager）支持按连接 `start`/`stop`，并对崩溃进程**自动重启**。 | ① 手动 `stop` 后进程退出、端口标记回收；② 进程被 `kill -9` 后，健康检查循环在 **≤ 配置间隔（默认 30s）** 内自动重新拉起，新 pid ≠ 旧 pid；③ 重启过程对进行中问数请求不静默成功（不可达时 orchestrator 走既有 mock 降级）。 |
| REQ-P0-2 | **端口分配与回收**：从配置端口段按连接分配独立端口，连接禁用/删除时回收并复用。 | ① 连接 A、B 拉起获得**不同**端口；② 删除连接 A 后其端口回到可用池，新建连接 C 可复用且无端口冲突；③ 端口段用尽时有明确报错而非越界绑定。 |
| REQ-P0-3 | **按 `connId` 路由**：`iqd_mcp_client` 由「取全局单值」改为按 `connection_id` 从 registry 取 `{host:127.0.0.1, port}` 构造 client。 | ① 问数请求带 `connId=A` 打到 A 的端口、带 `connId=B` 打到 B 的端口；② 传入不存在/已停的 `connId` 返回**明确错误**（不静默落到默认 8080 端点）；③ 编排器其余链路（注入/血缘/dry_run/run_sql）不变。 |
| REQ-P0-4 | **MDL 同步按连接触发**：语义模型/物料保存按 `connection_id` 异步触发 `context build` + `memory index`，写入 `iqd_sync_job`（connection_id 维度）状态机 `pending→running→success/failed`。 | ① 在连接 A 保存语义模型**仅触发 A 的 build/index**，连接 B 的 sync-job 不受影响；② 状态机正确流转并在 `sync_coalesce_window_sec` 内合并多次保存；③ 自动重试 ≤3 次（指数退避），超限置 `failed` 并置 `staleDrift`。 |
| REQ-P0-5 | **凭证注入不落盘**：`wren serve mcp` 启动时经 `${ENV}` 占位注入凭证（从 `secretRef` 解出明文注入进程环境变量，或 `--from-file` 临时文件 `chmod 600` 用后即删）。 | ① `profiles.yml` 仅存 `host/port/user/${DB_PWD}`，磁盘**无明文**；② 进程环境变量含明文但不在平台库/前端出现；③ `--from-file` 路径无论成败均 `os.remove` 删除，删除失败告警。 |

### 3.2 P1 — 启动集成、可观测、就绪门禁

| 编号 | 需求（增量） | 验收标准（可测） |
|---|---|---|
| REQ-P1-1 | **启动集成**：Worker 启动对全部 `enabled` 连接批量拉起 MCP 进程，并启动后台健康检查循环。 | ① Worker 重启后，所有 `enabled` 连接 MCP 自动恢复 `running`；② 健康检查按固定间隔（默认 30s）轮询各端点，失败计数达阈值置 `unhealthy` 并触发重启；③ 健康检查不阻塞问数主链路。 |
| REQ-P1-2 | **可观测**：`IqdConnection` 持久化 `mcpPort`/`mcpStatus`（及 `lastHealthAt`/`lastHealthMsg`），并提供查询端点/状态回流。 | ① `GET /iqd/connections/{id}` 或等价接口返回该连接 `mcp_status`（running/stopped/starting/crashed/unhealthy）、`mcp_port`、`last_health_at`；② 前端/runbook 可读到每连接运行态，无需登机 `ps`；③ `mcpStatus` 与进程管理器内存注册表一致（崩溃后状态及时更新）。 |
| REQ-P1-3 | **就绪门禁**：某连接 MCP 进程启动/重启前，其 project 目录 `target/mdl.json` 必须已存在（build 完成）。 | ① build 未完成时该连接 MCP **不拉起**或拉起后**不接流量**（返回未就绪而非脏答）；② build 成功（mdl.json 就绪）后自动拉起/重启该连接 MCP；③ `staleDrift`/`failed` 时不拉起并出告警，避免问数打到未就绪 project。 |

### 3.3 P2 — 二期增强

| 编号 | 需求（增量） | 验收标准（可测） |
|---|---|---|
| REQ-P2-1 | **低频连接懒启动 / 空闲回收**：对低频连接，首次问数按需拉起 MCP，空闲超时回收资源。 | ① 长期无问数连接释放端口与进程；② 下次问数自动拉起（首问延迟在可接受阈值内，如 ≤ 15s）；③ 回收不影响其他常驻连接。 |
| REQ-P2-2 | **每连接并发上限 / 熔断**：per-connection 限流与失败熔断，避免单库慢查询拖垮 Worker。 | ① 单连接超额请求被限流/排队，不影响其他连接；② 单连接连续失败达阈值触发熔断并告警，恢复后自动解除。 |

---

## 4. UI / 前端影响评估

### 4.1 结论

**需要改动。** 本增量把「单端点」彻底改为「多连接各自进程」，**连接管理范式必须从「单连接表单」前移到「多连接」**。当前 `iqd-config-page.tsx` 是单连接（`getIqdConfig()` 单条、无 `connId` 维度），无法表达「每连接的 MCP 端口/状态」，因此前端必须随本增量改造。最小改动集：

1. **连接管理页**：由「单连接表单」升级为「**多连接列表 + 选中连接详情**」；详情区新增「MCP 运行态」卡片（状态徽标 + 端口 + 最近健康检测时间）+ 启停/重启运维按钮。
2. **MDL 同步反馈按连接维度**：语义模型/物料保存触发异步 build 时，复用现有 `CatalogSyncStatusBar` 5 态范式展示**该连接**的「构建中 / 已就绪 / 失败 / 漂移」，并提示「该连接 MCP 将于就绪后自动拉起」（就绪门禁反馈）。
3. **物料页（catalog/scope/enhance）顶部 connection 选择器**：因多连接下每个连接是独立 project，物料编辑必须指定连接——该选择器是更大的多连接整体改造，建议随本增量排期，但**至少状态展示须随本增量落地**（详见 §5 Q4）。

### 4.2 草拟交互（连接管理页 · MCP 运行态卡）

```
[ 问数连接 ]                                    [+ 新建连接]
┌─ 连接列表 ───────────────┐  ┌─ 选中连接详情：销售库(conn_sales) ───────┐
│ ● 销售库 (running:18081)  │  │ 连接信息 ...（沿用现有表单字段）          │
│ ○ 仓储库 (stopped:18082)  │  │                                          │
│ ● 财务库 (unhealthy:18083)│  │ [ MCP 运行态 ]   状态 running   端口 18081 │
│                           │  │   最近健康 2026-08-29 14:02:11           │
│                           │  │   [启动][停止][重启]  ← 重启带二次确认     │
│                           │  │   注：停止/重启期间在线问数将短暂不可用    │
│                           │  └──────────────────────────────────────────┘
└───────────────────────────┘
```

- **状态徽标**：`running`(绿) / `starting`(黄) / `stopped`(灰) / `crashed`(红) / `unhealthy`(橙，健康检查失败待重启)。
- **启停/重启按钮**：`停止`/`重启` 为高危操作，**带二次确认**（提示「将中断该连接在线问数」），防止误伤（对齐 selfheal PRD 的 fail-closed 思维）。`启动` 仅在 `stopped` 可用。
- **数据来源**：`IqdConnection.mcpStatus` / `mcpPort` / `lastHealthAt`（REQ-P1-2 落库字段），前端轮询复用现有 5000ms 范式（与 `CatalogSyncStatusBar` 一致，不新造间隔）。
- **复用**：徽标样式、`CatalogSyncStatusBar` 轮询范式、二次确认弹窗均复用既有组件，降低改动面。

---

## 5. 待确认问题（送主理人 / 架构师拍板，不臆造）

| # | 项 | 影响范围 | 建议默认（供拍板参考，非结论） |
|---|---|---|---|
| **Q1** | **端口段默认值与并发上限**：`wren_mcp_port_range` 起止、每进程内存/CPU 预算、最大常驻连接数。 | REQ-P0-2 / REQ-P1-1 / R1 进程膨胀 | 端口段默认 `18080-18180`（避开 8080）；N 进程常驻预算需按最大连接数压测定档（设计 §9-3）。 |
| **Q2** | **`projectHome` 字段落地方式**：由 `connId` 约定派生（`/var/lib/mis-iqd/wren-projects/{connId}`）还是入库新字段。 | 设计 §3.2 / §9-6 / `IqdConnection` | 建议由 connId 派生（无需新字段），介质持久卷归属待 Q3。 |
| **Q3** | **project 目录存储介质**：`/var/lib/mis-iqd` 持久卷 vs 临时盘；崩溃后是否由 `mdl_raw` 重建。 | 设计 §9-4 / R4 | 建议持久卷（project 目录可重建，由 mdl_raw 重新生成 models/）。 |
| **Q4** | **前端多连接范式前移范围**：本期是否连「catalog/scope/enhance 顶部 connection 选择器」一并做（大改），还是后端先多连接、前端仅补「连接页 MCP 状态」最小集（物料页选择器后续）。 | §4 UI 改动面 | 建议本期最小集（连接页 MCP 状态 + 启停），物料页选择器随多连接整体排期。 |
| **Q5** | **MCP 启停/重启按钮是否本期开放前端**：还是仅后端 + runbook 运维（前端只展示状态，不开放启停）。 | REQ-P1-2 / §4.2 | 建议本期前端**展示状态 + 开放启停**（运维自助），但带二次确认 gate。 |
| **Q6** | **多连接问数租户隔离/限流**：是否需 per-connection 并发上限与失败熔断。 | REQ-P2-2（二期） | 建议二期（REQ-P2-2），但接口/配置预留开关。 |
| **Q7** | **懒启动阈值**：低频连接「空闲超时回收」的时长阈值。 | REQ-P2-1（二期） | 二期定档（如空闲 30min 回收）。 |
| **Q8** | **连接禁用时 project 目录保留策略**：design §3.2 说保留 7 天便于回溯——是否需用户确认/可配置。 | 设计 §3.2 清理策略 | 建议默认保留 7 天 + 定时任务清理，可配置。 |
| **Q9** | **`wren serve mcp` 真实工具清单与参数（W0 实测）**：`dry_plan` 是否真收 `question` 自然语言、`get_context` 原生引用结构——影响 `iqd_mcp_client` 常量与 orchestrator 字段解析。 | 设计 §9-1 / 既有 W0 实测项 | 以 W0 真机实测为准，仅校准常量，不反工上层契约。 |

---

## 6. 跨 PRD 影响（重要，需同步）

> ⚠️ **运维自愈三按钮 PRD 需随本增量重定范围。**

`mis-iqd-selfheal-prd.md` 已 Sign-off，其 Q4 明确「现状 WrenAI 为**单 profile 单实例**，建议**全局动作**（与现有默认主连接一致）」。但本增量（方案 A）使每个 IQD 连接成为**独立 MCP 进程 / 独立 project**，已无「全局单实例」前提。因此 selfheal 的 `force-rebuild` / `re-index` / `validate` 三按钮**必须改为 per-connection（按 `connId` 维度）触发**，否则会误伤/漏触发多连接中的特定库。

**建议动作**：
1. selfheal PRD 的 Q4 结论作废，三按钮改为「连接详情内 + 按 `connId` 触发」；
2. 其 `trigger_build_index` / `IqdCli` 调用已按连接参数化（设计 T1/T4），selfheal 复用即可，无需新写多库逻辑，仅改触发维度与 UI 落点；
3. 排期上 selfheal 宜在本增量 T1/T4 之后，避免「全局动作」残留。

---

## 7. 边界与依赖

- **本 PRD 不含（不重写已落地能力）**：① 编排器安全控制面（`dry_plan→注入行级范围→血缘 fail-closed→dry_run→run_sql`）不变；② 双闸门权限（RBAC + 数据范围）不变；③ 管理面 `iqd_cli.py` 多库能力（仅参数化 `project_dir`，抽象不变）；④ 前端用户端 `/ai/data-query` 问数页（本增量不改变用户端体验，仅后端路由到正确连接）。
- **依赖（设计 T1–T5）**：`config.py`（端口段/projects_root）、`iqd_cli.py`（`project_dir` 参数化 + `ensure_project`）、`wren_mcp_registry.py`（新增）、`iqd_mcp_client.py`（`for_connection` 工厂）、`orchestrator.py`（按 `connection_id` 取端点）、`service.py`（build 完成后拉起 MCP + 就绪门禁）、`IqdConnection`（mcpPort/mcpStatus 落库）。
- **风险呼应**：R1 进程膨胀（端口段 + 自愈 + 二期懒启动缓解）、R2 单连接崩溃（自动重启 + mock 降级）、R3 凭证泄漏（仅 env、不落盘）、R4 未就绪即问数（就绪门禁）。

---

## 8. 验收口径摘要

- **P0 闭环**：每连接 MCP 启停 + 崩溃自动重启（REQ-P0-1）、端口分配回收无冲突（REQ-P0-2）、按 connId 路由不落到默认端点（REQ-P0-3）、MDL 同步按连接触发且状态机正确（REQ-P0-4）、凭证仅 env 注入不落盘（REQ-P0-5）。
- **P1 完备**：Worker 重启自动恢复全部 enabled 连接（REQ-P1-1）、每连接 mcp 状态/端口可观测（REQ-P1-2）、就绪门禁（build 就绪才拉起，REQ-P1-3）。
- **P2 二期**：低频懒启动/空闲回收（REQ-P2-1）、每连接限流熔断（REQ-P2-2）。
- **跨 PRD**：selfheal 三按钮重定范围为 per-connection（§6）。
