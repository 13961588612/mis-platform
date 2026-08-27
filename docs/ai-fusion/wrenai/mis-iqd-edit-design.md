# mis-iqd 二期「语义模型编辑能力」增量设计文档

> 架构师：高见远（software-architect）｜ 语言：中文
> 配套输入：`mis-iqd-edit-prd.md`（PM 增量 PRD）、`mis-iqd-edit-architecture-review.md`、评审类图/时序图
> 代码依据：mis-iqd `IqdController/IqdInternalController/IqdAdminService/IqdCatalogItem/IqdConnection/IqdSyncJob`、BFF `IqdFacadeService/IqdClient/AiPlatformClient/IqdAclController/IqdProperties`、ai-platform `service.py/sync_coordinator.py/iqd_cli.py/iqd_config_client.py/iqd_enhance.py`、前端 `iqd-catalog-page.tsx/SyncStatusBar.tsx/lib/api/iqd.ts`（均已 Read 并比对）
> 决策依据：U1–U8（评审 §九 已拍板）；Q1–Q5 按主理人「建议默认」拍板落地（见 §〇）

---

## 〇、Q1–Q5 主理人决策落地

| # | 问题 | 主理人拍板 | 本文落地 |
| --- | --- | --- | --- |
| Q1 | 字段级 diff 预览 | 一期不做，仅当前值 + 保存 | 编辑弹窗只展示当前值 + 保存；`patch` 仅含待改字段，**不做 diff 预览**（P2 留待） |
| Q2 | 外部漂移重导入闭环 | 自动生成待审草稿 + 人工确认合并 | `STALE_DRIFT` 横幅 +「重新导入」引导进 `syncCatalogFromMdl` 生成待审草稿（P1-3 部分）；不自动强写 |
| Q3 | 依赖列表粒度 | 仅直接引用方（N 条），不递归 | `validateCatalogRefs` 返回**直接引用方列表**（cube/relation/sql_pair/knowledge 各取直接引用，无递归展开） |
| Q4 | 灰度首批连接 | 按连接开关即可，无需硬编码清单 | `mdl_writeback_enabled` 按连接粒度；预留 1 试点连接翻 `true`，代码中**不硬编码**任何连接 id |
| Q5 | 轮询间隔 | 沿用一期 `SyncStatusBar` 间隔 | 前端 `CatalogSyncStatusBar` 沿用一期 `5000ms` 轮询（`SyncStatusBar.tsx` 同值） |

---

## 一、实现方案 + 框架选型

**结论：沿用一期技术栈，无新增 npm / PyPI / Maven 包；外部前置仍为 `wren` CLI 支持 `context build --mdl`（一期已验证）。**

| 层 | 技术栈 | 二期变化 |
| --- | --- | --- |
| mis-iqd | Spring Boot + JPA + Flyway + WebFlux WebClient（BFF 侧） | 仅加列 + 新增 Service/Controller 方法；**无新依赖** |
| ai-platform | FastAPI + asyncio + httpx + subprocess 调 `wren` CLI | 仅新增 `build_mdl_from_catalog` / `get_catalog_full` / `backfill_catalog_sync` / `get_current_mdl_hash`；**无新依赖** |
| mis-admin-bff | Spring Boot + WebClient + RS256 透传 | 新增 3 端点 + 对账清扫定时任务；**无新依赖** |
| 前端 | React + MUI + Tailwind + lucide | 新增 3 API + 编辑弹窗 + `CatalogSyncStatusBar`；**无新依赖** |

**架构模式**：复用一期「平台先落库 → BFF best-effort → ai-platform `SyncCoordinator` 合并窗口 → `context build` + `memory_index` → 内部端点回填」闭环（fail-closed 哲学一致）。二期差异点仅三处（评审 §十）：
1. 平台 catalog 升格为**编辑权威**并加 `edit_revision` 状态机；
2. ai-platform 从平台 catalog **派生完整 MDL** 写回（G7，最关键）；
3. 补全引用校验 / 乐观并发 / 对账清扫（G4–G6）。

**核心不变量（必须维持）**：对任一连接，`平台.built_edit_revision 对应模型 == WrenAI.build_mdl_hash 所代表版本`；偏离即单边情况，由 `STALE_DRIFT` / 对账清扫收敛。

---

## 二、精确文件清单（增量视角，diff 优先）

> 标注：`[新建]` / `[修改]`；端：mis-iqd / ai-platform / bff / frontend。对照 PRD **P0-1~P0-12** 与评审 **T01–T05**。

### T01 — 编辑态数据模型与共享约定（基础设施）

