# MIS 知识库（mis-kb）企业级增强一期 QA 独立验收报告

- **QA**：严过关（软件 QA 工程师）
- **日期**：2026-08-11
- **验收对象**：T0~T4（寇豆码交付，自述全绿）
- **验收依据**：`docs/backend/mis-kb-enterprise-phase1-design-2026-08-11.md`（Q1~Q8 裁决）、`deliverables/software-company/kb-enterprise-phase1-prd-2026-08-11.md`（KE-01~KE-09）、`docs/backend/knowledge-base-phase2-plan.md` §11（11.1/11.2/11.5）
- **方法**：①独立复跑全量测试（非复用工程师日志）；②读码逐项核对设计验收点；③边界/反例 try-to-break；④智能路由判定
- **结论**：**全部通过，路由 NoOne**（无源码 Bug；2 条非阻塞遗留项见 §6）

---

## 1. 测试复跑结果（独立执行）

> 环境：JDK17（`D:\software\jdk-17.0.2`）+ Maven 3.9.16 直启，`-DforkCount=0`，`-Dstyle.color=never`。

| 套件 | 命令 | Tests run | Failures | Errors | 与工程师声称核对 |
|---|---|---|---|---|---|
| mis-kb | `mvn -pl mis-kb test` | **397** | 0 | 0 | ✅ 一致（逐 surefire 报告加总=397） |
| mis-admin-bff | `mvn -pl mis-admin-bff test` | **250** | 0 | 0 | ✅ 一致（剔除 1 份陈旧报告后加总=250） |
| 前端 typecheck | `npm run typecheck` | — | EXIT=0 | 0 TS error | ✅ 一致（零错误输出） |

**注意（非缺陷）**：mis-admin-bff `target/surefire-reports` 残留一份改写前旧测试类
`OperLogAspectSensitiveKeyTest$KnownBlindSpots.txt`（16:31 生成，42 tests），导致「逐报告加总」出现 292 vs Maven 汇总 250 的假象。剔除该陈旧文件后加总恰好 **250**。属 target/ 残留物，建议 CI 先 clean 或清理；不影响本次结论。

**审计专项测试均已实际执行并通过**：
- `KbControllerOperLogCoverageTest`（1 test，7.9s）——RequestMappingHandlerMapping 运行时盘点
- `OperLogAspectSensitiveKeyTest`（61 tests）——脱敏归一化 + 反例排除 + 反向断言

---

## 2. 设计验收点逐项核查（读码验证，非仅测试通过）

### R1 审计零遗漏 —— ✅ 通过
- `KbControllerOperLogCoverageTest` **确为运行时比对**（非硬编码 17 清单）：用 `StaticApplicationContext` 注册真实 `KbController` + `RequestMappingHandlerMapping.afterPropertiesSet()` 导出全量映射，按 POST/PUT/DELETE/PATCH 筛写端点，对每个写端点断言「恰好一个 @OperLog（Controller XOR 门面）」+ module="知识库" + operation 非空 + recordParams=true；门面方法按同名契约 `findFacadeMethod` 查找。
- 本次运行导出 26 个写端点，**全部恰好一个 @OperLog**，17 个设计端点无一遗漏：categories（创建/修改/删除/移动/授予管理员/撤销管理员）、libraries（创建/修改/修改 RAG 设置/删除）、documents（上传/切片配置/启停/重解析/全部重解析/删除）、acls（授予/撤销）。QA 独立抽查确认：6 个挂 Controller（创建分类/创建库/删除库/上传文档/文档重解析/全部重解析）、12 个挂门面（修改分类/删除分类/移动/授予管理员/撤销管理员/修改库/修改 RAG 设置/启停/切片配置/删除文档/授予 ACL/撤销 ACL）。

