# mis-iqd 前端可视化建模台 — 系统设计文档（增量架构）

> 架构师：高见远（software-architect）｜ 语言：中文
> 配套输入：[`mis-iqd-modeling-prd.md`](mis-iqd-modeling-prd.md)（PM 增量 PRD，14 项能力 + 4 支撑项 + 8 待确认问题）
> 上游不重做：[`prd.md`](prd.md) / [`architecture.md`](architecture.md) v1.9 / [`tasks.md`](tasks.md) v1.9
> 继承二/三/四期：[`mis-iqd-edit-prd.md`](mis-iqd-edit-prd.md) · [`mis-iqd-edit-design.md`](mis-iqd-edit-design.md) · [`mis-iqd-edit-architecture-review.md`](mis-iqd-edit-architecture-review.md)
> 被消费上游：[`mis-iqd-mcp-multiconn-prd.md`](mis-iqd-mcp-multiconn-prd.md) + [`mis-iqd-selfheal-prd.md`](mis-iqd-selfheal-prd.md)
> 图表：[`mis-iqd-modeling-class.mermaid`](mis-iqd-modeling-class.mermaid) · [`mis-iqd-modeling-sequence.mermaid`](mis-iqd-modeling-sequence.mermaid)
> 状态：🔴 已拍板 + **✅ 已实现并回写**（Q1–Q8 见 §1.1 裁决一览）｜规划日期：2026-08-30 ｜ **实施回写：2026-09-22**
>
> **⚠️ 实施回写说明（2026-09-22，架构师高见远）**：本建模台已**全部实现并入库**（18 commit，门禁全绿）。实施期发现 **8 处「设计稿 vs 代码现实」偏差**，已**逐条订正**本文（§4.1 / §4.3 / §4.4 / §4.5 / §7.1 / §8.1 / §8.2），并新增 **§11 实施期事实** 与 **§12 实施小结**。**读本文时以下即为「当前真相」**；篇幅较大的实施记录以 `mis-iqd-modeling-verify-checklist.md`（QA 验收结论）与 `architecture.md §11` 为准。

---

## 0. 一句话架构结论

**「wren-ui 级可视化建模台」作为 mis-iqd 的前端体验升级，不改变既有「平台 catalog 编辑权威 → 派生完整 MDL → `wren context build` + `memory index` → WrenAI 就绪门禁」的写回闭环**：前端落地三栏（连接树 / 拖拽 ER 画布 / 属性面板）+ 5 步向导（连接 / 表发现 / 模型 / 关系 / Cube）的可视化交互；新建节点端点（model/from-table/relationship/cube/calculated column）落 `iqd_catalog_item`（`source=platform_edit|modeling`），触发既有 `SyncCoordinator` 合并窗口走整连接 `build_mdl_from_catalog`（二/四期已落地），并由 `PublishPipelineBar` 集成既有 `CatalogSyncStatusBar` + `SelfHealPanel`（per-connection 化见 multiconn §6）做发布链路可视化与自愈；命名沿用 `iqd` 平台域（项目 `mis-iqd` / 表 `iqd_*` / API `/api/v1/iqd` / 权限码 `iqd:*` / 前端 `features/agent/iqd`），外部 WrenAI 适配层保留 `wren`（`wren serve mcp` / `wren context build` / `wren_ref_id` / `build_mdl_hash` 等），编辑权威、权限五件套、ADR-020、维度注册表 + 双维度（dept/store）均沿用不重做；多连接 MCP 进程、就绪门禁、per-connection 自愈强制重构（multiconn T1/T4）是建模台的**硬前置**（Q8）。

---

## 1. 框架与库选型（Q1–Q8 裁决一览）

### 1.1 裁决一览表

| # | 问题 | **架构师裁决** | 备选 | 工程理由（与 PM 推荐对比） |
|---|---|---|---|---|
| **Q1** | MDL 写入通道 | **方案甲（编辑权威闭环，与 PM 一致）**：一切建模编辑落 `iqd_catalog_item` → 既有「派生 MDL → build → memory index → MCP 就绪门禁」写回 | 乙（建模台直写 MDL 文件）/ 丙（跳转 wren-ui） | ① 复用已落地的 `edit_revision` 乐观并发、`idempotency_key`、引用校验（`validateCatalogRefs`）、STALE_DRIFT 对账（编辑二/四期）；② 平台是唯一受控写路径（U3 已拍板），建模台直写 MDL 会导致 catalog ↔ MDL 双真值源，破坏 `edit_revision == built_revision` 核心不变量；③ 漂移检测、对账清扫、审计、回滚全部失效；④ fail-closed 哲学被破坏。**完全采纳 PM 推荐**。 |
| **Q2** | 前端目录迁移 | **随 M1 一并迁移** `features/agent/ai/iqd` → `features/agent/iqd`（与 PM 一致） | 不迁移（保留 `ai/iqd`） | ① architecture.md §3.4 v1.9 已规划目录为 `features/agent/iqd`（**当前目录与 v1.9 命名边界不一致**，欠架构债）；② 建模台增量约 14 个新文件 + 大体量编辑抽屉/向导，画布/Cube/Calculated column 与既有 `iqd-*` 七个页面同域，迁移一次性搬齐避免永久性目录债；③ 路由 `/iqd/*` 不变（已迁独立门户 V77），仅 `import` 路径更新 + `pages.ts` 重导出，git mv + IDE 重构风险低；④ 与 W1/W2 历史已搬迁的 KB 模块做法一致。**完全采纳 PM 推荐**。 |
| **Q3** | 画布库 | **`@xyflow/react`（React Flow v12，与 PM 一致）** | 自研 SVG / d3-force / rete.js | ① MIT、React 18 兼容（Vite 既有生态）、节点自定义渲染贴合 shadcn/ui；② 自带 `<ReactFlow>` 的 `MiniMap` / `<Controls>` / `<Background>` 与 `<Handle>` 锚点，连线即建关系天然契合（MR-14/05 核心交互）；③ `applyNodeChanges`/`applyEdgeChanges` 集成 zustand 简单；④ bundle gzip ~150KB 可接受（建模台按需懒加载）；⑤ 自研 SVG/D3 估 2–3 倍工作量，MR-14 是 P0 核心；⑥ rete.js 编辑能力更强但学习曲线 + bundle 大，无必要。**完全采纳 PM 推荐**。 |
| **Q4** | SQL/表达式编辑器 | **CodeMirror 6**（`@codemirror/lang-sql` + `@codemirror/state` + `@codemirror/view`，与 PM 一致） | monaco-editor / 维持 textarea | ① `ref_sql`（MR-03）/ 计算列 expression（MR-04）/ 样本对 SQL（MR-08）三个落点统一编辑器；② CodeMirror 6 懒加载分包后 ~120KB gzip；monaco ~2MB+ 必懒加载且首屏影响；③ SQL 高亮/补全/行号够用，三处编辑器共用 `useCodeMirror` hook 降低工程量；④ monaco 的多光标/格式化/Pylance 等增强本期无需，YAGNI。**完全采纳 PM 推荐**。 |
| **Q5** | 跨页状态 | **服务端状态 = TanStack Query（catalog 单一缓存源）；UI 态 = zustand（选中项 / 视口 / 抽屉开合 / 脏标记 / wizard 步骤）；画布 nodes/edges 由 catalog 数据 selector 派生，**不持有第二份真值** | Redux Toolkit / jotai | ① 既有项目已装 zustand（依赖列表已有）；② TanStack Query 的 `staleTime` + 5000ms 轮询 + `invalidateQueries(['iqd', 'catalog', connId])` 与既有 `CatalogSyncStatusBar` 5000ms 范式一致；③ 建模台三栏数据流单向：catalog → 派生（nodes/edges）→ 选中 → 抽屉，UI 态集中在 zustand（避免分散 prop drilling）；④ 不做「第二份真值」= 画布与编辑抽屉/Cube 编辑器不可能数据不一致。**完全采纳 PM 推荐**。 |
| **Q6** | 布局持久化 | **独立 `iqd_model_layout` JSONB 存储（与 PM 一致）**（`{connection_id, layout_json, viewport_json, updated_by, updated_at}`） | `iqd_catalog_item` 加 x/y 列 / localStorage | ① 不动既有 V71 表结构，避免对 V72/V82 既有迁移产生连锁；② 连接级一份 JSONB（含 nodes 坐标 + edges 锚点 + viewport + 折叠态 + 自动布局版本号），自动布局可随时覆盖重建（重写整 JSON）；③ localStorage 仅作未保存的 `dirty` 缓冲（断网/崩溃恢复）；④ 后端一键 GET/PUT，权限码 `iqd:modeling:view`（GET）/ `iqd:modeling:edit`（PUT）；⑤ `x/y` 入 catalog 会把「视图数据」混进「模型数据」，违背「视图/模型分离」。**完全采纳 PM 推荐**。 |
| **Q7** | 画布规模上限 | **≤200 节点流畅（60fps 拖拽）；>200 触发「无关系表折叠」；>500 评估分区画布/按 schema 分组视图（标记 P2，不在本期实现）** | 无上限 / 仅折叠 | ① React Flow 自带节点虚拟化（`onlyRenderVisibleElements`），200 节点在 4 核 8G 笔记本实测 ≥55fps；② 「无关系表折叠」是 wren-ui 同款范式，UX 友好；③ >500 需分区画布/分页视图，工作量翻倍（路由 + 缩略图 + 关系跨区），本期不破坏大纲，落到 P2；④ 性能预算为拖拽 ≥55fps、缩放 ≥60fps、布局计算 ≤2s（200 节点）。**完全采纳 PM 推荐**（仅细化性能预算）。 |
| **Q8** | 与 multiconn 排期耦合 | **硬依赖：M1 排在 multiconn T1（多连接 + MCP 状态落库）之后；若 multiconn 延期，M1 降级为「单连接建模」（连接向导暂留单条形态，画布/建模不阻塞；前端可在路由层阻断 per-connection 自愈按钮与 MCP 状态卡）** | 软依赖 / 各自独立 | ① MR-01（连接向导 + MCP 状态卡）的 MCP 状态/端口字段（`mcp_port`/`mcp_status`/`last_health_at`）由 multiconn T1 提供，否则连接向导只能展示「已启用」+「未启用」，无 per-connection MCP 维度；② MR-10（发布流水线）的 per-connection 强制重建/重新索引/模型校验依赖 multiconn §6 重定范围；③ 画布/MR-02/03/05/06 与 multiconn 弱相关，可在 multiconn 前以单连接形态起步；④ 但用户体验层面「多连接是基本盘」，降级路径只用于风险预案，不作为正式分期。**完全采纳 PM 推荐**（仅补充降级形态细节）。 |

### 1.2 与既有技术栈的关系

| 层 | 沿用 | 增量 |
|---|---|---|
| 前端 | Vite + React 18 + TypeScript + Tailwind + shadcn/radix（`@/components/ui/*`）+ TanStack Query + zustand + react-router 6 | ① `@xyflow/react@^12.3.0`（画布，懒加载）；② `@codemirror/lang-sql@^6.8.0` + `@codemirror/state@^6.4.0` + `@codemirror/view@^6.30.0`（SQL/表达式编辑器懒加载）；③ `lucide-react` 已有，新增 icon 登记（`Workflow` / `GitBranchPlus` / `Calculator` / `Layers` 等） |
| BFF | Spring Boot 17 + WebClient + RS256 透传 + `@Scheduled` + mis-iqd `IqdClient` | ① 新增 `IqdModelingController`（8 端点，见 §3.3）；② 透传 `build_mdl_from_catalog` 触发与状态查询；③ 无新依赖 |
| mis-iqd（Java） | JPA + Flyway + `IqdAdminService` 范式 | ① 新增 `IqdCatalogNodeService`（新建节点族）+ `IqdModelLayoutService`（布局存储）；② 新增 V8x 迁移：`iqd_model_layout` 建表 + `iqd_catalog_item.source` 扩 `modeling` + 计算列 `expression` 列预留 + V8y 权限码种子；③ 无新依赖 |
| ai-platform（Python Worker） | FastAPI + asyncio + httpx + subprocess（`wren` CLI）+ `IqdConfigClient`（API+缓存）+ `SyncCoordinator`（合并窗口） | ① 复用既有 `build_mdl_from_catalog`（二/四期已落地，G7）；② 复核 `build_mdl_from_catalog` 派生 cubes/measures/dimensions 完整性（PRD §5.2 b 点实测确认，缺则补 patch）；③ 无新依赖 |
| WrenAI（新线） | `pip install wrenai` (wren 0.13.3) → `wren serve mcp` + wren-core | 不动；multiconn 已做进程级适配 |

