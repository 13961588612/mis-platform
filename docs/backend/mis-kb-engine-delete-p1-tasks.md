# 知识库引擎策略 P1 增量任务分解

> 架构：高见远 ｜ 依据：P0 设计 `docs/backend/mis-kb-engine-delete-p0-tasks.md`（commit `1d5a796` 主体 + `b22426e` 加固，mis-kb 345/0、BFF 218/0、前端 typecheck 0 错）
> 范围：P1（4 项全做）。P2（RAGFLOW 升级 + delete-supported 灰度）见文末「不在本次范围」。
> 语言：简体中文。本文件只产出**任务分解与增量设计**，不写代码文件。

---

## 0. 交付总览

| 任务 | 名称 | 依赖 | 落点 | 优先级 |
|---|---|---|---|---|
| **T0** | 权限码 / 实体 / 日志表 / 迁移（P1 公共地基） | — | V27 迁移 + `KbEngineOrphan` + `KbEngineRenameLog` 实体与仓储 | P1 |
| **T1** | 其余 3 个 `KbLibraryPicker` 调用点迁 combobox | T0（仅需 combobox 加 1 个可选属性） | `kb-document-page` / `kb-hit-test-page` / `kb-qa-page` + combobox 小改 | P1 |
| **T2** | 取消归档自动改回引擎名 + 对账预期名一致性 | T0 | `KbLibraryService.update` + `KbEngineReconcileService` + 前端库页 | P1 |
| **T3** | `kb_engine_orphan` 认领/清理操作全链路 | T0 | `KbEngineOrphanService` + `EngineConfigController` + `KbController`(BFF) + 前端孤儿面板 | P1 |
| **T4** | 存量库 dataset 重命名（受控端点，dry-run + 执行 + 回滚） | T0 | `KbEngineLegacyRenameService` + `EngineConfigController` + `KbController`(BFF) + 前端重命名卡片 | P1 |

**依赖链有意做浅**：T0 是唯一的公共前置，T1/T2 互不依赖可并行编码（T1 是纯前端，T2 是后端+前端），T3/T4 只依赖 T0、彼此不互相等。推荐执行顺序 `T0 → T1 → T2 → T3 → T4`（风险递增）。

```
        ┌─ T1（纯前端 combobox 迁移）─┐
T0 ─────┼─ T2（取消归档回滚）─────────┼─→ 全部完成
        ├─ T3（orphan 认领/清理）──────┤
        └─ T4（存量重命名）───────────┘
```

---

## 1. 共享约定（P1 内跨任务，动手前读完）

### 1.1 新增权限码（P1 共 3 个，挂载点见 T0 的 V27）

| 权限码 | 语义 | 挂载端点 | 与既有码的关系 |
|---|---|---|---|
| `kb:engine:orphan:handle` | 游离 dataset 处置（认领/新建认领/忽略） | `POST /kb/engine/orphans/{nativeId}/resolve` | **新**。写操作，不复用 `kb:engine:reconcile`（后者是只读对账，降级会放大风险面）。 |
| `kb:engine:dataset:rename` | 存量 dataset 批量重命名（含 dry-run/执行/回滚） | `POST /kb/engine/datasets/rename`、`POST /kb/engine/datasets/rename/rollback` | **新**。高危批量改引擎名，独立高权限码。 |
| （复用 `kb:engine:reconcile`） | 只读看游离 dataset 列表 | `GET /kb/engine/orphans` | 复用 P0 码——只读列表与对账同源、风险同级，不新增码。 |

> **硬约束（V17 r2 血训）**：`uk_menu_app_permission` 是 `(app_id, permission)` 上 `status=1 AND permission IS NOT NULL` 的部分唯一索引。每个码**只建 1 行菜单按钮节点**（type=3），绝不再叠加「页面菜单挂同一码」。孤儿「忽略」写与重命名执行都属高危，必须用上面两个新独立码，不得归集到 P0 的 `kb:engine:reconcile`。

### 1.2 Orphan 处置动作枚举（`KbEngineOrphanAction`，P1-T3）

| 枚举值 | 语义 | 本地动作 | 引擎侧动作 |
|---|---|---|---|
| `bind_existing` | 认领到已存在的 MIS 库 | 该 `kb_library.engine_library_ref = orphan.native_id`、`engine_sync_status=0`；orphan 行 `resolved=1` + `resolved_action`；`engine_library_ref` 原为空才允许（见护栏） | 若引擎侧名≠规范名 → `renameLibrary` 到 `expectedEngineName(lib)`；失败置 `engine_sync_status=3` 但**不回滚绑定** |
| `adopt_new` | 新建 MIS 库并认领该游离 dataset | 复用 `create()` 校验（密级合法、`existsByNameAndCategoryId` 唯一），但**跳过引擎 create**（dataset 已存在），直接落库并绑 `engine_library_ref`；orphan 行 `resolved=1` + `resolved_action` | 同上，`renameLibrary` 到规范名；失败置 3 不回滚 |
| `ignore` | 标记已处理（不绑定，不删引擎数据） | orphan 行 `resolved=1`、`resolved_action=ignore`、`note` 必填（≥5 字）、`resolved_at=now` | 无。真正的引擎侧删除由管理员在 RAGFLOW 后台按 `native_id` 手工做（P0 已裁定不做 force-unbind） |