| 文件 | 端 | 标注 | 职责 |
| --- | --- | --- | --- |
| `backend/mis-iqd/src/main/resources/db/migration/V8x__iqd_edit_state.sql` | mis-iqd | `[新建]` | Flyway 迁移：加列 + 幂等表 + 索引（见 §三） |
| `backend/mis-iqd/.../domain/entity/IqdConnection.java` | mis-iqd | `[修改]` | 加 `currentEditRevision`/`builtEditRevision`/`mdlWritebackEnabled`/`builtMdlHash`/`mdlRaw`(JSONB)/`staleDrift` 字段与 getter/setter |
| `backend/mis-iqd/.../domain/entity/IqdCatalogItem.java` | mis-iqd | `[修改]` | 加 `editRevision`(Long)/`wrenRefId`(String)；`source` 已存在（默认 `db_meta`），扩展允许值 `platform_edit`（应用层校验，无 DDL） |
| `backend/mis-iqd/.../domain/entity/IqdSyncJob.java` | mis-iqd | `[修改]` | 加 `editRevision`(Long)/`editSource`(String: materials\|model) |
| `backend/mis-iqd/.../domain/entity/IqdEditIdempotency.java` | mis-iqd | `[新建]` | 幂等去重表实体 `(connectionId, idempotencyKey)` → `editRevision`（P0-12） |
| `backend/mis-iqd/.../domain/repository/IqdConnectionRepository.java` | mis-iqd | `[修改]` | 加 `findPrimary()`（复用）、`stampBuiltRevision(conn,rev,hash)`、`setStaleDrift(conn,bool)` |
| `backend/mis-iqd/.../domain/repository/IqdCatalogItemRepository.java` | mis-iqd | `[修改]` | 加 `findEditedItems(conn)`、`stampCatalogSync(conn,hash,builtRev)`（批量 UPDATE）、`resetEditRevision(conn)`（重导入） |
| `backend/mis-iqd/.../domain/repository/IqdEditIdempotencyRepository.java` | mis-iqd | `[新建]` | `findByConnAndKey(conn,key)`、`save()` |
| `backend/mis-admin-bff/.../config/IqdProperties.java` | bff | `[修改]` | 加 `catalogEditPermission = "iqd:catalog:edit"`（新增权限码）；`mdlWritebackEnabled` 一期已存在，保留 |
| `backend/mis-iqd/.../IqdProperties.java`（mis-iqd 侧配置，如存在） | mis-iqd | `[修改]` | 试点连接 `mdlWritebackEnabled=true`（按连接，非硬编码 id） |

**复用**：`IqdSyncJob`、`IqdCatalogItem.editable`、`IqdProperties`、`IqdConnectionRepository.findByName/findByEnabledOrderByIdAsc`。

### T02 — ai-platform 模型派生 + 写回核心（G7）

| 文件 | 端 | 标注 | 职责 |
| --- | --- | --- | --- |
| `agent/ai-platform/backend/src/agent/mis_iqd/service.py` | ai-platform | `[修改]` | 新增 `trigger_model_build(connection_id, wait)` / `build_mdl_from_catalog(connection_id)`；`trigger_build_index` 增 `scope` 参数（materials\|model） |
| `agent/ai-platform/backend/src/adapters/iqd_config_client.py` | ai-platform | `[修改]` | 新增 `get_catalog_full(connection_id)` / `backfill_catalog_sync(payload)` / `get_catalog_sync_status(connection_id)` / `set_stale_drift(connection_id, bool)`；加对应端点常量 |
| `agent/ai-platform/backend/src/adapters/iqd_cli.py` | ai-platform | `[修改]` | 新增 `get_current_mdl_hash()`（S3 漂移检测：包裹 `wren get mdl` 或读部署产物，解析 mdl_hash）；`context_build` 已支持 `mdl_dir`（复用） |
| `agent/ai-platform/backend/src/agent/mis_iqd/sync_coordinator.py` | ai-platform | `[修改]` | `trigger(connection_id, wait, scope="materials")` 按 scope 派发 model / materials 构建（合并窗口语义不变） |
| `agent/ai-platform/backend/src/api/routes/iqd_enhance.py` | ai-platform | `[修改]` | `EnhanceSyncRequest` 加 `scope: str = "materials"`；`/enhance/sync` 透传；新增 `/enhance/reconcile` 端点（S9/S3 周期/手动对账） |

**复用**：`SyncCoordinator` 合并窗口、`IqdCli.context_build`/`memory_index`、`IqdConfigClient.backfill_enhancement_sync`/`report_sync_job`、`_parse_mdl_hash`/`_fallback_mdl_hash`。

### T03 — mis-iqd 编辑接口 + 校验 + 回填（落地 501）

| 文件 | 端 | 标注 | 职责 |
| --- | --- | --- | --- |
| `backend/mis-iqd/.../api/controller/IqdController.java` | mis-iqd | `[修改]` | `PUT /catalog/node` 501→200（调 `updateCatalogNode`）；新增 `GET /catalog/sync-status`、`POST /catalog/reconcile` |
| `backend/mis-iqd/.../api/controller/IqdInternalController.java` | mis-iqd | `[修改]` | 新增 `GET /get-catalog-full`（返回 mdl_raw + edited_items）、`POST /enhance/catalog-backfill`、`POST /enhance/drift`（置 stale_drift） |
| `backend/mis-iqd/.../domain/service/IqdAdminService.java` | mis-iqd | `[修改]` | 新增 `updateCatalogNode`/`validateCatalogRefs`/`backfillCatalogSync`/`getCatalogSyncStatus`/`reconcileCatalog`/`checkExternalDrift`；增强 `syncCatalogFromMdl`（存 mdl_raw + 重置 edit_revision） |

**复用**：`backfillEnhancementSync`（物料级，保留）、`reportSyncJob`（同连接覆盖写）、`syncCatalogFromMdl`（重导入收敛）、`IqdSyncJob`、`IqdChangeEventPublisher`。

### T04 — BFF 编排（编辑触发 + 状态 + 冲突 + 对账清扫）