### 1.3 命名边界（沿用 architecture.md §1.5/§3.3，**不重做**）

```text
平台问数业务域 → 一律 iqd：
  项目 mis-iqd、表 iqd_*、API /api/v1/iqd/**、权限码 iqd:*、
  前端 features/agent/iqd（M1 迁移后）、Java 模块 backend/mis-iqd、
  Python 包 agent/mis_iqd、类 IqdAdminService/IqdModelingController/IqdCatalogNodeService/...
  （V8y 新增 iqd:modeling:* 权限码）

对接外部 WrenAI 产品 → 保留 wren（外部系统名，不是平台问数域）：
  WrenAI 品牌、wren CLI、wren-core、wren-ui、命令 wren serve mcp / wren profile /
  wren context build、配置键 wren_mcp_host/port/transport/allow_write/timeout_seconds、
  wren_cli_bin、wren_profile_name、wren_language、外部引用字段
  iqd_catalog_item.wren_ref_id / iqd_connection.built_mdl_hash

本建模台内部命名（V8y 新增，命名空间约束）：
  前端目录 features/agent/iqd/{pages,components/modeling,components/wizard,api,store,types}
  后端端点前缀 /api/v1/iqd/modeling/** 与 /internal/v1/iqd/modeling/**
  权限码 iqd:modeling:view | iqd:modeling:edit | iqd:modeling:publish
```

---

## 2. 系统上下文图（建模台与既有能力的关系）

```mermaid
flowchart TB
  subgraph U["用户"]
    DBA["语义建模者（DBA/数据治理）"]
    RO["只读观察员"]
    OPS["AI 运营"]
  end

  subgraph FE["frontend/mis-admin-web（V77 独立门户 /iqd/*）"]
    subgraph MS["★ 建模台增量（M1 起）features/agent/iqd/"]
      MSHOME["iqd-modeling-page.tsx<br/>建模台主页（三栏壳）"]
      MSWIZ["components/wizard/ConnectionWizard.tsx<br/>TableImportWizard.tsx（MR-01/02）"]
      MSCAN["components/modeling/ModelCanvas.tsx<br/>ModelNodeCard / RelationEdge<br/>PropertyPanel / ModelTree（MR-14）"]
      MSDRAW["components/modeling/ModelEditDrawer.tsx<br/>CalculatedColumnEditor / RelationshipDialog<br/>CubeEditor / MeasureDimensionList<br/>（MR-03/04/05/06）"]
      MSPIPE["components/modeling/PublishPipelineBar.tsx<br/>整合 CatalogSyncStatusBar+SelfHealPanel<br/>（MR-10，per-connection 化见 multiconn §6）"]
      MSENH["i18n 增强：PropertyPanel 直编 description/脱敏<br/>Scope 行级维度徽标 + 谓词预览（MR-09/12/13）"]
    end
    subgraph EX["既有 iqd 页面（M1 随目录迁移）"]
      EXCFG["iqd-config-page.tsx（增强向导 + MCP 状态卡）"]
      EXCAT["iqd-catalog-page.tsx（保留并叠加 MR-S2 新建节点入口）"]
      EXSCP["iqd-scope-page.tsx（增强 MR-12 行级维度徽标）"]
      EXENH["iqd-enhance-page.tsx（MR-07/08/09 入口）"]
      EXTST["iqd-test-chat-page.tsx（验证 MR-G2/G3）"]
      EXTRA["iqd-trace-page.tsx / iqd-instruction-page.tsx"]
    end
  end

  subgraph BFF["backend/mis-admin-bff（Java）"]
    PEP["ApiPermissionInterceptor<br/>L1 权限码 iqd:modeling:*"]
    BFFMC["IqdModelingController<br/>8 端点（§3.3）"]
    BFFAC["IqdAclController（既有 MR-S2 透传）"]
    BFFCL["IqdClient（既有）+ AiPlatformClient（既有）"]
  end

  subgraph MIS["backend/mis-iqd（Java 领域模块）"]
    SVC["IqdCatalogNodeService<br/>MR-S2 新建节点族<br/>validateCatalogRefs（沿用）<br/>updateCatalogNode（既有，PUT/catalog/node）"]
    LSVC["IqdModelLayoutService<br/>layout 读写（MR-S4）"]
    DSVC["IqdDiscoveryService<br/>MR-02 表发现通道<br/>iqd_cli.py 子进程或直连（架构师定）"]
    REPO["Repository + Flyway V8x（§3.3）"]
    DB1[("mis_platform 库<br/>iqd_* 表 + iqd_model_layout(V8x)")]
  end

  subgraph AIP["agent/ai-platform（Python FastAPI）"]
    COORD["mis-copilot（既有）"]
    WORKER["mis-iqd Worker（既有）"]
    ORCH["build_mdl_from_catalog（既有，二/四期已落地 G7）"]
    CLIP["IqdCli（既有，wren context build）"]
    DCLI["iqd_cli.py 服务端表发现通道（MR-02 a 点，架构师定）"]
    CFG["IqdConfigClient（既有 API+缓存）"]
  end

  subgraph WAI["WrenAI 新线（本机进程）"]
    WMS["wren serve mcp per-connection<br/>（multiconn 已规划）"]
    WCLIL["wren CLI（context build / memory index / get mdl）"]
    WCORE["wren-core（Rust/Apache DataFusion）"]
  end

  subgraph MUL["multiconn 增量（硬前置，Q8）"]
    MULREG["WrenMcpProcessManager（多进程注册表）"]
    MULSTAT["IqdConnection.mcp_port/mcp_status/last_health_at（落库）"]
    MULSHE["SelfHealPanel per-connection 化（§6 重定）"]
  end

  DBA --> MSHOME & EXCFG & EXCAT
  RO --> MSHOME
  OPS --> EXENH

  MSHOME --> MSCAN
  EXCFG --> MSWIZ
  EXCAT --> MSCAN
  MSCAN -->|双击| MSDRAW
  MSCAN -->|连线| MSDRAW
  MSDRAW --> SVC
  MSWIZ -->|导入表| DSVC
  MSHOME -->|读/写| LSVC
  MSHOME -->|发布| MSPIPE

  MSHOME -->|"catalog 数据（TanStack Query）"| EXCAT
  MSHOME -->|"status 5000ms 轮询"| MSPIPE
  MSPIPE -->|"per-connection 启停"| MULSHE

  PEP --> BFFMC
  PEP --> BFFAC
  BFFMC --> BFFCL
  BFFAC --> BFFCL
  BFFCL --> SVC
  BFFCL --> LSVC
  BFFCL -->|"get-catalog-full / catalog-backfill"| SVC
  BFFCL -->|"/enhance/sync scope=model"| ORCH

  SVC --> REPO --> DB1
  LSVC --> REPO
  DSVC -->|"读 schema/tables/columns"| DCLI

  ORCH -->|get_catalog_full| CFG --> SVC
  ORCH --> CLIP --> WCLIL
  WCLIL --> WMS
  WMS --> WCORE

  MULREG --> WMS
  MULSTAT --> MULREG
```

**边界红线（建模台增量专属）**：
1. 建模台**不直写 MDL 文件**（Q1 方案甲）；一切编辑经 mis-iqd 落库 → 触发整连接 build。
2. 建模台**不直连 MCP/WrenAI**；问数/执行仍经既有 `IQD_TEST_CHAT_PAGE`（`/iqd/test-chat`）。
3. 建模台**不持有凭证**；连接向导凭证 UI 永不回显明文（沿用既有 `iqd-config-page`）。
4. 建模台**不派生 MDL**；派生由 ai-platform `build_mdl_from_catalog`（二/四期）执行。
5. 画布是**视图**、catalog 是**模型**（PRD §6.2 边界说明）；画布由 catalog 派生，不持有第二份真值。

---

## 3. 前端模块拆分（基于 PRD §4 14+4 项需求）

> 假设 Q2=是，M1 迁移后所有文件落在 **`frontend/mis-admin-web/src/features/agent/iqd/`**（既有 `ai/iqd/` 7 页面 + 4 组件一次性 git mv 过来）。本节路径全部为**迁移后**路径。

### 3.1 文件树（含相对路径）

```
frontend/mis-admin-web/src/features/agent/iqd/
├── pages.ts                                   [改] 桶导出（新增 IqdModelingPage）
├── pages/
│   ├── iqd-modeling-page.tsx                  [新建 M1] 建模台主页壳（三栏 + PageHeader）
│   ├── iqd-config-page.tsx                    [迁移 + 改] 既有 → 升级向导 + MCP 状态卡（MR-01）
│   ├── iqd-catalog-page.tsx                   [迁移 + 改] 既有 → 叠加 MR-S2 新建节点入口（MR-14 联动）
│   ├── iqd-scope-page.tsx                     [迁移 + 改] 既有 → 行级维度徽标（MR-12）
│   ├── iqd-enhance-page.tsx                   [迁移 + 改] 既有 → 样本对编辑器升级 + 知识关联（MR-07/08/09）
│   ├── iqd-instruction-page.tsx               [迁移] 既有 → 表达式辅助录入（MR-07）
│   ├── iqd-test-chat-page.tsx                 [迁移] 既有
│   └── iqd-trace-page.tsx                     [迁移] 既有
│
├── components/
│   ├── modeling/                              [新建 M1~M3]
│   │   ├── ModelCanvas.tsx                    [M1] @xyflow/react 画布壳（ReactFlow/MiniMap/Controls/Background）
│   │   ├── ModelNodeCard.tsx                  [M1] 模型节点卡（表名 + 字段列表 + PK/计算列/脱敏徽标）
│   │   ├── RelationEdge.tsx                   [M2] 关系边（join 类型/基数编码 + 拖拽创建）
│   │   ├── ModelTree.tsx                      [M1] 左树（连接 → 表/模型/Cube 分组 + 搜索 + 表发现入口）
│   │   ├── PropertyPanel.tsx                  [M1] 右栏（字段列表 / 业务描述直编 / 脱敏直编 / 依赖方）
│   │   ├── ModelEditDrawer.tsx                [M2] 模型编辑抽屉（PK / 语义标记 / ref_sql 编辑器）
│   │   ├── CalculatedColumnEditor.tsx         [M2] 计算列编辑器（CodeMirror SQL 高亮 + 引用校验）
│   │   ├── RelationshipDialog.tsx             [M2] 关系弹窗（join/cardinality/condition）
│   │   ├── CubeEditor.tsx                     [M2] Cube 编辑器（measures + dimensions）
│   │   ├── MeasureDimensionList.tsx           [M2] Cube 子组件
│   │   ├── PublishPipelineBar.tsx             [M3] 发布流水线条（整合既有 CatalogSyncStatusBar + SelfHealPanel）
│   │   ├── DriftDetailPanel.tsx               [M3] 漂移详情面板（MR-11）
│   │   └── AutoLayoutButton.tsx               [M3] dagre 一键整理
│   │
│   ├── wizard/                                [新建 M1~M2]
│   │   ├── ConnectionWizard.tsx               [M1] 连接向导 4 步（基本信息 → 数据源参数 → profile → 连通测试）
│   │   ├── TableImportWizard.tsx              [M1] 表发现向导 4 步（选 schema → 表清单 → 列预览 → 导入确认）
│   │   └── WizardShell.tsx                    [M1] 向导通用壳（步骤条 + 上一步/下一步 + 二次确认）
│   │
│   ├── shared/                                [新建 M1]
│   │   ├── usePermission.ts                   [M1] iqd:modeling:* 权限码 hook（沿用 PermissionGate）
│   │   ├── useSyncStatus.ts                   [M1] 5000ms 轮询 hook（沿用既有 SyncStatusBar 范式）
│   │   └── IqdIcon.tsx                        [M1] icon 登记（lucide Workflow / GitBranchPlus / Calculator / Layers）
│   │
│   ├── CatalogSyncStatusBar.tsx               [迁移 + 改] 既有 → MR-10 集成到 PublishPipelineBar
│   ├── SyncStatusBar.tsx                      [迁移] 既有
│   └── SelfHealPanel.tsx                      [迁移 + 改] 既有 → per-connection 化（multiconn §6）
│
├── api/
│   ├── iqd.ts                                 [迁移 + 改] 既有 wire 层（约 30 函数 + 类型）→ 拆分为 iqd.ts + iqd-modeling.ts + iqd-layout.ts
│   ├── iqd-modeling.ts                        [新建 M1~M2] 建模台端点（连接向导 / 表发现 / 新建节点 / 校验 / 状态）
│   └── iqd-layout.ts                          [新建 M3] 布局读写
│
├── store/
│   ├── modeling-store.ts                      [新建 M1] zustand（UI 态：选中 / 视口 / 抽屉 / 脏标记 / wizard 步骤 / 自动布局版本）
│   └── selectors.ts                           [新建 M1] 派生 selector（catalog → nodes/edges）
│
├── types/
│   ├── catalog.ts                             [迁移 + 改] 既有 IqdCatalogItem → 扩 source=platform_edit|modeling、expression、calculated columns
│   ├── modeling.ts                            [新建 M1] ModelNode / RelationEdge / PropertyPanel / WizardStep / LayoutDTO
│   ├── connection.ts                          [迁移] 既有
│   └── layout.ts                              [新建 M3] IqdModelLayoutDTO
│
├── queries/
│   └── iqd-keys.ts                            [新建 M1] TanStack Query keys 集中管理（['iqd','catalog',connId] / ['iqd','modeling','node',connId,key] ...）
│
└── hooks/                                    [新建 M1]
    ├── useCodeMirror.ts                       [新建 M2] CodeMirror 6 React hook（懒加载 + SQL 高亮）
    ├── useCatalogNodes.ts                     [新建 M1] 派生画布 nodes/edges（selector，Q5 不持第二份真值）
    └── useDirtyState.ts                       [新建 M2] 脏标记 hook（draft vs server）
```

