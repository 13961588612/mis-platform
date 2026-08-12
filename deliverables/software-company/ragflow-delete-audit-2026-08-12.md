# RAGFlow 删除语义与对账机制审计报告

- 审计模块：`backend/mis-kb`（MIS 平台对接 RAGFlow 知识库引擎）
- 审计类型：**只读代码审计**（未修改任何源码，未运行测试/服务）
- 审计日期：2026-08-12
- 审计人：software-engineer（团队只读审计）

---

## 1. TL;DR

1. **当前删除语义**：知识库默认走 **软删除（归档）**——引擎侧只 `PUT` 改名 + 本地置 `status=0/archived_at`，引擎数据完整保留；知识库“物理删除”被配置开关 `delete-supported`（默认 `false`）**整体拦截**，且即便放开，当前代码用的是**非官方的单 id 路径 `DELETE /api/v1/datasets/{id}`（本实例实测 405）**。文档删除则是**真实物理删除**，且 URL 已采用**官方形态** `DELETE /api/v1/datasets/{ds}/documents` + `{"ids":[docId]}`。
2. **对账健在性**：`KbEngineReconcileService` / `KbEngineOrphanService` **健在但完全脱离删除链路**——仅由 30 分钟定时任务 + 手动端点触发，删除流程里不调用。它能在 dataset 级别发现“MIS↔引擎”漂移（置 `engine_sync_status` 标记 + 孤儿表），但**只标记不处置**：「RAGFlow 已删、本地残留」仅被标成 `MISSING_IN_ENGINE`，无自动清理；且**完全没有文档级对账**。
3. **核心建议**：把库物理删除的 URL 改成官方批量 `{"ids":[...]}` 形态（当前单 id 路径 405 是假失败/硬失败根因），`delete-supported` 仅在改完 URL 后再放开；同时**补强对账**：新增文档级对账 + 对 `MISSING_IN_ENGINE` 的本地残留增加自动/可手动清理路径。

---

## 2. 当前删除语义核实

### 2.1 知识库（dataset）删除

入口：`KbLibraryService.delete(Long, Long, LibraryDeleteMode)`（`backend/mis-kb/src/main/java/com/mis/kb/domain/service/KbLibraryService.java#L306`）。

- **默认模式 = 归档（软删除）**：`effective = mode == null ? LibraryDeleteMode.ARCHIVE : mode;`（`KbLibraryService.java#L308`）。即不带 `mode` 时不会物理删。
- **归档分支 `archive()`**（`KbLibraryService.java#L331`）：
  - 引擎侧：`enginePort.renameLibrary(...)` → `RagflowAdapter.renameLibrary`（`RagflowAdapter.java#L256`）→ `client.renameDataset(...)` → `PUT /api/v1/datasets/{id}` 仅改 `name`（`RagflowClient.java#L284`）。**不调用任何 DELETE，引擎数据原样保留、可恢复**。
  - 本地侧：`status=DISABLED(0)` + `archived_at=now`，三表均不清（`KbLibraryService.java#L359`）。文档/授权全保留（`archiveMessage` 文案明确“未删除引擎数据”，`KbLibraryService.java#L473`）。
  - **结论：软删除（引擎侧改名 + 本地停用打标），可回滚**（取消归档 `update()` 里会改回规范名并清 `archived_at`，`KbLibraryService.java#L263`）。
- **物理删除分支 `physicalDelete()`**（`KbLibraryService.java#L383`）：
  - **第一道闸门**：`if (!engineProperties.isDeleteSupported())` → 抛 `KB_ENGINE_DELETE_UNSUPPORTED`(40934)，**本地零变更**（`KbLibraryService.java#L384`）。`isDeleteSupported()` 来自 `RagflowProperties.deleteSupported`，默认 `false`（`RagflowProperties.java#L48`），`application.yml#L32` 默认 `false`。**因此当前部署下“物理删除”根本不会执行引擎调用**。
  - 若放开开关：`enginePort.deleteLibrary(ref)` → `RagflowAdapter.deleteLibrary`（`RagflowAdapter.java#L244`：`client.deleteDataset(ref.nativeId())`）→ `RagflowClient.deleteDataset`（`RagflowClient.java#L265`）→ `deleteFor("/api/v1/datasets/" + datasetId, ...)` → **`DELETE /api/v1/datasets/{id}`（单 id 路径参数，无 body）**（`RagflowClient.java#L593`）。
  - 引擎成功后按 文档→授权→库 顺序清本地（`KbLibraryService.java#L403`）。
  - **这是非官方形态**：RAGFlow 官方 dataset 删除是 `DELETE /api/v1/datasets` + body `{"ids":[...]}`，当前代码走的是**单 id 路径参数**，与官方不一致。