| 文件 | 端 | 标注 | 职责 |
| --- | --- | --- | --- |
| `backend/mis-admin-bff/.../client/IqdClient.java` | bff | `[修改]` | 新增 `updateCatalogNode(conn, body)` / `getCatalogSyncStatus(conn)` / `reconcileCatalog(conn)` / `setStaleDrift(conn,bool)` |
| `backend/mis-admin-bff/.../service/iqd/IqdFacadeService.java` | bff | `[修改]` | `updateCatalogNode`（权限 `iqd:catalog:edit` + 409 友好转换）；`getCatalogSyncStatus`/`reconcileCatalog`；复用 `triggerSyncBestEffort` 触发 model 范围同步 |
| `backend/mis-admin-bff/.../controller/IqdAclController.java` | bff | `[修改]` | 新增 `PUT /catalog/node`、`GET /catalog/sync-status`、`POST /catalog/reconcile`（均走 `iqd:catalog:edit` 闸门） |
| `backend/mis-admin-bff/.../client/AiPlatformClient.java` | bff | `[修改]` | `syncEnhancements` 增 `scope` 参数；新增 `reconcile(connectionId)`（调 `/iqd/enhance/reconcile`） |
| `backend/mis-admin-bff/.../service/iqd/IqdReconcileJobService.java` | bff | `[新建]` | 定时（`@Scheduled`，如 60s）`scanDivergedConnections()`：扫描 `current>built` 或 `stale_drift` 连接 → 调 ai-platform 重新对账/构建（复用 `IqdScopeSyncJobService` 范式） |

**复用**：`IqdFacadeService.triggerSyncBestEffort`、`AiPlatformClient.syncEnhancements`、`IqdClient`、`IqdProperties`。

### T05 — 前端：catalog 编辑态 + 同步指示 + 冲突/依赖提示

| 文件 | 端 | 标注 | 职责 |
| --- | --- | --- | --- |
| `frontend/mis-admin-web/src/lib/api/iqd.ts` | frontend | `[修改]` | 新增 `updateIqdCatalogNode`/`getIqdCatalogSyncStatus`/`reconcileIqdCatalog` + 类型 `IqdCatalogEditStatus`/`IqdEditNodePayload`/`IqdCatalogSyncStatus`/`IqdDependents` |
| `frontend/mis-admin-web/src/features/agent/ai/iqd/iqd-catalog-page.tsx` | frontend | `[修改]` | 编辑弹窗（按 kind 渲染字段）、带 `base_revision`+`idempotency_key`、删除/改名前 `validateCatalogRefs` 依赖提示与 422 阻断、乐观 UI + 同步徽标；接 `CatalogSyncStatusBar` |
| `frontend/mis-admin-web/src/features/agent/ai/iqd/components/CatalogSyncStatusBar.tsx` | frontend | `[新建]` | 轮询 `GET /catalog/sync-status`，渲染 5 态徽标 + STALE_DRIFT 横幅 + 重试；沿用一期 5000ms 间隔 |

**复用**：一期 `SyncStatusBar` 轮询范式（5000ms）、`IqdCatalogItem` 类型、`iqd-catalog-page` 分组展示（KIND_ORDER）。

---

## 三、数据库迁移 SQL 草案（Flyway `V8x__iqd_edit_state.sql`）

```sql
-- ============================================================
-- mis-iqd 二期编辑态 + 写回闸门 + 外部漂移检测
-- 执行顺序：先加列，后建表/索引
-- 注意：iqd_catalog_item.source 列在一期已存在(默认 'db_meta'，syncCatalogFromMdl 写入 'mdl')，
--       本期仅“扩展允许值”为 'platform_edit'（应用层校验，无需 DDL）。
--       下列 mdl_raw / stale_drift / iqd_edit_idempotency 为 G7/S3/P0-12 正确性必要补充（见 §九待明确事项③）。
-- ============================================================

-- ===================== iqd_connection =====================
ALTER TABLE iqd_connection
    ADD COLUMN current_edit_revision BIGINT      NOT NULL DEFAULT 0,   -- 平台当前编辑版本（单调递增）
    ADD COLUMN built_edit_revision  BIGINT      NOT NULL DEFAULT 0,   -- 已写回 WrenAI 的版本
    ADD COLUMN mdl_writeback_enabled BOOLEAN    NOT NULL DEFAULT FALSE,-- 按连接灰度闸门（U7）
    ADD COLUMN built_mdl_hash       VARCHAR(255),                     -- 最近一次成功写回的 mdl_hash
    ADD COLUMN mdl_raw              JSON,                             -- 【补充·G7】基线完整 MDL（最近一次 WrenAI 同步快照）
    ADD COLUMN stale_drift          BOOLEAN    NOT NULL DEFAULT FALSE; -- 【补充·S3】外部漂移标记
-- 仅对漂移中连接建部分索引，便于对账扫描
CREATE INDEX idx_iqd_conn_stale_drift ON iqd_connection (stale_drift) WHERE stale_drift = TRUE;

-- ===================== iqd_catalog_item =====================
-- source 列已存在：取值 {db_meta(默认) | mdl | platform_edit(新增)}，无需 DDL
ALTER TABLE iqd_catalog_item
    ADD COLUMN edit_revision BIGINT,       -- 该节点最后被平台编辑所属 revision；NULL=从未编辑（沿用 WrenAI 镜像）
    ADD COLUMN wren_ref_id  VARCHAR(255);  -- 该节点被编入的 mdl_hash（批量回填盖章）；NULL=未同步
CREATE INDEX idx_iqd_ci_edit_rev ON iqd_catalog_item (connection_id, edit_revision);

-- ===================== iqd_sync_job =====================
ALTER TABLE iqd_sync_job
    ADD COLUMN edit_revision BIGINT,       -- 本次 build 对应连接 revision
    ADD COLUMN edit_source   VARCHAR(32);  -- materials | model

-- ===================== 幂等去重表（P0-12）=====================
CREATE TABLE iqd_edit_idempotency (
    idempotency_key VARCHAR(64)  NOT NULL,
    connection_id   BIGINT       NOT NULL,
    edit_revision   BIGINT       NOT NULL,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (connection_id, idempotency_key)
);
```