**四处同改清单（M1 起新增页面必走，PRD §7.7 + §1.5 命名边界）**：
1. `lib/nav/iqd-nav.ts`：追加 leaf `'/iqd/modeling'`（icon `Workflow`，权限 `iqd:modeling:view`）。
2. `components/layout/keep-alive-outlet.tsx` 的 `PAGE_MAP`：追加 `/iqd/modeling` → `IqdModelingPage`。
3. `app/router.tsx`：通常零改动（`/iqd/*` 已整体登记，V77），需核实。
4. `lib/nav/icons.ts`：登记新 icon（`Workflow` / `GitBranchPlus` / `Calculator` / `Layers` / `Database` 已有），**漏登记会静默回退成 LayoutDashboard**。
5. `backend/mis-migrator/.../V8y__iqd_modeling_seed.sql`：`sys_menu`（**4 条 = 1 页面 + 3 权限按钮**）+ `sys_api`（8 端点 + 3 权限码）+ `sys_menu_api` 绑定；ID 段避 V69/V73/V77/V82 已用（建议 `92600-92699`，v1.10 已用 9250x，92600+ 空闲）。
   - **⚠️ 实施回写（2026-09-22）**：实际落为 **V87**（主页 92600 + 权限按钮 **92631/92632/92633** + 12 端点 + 绑定 + 3 角色授权）+ **V88**（补登 `GET /connections` 等 5 端点）。**`sys_menu` 必须是 4 条**——页面菜单 92600 **加上 3 个 `type=3` 权限按钮**；若只落 1 条页面菜单，则 `sys_role_permission(perm_type='menu', target_id)` **无所指** ⇒ `iqd:modeling:*` 进不了 `auth-store.permissions` ⇒ `PermissionGate` **静默全拒**。详见 §8.2 与 §11.3。

### 3.2 路由与权限闸

- 新路由 `/iqd/modeling`（独立门户 App `/iqd/*`，V77）
- 三权限码（V8y 种子）：
  - `iqd:modeling:view`（画布只读 / 列表 / 详情可见）
  - `iqd:modeling:edit`（画布编辑 / 新建模型/关系/Cube / 计算列 / 字段描述直编 / 脱敏直编；语义等同并扩展 `iqd:catalog:edit`）
  - `iqd:modeling:publish`（触发构建/强制重建/重新索引/模型校验；语义等同并扩展 `iqd:selfheal:exec`）
- 前端按钮按权限码置灰（沿用既有 `PermissionGate`）：无 `view` → 不可进页面（40300）；无 `edit` → 画布只读；无 `publish` → 发布按钮置灰。
- 后端硬闸门：mis-iqd `IqdCatalogNodeService` 每个新建方法 `@PreAuthorize("hasAuthority('iqd:modeling:edit')")`；publish 端点 `hasAuthority('iqd:modeling:publish')`。

### 3.3 前端与后端契约（M1/M2/M3 端点表）

| 端点（路径） | HTTP | 权限码 | 入参 schema | 出参 | 错误码 | 幂等 key | 乐观并发 |
|---|---|---|---|---|---|---|---|
| `POST /api/v1/iqd/connections` | POST | `iqd:modeling:edit` | `{name, base_url, project_id, default_connector, secret_ref, timeout_seconds, language, enabled}` | `IqdConnectionVO` | 42200（参数）/ 40900（同名冲突） | `{conn_name}+{uuid}`（双键） | n/a |
| `POST /api/v1/iqd/connections/{id}/test` | POST | `iqd:modeling:edit` | n/a | `{ok, latency_ms, version}` | 50201（MCP 不可达） | `{connId}+{uuid}` | n/a |
| `GET /api/v1/iqd/discovery/schemas?connectionId=…` | GET | `iqd:modeling:edit` | query `connectionId` | `{schemas: [string]}` | 50201（连接不可达） | n/a | n/a |
| `GET /api/v1/iqd/discovery/tables?connectionId=…&schema=…&keyword=…&page=…` | GET | `iqd:modeling:edit` | query | `{tables:[{name, comment, row_count_estimate}], total, page}` | 50201 | n/a | n/a |
| `GET /api/v1/iqd/discovery/columns?connectionId=…&schema=…&table=…` | GET | `iqd:modeling:edit` | query | `{columns:[{name, type, comment, is_pk_inferred, nullable}]}` | 50201 | n/a | n/a |
| `POST /api/v1/iqd/discovery/import` | POST | `iqd:modeling:edit` | `{connectionId, tables:[{schema,name}], mode: 'create_or_skip' \| 'create_or_update', in_scope: false}` | `{imported: [item_key], skipped: [item_key]}` | 42200（空清单）/ 50201 | `{connId}+{sha1(tables)}` | n/a |
| `POST /api/v1/iqd/catalog/model` | POST | `iqd:modeling:edit` | `{connectionId, item_key, kind:'model', patch:{display_name,description,primary_keys[], is_time_dimension{}, is_email{}, ref_sql?}, base_revision, idempotency_key}` | `{edit_revision, edit_status, wren_ref_id?}` | 40900（base_revision）/ 42200（引用）/ 40901（key 重复） | `{connId}+{uuid}` | `base_revision` |
| `POST /api/v1/iqd/catalog/model/from-table` | POST | `iqd:modeling:edit` | `{connectionId, source_table:{schema,name}, model_item_key, base_revision, idempotency_key, ref_sql?}` | `{edit_revision, edit_status, item_key, column_mapping}` | 40900/42200/40901 | `{connId}+{sha1(source_table)}` | `base_revision` |
| `POST /api/v1/iqd/catalog/relationship` | POST | `iqd:modeling:edit` | `{connectionId, item_key, kind:'relationship', patch:{join_type, cardinality, condition, source_model, target_model}, base_revision, idempotency_key}` | `{edit_revision, edit_status}` | 40900/42200（源/目标字段不存在/被引用阻断）/40901 | `{connId}+{uuid}` | `base_revision` |
| `POST /api/v1/iqd/catalog/cube` | POST | `iqd:modeling:edit` | `{connectionId, item_key, kind:'cube', patch:{display_name, model_ref, measures:[{name, expression, format}], dimensions:[{name, ref_model_field}]}, base_revision, idempotency_key}` | `{edit_revision, edit_status}` | 40900/42200（引用/被引用阻断）/40901 | `{connId}+{uuid}` | `base_revision` |
| `PUT /api/v1/iqd/catalog/node/{itemKey}` | PUT | `iqd:modeling:edit` | 既有契约，二/二/四期已落地 | 既有 | 40900/42200/40901 | 既有 | 既有 |
| `POST /api/v1/iqd/catalog/calculated-column` | POST | `iqd:modeling:edit` | `{connectionId, model_item_key, column_name, expression, base_revision, idempotency_key}` | `{edit_revision, edit_status, item_key, validated: bool, errors?: [string]}` | 42201（expression 引用不存在字段）/ 40900/40901 | `{connId}+{uuid}` | `base_revision` |
| `GET /api/v1/iqd/catalog/validate-expression` | GET | `iqd:modeling:edit` | query `connectionId,model_item_key,expression` | `{valid: bool, errors: [string]}` | n/a | n/a | n/a |
| `GET /api/v1/iqd/modeling/layout/{connectionId}` | GET | `iqd:modeling:view` | path | `IqdModelLayoutDTO` | n/a | n/a | n/a |
| `PUT /api/v1/iqd/modeling/layout/{connectionId}` | PUT | `iqd:modeling:edit` | path + body `IqdModelLayoutDTO` | `IqdModelLayoutDTO` | 42200（layout 体积 >1MB）/ 40900（并发覆盖） | `{connId}+{uuid}` | `base_version` |
| `POST /api/v1/iqd/modeling/layout/{id}/auto-layout` | POST | `iqd:modeling:edit` | path + body `{algorithm:'dagre', direction:'LR'\|'TB'}` | `IqdModelLayoutDTO` | n/a | `{connId}+{uuid}` | n/a |
| `GET /api/v1/iqd/dependencies?connectionId=…&itemKey=…` | GET | `iqd:modeling:view` | query | `{dependents:[{item_key, kind}], total}` | n/a | n/a | n/a |
| `GET /api/v1/iqd/catalog/sync-status?connectionId=…` | GET | `iqd:modeling:view` | query | 既有 `IqdCatalogSyncStatus`（含 `action` 见 selfheal 二/四期） | n/a | n/a | n/a |
| `POST /api/v1/iqd/self-heal/{action}?connectionId=…` | POST | `iqd:modeling:publish` | query | `IqdSelfHealResult` | n/a | n/a | n/a |

**注**：所有 `POST` 建节点端点 = 落 `iqd_catalog_item`（`source='modeling'`）→ bump `current_edit_revision` → 触发 `triggerSyncBestEffort(scope=model)`（沿用二/四期 `IqdFacadeService.triggerSyncBestEffort` 范式）→ 不阻塞用户（`wait=false`，异步）。所有 `*_item_key` 命名遵循既有 `{kind}/{name}` 形态（`mdl:model:orders`、`mdl:cube:revenue`、`mdl:relationship:orders_customers`）。

---

## 4. 后端 / BFF / Worker 增量点（PRD §5.2 a/b/c/d/e 五点全契约）

