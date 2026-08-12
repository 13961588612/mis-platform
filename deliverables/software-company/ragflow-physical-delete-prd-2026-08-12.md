# RAGFlow 删除语义修复与对账补强 — 增量 PRD

- 文档类型：**增量 PRD**（需求已明确，按默认简单版，不含竞品分析）
- 编写人：software-product-manager（产品经理 许清楚）
- 日期：2026-08-12
- 关联背景文档：`deliverables/software-company/ragflow-delete-audit-2026-08-12.md`（只读代码审计）

---

## 1. 变更背景

根据 `ragflow-delete-audit-2026-08-12.md` 的只读代码审计结论：知识库删除当前默认走「归档（软删除）」，其根因并非 RAGFlow 引擎不支持删除，而是**调用方式错误**——`RagflowClient.deleteDataset`（`backend/mis-kb/src/main/java/com/mis/kb/engine/RagflowClient.java`）走的是非官方单 id 路径 `DELETE /api/v1/datasets/{id}`，在本实例实测返回 405，导致物理删除被 `delete-supported` 开关整体拦截（默认 `false`）。审计同时指出：文档删除当前已是真实物理删除（URL 已为官方形态 `DELETE /api/v1/datasets/{ds}/documents` + `{"ids":[docId]}`），且后台对账仅覆盖 dataset 级、只对「RAGFlow 已删、本地残留」打 `MISSING_IN_ENGINE` 标记而**不清理**，并**完全缺失文档级对账**。现用户已拍板：改用 RAGFlow 官方批量接口**恢复知识库物理删除**（真正删除引擎侧 dataset + 本地库记录），同时**保留并补强对账机制**（覆盖库级 + 文档级单边删除），文档删除沿用现有物理删除能力并补上文档级对账。

---

## 2. 产品目标

1. **恢复知识库物理删除**：将库删除从非官方单 id 路径改为官方批量接口 `DELETE /api/v1/datasets` + body `{"ids":[...]}`，使「用户/运维请求的物理删除」能真正删除引擎侧 dataset，而非仅改名归档。
2. **修正调用链路并安全放开开关**：修正 `RagflowClient.deleteDataset` 的请求形态，去除 405 根因；合理处置 `delete-supported` 拦截（`backend/mis-kb/.../domain/service/KbLibraryService.java` 中 `physicalDelete` 的整体拦截），使物理删除在可控前提下可生效。
3. **保留库级后台对账**：维持 `KbEngineReconcileService`（30min 定时 + 手动端点）对 dataset 级 MIS↔引擎漂移的检测与 `MISSING_IN_ENGINE` 标记，确保改动不回退既有对账能力。
4. **补强单边删除收敛（库级）**：对连续被标记为 `MISSING_IN_ENGINE` 的本地残留，新增可收敛路径（自动软删本地 / 或提供人工「清理本地残留」动作），消除「只标记不处置」缺口。
5. **补齐文档级对账**：新增文档级 reconcile（按 dataset `listDocuments` 比对本地 `kb_document.engine_document_ref`），覆盖「RAGFlow 文档已删、本地文档残留」这一当前完全不可见的单边删除场景。

---

## 3. 用户故事

**库删除视角**
- 作为**知识库管理员**，我希望在确认删除知识库时，系统能真正从 RAGFlow 引擎侧删除该 dataset（而非仅改名归档），以便彻底释放存储、避免敏感知识被意外恢复。
- 作为**运维**，我希望物理删除在开关未确认前仍被拦截，避免误操作不可逆销毁，以便遵循「显式确认才执行破坏性操作」的治理要求。

**文档删除视角**
- 作为**知识库管理员**，我希望删除某篇文档时其引擎侧文档被真正删除（当前已满足），且删除后本地与引擎保持一致，以便不残留无效索引。
- 作为**运维**，我希望系统能检测到「引擎文档被外部删除/改名而本地仍记录」的漂移，以便及时收敛、避免向用户展示不存在的文档。

**运维对账视角**
- 作为**运维**，我希望后台对账既能发现 dataset 级也能发现文档级单边删除，并能在连续多次确认缺失后自动或经我确认清理本地残留，以便对账闭环、不产生长期孤儿。
- 作为**运维**，我希望对账结果（库级/文档级漂移）在控制台可见、可手动触发重跑，以便排障与即时收敛。