### Q2 前后值快照 —— ✅ 通过
- 门面层 `loadCategoryBefore / loadLibraryBefore / loadRagSettingsBefore / loadDocumentBefore / loadAclListBefore / loadCategoryAdminListBefore` 全部先调既有**读**端点取旧值，包装为 `KbAuditBefore(targetId, targetTitle, before)` 作为门面方法入参；`@OperLog(recordParams=true)` 挂门面，切面序列化入参时 `before` 自然进入 `request_params`（新值=请求体顶层字段），形成 `{libraryId, ..., targetId, targetTitle, before:{旧值}}`。
- 范式对齐 `KbSynonymFacadeService.deleteGroup(Long, KbSynonymGroupSnapshot)` 先例；窄快照（Map 组装，剔除 `java.time.Instant`）避免裸 ObjectMapper 序列化炸掉 requestParams（KbAuditBefore Javadoc 明示）。
- **R2 兜底**：每个 loadXxxBefore 均 try-catch，失败回退 `KbAuditBefore.minimal(id)`，不阻断主链路。

### 11.5 脱敏销账 —— ✅ 通过
- `OperLogAspect.isSensitiveKey`：小写 + `replaceAll("[^a-z0-9]","")` 归一化，黑名单 7 项不动；新增 `SENSITIVE_KEY_EXCLUSIONS = {chunktokennum, chunkoverlaptokennum}` 反例排除（完整归一化名精确相等才放行，字段名一变即失效，宁可少豁免）。
- 测试已改写且语义正确（61 用例）：`private_key / private-key / PRIVATE_KEY / ACCESS-KEY / access_key / user_private_key / aliyun_access_key_secret` 全命中；`chunkTokenNum / chunkOverlapTokenNum` 放行（反例排除）；`accessToken / refreshToken / max_tokens / maxTokens` 仍脱敏；反向断言 `topK / docType / retrievalMethod / ocrEnabled / ocrLanguage / onlyFailed` 等业务字段不误伤；`sanitizeMasksValueButKeepsKey` 端到端验证「保留键名、值换 ***」。

### R5 空不下发 —— ✅ 通过（三层印证）
1. **前端**：`kb-api.ts` `cleanParams` 剔除 null/空串；`documentIds` 空数组→null；`kb-hit-test-page.tsx` 空串→`toIsoInstant` null。
2. **resolver 门**：`RetrieveQueryResolver` S4.5 —— `filterRequested=false` 一律 `effectiveDocumentIds=List.of()`（即使上下文带残留 id 也不透传）；请求过滤但 `metadataFilterSupported=false` → 清空 + 降级原因「当前引擎不支持文档/时间范围过滤，已忽略过滤条件」；请求过滤但解析结果为空 → 空集透传不降级（R5 回退全量语义）。
3. **客户端**：`RagflowClient.retrieve` 仅 `documentIds` 非空才 `body.put("document_ids", ...)`；适配层 `resolveDocumentIds` 只取「本次检索库内 + enabled=1 + 有引擎映射」文档。
- 测试覆盖：`RetrieveQueryResolverTest.DocumentFilter` 四用例（透传/未请求/能力降级/空集 R5）全绿。

### T3 降级验收（OCR/overlap）—— ✅ 通过
- **落库 + 回显**：`RagSettings` 末位追加 `ocrEnabled / ocrLanguage / chunkOverlapTokenNum`，defaults（false/zh/null）+ withDefaults 兜底；BFF `KbRagSettings`、前端 library-detail 同步；`RagSettingsServiceTest` 验证落库回显 + rerank 收敛不透传吞字段。
- **能力码驱动置灰**：`EngineCapabilities` 新增 `CAP_PARSER_OCR / CAP_PARSER_OVERLAP`，RagflowAdapter.capabilities() 两位置 **false**；前端 `ocrSupported/overlapSupported` fail-safe（未确认即置灰）+「当前引擎版本暂不支持…参数已保留待引擎升级生效」。
- **绝无键下发**：grep 证实 `RagflowClient` 全文件 **0 处** ocr/overlap 键；`updateDatasetSettings` / `updateDocumentConfig` 白名单仅 `chunk_token_num / delimiter`。
- 校验：`chunkOverlapTokenNum < 0` 拒绝；`ocrLanguage` 空白/非法码值拒绝（三档 zh/en/zh_en）。

