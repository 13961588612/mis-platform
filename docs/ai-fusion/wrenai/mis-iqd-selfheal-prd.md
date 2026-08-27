# 增量 PRD：运维自愈三按钮（mis-iqd × WrenAI）

> 文档角色：mis-iqd 集成 WrenAI「运营完备性补全」阶段（任务 2）的增量 PRD，作为后续架构/工程/QA 的输入。
> 阶段：一期物料同步+问数执行、二期语义模型编辑写回 均 Sign-off 通过后，进入「运营完备性补全」。
> 状态：🔶 草案（待主理人拍板 Open Questions）｜日期：2026-08-28｜语言：中文
> 关联：前置 `mis-iqd-edit-prd.md`（二期）、`architecture.md §4.4 / D6`、`deploy-iqd.md`、`wrenai-ops-runbook.md`（任务3 同期产出）。

## 1. 项目信息

| 项 | 值 |
|---|---|
| Language | 中文 |
| Programming Language | 前端 Vite + React + MUI + Tailwind CSS（沿用 `frontend/mis-admin-web`）；后端复用 Python FastAPI（mis-iqd Worker，`service.py` / `iqd_cli.py`） |
| Project Name | `mis_iqd_selfheal` |
| 原始需求复述 | 让运维/管理员在平台内自助触发 WrenAI 的「强制重建 / 重新索引 / 模型校验」三类运维动作，减少登机敲 CLI 频次；动作进度对运维可见，高危动作带确认与告警。 |

## 2. 产品定义

### 2.1 产品目标（3 个，正交）

- **G1 自助化运维**：运维/管理员在平台内一键触发三类 WrenAI 运维动作，免登机手工敲 CLI（减少人工运维触点）。
- **G2 风险可控**：强制重建等高危动作带二次确认/gate，避免误伤在线问数（fail-closed 思维延伸）。
- **G3 状态可见**：复用现有 sync-job 状态机制 + 5000ms 轮询，动作进度/结果/失败对运维透明。

### 2.2 用户故事（运维角色）

- **US1**：作为运维，当平台检测到 MDL 漂移（STALE_DRIFT）时，我想一键「强制重建」，使线上语义上下文与平台基线重新收敛，而无需登机执行 `wren context build --force`。
- **US2**：作为运维，当知识/术语/样本对发生变更后，我想一键「重新索引」，使记忆（memory）重新生效，而无需登机执行 `wren memory reset` + `wren memory index`。
- **US3**：作为发布负责人，在语义模型上线前，我想一键「模型校验」，提前暴露 MDL 结构错误，避免上线后问数才失败。
- **US4（可选）**：作为运维，我想实时查看每个自愈动作的进度与 mdl_hash，判断何时可恢复在线查询。

## 3. 技术规范

### 3.1 需求池

| 优先级 | 编号 | 需求 | 验收口径 |
|---|---|---|---|
| P0 | REQ-1 | 后端 mis-iqd Worker 暴露三个触发端点：`force-rebuild` / `re-index` / `validate`，分别串联 `IqdCli` 原子（context_build 新增强制变体、`memory_reset`+`context_build`/`memory_index`、`context_validate`）。 | 三端点可达；强制变体不依赖增量、整库重建。 |
| P0 | REQ-2 | 三端点复用 `trigger_build_index` 的 `SyncResult` 上报机制（`report_sync_job`），将 `build_status`/`index_status`/`build_mdl_hash` 写入 sync-job 状态表。 | 动作结束在状态表可见 build_status；mdl_hash 回填。 |
| P0 | REQ-3 | 前端「连接配置」或「语义模型」页新增「运维自愈」操作区：3 个按钮（强制重建/重新索引/模型校验）+ 状态提示，风格复用 `CatalogSyncStatusBar`。 | 3 按钮可见可点；状态区复用 5 态徽标 + mdl_hash。 |
| P0 | REQ-4 | 前端以 **5000ms** 轮询复用现有 `/iqd/catalog/sync-status`（或同源 sync-job 状态接口）渲染进度/结果。 | 轮询间隔=5000ms；进行中徽标 SYNCING，完成 SYNCED。 |
| P0 | REQ-5 | `force-rebuild` 语义 = 强制忽略增量、整库重建（对应 `context build --force`），与现有增量 `context build` 区分。 | 强制重建覆盖增量短路路径。 |
| P1 | REQ-6 | `force-rebuild` 触发前弹二次确认（高危），文案提示将重建/中断在线语义上下文。 | 未确认不发起；确认后才调端点。 |
| P1 | REQ-7 | 任一动作失败（`build_status=failed` / `index_status=failed`）前端横幅告警（复用 STALE_DRIFT 横幅样式）+ 操作审计落同步日志。 | 失败即横幅；审计可读。 |
| P1 | REQ-8 | `validate` 失败时给出人可读错误摘要（MDL 结构问题点），引导运维修正后重试。 | 摘要含定位信息，非裸 stderr。 |
| P2 | REQ-9 | 批量触发（多连接循环）/ 定时触发（低峰 cron）。 | 可一次圈选多连接或排期。 |
| P2 | REQ-10 | 与现有 reconcile（STALE_DRIFT 重新导入）打通：漂移告警可直接跳到强制重建。 | 漂移横幅旁提供「强制重建」入口。 |