---

## 4. 需求池

### P0（Must have）

- **P0-1 库删除 URL 改为官方批量形态**：修改 `RagflowClient.deleteDataset`，将请求从 `DELETE /api/v1/datasets/{id}`（单 id 路径参数）改为 `DELETE /api/v1/datasets` + JSON body `{"ids":[datasetId]}`，与文档删除（`RagflowClient.deleteDocument`）同构。保持 `deleteFor` 对非 2xx 一律抛异常的「显式失败、不吞错」硬约束不变。
- **P0-2 修正/放开 `delete-supported` 拦截**：`KbLibraryService.physicalDelete` 当前在 `if (!engineProperties.isDeleteSupported())` 处整体抛 `KB_ENGINE_DELETE_UNSUPPORTED` 并本地零变更。需明确开关语义与默认值（见待确认 Q1），在 URL 修正后使物理删除在开关允许时可真正执行引擎删除并顺带清理本地三表（文档→授权→库，保持现有 `KbLibraryService.java#L403` 顺序）。
- **P0-3 保留库级后台对账**：维持 `KbEngineReconcileService` 的 30min 定时（`@Scheduled(fixedDelay=1800000)`）+ `EngineConfigController.runReconcile()` 手动端点，对 dataset 级 MIS↔引擎漂移继续检测并标记 `MISSING_IN_ENGINE`/`DRIFT_OR_FAILED`/孤儿，能力不回退。

### P1（Should have）

- **P1-1 补齐文档级对账**：新增文档级 reconcile 逻辑（建议在 `KbEngineReconcileService` 内扩展或新增对等服务），按 dataset 调用引擎 `listDocuments`，与本地 `kb_document.engine_document_ref` 比对，识别「MIS 文档有 / 引擎文档无」场景并标记（可复用 `engine_sync_status` 或新增文档级状态/孤儿记录）。覆盖当前完全缺失的文档级单边删除检测。
- **P1-2 单边删除收敛路径（库级 + 文档级）**：对连续 N 次（可配置，建议默认 ≥2 次 30min 周期）被标记 `MISSING_IN_ENGINE` 的本地残留（库与文档），新增收敛路径——自动软删本地记录（置 `status=0`/`archived_at`，可逆优先）或提供人工「清理本地残留」动作（在控制台/端点暴露）。消除审计缺口 A（只标记不清理）。

### P2（Nice to have）

- **P2-1 删除链路即时标记**：在 `KbLibraryService.physicalDelete` / `KbDocumentService.delete` 成功后，除后台定时对账外，额外即时将本地 `engine_sync_status` 标为「已删除/待引擎确认」，缩短漂移可见时延（与仅后台定时对账互补）。
- **P2-2 运维控制台增强**：增强 `EngineConfigController` 相关端点/控制台，呈现文档级对账结果与孤儿，支持对文档级残留的认领/忽略/清理动作（当前 `KbEngineOrphanService` 仅 dataset 级、仅人工认领/忽略，无删本地出口）。
- **P2-3 孤儿处置补强**：为「RAGFlow 残留 dataset / 文档、本地无映射」的孤儿方向，补充「真删引擎侧数据」的处置出口（当前仅 BIND_EXISTING / ADOPT_NEW / IGNORE，只能忽略保留）。

---

## 5. 验收标准

验收需基于 `ragflow-delete-audit-2026-08-12.md` 既有测试护栏，并新增/扩展以覆盖下列条目，所有标准可测、具体：