**是否会被 405（证据）**：
- `RagflowClient.deleteDataset` 注释明确：「该实例 `DELETE /api/v1/datasets/{id}` 返回 405 MethodNotAllowed——RAGFlow 这个版本根本不提供 dataset 物理删除」（`RagflowClient.java#L248`～`#L267`）。
- 测试 `RagflowDeleteHttpTest.Delete405.deleteDataset405Throws` 实测断言：`lastPath == "/api/v1/datasets/ds-1"`、`lastMethod == "DELETE"`、异常 message 含「删除知识库」与「405」（`RagflowDeleteHttpTest.java#L106`）。
- **关键点（已修复旧“假成功”缺陷）**：`deleteFor` 现在对非 2xx 一律抛 `BusinessException`（`RagflowClient.java#L593`～`#L608`），不再用 `toBodilessEntity()` 吞掉 405。因此若放开 `delete-supported`，单 id 路径 405 会**显式失败**→ `physicalDelete` catch 后抛 `KB_ENGINE_DELETE_FAILED`(40935)→ `@Transactional` 回滚，**本地零变更、不产生孤儿**（测试 `KbLibraryServiceDeleteTest.shouldRollbackWhenEngineDeleteFails` 钉死此行为，`KbLibraryServiceDeleteTest.java#L153`）。

### 2.2 文档（document）删除

入口：`KbDocumentService.delete(Long, Long, Long)`（`backend/mis-kb/src/main/java/com/mis/kb/domain/service/KbDocumentService.java#L194`）。

- **总是物理删除**：`enginePort.deleteDocument(...)` → `RagflowAdapter.deleteDocument`（`RagflowAdapter.java#L502`）→ `client.deleteDocument(datasetId, docId)` → **`DELETE /api/v1/datasets/{ds}/documents` + JSON body `{"ids":[docId]}`**（`RagflowClient.java#L563`～`#L576`，实际发请求在 `deleteWithJsonBody`，`RagflowClient.java#L615`）。
- **该 URL/body 形态即 RAGFlow 官方文档删除形态**（集合端点 + `ids` body）。`RagflowClient.java#L546`～`#L555` 注释明确：官方就是 `DELETE /api/v1/datasets/{dataset_id}/documents` + `{"ids":["docId"]}`，而**路径式 `…/documents/{docId}` 在本实例才返回 405**。当前代码**未使用路径式**，已规避 405。
- **注意与库删除的差异**：文档删除**不受 `delete-supported` 开关约束**，只要引擎映射存在就直接发请求（`KbDocumentService.java#L199` 仅依赖 `syncEngineDocument` 回调，回调里失败则抛 40935、本地不删）。
- 测试 `RagflowDeleteHttpTest.Delete405.deleteDocument2xxSucceeds` 断言：`lastPath == "/api/v1/datasets/ds-1/documents"`、`body` 含 `"ids"` 与 `doc-1`、不抛异常（`RagflowDeleteHttpTest.java#L142`）。

> **对 team-lead 假设的纠正**：假设“当前疑似 `DELETE /api/v1/datasets/{id}` 和 `DELETE …/documents/{docId}`”**只对了前半句**。
> - 库删除确为 `DELETE /api/v1/datasets/{id}`（单 id 路径，非官方）。
> - 文档删除**并非** `…/documents/{docId}` 路径式，而是已经采用官方 `…/documents`（集合）+ `{"ids":[docId]}` body。文档侧无需改 URL，库侧才需改。

---

## 3. 对账机制核实

### 3.1 是否接入删除链路

- **结论：未接入**。全仓 grep `ReconcileService | OrphanService | reconcile(` 仅出现在：`EngineConfigController`（手动端点）、`KbApplication`（注释）、`KnowledgeEnginePort`（注释护栏说明）、以及服务/实体/仓库/VO/Model 自身。**`KbLibraryService` 与 `KbDocumentService` 的删除方法不调用任何 reconcile/orphan 服务**（删除流程里只依赖 `enginePort` 与 repository）。
- 对账是**独立后台进程**：`KbEngineReconcileService.scheduledReconcile()` 用 `@Scheduled(fixedDelay=1800000)`（30 分钟）+ `@SchedulerLock`（ShedLock 多实例互斥）触发（`KbEngineReconcileService.java#L99`）；另有 `EngineConfigController.runReconcile()` 手动触发（`EngineConfigController.java#L105`）、`reconcileReport()` 读取（`EngineConfigController.java#L90`）。

