# 知识库权限页防误选 + RAGFLOW 删除策略 — P0 任务分解

> 架构：高见远 ｜ 执行：寇豆码 ｜ 依据：Q1–Q11 已拍板决议（本文件不再做方案取舍）
> 范围：P0。P1/P2 见文末「不在本次范围」。

## 0. 交付总览

| 任务 | 名称 | 依赖 | 主要落点 | 文件数 | 优先级 |
|---|---|---|---|---|---|
| T01 | 契约与数据地基 | — | 迁移 / 枚举 / 能力位 / 错误码 / 配置 / 端口签名 / shedlock | 16 | P0 |
| T02 | 引擎适配层：命名规范 + rename + listDatasets | T01 | RagflowClient / RagflowAdapter / 命名工具 | 7 | P0 |
| T03 | 领域服务：删除三分支 + update 回执 | T01, T02 | KbLibraryService / LibraryController / VO | 6 | P0 |
| T04 | 对账服务 + BFF 全链路 | T01, T02, T03 | KbEngineReconcileService / BFF 三层 | 12 | P0 |
| T05 | 前端：组合框 + 归档弹窗 + 对账区 | T04（契约冻结后可并行编码） | features/kb/** | 7 | P0 |

**依赖链刻意做浅**：T01 是唯一的公共前置，T02/T03 串行是因为共用 `CreateLibraryCmd`
与 `KbLibraryService`，T05 可在 T04 编码期并行推进（契约见 §1）。

---

## 1. 共享约定（跨任务，动手前必须读完）

### 1.1 删除模式 DeleteMode

| wire 值 | 后端枚举 | 语义 | 引擎侧动作 | 本地动作 |
|---|---|---|---|---|
| `archive` | `LibraryDeleteMode.ARCHIVE` | 归档（**默认**） | `PUT dataset.name = 归档名` | `status=0` + `archived_at=now` |
| `physical` | `LibraryDeleteMode.PHYSICAL` | 物理删除 | `DELETE dataset` | 删 `kb_document` → `kb_acl` → `kb_library` |

- **「停用」不走 delete 端点**：沿用既有 `PUT /libraries/{id}` + `status=0`，不要为它新造分支。
- 当前版本 `deleteSupported=false`，`physical` 一定被拒（`KB_ENGINE_DELETE_UNSUPPORTED`）；
  代码分支照写不误，等 RAGFLOW 升级（P2）后翻配置即可启用。
- 不存在 `FORCE_UNBIND`（Q10 明确不做），谁都别顺手加。

### 1.2 engine_sync_status 枚举

| 值 | 含义 | 写入方 |
|---|---|---|
| 0 | 未知（未对过账） | 建库默认值 |
| 1 | 一致 | 对账服务 |
| 2 | 引擎缺失（MIS 有 / 引擎无 → 孤儿引用） | 对账服务 |
| 3 | 名称漂移 / 引擎同步失败 | 对账服务、`update()`、`archive` 改名失败 |

「引擎有 / MIS 无」这类差异**不落 kb_library**（无行可落），写 `kb_engine_orphan` 表。

### 1.3 能力位

- `EngineCapabilities` record **末位追加** `boolean deleteSupported`。
- 码值常量 `CAP_DELETE = "delete"`，由 `of()` 反推进 `capabilities` 列表。
- `of()` 变 5 参：`of(rerank, metadataFilter, replace, hybrid, delete)` —— 现有 3 处调用点
  （`MockAdapter:109`、`RagflowAdapter:351`、`RetrieveQueryResolverTest:37`）必须在 T01 内一并改完。

### 1.4 命名规范（加工只在 adapter 层，业务层不感知）

```
新建 dataset 名 = {一级分类名}-{库名}-{MIS库ID后6位}
归档改名        = [已归档-yyyyMMdd]-{原dataset名}
```

- 长度上限常量 `MAX_DATASET_NAME = 128`；超长时**只截库名段**，一级分类名前缀、ID 后 6 位、
  归档前缀三者不可截。
- 非法字符（`/ \ : * ? " < > |` 与首尾空白）统一替换为 `-`。
- 一级分类名取该库所属分类**向上回溯到根**的那一级名称；查不到时用 `未分类`。

### 1.5 新权限码

| 权限码 | 挂载端点 | 说明 |
|---|---|---|
| `kb:library:engine-ref:view` | `GET /api/v1/kb/libraries/{id}/engine-ref` | Q4 有限暴露 dataset_id，**破 F8 红线，必须带审计** |
| `kb:engine:reconcile` | `GET`/`POST /api/v1/kb/engine/reconcile` | 引擎对账查看与手动触发 |

**硬约束（V17 r2 的血教训）**：`uk_menu_app_permission` 是 `(app_id, permission)` 上
`status=1 AND permission IS NOT NULL` 的部分唯一索引 —— 同一 app 下**不得两行共用同一权限码**，
「页面菜单 + 按钮节点挂同一 permission」的写法在本仓库直接违约、迁移整体回滚。

### 1.6 配置项（Nacos `mis.kb.engine.*`）

| key | 默认 | 说明 |
|---|---|---|
| `delete-supported` | `false` | Q5：写死配置，**不做启动探测** |
| `reconcile.enabled` | `true` | 关掉后定时任务方法直接 return（热调，不用 `@ConditionalOnProperty`） |
| `reconcile.interval-ms` | `1800000` | 30 分钟 |
| `reconcile.page-size` | `100` | listDatasets 分页大小 |
| `reconcile.max-pages` | `50` | 防打爆的硬上限 |
| `reconcile.lock-at-most-for` | `PT10M` | shedlock |
| `reconcile.lock-at-least-for` | `PT30S` | shedlock |

### 1.7 shedlock

- 表名 `shedlock`（列 `name/lock_until/locked_at/locked_by`），**建在 mis-migrator 的 V26**
  —— 已核实 mis-kb 无自己的 Flyway（`src/main/resources` 只有 `application.yml` / `bootstrap.yml`）。
- lock name：`kb-engine-reconcile`（唯一，别再起第二个）。
- `KbApplication` **已有** `@EnableScheduling`（Wave D 加的），不要重复加；新建
  `config/ShedLockConfig` 只放 `@EnableSchedulerLock` + `JdbcTemplateLockProvider`。

### 1.8 错误码（续 `KbResultCode` 冲突段，40933 已占）

| 枚举 | code | message |
|---|---|---|
| `KB_ENGINE_DELETE_UNSUPPORTED` | 40934 | 当前引擎不支持在线删除知识库，请改用归档 |
| `KB_ENGINE_DELETE_FAILED` | 40935 | 引擎侧删除失败，本地未做任何变更 |

### 1.9 接口契约（前后端冻结，T05 据此先写）

```
DELETE /api/v1/kb/libraries/{id}?mode=archive|physical
  → KbLibraryDeleteResultVO {
      mode, engineSynced, engineError, archivedName, docCleaned, aclCleaned, message }

GET  /api/v1/kb/libraries/{id}/engine-ref     [kb:library:engine-ref:view]
  → KbEngineRefVO { libraryId, engineType, engineLibraryRef, engineSyncStatus, engineCheckedAt }

GET  /api/v1/kb/engine/reconcile              [kb:engine:reconcile]
POST /api/v1/kb/engine/reconcile              [kb:engine:reconcile]
  → KbEngineReconcileVO {
      lastRunAt, skipped, skipReason, engineType,
      counts: { total, consistent, missingInEngine, orphan, nameDrift },
      missingInEngine: [{ libraryId, name, engineLibraryRef }],
      orphans:         [{ nativeId, nativeName, docCount, firstSeenAt, lastSeenAt }],
      nameDrift:       [{ libraryId, name, expectedName, actualName }] }
```

`KbLibraryVO` 末位追加：`engineSyncStatus`、`engineCheckedAt`、`archivedAt`、
`engineSyncFailed`、`engineSyncMessage`（后两个仅 `update` 回执填，list/get 恒 null）。

### 1.10 两个必须记住的护栏

1. **noop/mock 引擎不许参与对账**：`listLibraries()` 默认实现返回空列表，直接对账会把
   全部 MIS 库判成「引擎缺失」。对账服务入口第一行判 `engineType != "ragflow"` → `skipped=true` 返回。
2. **`DELETE` 端点语义变了**：不带 `mode` 时行为从「物理删（且吞异常假成功）」变成「归档」。
   这是**破坏性语义变更**，回执 `message` 必须明说「已归档，未删除引擎数据」。

---

## T01 契约与数据地基（P0，无依赖）

**目标**：把所有跨任务共享的枚举、能力位、错误码、配置项、表结构、权限码一次性落地，
让 T02–T05 只依赖 T01、彼此不互相等。

### 文件清单

| 文件 | 动作 |
|---|---|
| `backend/mis-migrator/src/main/resources/db/migration/V26__kb_engine_sync.sql` | 新增 |
| `backend/mis-kb/.../domain/model/EngineCapabilities.java` | 改 |
| `backend/mis-kb/.../domain/model/KbResultCode.java` | 改 |
| `backend/mis-kb/.../domain/model/LibraryDeleteMode.java` | 新增 |
| `backend/mis-kb/.../domain/model/EngineSyncStatus.java` | 新增 |
| `backend/mis-kb/.../domain/model/EngineLibraryBrief.java` | 新增 |
| `backend/mis-kb/.../domain/entity/KbLibrary.java` | 改 |
| `backend/mis-kb/.../domain/entity/KbEngineOrphan.java` | 新增 |
| `backend/mis-kb/.../domain/repository/KbEngineOrphanRepository.java` | 新增 |
| `backend/mis-kb/.../domain/repository/KbDocumentRepository.java` | 改 |
| `backend/mis-kb/.../engine/RagflowProperties.java` | 改 |
| `backend/mis-kb/.../engine/KnowledgeEnginePort.java` | 改 |
| `backend/mis-kb/.../config/ShedLockConfig.java` | 新增 |
| `backend/mis-kb/pom.xml` | 改 |
| `backend/mis-kb/src/main/resources/application.yml` | 改 |
| `backend/mis-kb/src/test/.../RetrieveQueryResolverTest.java` | 改（编译连带） |

### 关键改动点

**V26 SQL（四段，全部幂等：固定 ID + `WHERE NOT EXISTS` + `ON CONFLICT DO NOTHING`）**

- A 段：`ALTER TABLE kb_library ADD COLUMN engine_sync_status SMALLINT NOT NULL DEFAULT 0`、
  `ADD COLUMN engine_checked_at TIMESTAMPTZ NULL`、`ADD COLUMN archived_at TIMESTAMPTZ NULL`。
  > `archived_at` 是我这次补的：原口径「归档 = status=0 + 归档标记」没说标记落哪，
  > 光靠 `status=0` 分不清「停用」和「归档」。归档判定 = `status=0 AND archived_at IS NOT NULL`。
  > `LibraryStatus` 枚举保持 0/1 不动。
- B 段：`CREATE TABLE kb_engine_orphan(id BIGINT PK, engine_type VARCHAR(32), native_id VARCHAR(64),
  native_name VARCHAR(255), doc_count INT, first_seen_at, last_seen_at, resolved SMALLINT DEFAULT 0, note VARCHAR(512))`
  \+ `UNIQUE(engine_type, native_id)`。
- C 段：`CREATE TABLE shedlock(name VARCHAR(64) PRIMARY KEY, lock_until TIMESTAMPTZ NOT NULL,
  locked_at TIMESTAMPTZ NOT NULL, locked_by VARCHAR(255) NOT NULL)`。
- D 段：两个权限码的菜单节点 + `sys_role_permission`(role_id=1) + `sys_api` + `sys_menu_api`
  登记，**照 V17 的写法**（不是 V2/V6 的旧 schema）。ID 段位：`sys_api`/`sys_menu_api` 取
  9106x 空位（91060 catalog 已存在可复用父节点，接口行取 91062/91063/91064，
  `code` 取 `00900002/3/4`）；菜单节点取 9107x。
  **登记不能省**：BFF `api-permission.deny-unmapped=false`，不登记 = 任何登录用户都能调，
  权限码只管菜单显隐（V17 文件头已把这个坑写明白）。

**EngineCapabilities**：末位加 `deleteSupported`；加 `CAP_DELETE="delete"`；
`of()` 扩到 5 参并把 `delete` 纳入列表反推；`unsupported()` 补第 5 个 false。

**KbResultCode**：加 §1.8 两个码。

**KnowledgeEnginePort**：新增两个 **default** 方法（noop/mock 零改动）：
- `default void renameLibrary(EngineLibraryRef ref, String newName) { }` —— 空实现 + WARN 日志
- `default List<EngineLibraryBrief> listLibraries() { return List.of(); }`

**EngineLibraryBrief**：`record EngineLibraryBrief(String nativeId, String name, Integer documentCount, Instant updatedAt)`。

**KbDocumentRepository**：加 `void deleteByLibraryId(Long libraryId)`（Q6：物理删库要清悬空文档，
现状只清了 `kb_acl`）。

**RagflowProperties**：加 `deleteSupported`（默认 false）与内部类 `Reconcile`（§1.6 全部 key）+ getter/setter。

**ShedLockConfig**：`@Configuration @EnableSchedulerLock(defaultLockAtMostFor = "PT10M")`，
`LockProvider` bean = `new JdbcTemplateLockProvider(dataSource, "shedlock")`。
pom 加 `net.javacrumbs.shedlock:shedlock-spring` + `shedlock-provider-jdbc-template`（版本走 dependencyManagement，别裸写）。

### 验收点

1. `mvn -pl backend/mis-kb -am test` 编译通过、既有单测全绿（重点看 `RetrieveQueryResolverTest`）。
2. V26 在**干净库**与**存量库**上各跑一次 `flyway migrate`，再重复跑一次不报错（幂等）。
3. 迁移后自检 SQL 全部符合预期：
   - `kb_library` 有 `engine_sync_status/engine_checked_at/archived_at` 三列；
   - `shedlock`、`kb_engine_orphan` 表存在；
   - `SELECT id,name,type FROM sys_menu WHERE app_id=91010 AND permission IN ('kb:library:engine-ref:view','kb:engine:reconcile') AND status=1;`
     → **每个码恰好 1 行**（多于 1 行即违反 `uk_menu_app_permission`）；
   - 三条新接口在 `findRegistryRows` 的联表查询里能查到且 permission 正确。
4. `mis.kb.engine.type=noop` 启动无异常（新 default 方法未破坏 Noop/Mock）。

---

## T02 引擎适配层：命名规范 + rename + listDatasets（P0，依赖 T01）

**目标**：让 RAGFlow 适配器具备「按规范命名、改名、列举 dataset、声明删除能力」四项能力，
且命名加工完全封在 adapter 层。

### 文件清单

| 文件 | 动作 |
|---|---|
| `backend/mis-kb/.../engine/RagflowClient.java` | 改 |
| `backend/mis-kb/.../engine/RagflowAdapter.java` | 改 |
| `backend/mis-kb/.../engine/RagflowDatasetNaming.java` | 新增 |
| `backend/mis-kb/.../engine/dto/RfDataset.java` | 改（补 listDatasets 所需字段） |
| `backend/mis-kb/.../engine/MockAdapter.java` | 改 |
| `backend/mis-kb/.../domain/model/CreateLibraryCmd.java` | 改 |
| `backend/mis-kb/.../domain/service/KbLibraryService.java` | 改（**仅 create()**，见下方红字） |

### 关键改动点

**RagflowClient**
- `void renameDataset(String datasetId, String name)`：`PUT /api/v1/datasets/{id}`，body `{"name": name}`，
  复用现有 `putFor` + `code != 0 抛异常` 的口径。
- `List<RfDataset> listDatasets(int page, int pageSize)`：`GET /api/v1/datasets?page=&page_size=`，
  page 从 1 起（与现有 `listDocuments` 口径一致）。`health()` 已证明该接口连通，别再造探测。

**RagflowDatasetNaming**（纯静态工具，零依赖，好测）
- `String forCreate(String topCategoryName, String libraryName, long libraryId)` → §1.4 格式
- `String forArchive(String currentName, LocalDate date)` → `[已归档-yyyyMMdd]-{原名}`
- `String sanitize(String raw)` / `MAX_DATASET_NAME = 128` 截断规则见 §1.4

**RagflowAdapter**
- `capabilities()` → `EngineCapabilities.of(rerankAvailable, true, true, true, props.isDeleteSupported())`
- `createLibrary(cmd)` → 用 `RagflowDatasetNaming.forCreate(cmd.topCategoryName(), cmd.name(), cmd.libraryId())`
  产出 dataset 名再 `client.createDataset(...)`
- `renameLibrary(ref, newName)` → `client.renameDataset(...)`
- `listLibraries()` → 循环 `listDatasets(page++, pageSize)` 直到返回不足 pageSize 或触到
  `reconcile.max-pages`，映射成 `EngineLibraryBrief`

**⚠️ CreateLibraryCmd 与 ID 生成顺序（本任务最容易踩的坑）**
现状 `KbLibraryService.create()` 是**先调 `enginePort.createLibrary()`、后 `IdGenerator.nextId()`**，
所以 adapter 拿不到 MIS 库 ID，也拿不到 categoryId。改法：
1. `CreateLibraryCmd` 增加 `long libraryId` 与 `String topCategoryName` 两个分量；
2. `KbLibraryService.create()` 里把 `IdGenerator.nextId()` **提前到调引擎之前**，并查出一级分类名传入；
3. **本任务只动 `create()` 这一处**，`update()`/`delete()` 归 T03，两边别互相回退。

**MockAdapter**：`capabilities()` 5 参传 true；`listLibraries()` 返回内存 map（给 T04 单测用）。
**NoopAdapter**：不动，走 default（空列表 + `unsupported()`）。

### 验收点

1. 单测（新增 `RagflowDatasetNamingTest`）：正常拼接、超长只截库名段、归档前缀幂等
   （对已归档名再归档不产生双前缀）、非法字符替换。
2. 单测：`listLibraries()` 的分页终止条件（不足一页即停、触顶 max-pages 即停并记 WARN）。
3. 联调环境（有 RAGFlow）：新建库后引擎侧 dataset 名 = `一级分类-库名-ID后6位`；
   调一次 rename 后 `GET /datasets` 能看到新名。
4. `GET /internal/v1/kb/engine/capabilities` 返回 `deleteSupported=false`，
   且 `capabilities` 数组**不含** `"delete"`。

---

## T03 领域服务：删除三分支 + update 回执（P0，依赖 T01、T02）

**目标**：干掉「吞异常假成功」，把删除做成语义清晰的三分支，并让 update 的引擎同步失败可见。

### 文件清单

| 文件 | 动作 |
|---|---|
| `backend/mis-kb/.../domain/service/KbLibraryService.java` | 改（140–153 `delete`、133–135 `update`） |
| `backend/mis-kb/.../api/dto/KbLibraryDeleteResultVO.java` | 新增 |
| `backend/mis-kb/.../api/dto/KbLibraryVO.java` | 改（末位追加 5 字段） |
| `backend/mis-kb/.../api/dto/KbEngineRefVO.java` | 新增 |
| `backend/mis-kb/.../api/controller/LibraryController.java` | 改 |
| `backend/mis-kb/.../domain/service/RagSettingsService.java` | 改（`KbLibraryVO` 第 2 处构造点，121 行） |

### 关键改动点

**`delete(Long id, LibraryDeleteMode mode)`（替换现有无参 delete）**

- `ARCHIVE`
  1. `enginePort.renameLibrary(ref, RagflowDatasetNaming.forArchive(...))`；
  2. 引擎抛异常 → **不阻断**（归档以本地语义为主）：`engineSynced=false`、
     `engine_sync_status=3`、`engine_checked_at=now`，回执 message 提示「已记入待对账」；
  3. 本地 `status=0` + `archived_at=now`，**MIS 侧 `name` 不改**（改了会撞唯一键、也会让用户找不到库）；
  4. 不清 `kb_document`、不清 `kb_acl`（Q6：归档不清文档）。
- `PHYSICAL`
  1. `props.deleteSupported == false` → 抛 `KB_ENGINE_DELETE_UNSUPPORTED`，**本地零变更**；
  2. `true` → 先 `enginePort.deleteLibrary()`；抛异常则抛 `KB_ENGINE_DELETE_FAILED`
     并让 `@Transactional` 回滚（**不准 catch 后继续**）；
  3. 引擎成功后依次 `documentRepository.deleteByLibraryId` → `aclRepository.deleteByLibraryId`
     → `libraryRepository.delete`。
- 「停用」不在这里（§1.1）。

**`update()` 的吞异常隐患（133–135）**：`catch` 里除了 WARN，追加
`engine_sync_status=3` / `engine_checked_at=now` 落库，并在返回 VO 上带
`engineSyncFailed=true` + `engineSyncMessage`。**不上抛**（保存本身已成功，上抛会让前端以为没存）。

**KbLibraryVO**：末位追加 `engineSyncStatus / engineCheckedAt / archivedAt /
engineSyncFailed / engineSyncMessage`；两处构造点（`KbLibraryService:163`、`RagSettingsService:121`）同步改。

**LibraryController**
- `DELETE /{id}` 加 `@RequestParam(defaultValue = "archive") String mode`，
  非法值 → `BusinessException(VALIDATION_ERROR)`；返回 `Result<KbLibraryDeleteResultVO>`。
- 新增 `GET /{id}/engine-ref` → `KbEngineRefVO`。内部端点**不重复判权**（判权在 BFF，与既有口径一致）。

### 验收点

1. 单测四条（用 mock 引擎 + `@DataJpaTest`/`@SpringBootTest` 择一）：
   - `physical` + `deleteSupported=false` → 抛 40934，`kb_library` 行仍在；
   - `physical` + 引擎抛异常 → 抛 40935，且 `kb_library`/`kb_acl`/`kb_document` **三表零变更**（事务回滚）；
   - `physical` + 成功 → 三表均无该库残留（**重点回归 Q6 的悬空文档**）；
   - `archive` → `status=0`、`archived_at` 非空、引擎收到 rename 调用；引擎失败时仍归档成功
     且 `engineSynced=false` / `engine_sync_status=3`。
2. `update()` 引擎失败时：接口仍 200、库仍保存、VO 带 `engineSyncFailed=true`、DB `engine_sync_status=3`。
3. 回归：不带 `mode` 调 `DELETE` → 走归档（语义变更已在回执 message 里说明）。

---

## T04 对账服务 + BFF 全链路（P0，依赖 T01、T02、T03）

**目标**：把「MIS 与引擎不一致」从看不见变成看得见、可手动触发、多实例安全；
并把 T03 的新契约一路透到 BFF。

### 文件清单

| 文件 | 动作 |
|---|---|
| `backend/mis-kb/.../domain/service/KbEngineReconcileService.java` | 新增 |
| `backend/mis-kb/.../domain/model/EngineReconcileReport.java` | 新增 |
| `backend/mis-kb/.../api/dto/KbEngineReconcileVO.java` | 新增 |
| `backend/mis-kb/.../api/controller/EngineConfigController.java` | 改 |
| `backend/mis-admin-bff/.../controller/KbController.java` | 改（187–191 + 550 段附近） |
| `backend/mis-admin-bff/.../service/KbFacadeService.java` | 改（162 行 `deleteLibrary` 等） |
| `backend/mis-admin-bff/.../client/KbWebClient.java` | 改（364 行 `deleteLibrary` 等） |
| `backend/mis-admin-bff/.../dto/kb/KbEngineCapabilitiesVO.java` | 改（加 `deleteSupported`） |
| `backend/mis-admin-bff/.../dto/kb/KbLibraryVO.java` | 改（镜像 T03 新字段） |
| `backend/mis-admin-bff/.../dto/kb/KbLibraryDeleteResultVO.java` | 新增 |
| `backend/mis-admin-bff/.../dto/kb/KbEngineRefVO.java` | 新增 |
| `backend/mis-admin-bff/.../dto/kb/KbEngineReconcileVO.java` | 新增 |

### 关键改动点

**KbEngineReconcileService**
- 入口护栏：`engineType != "ragflow"` → 返回 `skipped=true, skipReason="当前引擎不支持对账"`，
  **一个字段都不写库**（§1.10-1）。
- 比对：`enginePort.listLibraries()` 全量 ×（`kb_library` 中 `engine_library_ref` 非空的行），按
  `nativeId` 双向 join：
  - MIS 有 / 引擎无 → `engine_sync_status=2`
  - 引擎有 / MIS 无 → `kb_engine_orphan` upsert（`first_seen_at` 保留、`last_seen_at` 刷新）
  - 名称与期望名不符 → `engine_sync_status=3`；**已归档库的期望名 = 归档名**，别把归档判成漂移
  - 其余 → `1`；所有参与比对的行统一刷 `engine_checked_at`
- 定时：`@Scheduled(fixedDelayString = "${mis.kb.engine.reconcile.interval-ms:1800000}")`
  \+ `@SchedulerLock(name = "kb-engine-reconcile", lockAtMostFor = ..., lockAtLeastFor = ...)`；
  方法体第一行判 `reconcile.enabled`，false 直接 return（Nacos 热调）。
- 报告：内存 `AtomicReference<EngineReconcileReport>` 存最近一次；重启后 `GET` 若为空，
  用 DB（`kb_library.engine_sync_status` + `kb_engine_orphan`）重算 counts，明细按需查。

**EngineConfigController**：`GET /internal/v1/kb/engine/reconcile`（读最近报告）、
`POST /internal/v1/kb/engine/reconcile`（同步跑一次并返回报告，受 max-pages 保护）。

**BFF**
- `DELETE /kb/libraries/{id}` 加 `mode` 透传，返回 `KbLibraryDeleteResultVO`；
- 新增 `GET /kb/libraries/{id}/engine-ref`，加
  `@OperLog(module = "知识库", operation = "查看引擎引用")` —— **Q4 破 F8 红线的代价就是这行审计，不能省**；
- 新增 `GET`/`POST /kb/engine/reconcile`，POST 同样加 `@OperLog`；
- `engineCapabilities()` 映射补 `deleteSupported`；`KbLibraryVO` 镜像补三个同步字段。

### 验收点

1. 单测：mock 引擎构造「引擎缺失 / 游离 dataset / 名称漂移 / 一致」四种样本，断言四个桶数量与明细正确；
   已归档库不被误判为漂移。
2. 单测：`engineType=noop` → `skipped=true`，且**任何一行 `engine_sync_status` 都没被改写**。
3. 多实例：本地起两个 mis-kb（临时把 `interval-ms` 调 30s），观察 `shedlock` 表 lock 行，
   同一窗口内只有一个实例执行（日志计数）。
4. 判权：无 `kb:engine:reconcile` 的用户 `POST /api/v1/kb/engine/reconcile` → **403**
   （BFF 需重启或等注册表 300s 刷新）；无 `kb:library:engine-ref:view` 调 engine-ref → 403。
5. 审计：调一次 engine-ref 后，`sys_oper_log` 有对应记录且**不含 apiKey 之类敏感字段**。

---

## T05 前端：可搜索组合框 + 归档弹窗 + 对账区（P0，依赖 T04；契约冻结后可并行编码）

**目标**：把「选错库」和「以为删干净了」两类事故在 UI 层堵死。

### 文件清单

| 文件 | 动作 |
|---|---|
| `frontend/mis-admin-web/src/features/kb/types.ts` | 改 |
| `frontend/mis-admin-web/src/features/kb/api/kb-api.ts` | 改（165 行 `deleteLibrary` 等） |
| `frontend/mis-admin-web/src/features/kb/components/kb-library-combobox.tsx` | 新增 |
| `frontend/mis-admin-web/src/features/kb/permission/kb-permission-page.tsx` | 改（180–189） |
| `frontend/mis-admin-web/src/features/kb/library/kb-library-delete-dialog.tsx` | 新增 |
| `frontend/mis-admin-web/src/features/kb/library/kb-library-page.tsx` | 改（333–343、菜单项、列表列） |
| `frontend/mis-admin-web/src/features/kb/engine/kb-engine-page.tsx` | 改（能力清单 + 对账区块） |

> **`components/kb-library-picker.tsx` 一行都不许动**（4 个调用点保持原状，Q1 决议）。

### 关键改动点

**kb-library-combobox.tsx（新）**
- 数据源：`listLibraries()` + `listCategories()`，**前端本地 join** 出分类路径（零后端改动）；
- 选项行：`分类路径 / 库名（密级）· #ID`；
- 模糊搜：命中「库名 ∪ 分类路径 ∪ ID 字符串」任一即可；
- 同名库（`name` 重复）时**分类路径加粗高亮**，这是防误选的核心；
- 键盘可达：↑↓ 移动、Enter 选中、Esc 关闭、输入即筛；
- 空态三分：无任何库 / 搜索无结果 / 加载失败（带重试）；
- 沿用 `useKbStore.libraryEpoch` + `activePath` 重拉机制（照抄 picker 的写法，KeepAlive 下不会显示陈旧列表）；
- 「当前操作对象」卡片**不在本组件内**，由调用页负责（组件保持纯粹）。

**kb-permission-page.tsx**
- 180–189 的 `KbLibraryPicker` → `KbLibraryCombobox`；
- 顶部常驻「当前操作对象」卡片：库名 + 分类路径 + 密级徽标 + `#ID`；
- 授权抽屉/弹窗标题带库名（`为「XX库」新增授权`）；
- `secret`/`confidential` 时卡片显红色警示条；
- 未选库时表格区空态提示「请先选择知识库」。

**kb-library-delete-dialog.tsx（新）**
- props：`{ library, capabilities, onDone }`；
- `deleteSupported === false` → 只有「归档」主按钮，「物理删除」项**置灰 + 说明**
  （「当前引擎版本不支持在线删除，升级后开放」）；
- 归档说明清单：**会做什么**（引擎侧改名、本地停用、从可见性中移除）/ **不会做什么**
  （不删引擎数据、不删文档、不释放存储）；
- 「删除指引单」区块（含 `dataset_id`）：调 `getEngineRef(id)`，外层
  `<PermissionGate permission="kb:library:engine-ref:view">` 包裹，未授权显示占位而不是空白；
- type-to-confirm：输入库名**完全一致**才启用确认按钮；
- 提交后按回执渲染：`engineSynced=false` 时黄色提示「引擎侧未同步，已记入对账」。

**kb-library-page.tsx**
- 333–343 的 `window.confirm` → 上面的 Dialog；成功后仍走 `invalidateLibraries()` + `loadLibraries()`；
- 行菜单「删除」→「**归档**」（Q9；`PermissionGate` 仍用 `kb:library:delete`，不新增权限码）；
- 列表新增「引擎同步」徽标列：0 灰 / 1 绿 / 2 红 / 3 黄，tooltip 显示 `engineCheckedAt`。

**kb-engine-page.tsx**
- 能力清单加 `CapabilityBadge label="在线删除"`，false 时附一句
  「当前版本经归档流程处理，删除不下发引擎」；
- 新增「引擎对账」Card：上次对账时间、三类差异计数、明细折叠表、「立即对账」按钮
  （`PermissionGate permission="kb:engine:reconcile"`）；`skipped=true` 时整块显示
  「当前引擎不支持对账」而不是报错。

**types.ts / kb-api.ts**
- `KbEngineCapabilities` 加 `deleteSupported`；`KbLibrary` 加 `engineSyncStatus`/`engineCheckedAt`/`archivedAt`；
  新增 `KbEngineReconcileReport`、`KbEngineOrphan`、`KbEngineRef`、`KbLibraryDeleteResult`、`KbLibraryDeleteMode`；
- `deleteLibrary(id, mode)` 返回回执（**签名变更，同步改 333 行调用点**）；
  新增 `getEngineRef(id)`、`getReconcileReport()`、`runReconcile()`。

### 验收点

1. 权限页：切库后「卡片 / 表格 / 抽屉标题」三处同步；搜「财务」能命中该分类路径下的库；
   构造两个同名库，能靠加粗分类路径区分。
2. 归档弹窗：不输库名时确认按钮禁用；无 `engine-ref` 权限的账号看不到 `dataset_id`；
   归档成功后列表该行变灰并出现归档标记。
3. 引擎页：`deleteSupported=false` 时「在线删除」显红叉且有说明；点「立即对账」能刷出计数。
4. `mis.kb.engine.type=noop` 环境下所有页面不白屏，对账区显示 skip 文案。
5. `pnpm build` / `tsc` 零错误，ESLint 无新增告警。

---

## 2. 不在本次范围

| 项 | 归属 | 说明 |
|---|---|---|
| 存量库 dataset 重命名脚本 | **P1** | Q8：P0 只保证「新建库套命名规范」 |
| 其余 3 个 `KbLibraryPicker` 调用点迁移到 combobox | **P1** | 先在权限页验证形态 |
| `kb_engine_orphan` 的「认领 / 清理」操作页 | **P1** | P0 只做发现与展示 |
| 归档库「取消归档」自动改回引擎名 | **P1** | P0 可用既有 `PUT status=1` 恢复启用，但引擎名不回滚，会被对账判漂移 |
| RAGFLOW 升级 + `delete-supported` 切 true 的灰度回归 | **P2** | Q11，运维并行推进 |
| 引擎能力启动探测 | **不做** | Q5 已裁定用配置项 |
| `FORCE_UNBIND` 强制解绑删除出口 | **不做** | Q10 已裁定不提供 |

## 3. 待明确事项（3 条，均为实现期可自行确认的低风险项）

1. **RAGFlow dataset name 长度硬上限**未见官方明确 → 暂按 128 截断。请在联调环境用 200 字符名试一次，
   以实测为准回填 `MAX_DATASET_NAME`。
2. **`sys_api.path_pattern` 是否支持通配**：`/api/v1/kb/libraries/*/engine-ref` 这种带路径变量的注册，
   需先读 `ApiPermissionRegistry` / `ApiPermissionInterceptor` 的匹配实现确认（V17 注册的
   `/api/v1/kb/hit-test` 是精确路径，没验证过通配）。若只支持精确匹配，则把端点改为
   `GET /api/v1/kb/engine-ref?libraryId=` 这种无路径变量形式，T01 的 D 段与 T04 的 BFF 路由同步调整。
3. **归档改名的日期口径**用服务器本地日期还是 UTC → 建议服务器本地日期（运维看引擎控制台时更直觉），
   若与既有时间口径冲突以仓库既有约定为准。

## 4. 落地顺序与联调关卡

```
T01 ──┬── T02 ── T03 ── T04 ── 联调关卡 B ── T05 收尾
      └────────────────────────┘
                  ↑
            T05 编码可从这里并行起步（契约见 §1.9）

联调关卡 A（T03 完成）：内部端点用 curl 验四种删除分支
联调关卡 B（T04 完成）：BFF 三条新接口 + 403 判权 + 审计落库
```