**枚举取值约定**：
- `iqd_catalog_item.source`：`db_meta` / `mdl` / `platform_edit`
- `iqd_sync_job.edit_source`：`materials` / `model`
- `edit_status`（派生，不落库）：`EDITED_UNSYNCED` / `SYNCING` / `SYNCED` / `SYNC_FAILED` / `STALE_DRIFT`

---

## 四、数据结构与接口（类图 mermaid）

完整类图见 **`mis-iqd-edit-design-class.mermaid`**（在评审类图基础上标注本期新增/修改字段与方法，并补充 `IqdEditIdempotency`、内部 `drift` 端点）。

要点（相对评审类图的增量）：
- **IqdConnection**：+`currentEditRevision:Long` +`builtEditRevision:Long` +`mdlWritebackEnabled:Boolean` +`builtMdlHash:String` +`mdlRaw:String(JSON)` +`staleDrift:Boolean`
- **IqdCatalogItem**：+`editRevision:Long` +`wrenRefId:String`（source 已存在，取值扩 `platform_edit`）
- **IqdSyncJob**：+`editRevision:Long` +`editSource:String`
- **IqdEditIdempotency**（新）：`connectionId` / `idempotencyKey`(PK 组合) / `editRevision` / `createdAt`
- **IqdAdminService**：`updateCatalogNode(conn,itemKey,kind,patch,baseRevision,idempotencyKey):Map` / `validateCatalogRefs(conn,itemKey,op):List<Dependent>` / `backfillCatalogSync(conn,mdlHash,builtRev):int` / `getCatalogSyncStatus(conn):Map` / `reconcileCatalog(conn):void` / `checkExternalDrift(conn):boolean`（复用 `backfillEnhancementSync`/`reportSyncJob`/`syncCatalogFromMdl`）
- **IqdController**：`PUT /catalog/node`(501→200) / `GET /catalog/sync-status` / `POST /catalog/reconcile`
- **IqdInternalController**：+`GET /get-catalog-full` / +`POST /enhance/catalog-backfill` / +`POST /enhance/drift`
- **BFF IqdFacadeService**：`updateCatalogNode(dto,auth,traceId):Map`(iqd:catalog:edit + 409处理) / `getCatalogSyncStatus(conn)` / `reconcileCatalog(conn)`（复用 `triggerSyncBestEffort`/`syncEnhancements`）
- **BFF IqdClient**：+`updateCatalogNode` / +`getCatalogSyncStatus` / +`reconcileCatalog` / +`setStaleDrift`
- **BFF IqdReconcileJobService**（新）：`scanDivergedConnections():void`
- **ai-platform IqdAskService**：+`trigger_model_build(conn,wait):SyncResult` / +`build_mdl_from_catalog(conn):dict`（复用 `trigger_build_index`/`_parse_mdl_hash`/`_fallback_mdl_hash`）
- **ai-platform IqdConfigClient**：+`get_catalog_full(conn)` / +`backfill_catalog_sync(payload)` / +`get_catalog_sync_status(conn)` / +`set_stale_drift(conn,bool)`
- **ai-platform IqdCli**：+`get_current_mdl_hash():str|None`（复用 `context_build`/`memory_index`）
- **ai-platform SyncCoordinator**：`trigger(conn,wait,scope)`（scope 派发）
- **前端**：`IqdCatalogPage.openEditModal/submitEdit/showDependents` / `CatalogSyncStatusBar.poll/render`

---

## 五、程序调用流程（时序图 mermaid）

完整时序见 **`mis-iqd-edit-design-sequence.mermaid`**（主线 A 编辑写回 + 分支 B 对账清扫 + S3 外部漂移）。

主线 A 关键步骤（编辑 → 写回 → 回填）：
1. 前端 `PUT /iqd/catalog/node {item_key,kind,patch,base_revision,idempotency_key}`
2. BFF 权限闸 `iqd:catalog:edit` + `mdl_writeback_enabled` 门控 → mis-iqd `updateCatalogNode`
3. mis-iqd `validateCatalogRefs`（S4/S5/S8 预校验，fail-closed）→ `base_revision` 乐观并发（不符 409）→ bump `current_edit_revision` → 幂等去重（同 key 不二次 bump）→ `@Transactional` 落库（置 `edit_revision`、更新 `source=platform_edit`）
4. 返回 `{edit_revision, edit_status=EDITED_UNSYNCED}` → BFF `triggerSyncBestEffort` → ai-platform `POST /iqd/enhance/sync(scope=model, wait=false)`
5. `SyncCoordinator` 合并窗口(3s) → `IqdAskService.trigger_model_build` → `IqdConfigClient.get_catalog_full` → mis-iqd `/get-catalog-full` 返回 `{mdl_raw, edited_items, current_edit_revision, built_edit_revision}`（连接级编辑版本随响应透传，key 命名与 sync-status 契约一致）
6. `build_mdl_from_catalog`：以 `mdl_raw` 为基线，按 `item_key→MDL节点` 映射 patch 编辑字段 → 写 `manifest.json` 临时目录 → `context_build(mdl_dir=tmp, sql_pairs, instructions, allow_write=true)`
7. build 成功 → `memory_index()`（失败仅标 `index_status=failed`，不阻断，沿用 Q6）→ `backfill_catalog_sync({conn, mdl_hash, edit_revision})` → mis-iqd `/enhance/catalog-backfill` 批量 UPDATE 盖章（`wren_ref_id`）→ `report_sync_job({edit_revision, edit_source='model', ...})` → mis-iqd 置 `built_edit_revision`/`built_mdl_hash`
8. build 失败 → `report_sync_job(build_status=failed)` → 前端见 `SYNC_FAILED`（红标，可重试）

---