1. **库删除真打到官方批量接口且成功**：在 `type=ragflow` 实例上，触发库物理删除后，网络层实测请求为 `DELETE /api/v1/datasets` 且 body 含 `"ids":[<datasetId>]`（非 `…/{id}` 路径），接口返回 2xx 时引擎侧 dataset 被真正删除、`kb_library` 及相关文档/授权本地记录被清理。
2. **`delete-supported` 放开后物理删生效**：当 `delete-supported=true`（或按最终决议的取值）时，库物理删除能越过 `physicalDelete` 首道闸门执行引擎删除；当 `false` 时仍整体拦截并本地零变更（沿用既有 `KB_ENGINE_DELETE_UNSUPPORTED` 行为，回归测试 `KbLibraryServiceDeleteTest` 不破）。
3. **引擎删除成功但本地写失败不产生孤儿**：在 `@Transactional` 方法内，若引擎 HTTP 删除成功、而随后本地 `libraryRepository/documentRepository.delete` 抛异常，本地必须零变更或可回滚（沿用 `shouldRollbackWhenEngineDeleteFails` 钉死行为），且残留能通过 P1-2 的对账收敛路径被识别与清理，不长期遗留。
4. **对账可发现库级与文档级单边删除**：`KbEngineReconcileService`（及新增文档级对账）能在 `type=ragflow` 下分别识别「RAGFlow dataset 已删/本地库残留」与「RAGFlow 文档已删/本地文档残留」两类单边删除，并以明确状态位/孤儿记录落库；`type=noop` 时仍自动跳过（护栏不变）。
5. **单边删除可收敛**：对连续满足阈值（如 ≥2 次 30min 周期）的 `MISSING_IN_ENGINE` 本地残留，系统能按 P1-2 自动软删本地或经人工动作清理，验证「只标记不处置」缺口被消除。
6. **保留显式失败护栏**：`RagflowClient.deleteFor` / `deleteWithJsonBody` 对任意非 2xx 一律抛 `BusinessException`，不回退到「假成功吞错」旧行为；删除链路中引擎失败即抛、本地零变更的逻辑保持。
7. **文档删除物理语义不变**：`KbDocumentService.delete` 仍走官方 `DELETE /api/v1/datasets/{ds}/documents` + `{"ids":[docId]}`，不受本次库删除 URL 修正影响，且受文档级对账（P1-1）纳入观测。

---

## 6. 待确认问题

以下问题抛给架构师 / 技术拍板，需在实现前明确：

1. **`delete-supported` 默认值与放开策略**：是直接将默认值翻为 `true`，还是保持 `false`、仅由部署配置（如 `application.yml` 中 `ragflow.delete-supported`）控制、经确认后再放开？**建议默认保持 `false`，仅当 `type=ragflow` 且经产品/运维确认后翻 `true`**，回归其「是否允许业务物理删」的本意（避免默认即不可逆销毁）。
2. **对账时效策略**：本期是仅保留现有后台定时（30min，`KbEngineReconcileService`）做漂移检测，还是同时接入删除链路做即时 `MISSING_IN_ENGINE` 标记（即 P2-1 是否升为 P0/P1）？需权衡一致性的实时性与链路复杂度。
3. **文档级对账本期是否实现（P1）**：是按本 PRD 在 P1 实现文档级对账与收敛，还是本期仅做库级（P0），文档级对账延后？审计指出该缺口当前完全不可见，但实现成本与回归风险需技术评估。
4. **事务边界与残留处置策略**：引擎 HTTP 成功、本地 DB 失败时的残留处置，究竟是「回滚重发引擎删除」还是「标记本地待人工 / 仅依赖后台对账收敛」？当前代码引擎调用不在 DB 事务回滚范围内，须明确收敛责任归属（P1-2 的自动软删 vs 人工清理，以及是否需补偿式重发）。

---

## 附：引用代码文件（仓库相对路径）

- `backend/mis-kb/src/main/java/com/mis/kb/domain/service/KbLibraryService.java`（库删除入口 `delete`/`physicalDelete`/`archive`）
- `backend/mis-kb/src/main/java/com/mis/kb/engine/RagflowClient.java`（`deleteDataset` 单 id 路径 405；`deleteDocument` 官方集合+body）
- `backend/mis-kb/src/main/java/com/mis/kb/domain/service/KbDocumentService.java`（文档删除入口）
- `backend/mis-kb/src/main/java/com/mis/kb/domain/service/KbEngineReconcileService.java`（30min 定时 + 手动端点，仅 dataset 级）
- `backend/mis-kb/src/main/java/com/mis/kb/domain/service/KbEngineOrphanService.java`（仅 dataset 级人工认领/忽略）
- `backend/mis-kb/src/main/java/com/mis/kb/.../RagflowProperties.java`、`application.yml`（`delete-supported` 默认 `false`）
- `backend/mis-kb/src/main/java/com/mis/kb/.../EngineConfigController.java`（手动 reconcile / 孤儿处置端点）
- 测试：`RagflowDeleteHttpTest.java`、`KbLibraryServiceDeleteTest.java`（既有 405 / 回滚护栏）