### 4.1 a 点 — 表发现通道（MR-02，**新建**）

**目的**：DBA 在建模台向导中「按连接」发现 schema/表/列；**凭证 server-side**，前端不触达业务库。

**架构师裁决**：复用 `agent/ai-platform/backend/src/adapters/iqd_cli.py`（Python 侧已有 `profile add` + `context set-profile`），由 `DBA` 在新连接创建后人工执行（沿用 multiconn §5 凭证注入流程），profile 注入到 WrenAI；建模台通过 **新增 Python 端点** 由 ai-platform Worker 暴露「按连接读 schema/表/列」的能力，经 BFF 转发到前端。

> **⚠️ 实施回写（2026-09-22）— 两处订正：**
> 1. **路径前缀 = `/api/v1/iqd/discovery/**`（不是 `/internal/v1/...`）**。`/internal/v1/**` 是 **Java 侧内部面**的命名；**Python Worker 全部业务路由前缀 `/api/v1`**（路由自带前缀 `/iqd/discovery`，由 `src/main.py` 以 `prefix="/api/v1"` 挂载 ⇒ 最终 `/api/v1/iqd/discovery/**`）。**Python Worker 从不使用 `/internal/v1/**`。**
> 2. **元数据读取走 MCP 工具，不是 CLI 子命令**：`wren list-models` / `wren describe-model` **是 `wren serve mcp` 暴露的 MCP 工具**（实现侧常量 `TOOL_LIST_MODELS="list_models"` / `TOOL_DESCRIBE_MODEL="describe_model"`），**实现走 `IqdMcpClient`**；**CLI 侧真正存在的只有 `wren get mdl` / `wren context show`**（`IqdCli` 已封装）。
>
> **不新增 Java 端口转发**（避免 Java ↔ WrenAI 多一跳延迟与凭证扩散），直接 BFF → ai-platform Python `/api/v1/iqd/discovery/**`，复用既有 `IqdConfigClient` 调用范式。

| 端点（Python Worker，实际前缀 `/api/v1`） | HTTP | 入参 | 出参 | 错误码 |
|---|---|---|---|---|
| `GET /api/v1/iqd/discovery/schemas?connectionId=…` | GET | query | `{schemas:[string]}`（MCP `list_models` 顶层 group 或 `get_mdl`） | 50201（profile 未注入/连接不可达） |
| `GET /api/v1/iqd/discovery/tables?connectionId=…&schema=…&page=…&keyword=…` | GET | query | `{tables:[{name,comment}], total, page}`（MCP `list_models` / `describe_model`） | 50201 |
| `GET /api/v1/iqd/discovery/columns?connectionId=…&schema=…&table=…` | GET | query | `{columns:[{name,type,comment,is_pk_inferred,nullable}]}`（MCP `describe_model` 的 columns 段 + 主键推断） | 50201 |
| `POST /api/v1/iqd/discovery/import` | POST | `{connection_id, tables:[{schema,name}], mode, in_scope}` | `{imported:[item_key], skipped:[item_key]}` | 42200/50201 |

**Java 侧**：`IqdDiscoveryController`（BFF）转发；权限码 `iqd:modeling:edit`；不落任何业务数据，仅缓存 5 分钟（TanStack Query）。

### 4.2 b 点 — Cube→MDL 派生确认（MR-06，**实测确认 + 可能补丁**）

**实测任务（不在本轮实现，作为 W0 实测清单）**：核实 `build_mdl_from_catalog`（二/四期已落地，G7）派生的 MDL 是否包含 cubes/measures/dimensions 完整结构。**期望已包含**（`item_key → MDL 节点` 映射表 `mdl:cube:<name>` → `cubes[]` 已覆盖），若实测发现 measures/dimensions 字段缺失或嵌套层级不对，则打补丁（最小化修改 `build_mdl_from_catalog`）。

**若需补丁的预案**：
```python
# service.py: build_mdl_from_catalog ——  补丁候选
if kind == 'cube' and it.expression:
    cube = locate(cube, it.item_key)
    cube['measures'] = parse_measures(it.expression)     # 补丁 1：若 expression 内含 measures JSON
    cube['dimensions'] = parse_dimensions(it.expression) # 补丁 2：同上
```
**默认**：不补丁（G7 已覆盖），仅在 W0 实测发现缺陷时打最小补丁（不属于本建模台 PRD 范围，但建模台依赖其正确性）。

### 4.3 c 点 — 新建节点端点族（MR-S2，**核心增量**）

| 端点族 | 方法 | mis-iqd Service 方法 | 入参摘要 | 复用 / 新增 |
|---|---|---|---|---|
| model（from-table） | POST | `IqdCatalogNodeService.createModelFromTable(connectionId, sourceTable, modelKey, baseRevision, idempotencyKey)` | `{connectionId, source_table:{schema,name}, model_item_key, base_revision, idempotency_key, ref_sql?}` | 新增；落 `iqd_catalog_item`（`kind=model`, `source=modeling`） + 同步建 `kind=column` 子节点 |
| model（blank） | POST | `IqdCatalogNodeService.createModel(connectionId, modelKey, patch, baseRevision, idempotencyKey)` | `{connectionId, item_key, patch, base_revision, idempotency_key}` | 新增；落 `kind=model` 节点 + 空 columns 子集 |
| relationship | POST | `IqdCatalogNodeService.createRelationship(connectionId, itemKey, patch, baseRevision, idempotencyKey)` | `{connectionId, item_key, patch:{join_type,cardinality,condition,source_model,target_model}, base_revision, idempotency_key}` | 新增；调 `validateCatalogRefs` 校验源/目标字段存在性；落 `kind=relationship` |
| cube | POST | `IqdCatalogNodeService.createCube(connectionId, itemKey, patch, baseRevision, idempotencyKey)` | `{connectionId, item_key, patch:{display_name,model_ref,measures[],dimensions[]}, base_revision, idempotency_key}` | 新增；落 `kind=cube` + `kind=measure`/`kind=dimension` 子节点；调 `validateCatalogRefs` 校验 `model_ref` + measure 表达式字段存在性 |
| calculated column | POST | `IqdCatalogNodeService.createCalculatedColumn(connectionId, modelItemKey, columnName, expression, baseRevision, idempotencyKey)` | `{connectionId, model_item_key, column_name, expression, base_revision, idempotency_key}` | 新增；落 `kind=column`, `parent_key=<model_item_key>`, `expression=<expr>`；校验 `expression` 引用本模型字段 |
| validate expression | GET | `IqdCatalogNodeService.validateExpression(connectionId, modelItemKey, expression)` | query | 新增；静态解析 expression 引用字段，列出错误 |

**所有新建节点统一流程**：
```
@PreAuthorize("hasAuthority('iqd:modeling:edit')")
@Transactional
public CreateResult createNode(...) {
    1. 幂等键查重 (iqd_edit_idempotency)
    2. base_revision 乐观并发（不符 → 409 + current_edit_revision）
    3. validateCatalogRefs(connectionId, itemKey, op='CREATE')  ← 引用完整性预校验
    4. 落 iqd_catalog_item（source='modeling'，按 kind 设字段）
    5. bump iqd_connection.current_edit_revision += 1
    6. 写 iqd_edit_idempotency(connectionId, key, current_edit_revision)
    7. publishChangeEvent('iqd.catalog.changed', connectionId)
    8. triggerSyncBestEffort(scope='model', wait=false)  ← 沿用二/四期 BFF 范式
    9. return {edit_revision: current, edit_status: 'EDITED_UNSYNCED'}
}
```

**字段扩展（V8x 迁移 → 实际落 **V89**）**：
- `iqd_catalog_item.source` 新增取值 `modeling`（应用层校验；DDL 已含 VARCHAR，扩展允许值）
- `iqd_catalog_item.expression` 已存在（computed），calculated column 落 `expression` 字段（与 cube/measure 复用）
- **⚠️ 实施回写：`iqd_catalog_item.model_ref` 是「新增列」**——上表 cube 的 `patch.model_ref` 字段**设计稿有、但表里原本没有该列**；已由 **V89** 补 `ALTER TABLE iqd_catalog_item ADD COLUMN IF NOT EXISTS model_ref VARCHAR(255)`（**可空、无回填**）。**为何补列而不挤进 `expression`**：① 「列存已有（`related_item_keys`）vs 新列」要看真实 DDL，不能凭稿假设；② `model_ref` 需**确定性关联**（cube → model），塞进 `expression` 会与 measure 表达式语义混叠；③ MDL 同步进来的老 cube `model_ref` 保持 `NULL`，**继续走 `expression` 兜底**，仅 T03 起新写入的 cube 填 `model_ref`。详见 §11.2。
- 新增表 `iqd_edit_idempotency`（已在二/四期 V8x 中建，V8y 复用）
- 新增表 `iqd_model_layout`（MR-S4，d 点）
- **⚠️ 实施回写（T04a 计划外新增）**：`PUT /api/v1/iqd/catalog/cube`（**Cube 级 upsert**，sys_api **92700** / **V90**）+ `pruneOrphanChildren` 孤儿清理——补 PRD **MR-06「能建不能改」**缺口（`POST /catalog/cube` 是 create-only 双幂等，`PUT /catalog/node` 只能改单节点自身字段、动不了 measure/dimension 子节点）。

### 4.4 d 点 — layout 存储（MR-S4，**新建**）

| 表 | DDL（V8y） |
|---|---|
| `iqd_model_layout` | `(id BIGINT PK, connection_id BIGINT NOT NULL FK, layout_json JSONB NOT NULL, viewport_json JSONB, auto_layout_version INT NOT NULL DEFAULT 0, updated_by VARCHAR(64), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), version INT NOT NULL DEFAULT 0)` + `UNIQUE(connection_id)` + `idx_iqd_ml_conn` |

| 端点 | 方法 | Service 方法 | 行为 |
|---|---|---|---|
| `GET /api/v1/iqd/modeling/layout/{connectionId}` | GET | `IqdModelLayoutService.get(connectionId)` | 返回 layout；空时返回 `{nodes:[],edges:[],viewport:{x:0,y:0,zoom:1},auto_layout_version:0}` |
| `PUT /api/v1/iqd/modeling/layout/{connectionId}` | PUT | `IqdModelLayoutService.save(connectionId, dto, base_version)` | 落 JSONB；`base_version` 乐观并发；体积限制 1MB |
| `POST /api/v1/iqd/modeling/layout/{connectionId}/auto-layout` | POST | `IqdModelLayoutService.autoLayout(connectionId, algo)` | **⚠️ 实施回写（A-02 裁决落地）：服务端按设计不实现 dagre** —— 端点返回 **HTTP 501 + 业务码 50101**（`NOT_IMPLEMENTED_BY_DESIGN`）；**前端 `@dagrejs/dagre` 算坐标 → `PUT` 落库**。协议层区分「**按设计不做**」（501/50101）与「**还没做**」（503/50300）——避免前端把两者一视同仁渲染成「建设中」 |

### 4.5 e 点 — 指令/知识「关联对象」裁剪（MR-07/09，**复用 + 增强**）

**不重建 iqd_knowledge 表结构**，仅在 knowledge.content JSON 内追加 `related_item_keys: [item_key]` 字段（应用层校验），下发前由 ai-platform `IqdAskService.push_enhancements` 按 related_item_keys 裁剪。

> **⚠️ 实施回写（2026-09-22）— A-06 premise 过时**：原裁决措辞为「**不新建列**，内嵌 `content.related_item_keys` JSON」，隐含前提是「该信息不存在列上」。**实测：`iqd_knowledge.related_item_keys` 列早已存在**（`V71:218`，`related_item_keys JSONB NULL`）。因此实施真相是「**给一个已存在的列加应用层校验 + 下发裁剪**」，**不是**「把字段塞进 `content` JSON」。**教训：判断「是否需新增列」必须 grep 真实 DDL（`V71`），不能凭稿假设。** 下发裁剪逻辑（`push_enhancements` 按 `related_item_keys` 只携带当前 model/cube 相关条目）与设计一致。