### 3.2 KbEngineReconcileService 做什么

`reconcile()`（`KbEngineReconcileService.java#L127`）：

1. **护栏**：`engineProperties.isRagflow()` 为 false 直接 `skipped`（noop/mock 的 `listLibraries()` 返空，若放行会把全库标成引擎缺失，`KbEngineReconcileService.java#L129` + `KnowledgeEnginePort.java#L62`）。`RagflowProperties.type` 默认 `"noop"`，故默认/CI 环境对账自动跳过，仅 `type=ragflow` 时生效。
2. **拉引擎侧全量 dataset**（`enginePort.listLibraries()` → `RagflowAdapter.listLibraries` 翻页，`RagflowAdapter.java#L274`）与本地 `kb_library.engineLibraryRef` 比对，四类结果（`KbEngineReconcileService.java#L39` 表）：
   - MIS 有 / 引擎无 → `kb_library.engine_sync_status = 2`（`MISSING_IN_ENGINE`，`#L156`）；
   - 引擎有 / MIS 无 → `kb_engine_orphan` upsert 一条待处理孤儿（`#L181`，`upsertOrphans` `#L263`）；
   - 名称与期望名不符 → `engine_sync_status = 3`（`DRIFT_OR_FAILED`，`#L168`）；
   - 一致 → `engine_sync_status = 1`（`#L166`）。
3. **孤儿自动关闭**：本轮引擎侧不再出现的孤儿行（且未经人工处置）被置 `resolved=1`（`#L293`）。

### 3.3 KbEngineOrphanService 做什么

- 仅提供**人工处置**孤儿（`引擎有 / MIS 无`）的能力：`resolve()` 三种动作 `BIND_EXISTING` / `ADOPT_NEW` / `IGNORE`（`KbEngineOrphanService.java#L118`），由 `EngineConfigController.resolveOrphan` 调用（`EngineConfigController.java#L138`）。**处理的是“RAGFlow 残留 dataset、本地无映射”**这一方向，且只能认领/忽略，**不能删除引擎数据**。
- 实体 `KbEngineOrphan`（`KbEngineOrphan.java`）是 **dataset 级**表，没有文档级对应物。

### 3.4 覆盖的孤儿场景与缺口

| 场景 | 是否被覆盖 | 覆盖方式 | 处置缺口 |
|---|---|---|---|
| **RAGFlow 已删、本地库残留**（MIS有/引擎无） | 能发现 | reconcile 标 `MISSING_IN_ENGINE`(status=2) | **只标记、不自动清理**；`KbEngineOrphanService` 也无“删本地”动作。残留记录长期可见、可检索，无自动收敛 |
| **RAGFlow 残留 dataset、本地无映射**（引擎有/MIS无） | 能发现+可人工处置 | orphan 表 + 三种认领/忽略动作 | 已较完整（认领/忽略），但**不提供“真删引擎 dataset”出口**（只能忽略保留） |
| **RAGFlow 已删、本地文档残留**（MIS doc 有/引擎 doc 无） | **完全不覆盖** | 全仓无文档级对账逻辑 | 无检测、无标记、无清理。`kb_document.engine_document_ref` 从未与引擎 `listDocuments` 比对（grep 确认无 `documentReconcile`） |
| 名称漂移 | 能发现 | 标 `DRIFT_OR_FAILED`(status=3) | 仅标记，靠 `取消归档`/`存量改名`端点人工修 |

**最大缺口**：
- 缺口 A：**「RAGFlow 单边已删、本地残留」无解动作**。对账只写状态位，`status=2` 的库不会被任何自动/手动流程清掉（除非人工在库列表删，而那又会回到 2.1 的归档/受控物理删逻辑）。
- 缺口 B：**完全没有文档级对账**。库删除时本地 `kb_document` 由 `physicalDelete` 顺带清（`KbLibraryService.java#L403`），但“引擎侧文档被外部删/改名”这类单边漂移在 MIS 侧**不可见、不报警**。
- 缺口 C：孤儿表与处置仅针对 dataset，不覆盖 document。

---

## 4. 若改回官方物理删除（批量 `{"ids":[...]}` body）的影响与遗留风险