## 六、任务清单 T01–T05 细化（文件级 + 接口契约 + 验收）

> 顺序：`T01 → (T02 ∥ T03) → T04 → T05`；T01 为基础设施；T02/T03 并行（运行期 ai-platform 回调 mis-iqd 内部端点，代码无交叉）。

### T01 — 编辑态数据模型与共享约定 ｜ 优先级 P0 ｜ 依赖：无

**源文件**（见 §二 T01 表）：迁移 SQL + `IqdConnection/IqdCatalogItem/IqdSyncJob` 实体 + `IqdEditIdempotency` 新实体 + 三个 Repository 增量 + BFF `IqdProperties.catalogEditPermission`。

**内部方法签名（Java）**：
- `IqdConnectionRepository.stampBuiltRevision(Long conn, Long rev, String hash)` — `@Modifying` UPDATE `built_edit_revision=? , built_mdl_hash=?`
- `IqdConnectionRepository.setStaleDrift(Long conn, boolean drift)` — `@Modifying` UPDATE `stale_drift=?`
- `IqdCatalogItemRepository.findEditedItems(Long conn)` — `WHERE connection_id=? AND edit_revision IS NOT NULL`
- `IqdCatalogItemRepository.stampCatalogSync(Long conn, String hash, Long builtRev)` — 见 §七 P0-8 SQL
- `IqdCatalogItemRepository.resetEditRevision(Long conn)` — 重导入时 `SET edit_revision=NULL, wren_ref_id=NULL`
- `IqdEditIdempotencyRepository.findByConnAndKey(Long conn, String key)`

**验收口径**：
- 迁移脚本在干净库与已有库均能执行（含索引/部分索引）；
- 实体字段与 SQL 列一一对应，JPA 启动无 schema 校验失败；
- `IqdProperties.catalogEditPermission` 返回 `"iqd:catalog:edit"`，权限码已注册（sys_api）。

### T02 — ai-platform 模型派生 + 写回核心（G7） ｜ 优先级 P0 ｜ 依赖：T01

**源文件**（见 §二 T02 表）：`service.py` / `iqd_config_client.py` / `iqd_cli.py` / `sync_coordinator.py` / `iqd_enhance.py`。

**内部方法签名（Python）**：
- `IqdAskService.trigger_model_build(self, connection_id, wait) -> SyncResult`
- `IqdAskService.build_mdl_from_catalog(self, connection_id) -> tuple[str, dict]`（返回 `(mdl_dir, payload)`，mdl_dir 为写入 `manifest.json` 的临时目录）
- `IqdConfigClient.get_catalog_full(self, connection_id) -> dict`（GET `/internal/v1/iqd/get-catalog-full`）
- `IqdConfigClient.backfill_catalog_sync(self, payload) -> dict`（POST `/internal/v1/iqd/enhance/catalog-backfill`）
- `IqdConfigClient.get_catalog_sync_status(self, connection_id) -> dict`
- `IqdConfigClient.set_stale_drift(self, connection_id, drift: bool) -> dict`
- `IqdCli.get_current_mdl_hash(self) -> str | None`

**接口契约（JSON schema）**：
- 内部 `GET /internal/v1/iqd/get-catalog-full?connectionId=1`：
  ```json
  {
    "connection_id": 1,
    "mdl_raw": { "models":[...], "relationships":[...], "cubes":[...], "views":[...], "metrics":[...], "dimensions":[...] },
    "edited_items": [
      {"item_key":"mdl:model:orders","kind":"model","display_name":"订单","description":"订单主表","expression":null},
      {"item_key":"mdl:cube:revenue","kind":"cube","display_name":"营收","description":null,"expression":"..."}
    ]
  }
  ```
- 内部 `POST /internal/v1/iqd/enhance/catalog-backfill` body：
  ```json
  {"connection_id":1,"mdl_hash":"abc123...","edit_revision":13}
  ```
  → `{"stamped_count": 42}`
- 内部 `POST /internal/v1/iqd/enhance/drift` body：`{"connection_id":1,"drift":true}` → `{"ok":true}`
- ai-platform `POST /iqd/enhance/sync` body（扩 `scope`）：`{"connection_id":1,"wait":false,"scope":"model"}`
- ai-platform `POST /iqd/enhance/reconcile` body：`{"connection_id":1}` → `{"triggered":true}`

**G7 数据流（最关键，详见 §七 G7）**。`build_mdl_from_catalog` 与一期 `trigger_build_index` 的区别：
- 一期 `trigger_build_index`：仅把 `sql_pairs`+`instructions` 注入 `context_build`，**不重排模型**（tables/relations/cubes 仍由 WrenAI 既有 MDL 决定）；
- 二期 `build_mdl_from_catalog`：**以 `mdl_raw` 为基线完整 MDL**，按 `edited_items` 的 `item_key→MDL节点` 映射 patch `display_name→name`/`description`/`expression`，写出 `manifest.json`，再 `context_build(mdl_dir=tmp, sql_pairs, instructions, allow_write=true)` 一次部署「模型 + 物料」。

**验收口径**：
- 对试点连接编辑一个 cube 的 `display_name` 后触发 `scope=model`，WrenAI 侧 `get mdl` 返回该 cube 名称已更新；
- `build_mdl_from_catalog` 对未编辑节点保持 `mdl_raw` 原值（全量 patch 幂等，同输入同 hash）；
- `get_current_mdl_hash` 在 WrenAI 不可达时返回 `None`（不抛，降级为不漂移判定）。

### T03 — mis-iqd 编辑接口 + 校验 + 回填（落地 501） ｜ 优先级 P0 ｜ 依赖：T01