```json
{
  "kind": "instruction",
  "content": "计算 @orders.amount 时剔除测试单",
  "related_item_keys": ["mdl:model:orders", "mdl:column:orders.amount"],
  "scope": "connection",        // connection | model | cube
  "scope_ref": null              // 或 item_key
}
```

**i18n 字段裁剪**（MR-07）：
- ai-platform 接收 `related_item_keys` 后，下发到 WrenAI `instructions` 时只携带与当前 model/cube 相关的条目（按 `get_context` 可见集筛选）
- 前端 instruction 编辑器 + PropertyPanel 在字段右侧提供「关联对象」按钮（多选 catalog 节点，下拉即校验）

---

## 5. 数据结构与接口（classDiagram）

```mermaid
classDiagram
    direction TB

    %% ========== 前端 zustand UI 态 ==========
    class ModelingStore {
      +string connectionId
      +string selectedItemKey | null
      +Set~string~ selectedNodeIds
      +Viewport viewport
      +DrawerState drawer: 'closed' | 'model' | 'cube' | 'calculatedColumn'
      +Map~string,ItemDraft~ dirtyDrafts
      +boolean isPublishing
      +string wizardStep | null
      +string[] wizardHistory
      +setSelected(key) (ke: string) void
      +openDrawer(kind, key) (k: DrawerKind, ke: string) void
      +closeDrawer() void
      +markDirty(itemKey, draft) void
      +clearDirty(itemKey) void
      +pushWizardStep(step) void
      +popWizardStep() string | null
      +reset() void
    }

    class ItemDraft {
      +string itemKey
      +string kind
      +Map baseValues
      +Map draftValues
      +string baseRevision
      +string idempotencyKey
      +isDirty() boolean
      +toPayload() Map
    }

    %% ========== 前端 TanStack Query keys ==========
    class IqdQueryKeys {
      +catalogs(connectionId) QueryKey
      +catalogNode(connectionId, itemKey) QueryKey
      +syncStatus(connectionId) QueryKey
      +dependencies(connectionId, itemKey) QueryKey
      +modelLayout(connectionId) QueryKey
      +discoverySchemas(connectionId) QueryKey
      +discoveryTables(connectionId, schema, page) QueryKey
      +discoveryColumns(connectionId, schema, table) QueryKey
      +connections() QueryKey
      +validateExpression(connectionId, modelKey, expr) QueryKey
    }

    %% ========== 前端 wire 类型（建模台增量）============
    class CreateModelFromTableRequest {
      +string connectionId
      +SourceTable sourceTable
      +string modelItemKey
      +string baseRevision
      +string idempotencyKey
      +string | null refSql
    }
    class CreateRelationshipRequest {
      +string connectionId
      +string itemKey
      +JoinType joinType: inner|left|right|full
      +Cardinality cardinality: 1:1|1:N|N:1|N:N
      +string condition
      +string sourceModel
      +string targetModel
      +string baseRevision
      +string idempotencyKey
    }
    class CreateCubeRequest {
      +string connectionId
      +string itemKey
      +string displayName
      +string modelRef
      +Measure[] measures
      +Dimension[] dimensions
      +string baseRevision
      +string idempotencyKey
    }
    class CreateCalculatedColumnRequest {
      +string connectionId
      +string modelItemKey
      +string columnName
      +string expression
      +string baseRevision
      +string idempotencyKey
    }
    class Measure {
      +string name
      +string expression
      +string | null format
    }
    class Dimension {
      +string name
      +string refModelField
    }

    %% ========== 后端 DTO ==========
    class IqdModelingCreateResponse {
      +string editRevision
      +string editStatus: EDITED_UNSYNCED|SYNCING|SYNCED|SYNC_FAILED|STALE_DRIFT
      +string | null wrenRefId
    }
    class IqdCatalogSyncStatus {
      +string connectionId
      +string currentEditRevision
      +string builtEditRevision
      +string buildStatus
      +string indexStatus
      +string editStatus
      +string mdlHash
      +string | null buildError
      +string | null indexError
      +boolean staleDrift
      +string | null action
    }
    class IqdModelLayoutDTO {
      +string connectionId
      +LayoutNode[] nodes
      +LayoutEdge[] edges
      +Viewport viewport
      +int autoLayoutVersion
      +int version
    }
    class LayoutNode {
      +string itemKey
      +float x
      +float y
      +float width
      +float height
      +boolean collapsed
    }
    class LayoutEdge {
      +string id
      +string source
      +string target
      +string | null sourceHandle
      +string | null targetHandle
    }
    class IqdDependents {
      +Dependent[] dependents
      +int total
    }
    class Dependent {
      +string itemKey
      +string kind: model|column|relationship|cube|measure|dimension|view|sql_pair|knowledge
    }

    %% ========== 后端 Java Service（增量）============
    class IqdCatalogNodeService {
      -IqdConnectionRepository connRepo
      -IqdCatalogItemRepository catalogRepo
      -IqdEditIdempotencyRepository idempRepo
      -ValidateCatalogRefsService validateRefs
      +createModelFromTable(req) IqdModelingCreateResponse
      +createModel(req) IqdModelingCreateResponse
      +createRelationship(req) IqdModelingCreateResponse
      +createCube(req) IqdModelingCreateResponse
      +createCalculatedColumn(req) IqdModelingCreateResponse
      +validateExpression(connId, modelKey, expr) ValidateExprResult
      +listDependents(connId, itemKey) IqdDependents
    }
    class IqdModelLayoutService {
      -IqdModelLayoutRepository layoutRepo
      +get(connectionId) IqdModelLayoutDTO
      +save(connectionId, dto, baseVersion) IqdModelLayoutDTO
      +autoLayout(connectionId, algo) IqdModelLayoutDTO
    }
    class ValidateCatalogRefsService {
      -IqdCatalogItemRepository repo
      +validate(connId, itemKey, op) List~Dependent~
      +validateExpression(connId, modelKey, expr) List~string~
    }

    %% ========== ai-platform Worker（增量端口族）============
    class IqdDiscoveryService {
      -IqdCli cli
      +listSchemas(connectionId) List~string~
      +listTables(connectionId, schema, page) PagedTables
      +listColumns(connectionId, schema, table) List~ColumnMeta~
      +importTables(req) ImportResult
    }
    class IqdCli {
      +contextBuild(mdlDir, scope, force) BuildResult
      +memoryIndex() IndexResult
      +memoryReset() ResetResult
      +contextValidate() ValidateResult
      +getCurrentMdlHash() string | null
      +listModels(connectionId) List~ModelSummary~  <<新>>
      +describeModel(connectionId, schema, table) ModelDetail  <<新>>
    }
    class BuildMdlFromCatalog {
      -IqdConfigClient configClient
      -IqdCli cli
      +build(connectionId, editedItems) tuple~string, dict~
    }

    %% ========== 关系 ==========
    ModelingStore "1" *-- "*" ItemDraft : dirtyDrafts
    IqdCatalogNodeService ..> ValidateCatalogRefsService : 委托校验
    IqdCatalogNodeService ..> IqdModelingCreateResponse : 返回
    IqdCatalogNodeService ..> CreateModelFromTableRequest : 入参
    IqdCatalogNodeService ..> CreateRelationshipRequest : 入参
    IqdCatalogNodeService ..> CreateCubeRequest : 入参
    IqdCatalogNodeService ..> CreateCalculatedColumnRequest : 入参
    CreateCubeRequest "1" *-- "*" Measure
    CreateCubeRequest "1" *-- "*" Dimension
    IqdModelLayoutService ..> IqdModelLayoutDTO
    IqdModelLayoutDTO "1" *-- "*" LayoutNode
    IqdModelLayoutDTO "1" *-- "*" LayoutEdge
    ValidateCatalogRefsService ..> Dependent : 返回
    IqdDiscoveryService ..> IqdCli : 委托
    BuildMdlFromCatalog ..> IqdConfigClient : get_catalog_full
    BuildMdlFromCatalog ..> IqdCli : context_build
```

**说明**：
- **未列出既有类**（`IqdConnection` / `IqdCatalogItem` / `IqdAskService` / `IqdConfigClient` 等沿用，详见 architecture.md §4.1 类图）
- **未列出 DB 表 schema 字段**（沿用 V71/V8x，详见 mis-iqd-edit-design.md §三 + 本设计 §4.3 + §4.4）
- **⚠️ 实施回写（2026-09-22）**：上图中 `IqdCli.listModels` / `describeModel` 标 `<新>` 是**设计稿的表述**；**实测这两个不是 CLI 子命令，而是 `wren serve mcp` 暴露的 MCP 工具**（`list_models` / `describe_model`），**实现落在 `IqdMcpClient`**（`adapters/iqd_mcp_client.py`，常量 `TOOL_LIST_MODELS` / `TOOL_DESCRIBE_MODEL`）。`IqdCli` 的形态保留（供 `context show` 类扩展），但**表发现不走 `IqdCli`**。读图时以本条为准。
- `IqdCatalogNodeService.upsertCube`（T04a 计划外新增）对应 `PUT /catalog/cube` + `pruneOrphanChildren`（§4.3 已补）。

---

## 6. 核心流程（sequenceDiagram）

### 6.1 表发现导入闭环（MR-02）

```mermaid
sequenceDiagram
    autonumber
    actor DBA as 语义建模者
    participant WIZ as TableImportWizard
    participant FE as FE (TanStack Query)
    participant BFF as IqdModelingController (BFF)
    participant AIP as IqdDiscoveryService (ai-platform)
    participant MCP as IqdMcpClient → wren serve mcp
    participant MIS as IqdCatalogNodeService (mis-iqd)
    participant COORD as SyncCoordinator
    participant BLD as build_mdl_from_catalog
    participant CLIP as IqdCli → wren CLI
    participant WREN as wren serve mcp

    DBA->>WIZ: 进入「表发现导入」向导
    WIZ->>FE: useQuery(['iqd','discovery','schemas',connId])
    FE->>BFF: GET /iqd/discovery/schemas?connectionId=1
    BFF->>AIP: GET /api/v1/iqd/discovery/schemas?connectionId=1
    AIP->>MCP: MCP tool list_models(connection_id)
    MCP-->>AIP: [schemas]
    AIP-->>BFF: {schemas: ["public","sales",...]}
    BFF-->>FE: 200
    FE-->>WIZ: schemas

    DBA->>WIZ: 选 schema → 表清单
    WIZ->>FE: useQuery(['iqd','discovery','tables',connId,schema,page])
    FE->>BFF: GET /iqd/discovery/tables
    BFF->>AIP: GET /api/v1/iqd/discovery/tables
    AIP->>MCP: MCP tool list_models / describe_model
    MCP-->>AIP: [tables]
    AIP-->>BFF: paged
    BFF-->>FE: paged
    FE-->>WIZ: tables

    DBA->>WIZ: 勾选 N 张表 → 进入列预览
    WIZ->>FE: useQuery(['iqd','discovery','columns',connId,s,t]) ×N
    FE->>BFF: GET /iqd/discovery/columns
    BFF->>AIP: GET /api/v1/iqd/discovery/columns
    AIP->>MCP: MCP tool describe_model(model_name)
    MCP-->>AIP: [columns + 主键推断]
    AIP-->>FE: columns
    FE-->>WIZ: 列预览（高 PK 推断列）

    DBA->>WIZ: 确认导入（mode=create_or_skip）
    WIZ->>FE: useMutation → POST /iqd/discovery/import
    FE->>BFF: POST {connectionId, tables:[...], mode, in_scope:false}
    BFF->>AIP: POST /api/v1/iqd/discovery/import
    AIP->>AIP: 查 iqd_catalog_item（connectionId, item_key 已存在?）
    alt 已存在 + mode=create_or_skip
        AIP-->>FE: {skipped:[...]}
    else 未存在 / 允许覆盖
        AIP->>MIS: POST /internal/v1/iqd/catalog/model/from-table × N
        MIS->>MIS: 落 iqd_catalog_item（kind=table/model/column, source=modeling）
        MIS->>MIS: bump current_edit_revision
        MIS-->>AIP: {edit_revision, edit_status: EDITED_UNSYNCED}
    end
    AIP-->>FE: {imported, skipped}
    FE->>FE: invalidateQueries(['iqd','catalog',connId])
    FE-->>WIZ: 导入完成，触发一次整连接 build

    par 异步整连接 build（沿用既有）
        MIS->>COORD: publishChangeEvent → SyncCoordinator 合并窗口
        COORD->>BLD: trigger_model_build(connectionId)
        BLD->>MIS: GET /get-catalog-full
        MIS-->>BLD: {mdl_raw, edited_items, current_edit_revision}
        BLD->>BLD: write manifest.json
        BLD->>CLIP: wren context build --mdl <dir>
        CLIP->>WREN: 重建 MDL + index
        BLD->>MIS: POST /enhance/catalog-backfill
        MIS-->>BLD: {stamped_count: N}
    and 前端发布流水线轮询
        FE->>BFF: GET /iqd/catalog/sync-status
        BFF->>MIS: 既有
        MIS-->>FE: {current_edit_revision, edit_status: SYNCING|SYNCED|...}
    end

    FE-->>WIZ: 跳转到建模台主页，画布可见新 table/model 节点
```