**处置动作护栏（写进服务端校验）**
1. `bind_existing` 的目标库 `engine_library_ref` 必须为空，否则 `KB_ENGINE_ORPHAN_TARGET_BOUND`（40940）。
2. `bind_existing`/`adopt_new` 改名失败**不回滚**绑定（本地语义优先，与 P0 archive 口径一致），只把 `engine_sync_status` 写 3，由 P1-T4 重命名端点做修复出口。
3. 非 `ragflow` 引擎：`GET /orphans` 返回空列表；`POST resolve` 直接 `ValidationException`（非 ragflow 不该有孤儿）。
4. `ignore` 的 `note` 不能为空且 trim 后 ≥ 5 字，否则校验拒绝。

### 1.3 取消归档回滚的触发条件与改名目标名（P1-T2）

- **触发条件**（在 `KbLibraryService.update` 内判定，必须**先快照**后改本地状态）：
  `req.status()!=null && LibStatus.isEnabled(req.status()) && entity.getStatus()==DISABLED.code && entity.getArchivedAt()!=null`
  —— 即「停用中且带归档标记 → 请求改回启用」。
- **改名目标名**：用 P0 的 `RagflowDatasetNaming.forCreate` 逻辑（即 `KbLibraryService.expectedEngineName(entity)`），算完已含「请求里可能的 name/categoryId 变更」。
- **副作用**：`entity.setArchivedAt(null)` → 调 `enginePort.renameLibrary(ref, 规范名)`（`engine_sync_status` 成功置 1、失败置 3）→ 落库。
- **不改既有 `PUT /libraries/{id}` 端点签名**，只在 `update()` 内补该分支。

### 1.4 存量重命名的命名计算与幂等（P1-T4）

- 命名计算**严格复用** `KbLibraryService.expectedEngineName(lib)`（= P0 `RagflowDatasetNaming.forCreate(topCategoryName, libName, libId)`），**禁止**在 T4 另写一份同名逻辑。
- **幂等**：`expectedName.equals(actualName)` 的行直接 `action=SKIP`（不改）。
- **受控触发**：默认 `dryRun=true`；执行需 `confirmToken=="RENAME-LEGACY"`。无 `@Scheduled`，不随应用启动跑。
- **分批**：`limit` 默认 50、上限 200；一次调用只跑一趟，运维重复触发直到 `plan.size()==0`。每条 rename 独立提交（`REQUIRES_NEW` 子事务），中途中断不影响日志与一致性。
- **审计/回滚**：每条 rename 写 `kb_engine_rename_log`（old/new/batchId/status/error/operator_id 取 `X-User-Id` 透传头，BFF 已透传）；按 `batch_id` 倒序回滚。

### 1.5 错误码（续 P0 段 40933–40935 之后）

| 枚举 | code | message |
|---|---|---|
| `KB_ENGINE_ORPHAN_NOT_FOUND` | 40936 | 游离 dataset 不存在或已处理 |
| `KB_ENGINE_ORPHAN_TARGET_BOUND` | 40940 | 目标知识库已绑定引擎 dataset，无法认领该游离项（请先解绑或选其他库） |
| `KB_ENGINE_ORPHAN_ACTION_INVALID` | 40941 | 处置动作非法或参数缺失（ignore 必须填备注） |
| `KB_ENGINE_RENAME_CONFIRM_REQUIRED` | 40942 | 批量重命名需携带确认令牌 RENAME-LEGACY 且 dryRun=false |
| `KB_ENGINE_RENAME_BATCH_NOT_FOUND` | 40943 | 回滚批次不存在或无成功记录 |

> ID 段位：P0 占 40933–40935，新码从 40936 起。**动手前先 grep `KbResultCode` 确认无冲突**（40936–40943 当前全空）。

---

## T0 权限码 / 实体 / 日志表 / 迁移（P1 公共地基，无依赖）

**目标**：把 P1 全部新权限码、实体字段、重命名日志表一次性落地，让 T1–T4 只依赖 T0、彼此不互等。

### 文件清单

| 文件 | 动作 |
|---|---|
| `backend/mis-migrator/src/main/resources/db/migration/V27__kb_engine_p1.sql` | 新增 |
| `backend/mis-kb/.../domain/entity/KbEngineOrphan.java` | 改（加 4 字段 + 访问器） |
| `backend/mis-kb/.../domain/entity/KbEngineRenameLog.java` | 新增 |
| `backend/mis-kb/.../domain/repository/KbEngineOrphanRepository.java` | 改（加方法） |
| `backend/mis-kb/.../domain/repository/KbEngineRenameLogRepository.java` | 新增 |
| `backend/mis-kb/.../domain/model/KbResultCode.java` | 改（加 §1.5 五个码） |

### 关键改动点

**V27 SQL（五段，全部幂等：固定 ID + `WHERE NOT EXISTS` + `ON CONFLICT DO NOTHING`）**

- **A 段 `kb_engine_orphan` 加 4 列**（承载 P1-B 的处置）：
  `resolved_action VARCHAR(16) NULL`、`resolved_at TIMESTAMPTZ NULL`、`resolved_note VARCHAR(512) NULL`、`resolved_by BIGINT NULL`。
  > 注：P0 的 `resolved`（0/1）仍表示「是否已处理」；`resolved_action` 记是哪种动作（bind_existing/adopt_new/ignore），区分「已认领」与「已忽略」。