> 前提：把库删除从单 id 路径 `DELETE /api/v1/datasets/{id}` 改为官方 `DELETE /api/v1/datasets` + `{"ids":[datasetId]}`（文档侧已是该形态，无需改）。

1. **库物理删除将真正生效（不再 405 卡死）**：当前单 id 路径在本实例 405；改为集合+body 后，按文档侧同构实测（文档集合+body 已正常），库删除大概率可成功调用。需先在**目标实例实测**确认该版本支持 dataset 集合删除（见待澄清 Q1）。
2. **`delete-supported` 开关应在 URL 修正后再放开**：现在该开关是“防 405 假成功”的兜底，本质是因为 URL 写错。URL 改对后，开关可回归其本意（是否允许业务物理删），建议默认仍 `false`、`type=ragflow` 且经产品确认后再翻 `true`（`RagflowProperties.java#L38` 注释已规划 P2 升级后放开）。
3. **事务边界风险未变，且对账需补强（最关键）**：`physicalDelete`/`KbDocumentService.delete` 中引擎 HTTP 调用在 `@Transactional` 方法内但**不在 DB 事务回滚范围内**——若引擎删除成功、而随后本地 `libraryRepository.delete`/`documentRepository.delete` 抛异常，则**引擎已删、本地残留**，且本地残留**无任何自动收敛**（缺口 A）。即使有 reconcile，也只标 `status=2`，不清理。**必须新增“连续 N 次 MISSING_IN_ENGINE → 自动软删本地/或提供人工‘清理本地残留’动作”**。
4. **文档级对账必须补齐（缺口 B/C）**：一旦文档物理删除被业务广泛使用，应新增文档级 reconcile（按 dataset `listDocuments` 比对 `kb_document.engine_document_ref`），否则“引擎 doc 被外部删除/改名”将持续不可见。
5. **保留“显式失败、不吞错”的硬约束**：`deleteFor`/`deleteWithJsonBody` 已正确对非 2xx 抛异常（`RagflowClient.java#L593`、`#L615`），`delete-supported=false` 与“引擎失败即抛、本地零变更”两条护栏要**原样保留**——这是旧代码“假成功孤儿”的根因修复，改 URL 时切勿回退。

---

## 5. 待澄清问题

1. **目标 RAGFlow 版本是否支持 `DELETE /api/v1/datasets`（集合）+ `{"ids":[...]}`？** 当前文档集合删除已验证可用，但 dataset 集合删除在同实例是否可用尚未实测。若不支持，则库物理删除**根本无法经 API 实现**，只能继续归档（软删）。
2. **生产环境 `reconcile.enabled` 与 `type` 实际取值？** `application.yml` 默认 `enabled=true`、但 `type` 默认 `noop`（对账自动跳过）。需确认线上是否 `type=ragflow` 且对账确实在跑；若关着，所有漂移当前不可见（缺口被放大）。
3. **产品上是否确认库删除应支持“真物理删除”？** 代码强烈暗示“库默认归档、物理删仅留待 P2 升级后放开”（`delete-supported=false` 默认、`archive` 为默认模式、`RagflowClient.deleteDataset` 注释称“该版本不提供 dataset 物理删除”）。在放开前需产品明确：是否接受用户可彻底销毁知识库（含不可恢复的 chunks）。

---

## 附：关键证据索引

- 库删除入口与默认归档：`KbLibraryService.java#L306`、`#L308`、`#L331`、`#L383`
- 库物理删除受 `delete-supported` 拦截：`KbLibraryService.java#L384`、`RagflowProperties.java#L48`、`application.yml#L32`
- 库删除单 id 路径（非官方、405）：`RagflowClient.java#L265`、`#L593`；注释 `#L248`~`#L267`
- 文档删除官方集合+body：`RagflowClient.java#L563`、`#L615`；`RagflowAdapter.java#L502`；注释 `#L546`~`#L555`
- 文档删除不受 `delete-supported` 约束：`KbDocumentService.java#L194`、`#L199`
- 对账脱离删除链路（grep 结论）：仅 `EngineConfigController` 手动触发
- 对账四类判定：`KbEngineReconcileService.java#L127`、`#L156`、`#L168`、`#L181`、`#L263`
- 孤儿仅 dataset 级、仅人工处置：`KbEngineOrphanService.java#L118`、`KbEngineOrphan.java`
- 文档级对账缺失：全仓 grep 无 `documentReconcile`/`reconcileDocument`
- 405 测试证据：`RagflowDeleteHttpTest.java#L106`、`#L142`；`KbLibraryServiceDeleteTest.java#L153`