### 3.2 UI 设计稿（文字描述）

- **位置**：建议置于「语义模型」页（`iqd-catalog-page`）的编辑同步状态条（`CatalogSyncStatusBar`）下方，新增「运维自愈」操作区；备选「连接配置」页。
- **构成**：一行 3 个按钮（强制重建 / 重新索引 / 模型校验）；按钮右侧状态区复用 `CatalogSyncStatusBar` 的 5 态徽标（EDITED_UNSYNCED / SYNCING / SYNCED / SYNC_FAILED / STALE_DRIFT）+ `mdl_hash` 展示。
- **交互**：点击「强制重建」→ 二次确认弹窗（REQ-6）→ 调 `force-rebuild` 端点 → 按钮进入 loading + 状态区 5000ms 轮询刷新；完成后徽标转 SYNCED 并展示新 mdl_hash。
- **失败**：徽标转 SYNC_FAILED / STALE_DRIFT 样式 + 横幅（橙/红）复用 STALE_DRIFT 样式（REQ-7）。
- **复用**：轮询范式与徽标样式直接复用 `CatalogSyncStatusBar`（5000ms），不新造组件，降低前端改动面。

```
[ 运维自愈 ]  编辑态[已同步]  mdl a1b2c3d4…  构建 success   [强制重建][重新索引][模型校验]
                                   ↑ 漂移/失败时此处出横幅（复用 STALE_DRIFT 样式）
```

### 3.3 待确认问题（主理人拍板用）

- **Q1 按钮落点**：「语义模型」页（与 `CatalogSyncStatusBar` 同页、漂移告警顺手触发）还是「连接配置」页（运维常驻）？建议前者。
- **Q2 强制重建 gate**：在线有问数请求时是否禁用/排队，防误伤在线查询（G2）？建议带 gate + 二次确认。
- **Q3 轮询间隔**：沿用 5000ms 还是新建间隔？建议沿用，不新增配置。
- **Q4 动作粒度**：连接级（per `connection_id`）还是全局（单 profile / 单 WrenAI 实例）？现状 WrenAI 为单 profile 单实例，建议全局动作（与现有默认主连接一致）。
- **Q5 命令参数真机核实**：三个新 WrenAI 命令的精确参数（`--force` / `memory reset` / `context validate`）以 W0 真机实测为准（见 runbook §8 + `deploy-iqd.md §5`），上线前必须核对；本 PRD 按假定形态描述，工程侧不得臆造参数。

## 4. 范围与依赖

- **本 PRD 不含**：① 安装/升级 wrenai、② 启动 MCP 进程、③ LLM/embedding 配置、④ 新增业务库 bootstrap（`profile add` / `context set-profile` / 首次 `context build`）—— 这四类仍由运维人工执行（见 runbook），因涉及真实凭证，受 D6 约束不落平台。
- **依赖**：现有 `service.py`（`trigger_build_index` / `trigger_model_build`）、`iqd_cli.py`（`context_build` / `memory_index` / `get_current_mdl_hash`）、`CatalogSyncStatusBar` 组件、sync-job 状态接口。
- **代码现状提示**：`iqd_cli.py` 的 `profile_add`(L51) 与 `context_set_profile`(L69) 已定义但全仓零调用——属 bootstrap 两步，本 PRD 不涉及其接线（保持人工，符合 D6）。

## 5. 验收口径（摘要）

- P0 三端点 + 三按钮 + 5000ms 状态轮询 全部可用；动作结果在 sync-job 状态表可查。
- 强制重建经二次确认（P1）；失败有横幅 + 审计（P1）。
- 命令参数以 W0 实测核对（Q5），不臆造。