- **B 段 新表 `kb_engine_rename_log`**（P1-D 审计/回滚）：
  ```sql
  CREATE TABLE IF NOT EXISTS kb_engine_rename_log (
    id BIGINT PRIMARY KEY,
    batch_id VARCHAR(40) NOT NULL,            -- UUID
    library_id BIGINT NOT NULL,
    engine_type VARCHAR(32) NOT NULL,
    native_id VARCHAR(64) NOT NULL,
    old_name VARCHAR(255) NOT NULL,
    new_name VARCHAR(255) NOT NULL,
    action VARCHAR(16) NOT NULL,             -- RENAME / SKIP / FAILED
    status SMALLINT NOT NULL,                -- 0=未执行(计划) 1=成功 2=失败
    error VARCHAR(512) NULL,
    operator_id BIGINT NULL,                 -- 取 X-User-Id 透传头
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_erl_batch ON kb_engine_rename_log(batch_id);
  CREATE INDEX IF NOT EXISTS idx_erl_native ON kb_engine_rename_log(engine_type, native_id);
  ```
- **C 段 两个新权限码菜单按钮节点**（type=3）：
  `91058 → 'kb:engine:orphan:handle'`（挂「引擎配置」页 91038）、`91059 → 'kb:engine:dataset:rename'`（挂 91038）。
  > ID 段位已核实：`91058/91059` 全仓未占用（V26 注释误称 91060–91078 已占，实测 91078 未插入、91058/91059 空闲，用新段最稳）。
- **D 段 `sys_role_permission`**：role_id=1 授权 91058、91059（口径同 V17/V25，id=menu id）。
- **E 段 `sys_api` 5 行 + `sys_menu_api` 关联**（ID 取 `91094`–`91099` + `91100`–`91104`，实测空闲）：
  - `91094` GET `/api/v1/kb/engine/orphans` → 关联 **既有** `91057`（`kb:engine:reconcile`，只读列表复用 P0 码，**不**新建菜单行，避免违 uk_menu_app_permission）
  - `91095` POST `/api/v1/kb/engine/orphans/{nativeId}/resolve` → `91058`
  - `91096` POST `/api/v1/kb/engine/datasets/rename` → `91059`
  - `91097` POST `/api/v1/kb/engine/datasets/rename/rollback` → `91059`
  - `91098` GET `/api/v1/kb/engine/datasets/rename/logs` → `91059`
  - `91099` GET `/api/v1/kb/engine/datasets/rename/logs/{batchId}` → `91059`
  - `sys_menu_api`：`91095→91058`、`91096→91059`、`91097→91059`、`91098→91059`、`91099→91059`（id `91100`–`91104`）
  > path_pattern 走 AntPathMatcher（V25 已核实模板路径 OK），`{nativeId}` 形态保留。

**KbEngineOrphan**：加 4 字段 `resolvedAction`（String）、`resolvedAt`（Instant）、`resolvedNote`（String）、`resolvedBy`（Long）+ 访问器；保留 P0 的 `resolved/note`。

**KbEngineRenameLog**：JPA 实体，`@Table("kb_engine_rename_log")`，字段见 B 段（status 用 int/SMALLINT）。

**KbEngineOrphanRepository**：加
- `List<KbEngineOrphan> findByEngineTypeAndResolvedOrderByResolvedAtDesc(engineType, resolved)`（已处理列表用）
- `List<KbEngineOrphan> findByEngineTypeAndResolvedActionOrderByLastSeenAtDesc(engineType, action)`（自动复位判定：`resolved_action IS NULL` 才复位）
- `long countByEngineTypeAndResolved(engineType, 0)`（P1 待处理计数，替代 P0 的 touch 计数口径）

**KbEngineRenameLogRepository**：`findByBatchIdOrderByCreatedAtDesc(batchId)`、`findByBatchIdAndStatus(batchId, 1)`（回滚只回成功的）。

### 验收点

1. `mvn -pl backend/mis-kb -am test` 编译通过、P0 单测全绿。
2. V27 在**干净库**与**存量库**各跑一次、重复跑一次不报错（幂等）。
3. `SELECT id,name,permission FROM sys_menu WHERE app_id=91010 AND permission IN ('kb:engine:orphan:handle','kb:engine:dataset:rename') AND status=1` → 每个码恰好 1 行。
4. 联表查 5 个新 `sys_api` 行的 permission 正确、method+path 不冲突。
5. `kb_engine_orphan` 有 4 新列、`kb_engine_rename_log` 表存在；`mis.kb.engine.type=noop` 启动无异常。

---

## T1 其余 3 个 `KbLibraryPicker` 调用点迁 combobox（依赖 T0，实际仅依赖 combobox 加 1 可选属性）

**目标**：把 `kb-qa / kb-hit-test / kb-document` 三页的 `<KbLibraryPicker>` 换成已定型的 `KbLibraryCombobox`，保留各页原语义；`kb-library-picker.tsx` 一行不动。

### 文件清单

| 文件 | 动作 |
|---|---|
| `frontend/mis-admin-web/src/features/kb/components/kb-library-combobox.tsx` | 改（加 `emptyOptionLabel?` 可选属性，向后兼容默认文案「请选择知识库」） |
| `frontend/mis-admin-web/src/features/kb/qa/kb-qa-page.tsx` | 改（377 行附近） |
| `frontend/mis-admin-web/src/features/kb/hittest/kb-hit-test-page.tsx` | 改（264 行附近） |
| `frontend/mis-admin-web/src/features/kb/document/kb-document-page.tsx` | 改（28 行附近） |