**源文件**（见 §二 T03 表）：`IqdController.java` / `IqdInternalController.java` / `IqdAdminService.java`。

**内部方法签名（Java）**：
- `Map<String,Object> updateCatalogNode(Long connectionId, String itemKey, String kind, Map<String,Object> patch, Long baseRevision, String idempotencyKey)`
- `List<Map<String,Object>> validateCatalogRefs(Long connectionId, String itemKey, String op)` — `op∈{EDIT,DELETE}`；返回直接引用方（最多 N 条，不递归）；无引用返回空
- `int backfillCatalogSync(Long connectionId, String mdlHash, Long builtRevision)`
- `Map<String,Object> getCatalogSyncStatus(Long connectionId)`
- `void reconcileCatalog(Long connectionId)`
- `boolean checkExternalDrift(Long connectionId)`

**接口契约（JSON schema）**：
- `PUT /api/v1/iqd/catalog/node`（501→200）：
  - 请求：`{"item_key":"mdl:model:orders","kind":"model","patch":{"display_name":"订单","description":"订单主表","expression":null},"base_revision":12,"idempotency_key":"uuid-xxxx"}`
  - 成功 200：`{"edit_revision":13,"edit_status":"EDITED_UNSYNCED","wren_ref_id":null}`
  - 冲突 409：`{"code":40900,"message":"并发编辑冲突：当前版本已变更","data":{"current_edit_revision":13}}`
  - 引用阻断 422：`{"code":42200,"message":"该节点被引用，禁止删除/改名","data":{"dependents":[{"item_key":"mdl:cube:revenue","kind":"cube"},...]}}`
- `GET /api/v1/iqd/catalog/sync-status?connectionId=1`：
  ```json
  {"connection_id":1,"current_edit_revision":13,"built_edit_revision":12,
   "edit_status":"EDITED_UNSYNCED","build_status":"success","index_status":"success",
   "mdl_hash":"abc123...","stale_drift":false}
  ```
- `POST /api/v1/iqd/catalog/reconcile?connectionId=1` → `{"triggered":true}`

**验收口径**：
- `PUT /catalog/node` 不再 501；`base_revision` 不符返回 409 且 body 含 `current_edit_revision`；
- 同 `idempotency_key` 重复提交返回首次结果且 `edit_revision` 不二次 bump（查 `iqd_edit_idempotency`）；
- 删除被 cube 引用的表/列 → 422 且 `dependents` 仅直接引用方（不递归）；
- 重命名被引用节点 → 422（U1）。

### T04 — BFF 编排（编辑触发 + 状态 + 冲突 + 对账清扫） ｜ 优先级 P0 ｜ 依赖：T02, T03

**源文件**（见 §二 T04 表）：`IqdClient.java` / `IqdFacadeService.java` / `IqdAclController.java` / `AiPlatformClient.java` / `IqdReconcileJobService.java`(新)。

**内部方法签名（Java）**：
- `IqdFacadeService.updateCatalogNode(Map dto, String auth, String traceId) -> Map`（权限 `iqd:catalog:edit`；mis-iqd 返 409 时转换为友好冲突视图）
- `IqdFacadeService.getCatalogSyncStatus(Long conn) -> Map`
- `IqdFacadeService.reconcileCatalog(Long conn) -> Map`
- `IqdReconcileJobService.scanDivergedConnections() -> void`（`@Scheduled(fixedDelay=60000)`；扫 `current>built` 或 `stale_drift` 连接 → `aiPlatformClient.reconcile(conn)`）
- `AiPlatformClient.reconcile(Long conn) -> Map`（POST `/iqd/enhance/reconcile`）

**接口契约（BFF 对外，权限码 `iqd:catalog:edit`）**：
- `PUT /api/v1/iqd/catalog/node`、`GET /api/v1/iqd/catalog/sync-status`、`POST /api/v1/iqd/catalog/reconcile`（契约同 §三 T03，仅路径前缀 `/iqd/` 经 BFF）

**验收口径**：
- 三端点均需 `iqd:catalog:edit`，缺权 403；
- `updateCatalogNode` 收到 mis-iqd 409 时向前端返回友好冲突结构（含 `current_edit_revision`），不裸透 500；
- `IqdReconcileJobService` 周期运行：制造 `current>built` 偏离后 ≤60s 内被重新触发写回并收敛为 `SYNCED`；
- **不硬编码任何连接 id**（Q4）：试点连接通过 `mdl_writeback_enabled=true` 配置开启。

### T05 — 前端 catalog 编辑态 + 同步指示 ｜ 优先级 P0 ｜ 依赖：T04

**源文件**（见 §二 T05 表）：`lib/api/iqd.ts` / `iqd-catalog-page.tsx` / `components/CatalogSyncStatusBar.tsx`(新)。

**前端 API 签名（TypeScript）**：
- `updateIqdCatalogNode(connectionId, payload: IqdEditNodePayload): Promise<{edit_revision:number; edit_status:string; wren_ref_id:string|null}>`
- `getIqdCatalogSyncStatus(connectionId): Promise<IqdCatalogSyncStatus|null>`
- `reconcileIqdCatalog(connectionId): Promise<{triggered:boolean}>`
- 类型：`IqdEditNodePayload {item_key; kind; patch:{display_name?;description?;expression?}; base_revision:number; idempotency_key:string}`、`IqdCatalogSyncStatus {connection_id; current_edit_revision; built_edit_revision; edit_status; build_status; index_status; mdl_hash; stale_drift}`、`IqdDependents {item_key; kind}[]`