### 6.2 画布连线建关系 → build 写回（MR-05）

```mermaid
sequenceDiagram
    autonumber
    actor DBA as 语义建模者
    participant CAN as ModelCanvas (@xyflow/react)
    participant STORE as ModelingStore (zustand)
    participant FE as FE (TanStack Mutation)
    participant BFF as IqdModelingController
    participant MIS as IqdCatalogNodeService
    participant VCR as ValidateCatalogRefsService
    participant COORD as SyncCoordinator
    participant BLD as build_mdl_from_catalog
    participant WREN as wren serve mcp

    DBA->>CAN: 从 orders 节点锚点拖拽到 customers 节点
    CAN->>STORE: pushWizardStep('relationship-create') + 预填 source/target
    CAN-->>DBA: 弹 RelationshipDialog

    DBA->>CAN: 选 join=INNER, cardinality=1:N, condition=orders.customer_id=customers.id
    CAN->>FE: useMutation → POST /iqd/catalog/relationship
    FE->>BFF: POST {connectionId, item_key, patch:{...}, base_revision, idempotency_key}
    BFF->>MIS: createRelationship(req)

    MIS->>MIS: 幂等键查重 iqd_edit_idempotency
    MIS->>MIS: base_revision 乐观并发（不符 → 409）
    MIS->>VCR: validate(connId, itemKey, op='CREATE')
    VCR-->>MIS: {valid:true} | {valid:false, dependents:[...]}
    alt 引用校验失败
        MIS-->>FE: 422 + dependents 列表
        FE-->>CAN: 阻断弹窗
    else 校验通过
        MIS->>MIS: @Transactional 落 iqd_catalog_item (kind=relationship, source='modeling')
        MIS->>MIS: bump current_edit_revision
        MIS->>MIS: write iqd_edit_idempotency
        MIS->>MIS: publishChangeEvent
        MIS-->>FE: 200 {edit_revision, edit_status: EDITED_UNSYNCED}
    end

    FE->>STORE: clearDirty('mdl:relationship:orders_customers')
    FE->>FE: invalidateQueries(['iqd','catalog',connId])
    FE-->>CAN: 关系边立即出现在画布（乐观 UI）
    CAN->>CAN: invalidateQueries 完成后 reconcile 节点位置

    par 异步 build
        MIS->>COORD: trigger_model_build
        COORD->>BLD: build_mdl_from_catalog
        BLD->>BLD: 合并 mdl_raw + edited_items（含新关系）
        BLD->>BLD: wren context build
        BLD->>MIS: backfill_catalog_sync → built_edit_revision
    and 发布流水线轮询
        FE->>BFF: GET /iqd/catalog/sync-status
        BFF-->>FE: {edit_status: SYNCING → SYNCED}
    end

    DBA->>CAN: 跳转到 /iqd/test-chat 验证
    CAN-->>DBA: 「上月各客户订单数」命中 customers-orders join
```

### 6.3 Cube 编辑 → 派生 → 写回（MR-06）

```mermaid
sequenceDiagram
    autonumber
    actor DBA as 语义建模者
    participant DRAW as CubeEditor
    participant FE as FE
    participant BFF as IqdModelingController
    participant MIS as IqdCatalogNodeService
    participant VCR as ValidateCatalogRefsService
    participant COORD as SyncCoordinator
    participant BLD as build_mdl_from_catalog
    participant WREN as wren serve mcp

    DBA->>DRAW: 进入 Cube 编辑器 → 新建 cube "revenue"
    DRAW->>DRAW: 编辑 measures[{name:"total", expression:"SUM(amount)"}], dimensions[{name:"store_id", ref:"orders.store_id"}]
    DRAW->>FE: 提交前 validateExpression
    FE->>BFF: GET /iqd/catalog/validate-expression?modelRef=orders&expr=SUM(amount)
    BFF->>MIS: validateExpression
    MIS->>VCR: validate modelRef 列存在性
    VCR-->>MIS: {valid:true}
    MIS-->>FE: {valid:true}
    FE-->>DRAW: 通过

    DBA->>DRAW: 提交保存
    DRAW->>FE: useMutation → POST /iqd/catalog/cube
    FE->>BFF: POST {connectionId, item_key, patch:{...}, base_revision, idempotency_key}
    BFF->>MIS: createCube(req)
    MIS->>MIS: 幂等键 + 乐观并发
    MIS->>VCR: validate (model_ref + measures expressions)
    alt 校验失败（模型字段不存在/被引用阻断）
        MIS-->>FE: 422 + dependents
    else 通过
        MIS->>MIS: 落 cube + measures + dimensions 子节点（kind=cube/measure/dimension, source=modeling）
        MIS->>MIS: bump edit_revision + publishChangeEvent
        MIS-->>FE: {edit_revision, edit_status: EDITED_UNSYNCED}
    end

    par 异步 build（Cube→MDL 派生确认）
        BLD->>MIS: get_catalog_full → mdl_raw + edited_items (含 cube)
        BLD->>BLD: locate 'mdl:cube:revenue' → cubes[]
        BLD->>BLD: patch cube.name + cube.measures[] + cube.dimensions[]
        BLD->>WREN: wren context build --mdl <dir>
        WREN->>WREN: 编译 mdl.json + index
        BLD->>MIS: backfill_catalog_sync → wren_ref_id 回填
    and 发布流水线
        FE->>BFF: GET /iqd/catalog/sync-status
        BFF-->>FE: SYNCING → SYNCED
    end

    DBA->>DRAW: 跳到 test-chat 验证
    DBA-->>DRAW: 「上月客单价」命中 cube query_cube 通道
```

### 6.4 漂移详情 → 重新导入（MR-11）

```mermaid
sequenceDiagram
    autonumber
    participant FE as PublishPipelineBar (轮询)
    participant BFF as IqdModelingController
    participant MIS as IqdConnection (mis-iqd)
    participant RECON as IqdReconcileJobService (BFF 定时)
    participant AIP as IqdCli (ai-platform)
    participant WREN as wren serve mcp

    Note over RECON: 每 60s 扫一遍 current>built 或 stale_drift

    RECON->>AIP: getCurrentMdlHash(connectionId)
    AIP->>WREN: wren context show / wren get mdl
    WREN-->>AIP: current_mdl_hash
    AIP-->>RECON: hash

    RECON->>MIS: iqd_connection.built_mdl_hash
    MIS-->>RECON: hash

    alt 不一致
        RECON->>MIS: POST /internal/v1/iqd/enhance/drift {drift:true}
        MIS->>MIS: iqd_connection.stale_drift = true
        MIS-->>RECON: ok
    end

    FE->>BFF: GET /iqd/catalog/sync-status
    BFF->>MIS: 读 iqd_sync_job + iqd_connection
    MIS-->>BFF: {edit_status: STALE_DRIFT, stale_drift:true, ...}
    BFF-->>FE: STALE_DRIFT
    FE->>FE: PublishPipelineBar 标橙阻断 + 展开 DriftDetailPanel

    actor DBA as 语义建模者
    DBA->>FE: 点「重新导入」（二/四期 P1-3 入口）
    FE->>BFF: POST /iqd/catalog/sync-from-mdl?connectionId=…  （沿用既有 syncCatalogFromMdl）
    BFF->>MIS: syncCatalogFromMdl
    MIS->>MIS: @Transactional 拉 WrenAI 当前 MDL → 写 iqd_catalog_item (source=mdl)
    MIS->>MIS: 落 iqd_connection.mdl_raw (JSONB)
    MIS->>MIS: resetEditRevision(connId)
    MIS->>MIS: stale_drift = false
    MIS-->>BFF: {conflicts:[...], added:[...]}

    alt 有冲突（平台与 WrenAI 同字段不同值）
        BFF-->>FE: 草稿比对合并界面（沿用二/四期 P1-3）
        DBA->>FE: 人工逐项选择保留哪边
        FE->>BFF: POST /iqd/catalog/resolve-conflicts {decisions:[...]}
        BFF->>MIS: 应用决策 + 触发 build
    else 无冲突
        BFF-->>FE: 自动收敛
    end

    FE->>BFF: 再次 GET /iqd/catalog/sync-status
    BFF-->>FE: SYNCED
    FE-->>DBA: 漂移横幅消失，可继续编辑
```

---

## 7. 依赖包列表

### 7.1 前端（**pnpm**）

> **⚠️ 实施回写（2026-09-22）— 安装命令必须用 `pnpm add`，不是 `npm install`**：本仓 `frontend/mis-admin-web` **`node_modules` 是 pnpm 布局 + `pnpm-lock.yaml`**；`npm` 的 arborist 处理 `.pnpm/` 会报 **`Cannot read properties of null`**（装不上）。**依赖安装只用 `pnpm add`，构建/测试用 `pnpm build` / `pnpm test`**（历史门禁命令里的 `npm run build` 等仅为习惯写法，安装环节严禁 `npm`）。原始安装命令：
>
> ```bash
> pnpm add @xyflow/react@^12.3.0 @codemirror/state@^6.4.0 @codemirror/view@^6.30.0 \
>           @codemirror/lang-sql@^6.8.0 @codemirror/language@^6.10.0 \
>           @codemirror/commands@^6.5.0 @dagrejs/dagre@^1.1.4
> ```

```jsonc
{
  "dependencies": {
    // 既有（沿用）
    "@tanstack/react-query": "^5.x",          // 服务端状态
    "zustand": "^4.x",                          // UI 态
    "react": "^18.2.0",
    "react-router-dom": "^6.x",
    "@/components/ui/*": "shadcn/ui 既有",
    "lucide-react": "^0.x",                     // icon（新增登记见 §3.1 四处同改）
    // 增量
    "@xyflow/react": "^12.3.0",                 // 画布（懒加载，MR-14）
    "@codemirror/state": "^6.4.0",              // SQL/表达式编辑器（懒加载，MR-03/04/08）
    "@codemirror/view": "^6.30.0",
    "@codemirror/lang-sql": "^6.8.0",
    "@codemirror/language": "^6.10.0",
    "@codemirror/commands": "^6.5.0",
    "@dagrejs/dagre": "^1.1.4"                  // 一键自动布局（MR-S4）
  }
}
```

### 7.2 后端（Java/Maven）

```xml
<!-- mis-iqd 模块（沿用 V71/V8x/V8y，无新依赖）-->
<dependencies>
  <dependency>spring-boot-starter-web</dependency>
  <dependency>spring-boot-starter-data-jpa</dependency>
  <dependency>spring-boot-starter-validation</dependency>
  <dependency>flyway-core</dependency>
  <dependency>flyway-database-postgresql</dependency>
  <dependency>postgresql</dependency>
  <dependency>lombok</dependency> <!-- 可选 -->
</dependencies>
```