> ⚠ **铁律**：`components/kb-library-picker.tsx` 一行都不许动（4 调用点历史包袱，迁移=替换调用点用法）。

### 关键改动点

**combobox 小改（唯一允许的属性扩展）**
- 新增可选 prop `emptyOptionLabel?: string`：仅在 `allowClear` 且当前未选时，触发器显示该文案替代默认「请选择知识库」（实现：triggerText 分支 `[allowClear && (selected==null) && emptyOptionLabel ? emptyOptionLabel : selected ? 名称（密级） : loading?'加载中…':'请选择知识库']`）。不传则完全等同 P0 行为。

**逐页迁移（保留语义）**
1. `kb-qa-page.tsx`（原 `allowEmpty + emptyLabel="全部可见知识库"`）
   - `KbLibraryPicker` → `KbLibraryCombobox`；`allowEmpty`→`allowClear`、`emptyLabel="全部可见知识库"`→`emptyOptionLabel="全部可见知识库"`；`activePath="/kb/qa"`。
   - `onChange={setLibraryId}` → `onChange={(id) => setLibraryId(id)}`（combobox 第二参 library 被忽略；id=null 时 `libraryIds = undefined` 而非 `[null]`，与现有 `227 行 libraryIds = libraryId==null ? undefined : [libraryId]` 一致）。
2. `kb-hit-test-page.tsx`（原单选必选，无 allowEmpty）
   - `KbLibraryPicker` → `KbLibraryCombobox`，`onChange={onLibraryChange}` → `onChange={(id) => onLibraryChange(id)}`，`activePath="/kb/hit-test"`。**不设 allowClear**（保留必选语义；其 `onLibraryChange` 已能处理 `id==null`）。
3. `kb-document-page.tsx`（原必选）
   - `KbLibraryPicker` → `KbLibraryCombobox`，`onChange={setLibraryId}` → `onChange={(id) => setLibraryId(id)}`，`activePath="/kb/documents"`。不设 allowClear。

### 验收点

1. 三页各切一次库，行为与原 picker 一致（问答页选「全部可见知识库」→ 请求 `libraryIds=undefined`）。
2. `kb-library-picker.tsx` 行数零变化（`grep -c ""` 与 P0 对比）。
3. `pnpm build`/`tsc` 零错误、ESLint 无新增告警。
4. 问答页构造两个同名库，combobox 靠加粗分类路径区分（P0 combobox 既有能力）。

---

## T2 取消归档自动改回引擎名 + 对账预期名一致性（依赖 T0）

**目标**：恢复启用归档库时把引擎 dataset 名回滚为规范名并清空 `archived_at`，且保证对账服务「归档中→期望归档名 / 已恢复→期望规范名」两种状态都不误判。

### 文件清单

| 文件 | 动作 |
|---|---|
| `backend/mis-kb/.../domain/service/KbLibraryService.java` | 改（`update` 内补取消归档回滚分支） |
| `backend/mis-kb/.../domain/service/KbEngineReconcileService.java` | 改（`upsertOrphans` 自动复位护栏 + `nameMatches`/`expectedName` 注释与断言） |
| `frontend/mis-admin-web/src/features/kb/library/kb-library-page.tsx` | 改（行菜单加「取消归档」+ 确认弹窗） |
| `backend/mis-kb/.../domain/service/KbLibraryServiceDeleteTest.java` 等 P0 测试 | 改（补 4 条边界用例） |

### 关键改动点

**`KbLibraryService.update`（先快照后改，见 §1.3）**
```java
KbLibrary entity = require(id);
boolean wasArchived = entity.isArchived();          // ← 先快照
... // 现有 name/secrecy/status/settings 处理不变
entity = libraryRepository.save(entity);              // 本地先落（沿用 P0）

// 取消归档回滚：停用中带归档标记 → 改回启用
boolean unarchiving = req.status() != null
    && LibraryStatus.isEnabled(req.status())
    && wasArchived;
if (unarchiving && saved.getEngineLibraryRef() != null) {
    String targetName = expectedEngineName(saved);    // 用 P0 forCreate 逻辑（含本次 name/categoryId 变更）
    try {
        enginePort.renameLibrary(ref(saved), targetName);
        saved.setEngineSyncStatus(CONSISTENT);
    } catch (Exception e) {
        saved.setEngineSyncStatus(DRIFT_OR_FAILED);    // 不回滚取消归档
        syncError = "引擎侧改名失败：" + describeError(e);
    }
    saved.setArchivedAt(null);
    saved.setEngineCheckedAt(Instant.now());
    saved = libraryRepository.save(saved);
}
```
- 回滚失败**不阻断**本地恢复（与 P0 archive 口径一致）。此时 `archived_at` 已清空、引擎仍是归档名 → 对账会**正确**判入漂移桶（不是误判），P1-T4 是修复出口。