**验收口径**：
- 编辑弹窗仅对 `mdl_writeback_enabled && editable` 节点可点（Q4 门控 + 一期 `editable`）；
- 提交携带 `base_revision` + `idempotency_key`(crypto.randomUUID())；收到 409 展示「版本已变更（当前 N），点重读」引导（P1-2）；
- 删除被引用节点 → 422 依赖阻断弹窗列出直接引用方并禁用确认（P1-1）；
- `CatalogSyncStatusBar` 渲染 5 态（沿用一期 5000ms 轮询）；`STALE_DRIFT` 显示橙标 + 横幅「检测到外部变更，请重新导入」并引导 `syncCatalogFromMdl`（P1-3/Q2）。

---

## 七、重点：G7 完整 MDL 派生 + P0-8 批量回填

### 7.1 G7 — ai-platform 从平台 catalog 派生完整 MDL（最关键）

**为什么需要 `mdl_raw`**：一期 `syncCatalogFromMdl` 把 WrenAI MDL **扁平化**存入 `iqd_catalog_item`，会丢失模型 `source`（物理表映射）与 relationship 的 `models` 数组等结构信息。若仅从扁平 catalog 反推 MDL，relationship 将缺少 `models` 列表、model 缺少 `source`，导致 `context build` 失败。故采用 **「基线快照 + 编辑 patch」** 方案（fail-closed、对全部节点类型稳健）：

**数据流（端到端）**：
```
前端编辑 → BFF.updateCatalogNode → mis-iqd.updateCatalogNode
   （落库：bump current_edit_revision，置 item.edit_revision=current，source=platform_edit）
        ↓ triggerSyncBestEffort(scope=model)
ai-platform POST /iqd/enhance/sync(scope=model,wait=false)
        ↓ SyncCoordinator 合并窗口(3s)
IqdAskService.trigger_model_build
        ↓ IqdConfigClient.get_catalog_full(conn)
mis-iqd GET /get-catalog-full  →  { mdl_raw, edited_items[] }
        ↓
build_mdl_from_catalog(conn):
   1. mdl = deepcopy(mdl_raw)                       # 基线完整 MDL（最近一次 WrenAI 同步）
   2. for it in edited_items:                        # 平台已编辑的节点
        node = locate(mdl, it.item_key)             # item_key→MDL节点 映射（下表）
        node["name"]        = it.display_name  (if not None)
        node["description"] = it.description   (if not None)
        node["expression"]  = it.expression    (if not None)  # cube/view/measure
   3. 写临时目录 manifest.json（WrenAI MDL 布局：顶层 models/relationships/cubes/views/metrics/dimensions）
   4. cli.context_build(mdl_dir=tmp, sql_pairs=<materials>, instructions=<materials>, allow_write=True)
   5. mdl_hash = _parse_mdl_hash(stdout)  (失败回退 _fallback_mdl_hash)
   6. cli.memory_index()                              # 失败仅标 index_status=failed（沿用 Q6）
   7. client.backfill_catalog_sync({conn, mdl_hash, edit_revision})
   8. client.report_sync_job({edit_revision, edit_source="model", build_status, index_status, ...})
        ↓
mis-iqd: built_edit_revision=edit_revision, built_mdl_hash=mdl_hash
```

**`item_key → MDL 节点` 映射（patch 定位规则）**：
| catalog item_key 形态 | MDL 节点定位 |
| --- | --- |
| `mdl:model:<name>` | `models[]` where `name==<name>` |
| `<ds>.<schema>.<table>.<col>` | `models[name==<table>].columns[]` where `name==<col>`（tableKey=`ds.schema.table`，MDL model name==table） |
| `mdl:relationship:<name>` | `relationships[]` where `name==<name>` |
| `mdl:cube:<name>` | `cubes[]` where `name==<name>` |
| `<cubeKey>.<measure>`（cubeKey=`mdl:cube:<cube>`） | `cubes[name==<cube>].measures[]` where `name==<measure>` |
| `mdl:metric:<name>` | `metrics[]` where `name==<name>` |
| `mdl:dimension:<name>` | `dimensions[]` where `name==<name>` |
| `mdl:view:<name>` | `views[]` where `name==<name>` |

**与一期 `trigger_build_index` 的本质区别**：一期只注入 `sql_pairs`/`instructions`（物料），模型结构仍由 WrenAI 既有 MDL 决定；二期 `build_mdl_from_catalog` **产出完整 MDL 文件**（`--mdl`）并一次部署「模型 + 物料」。

**`mdl_raw` 写入时机**：增强 `syncCatalogFromMdl`——在解析 MDL 写 catalog 的同时，把原始 `mdlJson`（解析前的完整对象）存入 `iqd_connection.mdl_raw`（JSONB），并 `resetEditRevision(conn)`（重导入 = 新基线，清空历史 edit_revision/wren_ref_id）。试点连接若从未同步（mdl_raw=null），`build_mdl_from_catalog` 降级为「仅从 edited_items 重建」（缺失 structure 时标 `SYNC_FAILED` 并提示先做一次 MDL 同步，fail-closed）。

### 7.2 P0-8 — 按 revision 批量回填（消除一期逐条循环部分盖章）

**调用点**：`build_mdl_from_catalog` build 成功后 → `IqdConfigClient.backfill_catalog_sync({connection_id, mdl_hash, edit_revision})` → mis-iqd `POST /enhance/catalog-backfill` → `IqdAdminService.backfillCatalogSync`。