### 7.3 后端（BFF，无新依赖）

```xml
<!-- mis-admin-bff 既有 WebClient + Spring Web -->
<dependency>...</dependency>
```

### 7.4 后端（Python）

```toml
# agent/ai-platform/backend/pyproject.toml —— 既有
[tool.poetry.dependencies]
sqlglot = "*"           # 既有（血缘/翻译）
mcp = "*"               # 既有（MCP client）
fastapi = "*"
uvicorn = "*"
httpx = "*"
pydantic = "*"
# 无新增
```

### 7.5 部署侧（外部）

- `pip install wrenai==0.13.3`（钉版本，architecture §1.4）
- 端口段 `18080-18180`（multiconn §3.2）
- project 目录 `/var/lib/mis-iqd/wren-projects/{connId}`（multiconn §3.1）

---

## 8. 共享知识（跨文件约定，工程师必读）

### 8.1 命名 & 路径

| 范畴 | 约定 |
|---|---|
| 前端目录 | `features/agent/iqd/`（M1 迁移后，所有建模台增量文件落此） |
| 前端页面组件 | `<Kind><Action>Page.tsx`，导出 `Iqd<Kind><Action>Page`（与既有 `IqdConfigPage` 一致） |
| 建模台子组件 | `components/modeling/<Component>.tsx` 或 `components/wizard/<Wizard>.tsx` |
| API wire | snake_case（与后端 Java 字段对齐，PRD §1.3） |
| 后端端点 | `/api/v1/iqd/modeling/**`（建模台）+ `/api/v1/iqd/discovery/**`（表发现）+ `/api/v1/iqd/catalog/**`（既有节点编辑，建模台复用）；**Python Worker 侧同为 `/api/v1/iqd/discovery/**`**（**实施回写：非 `/internal/v1`**） |
| Python 端点 | **`/api/v1/iqd/discovery/**`**（a 点，**实施回写：非 `/internal/v1`**——`/internal/v1/**` 是 Java 侧内部面命名，Python Worker 全走 `/api/v1`） |
| 权限码 | `iqd:modeling:view` / `iqd:modeling:edit` / `iqd:modeling:publish`（**V87** 种子）；**⚠️ 建模台实际触达 7 个权限族**：`iqd:modeling:*` / `iqd:catalog:*` / `iqd:enhance:*`（含 `iqd:enhance:manage`）/ `iqd:mask:*` / `iqd:dimension:*` / `iqd:scope:*` / `iqd:mcp:manage` |
| 权限码 ID 段 | `92600-92699`（避 V69/V73/V77/V82 已用）——**实施落号**：`sys_menu` **92600 + 92631-92633**；`sys_api` **92601-92612**（V87）/ **92640-92644**（V88）/ **92650-92655**（V89）/ **92700**（V90）/ **92703**（V91）；分配规约见 `architecture.md §7.10` |
| Flyway 迁移 | V8x 二/四期已用；**建模台实际落 V87–V91**（见 `architecture.md §11.3`） |

### 8.2 权限码登记（**实际落 V87**，实施回写已订正）

```sql
-- V87__iqd_modeling_seed.sql（增量建模台权限码；+ V88 补登，见下）
-- ① sys_menu：**4 条**（⚠️ 不是 1 条）
--      · 92600  页面菜单（type=1，path=/iqd/modeling，icon='Workflow'）
--      · 92631  权限按钮（type=3，permission='iqd:modeling:view'）
--      · 92632  权限按钮（type=3，permission='iqd:modeling:edit'）
--      · 92633  权限按钮（type=3，permission='iqd:modeling:publish'）
--    ❗ 缺 3 个 type=3 按钮 ⇒ sys_role_permission(perm_type='menu', target_id) 无所指
--       ⇒ iqd:modeling:* 进不了 auth-store.permissions ⇒ PermissionGate **静默全拒**
-- ② sys_api：12 条（8 建模台端点 + 4 表发现端点，ids 92601-92612）→ V88 补 5 条（92640-92644）
-- ③ sys_menu_api 绑定：端点的权限码按 §3.3 均为 iqd:modeling:edit（挂 92632）；
--      查询类端点挂 view（92631）；触发类挂 publish（92633）（ids 92613-92624）
-- ④ sys_role_permission：role_id=1 授予 iqd:modeling:* 三个权限码（92625-92627，target_id 指向 92631/92632/92633）
-- ⑤ 固定 ID 段 + WHERE NOT EXISTS 幂等（同 V81 范式）；**新迁移补登，绝不改历史迁移**
```

### 8.3 事件名 & 缓存

| 事件名 | 触发方 | 消费方 | 行为 |
|---|---|---|---|
| `iqd.catalog.changed` | mis-iqd `IqdCatalogNodeService`（新建/编辑后） | ai-platform `IqdConfigClient` + BFF 缓存 | 失效 catalog 缓存，触发 SyncCoordinator |
| `iqd.layout.changed` | mis-iqd `IqdModelLayoutService` | ai-platform + 前端 | 失效 layout 缓存 |
| `iqd.config.changed` | mis-iqd `IqdAdminService`（既有，multiconn 扩） | ai-platform `IqdConfigClient` | 失效连接/字典/维度注册表缓存 |
| `iqd.mcp.status.changed` | multiconn `WrenMcpProcessManager` | 前端 `McpStatusCard` + `PublishPipelineBar` | 更新 MCP 状态徽标 |

### 8.4 幂等 key 格式

```
幂等 key 模板（前端生成 crypto.randomUUID()）：
  {connId}:{kind}:{action}:{uuid}

  示例：
    POST /catalog/model/from-table → "1:model:create:{uuid}"
    POST /catalog/relationship    → "1:relationship:create:{uuid}"
    POST /catalog/cube            → "1:cube:create:{uuid}"
    POST /catalog/calculated-column → "1:column:create:{uuid}"
    POST /modeling/layout/{id}/auto-layout → "1:layout:auto:{uuid}"

后端存储：iqd_edit_idempotency（connection_id, idempotency_key）→ edit_revision
查重语义：同 key 命中 → 返回首次结果，不二次 bump；同 key 不同 base_revision → 409（语义冲突）
```

### 8.5 状态机术语

```
edit_status 枚举（不落库，派生）：
  EDITED_UNSYNCED  - current > built，无在途
  SYNCING          - current > built，有 SyncCoordinator 在途
  SYNCED           - current == built 且 build_status=success
  SYNC_FAILED      - build_status=failed（最后终态）
  STALE_DRIFT      - 平台 built_mdl_hash ≠ WrenAI current hash

派生规则（不变，二/四期已定）：
  current == built && build_status == success → SYNCED
  current > built && job_in_flight            → SYNCING
  current > built && !job_in_flight           → EDITED_UNSYNCED
  build_status == failed                     → SYNC_FAILED
  built_mdl_hash ≠ current_mdl_hash           → STALE_DRIFT

幂等/并发：
  base_revision != current_edit_revision      → 409
  idempotency_key 命中                        → 返回首次结果
```

### 8.6 `item_key` 命名（沿用二/四期）

```
mdl:model:<name>                  model 节点
mdl:relationship:<name>           relationship 节点
mdl:cube:<name>                   cube 节点
mdl:measure:<cube>.<name>         cube 子 measure
mdl:dimension:<cube>.<name>       cube 子 dimension
mdl:view:<name>                   view 节点
mdl:metric:<name>                 metric 节点
mdl:dimension:<name>              dimension 节点（顶部 dimension）
<ds>.<schema>.<table>.<col>       column 节点（物理表/模型字段）
calc:<model>.<column_name>        calculated column 节点（新增，二/四期未含）
```

### 8.7 类型约定（前端 ↔ 后端 ↔ DB）

| 层 | 命名 | 例 |
|---|---|---|
| DB schema（snake_case） | `edit_revision`, `current_edit_revision`, `built_edit_revision`, `wren_ref_id`, `mdl_writeback_enabled` | `iqd_connection.current_edit_revision` |
| Java 实体（camelCase） | `currentEditRevision`, `builtEditRevision`, `wrenRefId`, `mdlWritebackEnabled` | `IqdConnection.currentEditRevision` |
| JSON wire（snake_case） | 与 DB 一致 | `{ "current_edit_revision": 13 }` |
| TypeScript wire（snake_case） | 与 JSON 一致 | `{ current_edit_revision: number }` |

---

## 9. 待明确事项（架构层 A-01 ~ A-N）

> 仅列出**架构层**仍需业务/工程拍板项；U1–U8（二/四期）、A1–A11（基线）、Q1–Q5（二/四期）已拍板的不重列。

| # | 项 | 影响 | 建议默认（拍板参考） | 谁拍板 |
|---|---|---|---|---|
| **A-01** | 建模台是否引入「字段级脱敏直编」的写后端点 `PUT /iqd/mask/affected`（沿用 mask 五类下拉），还是仅前端 PropertyPanel 直调既有 `mask-rule` API | MR-13 验收 | 复用既有 `PUT /api/v1/iqd/mask-rules`（增强页已用），PropertyPanel 直调同一端点；不新增建模台专属端口 | 主理人 |
| **A-02** | 建模台布局 dagre 算法跑在前端还是后端（影响一/二键整理性能与并发） | MR-S4 | **✅ 已落地（2026-09-22）**：**前端**（`@dagrejs/dagre` 算坐标 <2s/200 节点 → `PUT` 落库）；**后端 `auto-layout` 端点按设计不实现**，返回 **HTTP 501 + 业务码 50101**（区分「按设计不做」vs「还没做」503/50300） | 架构师 |
| **A-03** | 「重新导入」（MR-11）是否需要「建模台专属」入口，还是沿用既有 `/iqd/catalog` 页的 syncCatalogFromMdl 流程 | MR-11 入口 | 建模台 `PublishPipelineBar` 顶部「重新导入」按钮（per-connection）→ 跳到既有 `syncCatalogFromMdl` 比对合并界面（不复制流程）；保留 catalog 页入口 | 主理人 |
| **A-04** | 样本对 SQL 编辑器（MR-08）改造是否影响 v1.10 已落地的「DB 类型下拉 → 转化 → 试运行」交互 | MR-08 | **✅ 已遵守（2026-09-22）**：**未变**——仅把 SQL 文本框换成 CodeMirror 6，**v1.10 的三步交互（DB类型下拉 → 转化 → 试运行 → 保存）完全保留** | PM |
| **A-05** | 「视图模型」（`mdl:view:*`）是否本期支持建模台可视化编辑 | PRD §4 14 项未含 view，但 §1.2 提及 | 本期不支持，view 编辑沿用二/四期既有 `PUT /catalog/node`；建模台 view 节点只读展示（灰色 + tooltip "v2 增强"） | 主理人 |
| **A-06** | 指令「关联对象」字段（e 点）是否需要新建 `iqd_knowledge.related_item_keys` 列，还是复用现有 `content` JSON 字段内嵌 | e 点（MR-07/09） | **⚠️ premise 过时（2026-09-22 实测）**：`iqd_knowledge.related_item_keys` 列**早已存在**（`V71:218` JSONB）。实际是「**给已存在的列加应用层校验 + 下发裁剪**」，既非「新建列」也非「内嵌 content」 | 架构师 |
| **A-07** | 「自动布局」按钮（MR-S4）是否在建模台首次进入时自动触发，或仅手动 | MR-S4 | 仅手动（一键整理按钮 + 拖拽坐标持久化），首次进入保留画布原位 | PM |
| **A-08** | 「属性面板」（MR-14/09/13）字段列表默认折叠前 N 列，N = ? | MR-14 节点卡 | N=8（与 wren-ui 一致），可展开全字段 | PM |
| **A-09** | 「Cube 节点在画布角标」（PRD §6.2）是否支持点击进入 Cube 编辑器 | MR-14/06 联动 | 是，左键单击 Cube 角标进入 CubeEditor，权限码 `iqd:modeling:edit` | 主理人 |
| **A-10** | 计算列 expression 校验是同步（提交时校验）还是异步（保存后服务端再校） | MR-04 性能 | 提交前同步校验（前端 GET `/validate-expression` ≤200ms 给出结果），失败阻断保存；服务端再次校作为兜底 | 架构师 |
| **A-11** | 「画布布局」是否纳入 `iqd:modeling:publish` 权限码（拖拽坐标即写库）还是 `iqd:modeling:edit` | MR-S4 权限 | 纳入 `iqd:modeling:edit`（与节点编辑同语义；只读用户仅 GET，不 PUT） | 架构师 |
| **A-12** | 建模台「表发现」空连接时，是否提示「请先创建连接」（跳到连接向导） | MR-02 空态 | 是，空态卡引导跳 `/iqd/config` 创建连接向导 | PM |
| **A-13** | 画布 dagre 算法的方向（LR 横排 / TB 竖排）默认值 | MR-S4 | 默认 LR（横排），建模台右上角下拉切换 TB（竖排） | PM |
| **A-14** | 多连接（M1 假设 multiconn 已就绪）下「表发现」向导是否按 connId 隔离 wizard 状态 | MR-02 多连接 | 是，wizard 步骤状态存 zustand，按 connId 切；不跨连接记忆 | 架构师 |
| **A-15** | 建模台主页壳「三栏可拖拽调宽」是否本期实现 | PRD §MR-S1 验收 | 是，min 200/max 800px；折叠按钮置栏头；折叠状态入 `iqd_model_layout`（layout 版本号 +1） | PM |