**`KbEngineReconcileService`（对账预期名一致性，关键点）**
- `nameMatches` 无需改算法：`isArchived()` = `archivedAt!=null && status==0`；取消归档后两条件都不成立，自动走 `expectedEngineName`（规范名）分支——P0 已正确，只需**补注释**明确：归档中期望归档名、已恢复期望规范名。
- 加防御性断言：若扫到 `status==1 && archivedAt!=null` 的行（update 回滚分支漏洞征兆），warn 并仍按规范名判定。
- `upsertOrphans` 自动复位护栏（见 T3 联动）：仅当 `resolved_action == null`（从未人工处置）的行在引擎侧消失时才置 `resolved=1`；已 `resolved_action` 的行**保留**，并只刷新 `lastSeenAt/docCount`（不覆盖 `resolved/note/action`）。

**前端 `kb-library-page.tsx`**
- 行菜单新增「取消归档」，仅当 `lib.archivedAt` 非空时显示（沿用 P0「归档」位置，不新增权限码，复用 `kb:library:update` 或既有行菜单权限）。
- 二次确认弹窗：说明「将把引擎侧 dataset 名改回规范名 `{一级分类名}-{库名}-{ID后6位}`，并恢复库可见性；若引擎改名失败会记入对账，可在引擎配置页修复」。
- 调既有 `updateLibrary(id, {name, secrecy, status:1, settings})`（settings 取库详情已加载的 `ragSettings`）；`engineSyncFailed` 时黄条提示「引擎侧改名失败，可在引擎配置页重命名修复」。

### 验收点

1. 单测 4 条（用 P0 `KbLibraryServiceDeleteTest` 基类）：① 归档→恢复启用且引擎改名成功（`archived_at=null`、`engine_sync_status=1`、引擎收到规范名）；② 恢复时引擎改名失败（`archived_at=null`、库已恢复、`engine_sync_status=3`、VO 带 `engineSyncFailed`）；③ 普通停用（`archivedAt=null`）改启用**不触发**改名；④ 归档中只改密级不改状态**不触发**回滚、`archived_at` 不变。
2. 联调：归档库引擎名带 `[已归档-...]-`；取消归档后引擎名回规范名、`archived_at` 空；立即对账该库判一致（非漂移）。
3. 模拟引擎报错：取消归档后 `GET /reconcile` 该库在 `nameDrift` 桶（正确判漂移，非误判）。
4. P0 两个测试类（`KbLibraryServiceDeleteTest` / `KbEngineReconcileServiceTest`）全绿，未回归「归档库不被误判漂移」用例。
5. `pnpm build` 库页 typecheck 0 错。

---

## T3 `kb_engine_orphan` 认领/清理操作全链路（依赖 T0）

**目标**：给 P0「只发现不处置」的孤儿表加上出口——列出待处理/已处理孤儿，并提供认领（绑已有库 / 新建认领）与忽略（标记已处理）三类动作，处置语义与 P0 对账、权限体系对齐。

### 文件清单

| 文件 | 动作 |
|---|---|
| `backend/mis-kb/.../domain/service/KbEngineOrphanService.java` | 新增 |
| `backend/mis-kb/.../domain/model/KbEngineOrphanAction.java` | 新增 |
| `backend/mis-kb/.../api/dto/KbEngineOrphanResolveReq.java` | 新增 |
| `backend/mis-kb/.../api/dto/KbEngineOrphanResolveResult.java` | 新增 |
| `backend/mis-kb/.../api/controller/EngineConfigController.java` | 改（加 2 端点） |
| `backend/mis-admin-bff/.../controller/KbController.java` | 改（加 2 端点 + @OperLog） |
| `backend/mis-admin-bff/.../service/KbFacadeService.java` | 改（加 2 方法） |
| `backend/mis-admin-bff/.../client/KbWebClient.java` | 改（加 2 调用） |
| `backend/mis-admin-bff/.../dto/kb/KbEngineOrphanResolveReqVO.java` | 新增 |
| `backend/mis-admin-bff/.../dto/kb/KbEngineOrphanItemVO.java`（镜像或复用） | 改/复用 |
| `frontend/mis-admin-web/src/features/kb/engine/kb-engine-page.tsx` | 改（对账区下方加孤儿处置 Panel + 顶部「待处理 N」徽标） |
| `frontend/mis-admin-web/src/features/kb/engine/kb-engine-orphan-panel.tsx` | 新增 |
| `frontend/mis-admin-web/src/features/kb/api/kb-api.ts` | 改（加 `listOrphans`/`resolveOrphan`） |
| `frontend/mis-admin-web/src/features/kb/types.ts` | 改（加 `KbEngineOrphanAction`/`ResolveReq`/`Item` 含 resolvedAction/resolvedAt/resolvedNote） |

> **挂载位置裁定**：挂在**引擎配置页对账区下方**（不新增独立菜单页），避免 `kb-nav.ts`/`keep-alive-outlet.tsx`/`sys_menu` 三处同步改动与半残风险；对账报告已含孤儿，处置面板是其直接下游，管理员一段式操作。

### 关键改动点