**mis-iqd 实现（单条批量 UPDATE，断点续盖）**：
```java
@Transactional
public int backfillCatalogSync(Long connectionId, String mdlHash, Long builtRevision) {
    // 批量盖章：edit_revision 非空 且 ≤ 本次 built 且 尚未盖此 hash 的节点
    int n = catalogItemRepository.stampCatalogSync(connectionId, mdlHash, builtRevision);
    // 连接级 built 态推进
    connectionRepository.findPrimary(connectionId).ifPresent(c -> {
        c.setBuiltEditRevision(builtRevision);
        c.setBuiltMdlHash(mdlHash);
        connectionRepository.save(c);
    });
    return n;
}
```
**Repository（JPQL / 原生 SQL，对应共享知识 WHERE 规则）**：
```sql
UPDATE iqd_catalog_item
SET wren_ref_id = :hash, updated_at = CURRENT_TIMESTAMP
WHERE connection_id = :conn
  AND edit_revision IS NOT NULL
  AND edit_revision <= :built
  AND (wren_ref_id IS NULL OR wren_ref_id <> :hash);
```
> 断点续盖语义：`edit_revision <= built` 表示「本次已纳入构建的编辑」；`wren_ref_id <> hash` 跳过已盖章节点，使中途失败重跑可补齐且不重复改写（U8 / S7）。物料级 `backfillEnhancementSync` 保留不变（按 sql_pair/knowledge id 循环，职责分离）。

---

## 八、依赖包列表

**无新增依赖包**（与评审 §七一致）：
- mis-iqd：JPA / Flyway / WebClient（既有）
- ai-platform：httpx / asyncio / subprocess（既有）；`wren` CLI 部署侧已验证支持 `context build --mdl`
- mis-admin-bff：WebClient / `@Scheduled`（Spring 既有）
- 前端：react / mui / tailwind / lucide（既有）

---

## 九、共享知识（跨文件约定，工程师必读）

1. **`edit_revision` 类型与比较**：`BIGINT`，连接级单调递增，从 0 起。每次 `PUT /catalog/node` 成功 → 该连接 `current_edit_revision += 1`；被编辑节点 `edit_revision = current`。比较 `current_edit_revision > built_edit_revision` ⇒ `EDITED_UNSYNCED`；相等且 build 成功 ⇒ `SYNCED`。
2. **`edit_status` 枚举字符串（统一大写）**：`EDITED_UNSYNCED` / `SYNCING` / `SYNCED` / `SYNC_FAILED` / `STALE_DRIFT`（派生计算，不落库；前端/后端/BFF 三端一致）。
3. **`idempotency_key` 生成与去重**：前端 `crypto.randomUUID()` 生成；服务端按 `(connection_id, idempotency_key)` 查 `iqd_edit_idempotency`，命中则返回首次结果且**不二次 bump**；未命中则落库新 `edit_revision` 并记 key。
4. **`base_revision` 冲突 409 响应体**：`{"code":40900,"message":"并发编辑冲突：当前版本已变更","data":{"current_edit_revision":<N>}}`；客户端凭 `current_edit_revision` 重读后重试（U2）。
5. **`STALE_DRIFT` 触发与阻断**：周期（BFF `IqdReconcileJobService` / ai-platform `/enhance/reconcile`）比对 WrenAI 当前 `mdl_hash`（`IqdCli.get_current_mdl_hash`）与 `built_mdl_hash`；不一致 ⇒ `stale_drift=true`（mis-iqd `/enhance/drift`）。此后编辑触发的 build **被阻断**（返回失败/提示先重新导入），直至 `syncCatalogFromMdl` 重新导入收敛（清 `edit_revision`/`wren_ref_id`、更新 `built_mdl_hash`、置 `stale_drift=false`）（U3/S3）。
6. **`mdl_writeback_enabled` 门控位置（双闸门）**：① mis-iqd 落库门控——仅 `mdl_writeback_enabled=true` 的连接允许 `PUT /catalog/node` 真正 bump（否则 403/501）；② BFF 权限闸 `iqd:catalog:edit`（缺权 403）。二者同时生效（Q4 按连接粒度，不硬编码 id）。
7. **批量 UPDATE 断点续盖 WHERE**：`edit_revision IS NOT NULL AND edit_revision <= :built AND (wren_ref_id IS NULL OR wren_ref_id <> :hash)`（见 §7.2）。
8. **`source` 取值**：`db_meta`（DB 元数据快照）/ `mdl`（WrenAI 镜像）/ `platform_edit`（平台编辑，本期新增）；编辑落库时置 `platform_edit`。
9. **`edit_source`（iqd_sync_job）取值**：`materials`（一期物料）/ `model`（二期模型写回）。

---

## 十、待明确事项（仅真正需澄清，不重复 U1–U8）

1. **`mdl_raw` 存储格式兼容性**：WrenAI `context build --mdl <dir>` 的目录布局（是否单一 `manifest.json` 或分散文件）需部署侧一期已验证样本对齐；若布局不同，`build_mdl_from_catalog` 写盘格式需相应调整（不影响接口契约）。
2. **`IqdCli.get_current_mdl_hash` 实现方式**：WrenAI 是否提供「读当前部署 mdl_hash」的轻量子命令（`wren get mdl` / 部署清单读取）；若仅能经 build 产物回推，则 S3 漂移检测退化为「下次 build 前后 hash 比对」，需在 review 阶段确认。
3. **G7/S3/P0-12 三项补充 schema 已纳入迁移 SQL**：`iqd_connection.mdl_raw(JSONB)`、`iqd_connection.stale_drift`、`iqd_edit_idempotency` 表为本期正确性必要补充（非原评审 T01 列清单所列）。如主理人/PM 希望严格只加原列，则需改用「重建式 MDL 派生」并承担 relationship/models 结构丢失风险——**默认按本文（带补充列）实现**。

> 上述 3 项均为实现细节确认，不阻塞开工；U1–U8 与 Q1–Q5 已全部拍板。