### T2 解析治理 —— ✅ 通过
- V30 落 `parse_progress INT NULL` / `parse_error TEXT NULL`；`KbDocumentService.syncOpenParseStatuses` 仅对 pending/parsing 批次拉引擎并回写 status+progress+error（success→清空 error，failed→progress_msg≤500）；`RagflowAdapter.queryDocumentParseStatuses` 返回 `ParseStatusSnapshot`；`RagflowParseStatusMapper.toProgress` 0~1→0~100。
- 行内重试 `reparse`：触发前清空 parseError + PARSING 幂等短路；失败置 FAILED 抛原因。
- 库级 `reparse-all?onlyFailed=true`：**先 sync 收敛（R8）再按 failed 过滤**（`onlyFailedSkipsConvergedOpenDocuments` 用例锁定）；`DocumentController.reparseAll` 增加 onlyFailed 参数；BFF `KbWebClient` 透传。
- 前端：解析进度列（parsing 显示 %）、失败原因 tooltip（failed）、行内重试、库级「重试全部失败文档」按钮（仅 failed 触发，无失败时提示「当前没有解析失败的文档」）。

### T4 检索过滤 —— ✅ 通过
- 前端命中测试页：过滤区（限定文档多选「仅 enabled=1 可选、停用禁选」+ 上传时间范围按 `kb_document.created_at`）+ `filterSupported` fail-safe 置灰 + filterEcho 回显「本次过滤条件：文档 X/Y 篇 · 上传时间 a ~ b」+ 切库清空（documentIds/uploadFrom/uploadTo 一并重置）+ 清除过滤按钮。
- 后端：`KbHitTestService.run / KbRetrieveService.retrieve` 均把 `documentIds/uploadFrom/uploadTo` 解析为 `KbDocumentFilter` → `KbDocumentRepository.findEnabledIdsByFilter`（库内+enabled=1+id 集+created_at 范围交集）→ `filterRequested=filter.hasAnyCondition()` → resolver S4.5 → 适配层 → 客户端。
- 监控页 `log-pages.tsx` 支持 `?module=知识库` 预筛选；KB 库列表页「操作日志」快捷入口带 module 跳转。

### V30 迁移 —— ✅ 通过
- A 段：parse_progress / parse_error 列（`ADD COLUMN IF NOT EXISTS` 幂等）。
- C 段：17 写端点 sys_api 登记，id **91106-91122**、code **00900022-00900038**、menu_api **91206-91222**（段位与设计一致，实测无冲突）；`WHERE NOT EXISTS`（id/code/method+path 三重守卫）+ `ON CONFLICT DO NOTHING` 幂等；3 个 V24/V25 既有行（move/admins/移除管理员）被 method+path 守卫**幂等跳过**，menu_api 对应行也因 `EXISTS(api)` 守卫同步跳过，最终仍 17 端点全量挂菜单。
- **uk_menu_app_permission 无冲突**：本期零新增 `sys_menu` 行，全部复用既有菜单节点（91040-91050、91055、catalog 91060 已核实存在于 V14/V17/V24/V25），「一码一菜单」天然满足。
- **uk_api_method_path 无重复**：path_pattern 用 `{id:[0-9]+}` 与字面路径（reparse-all、manageable-ids 等）隔离，且 method+path 去重守卫防重插。

---

## 3. 边界与反例验证（try to break）