**`KbEngineOrphanService`（核心）**
- `List<KbEngineOrphan> listPending(engineType)` / `listResolved(engineType)`：读 T0 新仓储方法。
- `KbEngineOrphanResolveResult resolve(String nativeId, KbEngineOrphanAction action, ResolveReq req, Long operatorId)`
  - `engineType != ragflow` → `ValidationException`（护栏 3）。
  - 取 orphan 行；不存在或 `resolved==1` → `KB_ENGINE_ORPHAN_NOT_FOUND`（40936）。
  - `bind_existing`：校验 `req.targetLibraryId` 存在且其 `engine_library_ref` 为空（否则 40940）；绑 `engine_libraryRef=nativeId`、`engine_sync_status=0`；`renameLibrary` 到 `expectedEngineName`（失败置 3 不回滚）。
  - `adopt_new`：校验 `req`（name/secrecy/categoryId/owner）走 `create()` 同款校验，**跳过引擎 create**，落库并绑 `engine_library_ref=nativeId`，`renameLibrary` 到规范名（失败置 3 不回滚）。
  - `ignore`：`req.note` 必填 trim≥5 字（否则 40941）。
  - 统一：orphan 行写 `resolved=1`、`resolved_action`、`resolved_at`、`resolved_note`、`resolved_by`；`@Transactional`（引擎改名在事务提交后做，单条失败不滚其他）。
- 返回 `{ nativeId, action, targetLibraryId?, renamed, engineSynced, message }`。

**`EngineConfigController`（复用 P0 内部端点口径，不重复判权）**
- `GET /internal/v1/kb/engine/orphans?resolved=false` → 列表（读 T0 新仓储；复用 `kb:engine:reconcile` 在 BFF 判权）。
- `POST /internal/v1/kb/engine/orphans/{nativeId}/resolve` → 处置（判权 `kb:engine:orphan:handle` 在 BFF）。

**BFF（镜像 P0 reconcile 三段）**
- `KbController`：`GET /kb/engine/orphans`（无 @OperLog，只读）/`POST /kb/engine/orphans/{nativeId}/resolve`（`@OperLog(module="知识库", operation="处置游离dataset")`）。
- `KbWebClient` 加 2 个 HTTP 调用（仿 `engineReconcileReport`）。

**前端 `kb-engine-orphan-panel.tsx`（新增，挂在 `kb-engine-page` 对账 Card 下方）**
- 表格列：native_id、`native_name`、doc_count、first_seen、last_seen、状态徽标（待处理/已认领/已忽略）、操作。
- Tab 切换「待处理 / 已处理」；待处理行有「处置」按钮（`<PermissionGate permission="kb:engine:orphan:handle">` 包裹）。
- 处置弹窗：单选 `bind_existing` / `adopt_new` / `ignore`。
  - `bind_existing`：内嵌 `<KbLibraryCombobox allowClear={false}>` 选目标库（防误选核心价值），显示所选库的 `engine_library_ref` 若非空则禁用并提示「该库已绑定，请另选」。
  - `adopt_new`：库名 + 密级 + 分类（复用新建表单片段）+ owner。
  - `ignore`：必填备注 textarea（≥5 字校验）+ 红条「仅标记已处理，引擎侧删除请到 RAGFLOW 后台按 native_id 操作」。
- 操作成功刷新面板 + `useKbStore.invalidateLibraries()`（认领后库列表要能看到新绑定的库）。

**对账报告计数口径联动（见 T3 护栏）**：`upsertOrphans` 改为——仅 `resolved_action == null` 且在引擎侧消失的行才自动置 `resolved=1`；未消失的行若 `resolved_action==null` 仍复位 pending（刷新 last_seen），已 `resolved_action` 的行保留。报告 orphan 计数改用 `countByEngineTypeAndResolved(engineType, 0)`（待处理），`resolvedCount` 进 VO。

### 验收点

1. 单测 3 条动作正常流 + 4 条护栏（靶库已绑定→40940、ignore 无备注→40941、非 ragflow→拒绝、孤儿不存在→40936）。
2. **回归（关键）**：手动 `resolved=1, resolved_action='ignore', note='x'` 后，再跑一次 `reconcile()`，该行 `note/action/resolved` 不变、不出现在「待处理」计数，且不在 `report.orphans` 列表（若引擎侧仍存在）。
3. `bind_existing` 成功后引擎侧 dataset 名变规范名、MIS 库 `engine_library_ref` 绑定、下一轮对账该行从游离消失。
4. 权限：无 `kb:engine:orphan:handle` 调 `POST resolve` → 403；无 `kb:engine:reconcile` 调 `GET /orphans` → 403。
5. 前端：`noop` 引擎下孤儿面板显示「当前引擎不支持对账」而不是报错；`pnpm build` 0 错。

---

## T4 存量库 dataset 重命名（受控端点，依赖 T0）

**目标**：把 P0 前已存在、引擎 dataset 名仍是裸库名/历史命名的存量库，一次性按规范名 `{一级分类名}-{库名}-{ID后6位}` 重命名；风险最高，必须受控、幂等、分批、可中断、可回滚。

### 交付形式裁定（推荐方案 X）

**采用方案 X：受控管理端点**（非方案 Y 独立脚本）。理由：① 凭据安全——RAGFLOW apiKey 在 Nacos，独立脚本需另发一份，端点复用 BFF 鉴权不扩散密钥；② 审计闭环——BFF `@OperLog` + `kb_engine_rename_log` 表，谁在何时改了哪个名全留痕（方案 Y 难做到）；③ dry-run 与执行共用同一命名/筛选逻辑，预览即真相（方案 Y 易漂移）；④ 回滚路径与执行共用日志表。代价仅是进常驻代码路径，但以「高权限码 + 默认 dryRun + confirmToken + 无定时任务」严格收口，不会自动跑。

### 文件清单