---

## 10. 落地建议（任务分解文档见姊妹文档）

> 任务分解（5 个任务、M1/M2/M3 阶段、依赖图、风险与回退）见 [`mis-iqd-modeling-tasks.md`](mis-iqd-modeling-tasks.md)。

**关键路径**：M1（基础设施 + 单连接建模最小闭环）→ M2（建模全量）→ M3（治理增强）。

**硬前置**：multiconn T1（多连接 + MCP 状态落库）。

**降级路径**：若 multiconn 延期，M1 退化为「单连接建模」（连接向导暂留单条形态，画布/建模不阻塞；前端在路由层阻断 per-connection MCP 状态卡与 per-connection 自愈按钮）。

---

## 11. 实施期事实（2026-09-22 回写）

> 本节记录「设计稿之外、实施中才发现/新增」的事实，避免后续读者被设计稿误导。**8 处偏差的逐条订正已就地改在对应章节**（§4.1 / §4.3 / §4.4 / §4.5 / §7.1 / §8.1 / §8.2）；本节收纳**其余实施期事实（含计划外新增与已修缺口）**。

### 11.1 「模拟角色 WHERE 片段预览」接口从未落地（偏差 6）

- **设计稿**：T-W2-02a 验收 5 期望一个「模拟角色 WHERE 片段预览」接口。
- **代码现实**：**从未落地为 API**；`simulate_role_code` **仅是 `POST /iqd/ask` 的字段**（随 `metadata.iqd.simulate_role_code` 透传，`tools.py` / `scope_resolver.py` 消费）。
- **前端处置**：降级为**示意片段**——`rowScopeUtils` 明确产出「无专用预览端点」说明，结果恒标 **`degraded`**，不与真实注入混同。
- **状态**：**后续开放项**（见 §12 D）。

### 11.2 「字典」端点是 `dict-sync-status` 而非 `dictionaries`（偏差 7）

- **设计稿**：`GET /iqd/dictionaries`。
- **代码现实**：**不存在**。实际只有 **`GET /api/v1/iqd/scope/dict-sync-status`**（内部面 `GET /internal/v1/iqd/get-dict-sync-status`）。
- **回写**：§8.1 已按真实端点归正；`api/iqd.ts` 的 `fetchDictSyncStatus` 走的即此路径。

### 11.3 `edit_revision` 与 MDL 派生的两个关键缺口（**均已修**）

1. **`build_mdl_from_catalog` 原实现只能 patch 既有基线节点，无新增能力** ⇒ 平台新建的 cube / measure / dimension / relationship / 计算列**会被静默丢弃**。
   - **已修**：补 **`_materialize_missing_nodes()`**（把平台新建节点物化进 MDL）+ **`_collect_unmatched_edits` / `_log_unmatched_edits`**（**未落入 MDL 的编辑项转「可见告警」**，不再静默）。
   - 对应 commit/任务：**T03e**。
2. **仍未物化：全新 model（from-table 路径）**——因真实 WrenAI MDL 的 model schema（`refSql` vs 基线 `source`、`columns` 必填项）**未经 W0 实测校准**，盲写可能产出**非法 MDL 导致整条 build 崩**，故**刻意不物化**。
   - **需列入 W0 实测清单 + M3.1**（见 §12 D）。

### 11.4 `enabled is not False` 脆弱点（**已修**）

- `service.py` 原有 **5 处** `is not False` 写法**依赖 wire 恰为 bool**；`0 is False == False` ⇒ 若 wire 传 **int `0`**，会**静默漏过滤**（本应过滤的项被放过）。
- **已修**：统一走新的 **`is_enabled()` 纯函数**，不依赖具体 Python 类型。

### 11.5 A-02 裁决落地：`auto-layout` = 501/50101

见 §4.4 表内回写：**后端按设计不做 dagre**（HTTP **501** + 业务码 **50101** `NOT_IMPLEMENTED_BY_DESIGN`），前端 `@dagrejs/dagre` 算坐标 → `PUT` 落库。**协议层区分**「按设计不做」(501/50101) 与「还没做」(503/50300)。

### 11.6 Cube 级 upsert（T04a 计划外新增）

- 新增 **`PUT /api/v1/iqd/catalog/cube`**（sys_api **92700** / 迁移 **V90**）+ **`pruneOrphanChildren`** 孤儿清理（PUT 语义：缺省/空列表 = 清空该类子节点）。
- 补 PRD **MR-06「能建不能改」**缺口：`POST /catalog/cube` 是 create-only 双幂等（同 key 返回首次结果、不应用新字段），`PUT /catalog/node` 只能改单节点自身字段、动不了 measure/dimension 子节点。
- 与 `POST /catalog/cube`（**92606**）**并列**，同挂菜单 92632（`iqd:modeling:edit`）。

### 11.7 F-1 预存缺陷 + 修复范式（**偏差 8，必修项**）

- **缺陷**：`V76:32` 与 `V78:50` **争 `sys_api` id `92586`**；V76 版本号更小先占位 ⇒ V78 的 **`POST /api/v1/iqd/sql-pairs/translate` 的 `sys_api` 登记与 `sys_menu_api` 绑定双双被 `WHERE NOT EXISTS` 静默跳过** ⇒ `deny-unmapped` 下必然 **40300**（前端 MR-08「样本对方言转化」点了就报错；同批 `/trial` 不受影响）。
- **修复**：**`V91`** 用 `sys_api` **92703**（**复用 V78 原 code `00960011`** 保可追溯）+ `sys_menu_api` **92704** → 菜单 **92525**（`iqd:enhance:manage`）补登。
- **修复范式（教训）**：
  1. **`WHERE NOT EXISTS` 守卫 + 固定 ID 段** ⇒ 两迁移争同一编号段时**后者被静默丢弃、零报错**（系统性风险，已两次：`92158` / `92586`）。
  2. **新迁移补登，绝不改历史迁移**：Flyway 校验 checksum，改已应用迁移 ⇒ `Validate failed: Migration checksum mismatch` ⇒ **整条迁移链阻塞**（比 40300 更严重）。
  3. **已有先例**：`V51__agent_ops_skill_builder_chat_api_fix.sql` 用同法修了 `V29`/`V46` 争 `sys_api` **92158** 的同类缺陷（补登 **92176** / code **00920077**）。
  4. **V91 刻意不加 `EXISTS(sys_module)` 守卫**：模块缺失时让 `fk_api_module` **报错中止（fail-loud）**，优于静默跳过（后者正是 F-1 的病根）。
  5. ⇒ **已固化为正式约定**：见 `architecture.md §7.10`「ID 段位分配规约 + 冲突自检」。

### 11.8 权限码实为多族（不是 1 个）+ 派工前置自检

- **`iqd` 域实测 12 个命名空间 / 25 个码**：`acl` / `catalog` / `config` / `dimension` / `enhance` / `mask` / `mcp` / `modeling` / `scope` / `selfheal` / `test` / `trace`。
- **建模台直接触达 7 个**：`iqd:modeling:*` / `iqd:catalog:*` / `iqd:enhance:*`（含 `iqd:enhance:manage`，V78 `92586`→**V91 `92703`** 修正后仍绑菜单 **92525**）/ `iqd:mask:*` / `iqd:dimension:*` / `iqd:scope:*` / `iqd:mcp:manage`。
- **派工前置自检（正式约定）**：每次派工**先 grep `sys_api` / `sys_menu_api` 核实真码**，再决定前端放行与后端 `@PreAuthorize` 用哪一码——T04 阶段靠此避免了 **3 次「前端放行、后端 40300」**。

---

## 12. 实施小结

> 交付规模与门禁为**实测**；`已证 / 未证` 分界**照实写**（未真机证明前**一律不记通过**）。与 `architecture.md §11.4` 同源。

### 12.1 交付规模（实测）

- **18 个 commit**（`git log 134a5c7^..5b054fd` = 18；`134a5c7` 规划 → `5b054fd` V91 修 F-1；**brief 原述 20 与实测不符，以 18 为准**）。
- **门禁（全绿）**：前端 `typecheck` **0 error** / `vitest` **34 files 429 passed** / build 成功；Java mis-iqd **69 passed**；Python `-k iqd` **110 passed**。
- 三份新文档：`mis-iqd-modeling-verify-checklist.md` / `mis-iqd-modeling-runbook.md` / `frontend/.../iqd/README.md`。

### 12.2 已证（本沙箱可复核）

**7 项**：① 四处同改齐；② icon 无静默回退；③ 权限码前后端 **23 对 23** 全覆盖；④ seed ID 段无冲突；⑤ 命名边界；⑥ **7 条新写路径全 bump `edit_revision`**；⑦ 构建预算（CodeMirror 块 **65.8KB gzip ≪ 300KB**）。**跨阶段不变项 6/6**。三条门禁全绿。

### 12.3 未证（需真机，不得记「通过」）

**3 类**：① **M-G1 ~ M-G6 六条黄金用例全部未真机执行**（环境无 docker / 无 wren CLI / PG 非业务库）；② **M-G1 含红线**——依赖**模型物化**，未真机证明「问数可答」前**不得判通过**；③ **P-1/P-2/P-4/P-5/P-6 性能项**未验证。

### 12.4 开放项清单

| # | 开放项 | 归属 |
|---|---|---|
| 1 | **W0 真机实测**（校准真实 MDL model schema） | W0 |
| 2 | **全新 model（from-table）物化** | W0 实测 + M3.1 |
| 3 | **模拟角色 WHERE 片段预览端点** | 后续（前端暂 degraded） |
| 4 | **enhance 页权限闸门** | 待补 |
| 5 | **F-3 观察项**（`iqd:test:use` / `iqd:acl:save` 前后端不齐） | 观察 |
| 6 | **`@EnableMethodSecurity` 缺失** | 建议核对 |

---

## 13. 与 `architecture.md` 的关系（版本纪律）

- **`architecture.md` 已升 v1.12（基线 v1.11）**，建模台实施回写见其 **§11**；ID 段位正式约定见其 **§7.10**。
- **v1.10（样本增量）与 v1.11（建模台规划增量）历史编号含义未被改动**；`V76`/`V78`/`V81`/`V87`–`V91` 迁移文件**一字未改**（修复一律新迁移追加）。