| 边界 | 结论 | 依据 |
|---|---|---|
| 无权限账号调 KB 写端点 | ✅ 仍被拒 | ApiPermissionInterceptor 按 sys_api 注册表判权（V30 登记后 17 端点纳入门控）+ mis-kb 服务层 `requireLibraryManage` 管辖校验；分类管理/命中测试另有 `requireXxxPermission` fail-close 兜底（权限为空/loader 返回 null 均 403，测试覆盖）。审计切面仅留痕、不绕过权限。 |
| recordParams=true 后敏感字段是否明文 | ✅ 不泄露 | sanitize 递归遮蔽 accessToken/privateKey 等；KB 写端点入参全为业务字段（无凭据）；KbAuditBefore 窄快照不含凭据；OperLogAspectSensitiveKeyTest 61 用例锁定。 |
| documentIds 含不存在 id | ✅ MIS 先行过滤 | `findEnabledIdsByFilter` 只返回库内+enabled 存在的 id（JPQL 显式 id 交集）；适配层 `resolveDocumentIds` 二次校验（库内+enabled+引擎映射），防引擎 code:102 拒整单。 |
| 空选择/空时间范围 | ✅ 行为与现状一致 | `hasAnyCondition()=false` → filterRequested=false → 不下发 document_ids 键（前端 cleanParams 也归 null）。 |
| OCR 空白串语言值 | ✅ 拒绝 | `RagSettingsService.validate`：非 null 语言 trim+小写后必须 ∈ {zh,en,zh_en}，空白 "" 不在集合 → KB_RAG_SETTINGS_INVALID；测试 `@ValueSource` 含 `"  "` 用例。 |
| 非法 overlap 值域 | ✅ 拒绝 | `<0` → KB_RAG_SETTINGS_INVALID；前端校验非负整数并提示。 |
| onlyFailed=true 无失败文档 | ✅ 幂等 | `reparseAll`：空库返回 success=0 明确结果；无失败文档时全部计入 skipped、success=0、失败明细空；前端先提示「当前没有解析失败的文档」再决定是否调用。 |
| reparseAll 并发/重复点击 | ✅ 有防护 | 单文档 PARSING 短路（幂等，不重复入队）；前端按钮提交中禁用（「提交中…」）。库级无锁是设计 R8 明确的最小实现（重复触发至多重复提交非解析中文档，RAGFlow 队列幂等），文档化可接受。 |

---

## 4. 智能路由判定

**路由：NoOne（全部通过）**

- 测试复跑：mis-kb 397 ✅ / mis-admin-bff 250 ✅ / 前端 typecheck EXIT=0 ✅ —— 与工程师声称逐一核对一致。
- 设计验收点 R1/Q2/11.5/R5/T3/T2/T4/V30 全部落实（读码验证）。
- 边界/反例 8 项全部通过。
- **未发现源码 Bug**；测试代码无 Bug（无需路由 QA 修复）。

---

## 5. 测试报告（结构化）

```markdown
# Test Report

## Summary
- mis-kb:        Total 397 | Passed 397 | Failed 0 | Errors 0
- mis-admin-bff: Total 250 | Passed 250 | Failed 0 | Errors 0
- frontend:      typecheck EXIT=0, 0 TS errors
- Coverage: 关键路径全覆盖（审计 17 端点运行时盘点、S4.5 四用例、onlyFailed 收敛、OCR/overlap 校验、脱敏 61 用例）
- Routing Decision: NoOne
```

---

## 6. 遗留问题（非阻塞）

1. **测试覆盖可加强（非缺陷）**：`RagflowClient.retrieve` 的 wire 层「document_ids 非空才下发 / 空集不发键」未单独在 `RagflowClientHttpTest` 做请求体断言（现有测试覆盖 keyword/rerank_id/weight 的 body，未覆盖 document_ids 两态）。语义已在 resolver 层 + 代码实现正确，属可加强项，建议二期补一条 wire 断言。
2. **构建残留物（非缺陷）**：mis-admin-bff `target/surefire-reports` 残留改写前的陈旧报告 `OperLogAspectSensitiveKeyTest$KnownBlindSpots.txt`（42 tests），会造成「逐报告加总」与 Maven 汇总不一致的假象。建议 CI 流程 `mvn clean` 或定期清理 target/。
3. **设计既有口径（非本期引入）**：ApiPermissionInterceptor 在 preHandle 抛 403 的越权调用不产生审计记录（切面尚未进入）；仅业务内抛出的失败会留痕 responseCode=1。KbController 注释已明示该权衡，非本期缺陷。