| 文件 | 动作 |
|---|---|
| `backend/mis-kb/.../domain/service/KbEngineLegacyRenameService.java` | 新增（核心） |
| `backend/mis-kb/.../domain/model/KbEngineRenamePlan.java` | 新增 |
| `backend/mis-kb/.../domain/model/KbEngineRenameAction.java` | 新增（RENAME/SKIP/FAILED） |
| `backend/mis-kb/.../api/dto/KbEngineRenameResult.java` | 新增 |
| `backend/mis-kb/.../api/controller/EngineConfigController.java` | 改（加 3 端点） |
| `backend/mis-admin-bff/.../controller/KbController.java` | 改（加 3 端点 + @OperLog） |
| `backend/mis-admin-bff/.../service/KbFacadeService.java` | 改（加 3 方法） |
| `backend/mis-admin-bff/.../client/KbWebClient.java` | 改（加 3 调用） |
| `backend/mis-admin-bff/.../dto/kb/KbEngineRename*.java` | 新增 |
| `frontend/mis-admin-web/src/features/kb/engine/kb-engine-page.tsx` | 改（对账区/孤儿面板下方加「存量重命名」Card） |
| `frontend/mis-admin-web/src/features/kb/engine/kb-engine-rename-card.tsx` | 新增 |
| `frontend/mis-admin-web/src/features/kb/api/kb-api.ts` | 改（加 `renameLegacyDatasets`/`rollbackRenameBatch`/`listRenameLogs`） |
| `frontend/mis-admin-web/src/features/kb/types.ts` | 改（加 `KbEngineRenamePlan/Result/BatchLog`） |

### 关键改动点

**`KbEngineLegacyRenameService`（核心，严格复用 P0 命名）**
- `rename(engineType, boolean dryRun, String confirmToken, int limit, Long operatorId) → KbEngineRenameResult`
  - `engineType != ragflow` → 返回 `skipped`（护栏，与 P0 reconcile 一致）。
  - dryRun=false 且 `!"RENAME-LEGACY".equals(confirmToken)` → 抛 `KB_ENGINE_RENAME_CONFIRM_REQUIRED`（40942）。
  - 一次 `enginePort.listLibraries()` 拉全量建 `nativeId→actualName` 映射（**避免逐库打引擎**）。
  - 扫 `kb_library`：`expectedName = libraryService.expectedEngineName(lib)`；`actual = map[ref]`。
    - 引擎缺失 → plan SKIP（reason=引擎缺失，不处理）；
    - `lib.isArchived()`（archived_at!=null）→ plan SKIP（reason=归档库不自动改名，避免破坏归档名；如需可后续加 opt-in）；
    - `expectedName.equals(actual)` → SKIP（幂等，已规范）；
    - 否则 → RENAME（old=actual, new=expectedName）。
  - 按 `limit`（默认 50、上限 200）截断 plan。
  - **dryRun=true**：返回 plan 预览，不写库不调引擎。
  - **dryRun=false**：`batchId = UUID`；逐条 `renameLibrary(ref, new)`，**每条独立 `REQUIRES_NEW` 子事务**写 `kb_engine_rename_log`（status=1 成功 / 2 失败 + error）；成功同时 `lib.engine_sync_status=1`。中途异常只记该条 FAILED，不影响其余（可中断、可重跑）。
- `rollback(batchId, operatorId)`：读 `findByBatchIdAndStatus(batchId, 1)` 倒序，逐条 `renameLibrary(ref, oldName)` 并写新 log（action=ROLLBACK）。批次不存在/无成功记录 → 40943。
- `listBatches()` / `batchDetail(batchId)`：读 `kb_engine_rename_log` 聚合（供前端历史与回滚）。

**`EngineConfigController`（加 3 端点，内部端点不重复判权）**
- `GET /internal/v1/kb/engine/datasets/rename/logs`（`91098`）、
- `GET /internal/v1/kb/engine/datasets/rename/logs/{batchId}`（`91099`）、
- `POST /internal/v1/kb/engine/datasets/rename`（`91096`，body `{dryRun, confirmToken, limit}`）、
- `POST /internal/v1/kb/engine/datasets/rename/rollback`（`91097`，body `{batchId}`）。
  > **无 `@Scheduled`**，不随启动跑。

**BFF（镜像，加 @OperLog）**
- `KbController`：`GET /kb/engine/datasets/rename/logs`、`GET /kb/engine/datasets/rename/logs/{batchId}`（只读无 OperLog）、`POST /kb/engine/datasets/rename`、`POST /kb/engine/datasets/rename/rollback`（两 POST 均 `@OperLog(module="知识库", operation="存量dataset重命名"/"回滚重命名批次")`）。判权 `kb:engine:dataset:rename`。

**前端 `kb-engine-rename-card.tsx`（新增，`<PermissionGate permission="kb:engine:dataset:rename">` 包裹；红色警示「线上改引擎名操作，请在运维窗口执行」）**
- 「预览」（dryRun）：展示表 库名/ID/当前名/目标名/动作（SKIP 折叠、RENAME 展开）；显示「将重命名 N 个」。
- 「执行」：需输入确认令牌 `RENAME-LEGACY` 激活，二次确认弹窗；执行后展示成功/失败计数 + 失败详情。
- 历史批次表：批次 ID、时间、操作人、成功/失败数、回滚按钮（逐批回滚）。
- 反复点「预览/执行」直到「将重命名 0 个」即全量完成。

### 验收点

1. **幂等**：跑一次执行（N 个 RENAME）→ 再跑一次预览，plan 中 RENAME 数 = 0（已规范的全 SKIP）。
2. **分批**：`limit=3` 时一次只改 3 个，重复触发直到全改完；每条在 `kb_engine_rename_log` 有记录。
3. **可中断**：执行中途 kill 进程，已成功的行状态=1、未执行的行无 log；重启再跑补齐，不重复改名（幂等）。
4. **回滚**：取刚才 batchId 调 rollback，引擎侧名回到 old、log 新增 ROLLBACK 行。
5. **受控**：dryRun 默认 true，不带 `RENAME-LEGACY` 执行 → 40942 且零引擎调用；无 `kb:engine:dataset:rename` → 403；@OperLog 两 POST 落 `sys_oper_log`。
6. `noop` 引擎下该 Card 显示「当前引擎不支持」。
7. `mvn test` 全绿；`pnpm build` 0 错。

---

## 2. 重点坑位速查（回传必读）

| 项 | 坑 | 规避 |
|---|---|---|
| **P1-A** | 改了 `kb-library-picker.tsx` | 铁律：picker 一行不动，只换调用点；combobox 仅加 `emptyOptionLabel` 可选属性 |
| **P1-B** | 对账自动把「管理员已忽略」的孤儿复位成待处理 | `upsertOrphans` 仅复位 `resolved_action==null` 的行；已处置行只刷 last_seen |
| **P1-B** | 认领时把别人库的 engine ref 覆盖 | `bind_existing` 校验目标库 `engine_library_ref` 必须为空（40940） |
| **P1-C** | 取消归档后引擎名不回滚 → 对账误判漂移 | T2 回滚改名 + 清空 `archived_at`；`nameMatches` 已按 `isArchived()` 正确分流，补注释/断言 |
| **P1-C** | 回滚分支读不到 `wasArchived`（已被清空） | `update` 开头先 `boolean wasArchived = entity.isArchived()` 快照 |
| **P1-D** | 线上改名事故不可回退 | 写 `kb_engine_rename_log` + `RENAME-LEGACY` 令牌 + 逐批回滚端点 |
| **P1-D** | 自动随启动跑改全量库名 | **无 `@Scheduled`**，纯手动触发 |
| **P1-D** | 命名逻辑与 P0 漂移 | 严格复用 `KbLibraryService.expectedEngineName`（=P0 `forCreate`） |
| **通用** | 新增权限码违反 `uk_menu_app_permission` | 每码只 1 行菜单按钮节点；GET /orphans 复用 P0 `kb:engine:reconcile` 不再建菜单行 |

---

## 3. 不在本次范围（建议往后放 / 已裁定不做）

| 项 | 归属 | 说明 |
|---|---|---|
| 孤儿 dataset 的**引擎侧真实删除**出口 | 不做 | P0 已裁定不做 force-unbind；清理=标记 resolved，引擎侧删由管理员在 RAGFLOW 后台按 native_id 做 |
| 存量重命名的自动分批调度 / 大批量进度条 | 往后放 | 本次手动重复触发 + 历史批次表足够；后续若量极大再考虑 |
| RAGFLOW 升级 + `delete-supported=true` 灰度回归 | **P2** | 与 P1 正交，运维并行推进 |
| 引擎能力启动探测 | 不做 | P0 已裁定用配置项 |

---

## 4. 待明确事项（极少，已确认则空）

1. **`adopt_new` 的 `owner` 必填性**：建议必填且沿用 P0 `create()` 校验（不新增管辖闸门）；若产品要求「认领时自动用当前操作人」，需确认 BFF `X-User-Id` 透传已覆盖 mis-kb（已确认：`loginContextHeaders()` 透传 `X-User-Id`，mis-kb 侧 `SecurityContextHolder` 可解析，故 `operator_id` 与 `owner` 默认可取该值）。
2. **存量重命名与进行中文档上传/检索的并发**：RAGFLOW 改名期间若某库正在上传/解析，是否影响进行中任务——**需运维在联调环境实测一次**确认（属运维窗口评估项，不阻塞编码）。
3. **`kb_engine_rename_log.operator_id` 来源**：已确认取 BFF 透传的 `X-User-Id`（同 CategoryAdminController 口径），无需新增透传头。

> 以上 3 条均已有明确推荐/已自行确认，无需主理人额外拍板即可开工。

---

## 5. 落地顺序与联调关卡

```
T0（迁移+权限+实体）── 联调关卡 α：迁移幂等 + 权限码各 1 行 + 5 接口注册可见
   ├─ T1（combobox 迁移）        ┐
   ├─ T2（取消归档回滚）         ├─ 可并行编码
   ├─ T3（orphan 处置）          ┤
   └─ T4（存量重命名）          ┘
          │
          └─ 联调关卡 β：T2 四种边界 + T3 护栏回归 + T4 幂等/回滚 + 权限 403
```

- **联调关卡 α（T0 完成）**：V27 幂等、权限码唯一、5 接口在注册表可见。
- **联调关卡 β（T2/T3/T4 完成）**：T2 四种边界各一条；T3「忽略后再次对账不被复位」；T4 幂等+回滚+受控令牌；全链路 403 判权 + @OperLog 落库。
