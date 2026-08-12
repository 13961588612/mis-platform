# MIS 知识库 Wave C（RAPTOR 能力）T01~T04 验收测试报告

- 日期：2026-08-12
- 验收人：QA 工程师 Edward（software-qa-engineer）
- 验收对象：`backend/mis-kb` + `backend/mis-admin-bff` + `frontend/mis-admin-web` 工作树已落盘未 commit 的 Wave C RAPTOR 改动（10 新增 + 30+ 修改）
- 环境：JDK 17.0.2 直启 classworlds（系统 mvn 直调损坏已规避）；前端唯一门禁 `npm run typecheck`

---

## 一、验收范围

| 模块 | 范围 |
|---|---|
| mis-kb 领域/引擎 | RaptorConfig、RaptorBuildSnapshot、KbRaptorService、RagSettings 7 字段、RagSettingsService 校验/联动、RagflowClient P1f 下发、RagflowAdapter/MockAdapter/NoopAdapter 能力位、RetrieveQueryResolver S4.6 |
| mis-kb API | LibraryController 2 新端点（build / build-status）、KbRaptorBuildResultVO、KbRaptorStatusVO、KbResultCode 3 错误码 |
| mis-admin-bff | KbController 2 新端点透传、KbFacadeService/KbWebClient、KbRagSettings 7 字段、KbEngineCapabilitiesVO.raptorSupported、KbHitTestRequest.enableRaptor、2 个镜像 VO |
| 迁移 | V34__kb_wave_c_raptor.sql（仅 sys_api/sys_menu_api 登记，零 DDL） |
| 前端 | types.ts、kb-api.ts、kb-library-detail-page.tsx、kb-library-page.tsx、kb-hit-test-page.tsx |

---

## 二、硬约束逐条核对结果（源码静态核对 + 自动化测试证据）

| # | 硬约束 | 核对结果 | 证据 |
|---|---|---|---|
| 1 | max_token ∈ [512,2048]、默认 1024、4096 明确不可用 | ✅ 通过 | `RaptorConfig.MIN=512/MAX=2048/DEFAULT=1024`；`RagSettingsService.validate` 拒 511/2049/4096/0/-1、收 512/2048（`RagSettingsServiceTest.rejectsOutOfRangeMaxTokenNum`/`acceptsBoundaryMaxTokenNum`） |
| 2 | random_seed 不暴露 | ✅ 通过 | RagSettings **无 randomSeed 字段**；`RagflowClient.updateDatasetSettings` body 白名单 5 键（use_raptor/max_token/threshold/max_cluster/prompt），无 seed/random_seed 键（`RagflowClientHttpTest.raptorSubObjectSerializedWithoutRandomSeed` 断言 `raptor.has("random_seed")==false`） |
| 3 | 不限库数；仅全局总开关 raptor-enabled（默认 true） | ✅ 通过 | 全仓无 `KB_RAPTOR_LIBRARY_LIMIT`（仅注释提及）、无 `raptor-max-libraries`；`application.yml:32 raptor-enabled: ${MIS_KB_RAPTOR_ENABLED:true}`；`RagflowProperties.raptorEnabled=true` |
| 4 | **P1f 契约（最高优先级）**：每次 PUT 必须同时携带 chunk_method + 完整 parser_config | ✅ 通过 | `RagflowClient.updateDatasetSettings:194-245`：chunk_method 恒下发（null 兜底 naive）；parser_config 恒含 chunk_token_num + delimiter + raptor + graphrag（settings=null 也按默认模板下发）。测试：`sendsFullBodyEvenWhenOnlyRetrievalParamsChanged`（仅检索参数变更仍全量 PUT）、`nullSettingsStillSendsFullDefaultBody` |
| 5 | raptor+graphrag 共存于同一 body | ✅ 通过 | parser_config 同时含 raptor 与 graphrag 子对象（`RagflowClientHttpTest.graphragSubObjectCoexistsWithRaptor`）；T00 P1c 实测回读双 true |
| 6 | 检索零回归：retrieve()/searchDataset() 无 RAPTOR 参数 | ✅ 通过 | `RetrieveQuery` 无 raptor 字段；`client.retrieve` body 仅 question/dataset_ids/page_size/similarity_threshold/keyword/vector_similarity_weight/rerank_id/document_ids；`RetrieveQueryRaptorDegradeTest.retrievalQueryUnchanged`；命中测试 enableRaptor 三态末位追加（`HitTestRequest.enableRaptor` → `KbHitTestService.withRaptorOverride`） |
| 7 | 24 参透传点必须扩展（不能走旧构造静默置 null） | ✅ 通过 | 主代码 `new RagSettings(` 全部 10 处为 24 参 canonical：`RagSettingsService`×4（enforceRerank/enforceGraph/enforceRaptor/withServerGraphState）、`KbRaptorService.writeBackStatus`、`KbGraphService.writeBackStatus`、`RetrieveQueryResolver.applyOverride`、`RagSettings` 内部×4（defaults/withDefaults/withGraphOverride/withRaptorOverride）。测试：`RagSettingsTest.graphOverridePreservesRaptorFields`/`raptorOverridePreservesGraphFields`、`RagSettingsServiceTest.raptorForcedFalsePreservesGraphFields` |
| 8 | 能力码 CAP_RAPTOR="raptor" + raptorSupported 位 | ✅ 通过 | `EngineCapabilities.CAP_RAPTOR="raptor"` + 9 参 `of()` 第 9 位；`RagflowAdapter.capabilities()` 声明 raptor=raptorEnabled（默认 true）；`NoopAdapter` 走 `unsupported()`（raptor=false）。⚠ 备注：`MockAdapter` 按既有 Wave B mock graph=true 先例**刻意声明 raptor=true**（javadoc 明示为 CI 覆盖分支），非疏漏——真实引擎/生产口径仍为 ragflow 按开关、noop false |
| 9 | 构建/状态端点 + 错误码（无数量上限码） | ✅ 通过 | mis-kb：`POST /{id}/raptor/build`、`GET /{id}/raptor/build-status`（LibraryController:151-168）；BFF：`POST/GET /libraries/{id}/raptor/build(-status)`（KbController:327-347，权限码 kb:library:edit / kb:library:engine-ref:view）；`KbResultCode.KB_RAPTOR_UNSUPPORTED(40960)`/`KB_RAPTOR_BUILD_IN_PROGRESS(40961)`/`KB_RAPTOR_NOT_READY(40962)`，**无数量上限码** |
| 10 | V34 段位不与既有迁移冲突 | ✅ 通过 | sys_api 91155-91156 / code 00900071-00900072 / menu_api 91255-91256；V33 用 91153-91154/00900069-70/91253-54，V35 头注释确认顺延 91157+——段位连续无冲突 |

---

## 三、测试执行结果

### 3.1 mis-kb（`-pl mis-kb -am test`）

- **总用例 481，通过 480，失败 1，错误 0，跳过 0**（基线 430 → 新增 51）
- 新增 3 测试类全过：`RagSettingsTest`（9）、`RetrieveQueryRaptorDegradeTest`（8 中 7 过，1 失败见下）、`KbRaptorServiceTest`（11）
- 既有 RAPTOR 相关测试类全过：`RagSettingsServiceTest`、`RagflowClientHttpTest`、`RagflowAdapterEngineOpsTest`、`RetrieveHitsVoContractTest`

### 3.2 mis-admin-bff（`-pl mis-admin-bff -am test`）

- **总用例 264，全部通过**（基线 250/262 → 264；BUILD SUCCESS）

### 3.3 前端（`cd frontend/mis-admin-web && npm run typecheck`）

- **tsc --noEmit 0 错误**（exit 0，无输出）

---

## 四、路由判定：**Engineer（1 个源码 Bug）**

### 4.1 源码 Bug（路由回工程师，勿由 QA 修改业务源码）

| 项 | 内容 |
|---|---|
| 失败测试 | `RetrieveQueryRaptorDegradeTest.multiLibrarySignalCorrection`（expected true, got false） |
| 源文件/函数 | `backend/mis-kb/src/main/java/com/mis/kb/domain/model/RetrieveQueryResolver.java` S4.6（约 L331-336） |
| 错误信息 | `AssertionFailedError: 多库时任一库开启 RAPTOR 即视为请求增强（与图谱同款信号修正）==> expected: <true> but was: <false>` |
| 根因 | 多库 RAPTOR 信号修正（S4.6 中 `useRaptor = anyMatch(useRaptor)`，设计意图：引擎 /retrieval 支持多库 RAPTOR 融合，T00 P3c）后，就绪闸门仍读 **`base.raptorBuildStatus()`**——多库时 base=全局默认（raptorBuildStatus=none），故 useRaptor 恒被降级为 false。信号修正成为**死代码**，与代码注释「任一被检索库开启 RAPTOR 即视为本次检索请求了 RAPTOR 增强」自相矛盾。对照：图谱 S4.5 因「仅支持单库」闸门先降级多库，故无此问题；RAPTOR 无单库限制，就绪闸门必须按「开启 RAPTOR 的库」的状态评估（如全部 useRaptor=true 的库均 ready 才放行，或至少信号库 ready） |
| 修复建议 | S4.6 就绪闸门改为按 per-library 评估：单库沿用 `base.raptorBuildStatus()==ready`；多库取「所有 useRaptor=true 库的 raptorBuildStatus 均==ready」判定，降级原因保留可读文案 |

### 4.2 QA 自修（测试代码 Bug，已修复并验证通过）

| 文件 | 问题 | 修复 |
|---|---|---|
| `mis-kb/.../api/dto/RetrieveHitsVoContractTest.java`（2 处） | `EffectiveParamsVO` 仍 10 参构造（缺末位 useRaptor） | 补一位 `null`（11 参 canonical） |
| `mis-kb/.../engine/RagflowClientHttpTest.java`（2 处） | 新增 P1f 测试 `mapper.readTree` 抛受检异常但方法未声明 `throws Exception` | 两方法补 `throws Exception` |
| `mis-kb/.../domain/service/RagSettingsServiceTest.java` | `raptorForcedFalsePreservesGraphFields` 断言 `saved.kgBuildStatus()=="ready"` 与设计 §5.1「服务端事实优先」冲突（DB 未预置 ready，withServerGraphState 用 DB 旧值 none 覆盖） | 保存前预置 DB 服务端图谱状态（ready/ok），端到端验证 RAPTOR 强制关时图谱字段不被吞 |
| `mis-admin-bff/.../KbControllerHitTestPermissionTest.java` | `KbHitTestRequest` 12 参构造（缺末位 enableRaptor） | 补一位 `null` |
| `mis-admin-bff/.../audit/KbControllerRegistryCoverageTest.java` | fixture 未含 V34 RAPTOR 2 端点、数量守恒断言 70 | fixture +2（raptor/build→kb:library:edit、raptor/build-status→kb:library:engine-ref:view），计数 70→72 |
| `mis-admin-bff/.../audit/BffApiRegistryDiffSurveyTest.java` | REGISTERED_FIXTURE 未含 V34 RAPTOR 2 端点、净新增断言只认 28 | fixture +2；新增 `EXPECTED_RAPTOR_2`，净新增断言改为 V32 28 + V34 2 = 30 |

> 以上均为测试代码修正，**未改动任何业务源码**（git 确认改动仅限 test 目录 7 个文件）。

---

## 五、遗留问题 / 已知事项

1. **~~（阻塞）S4.6 多库 RAPTOR 信号修正死代码~~ —— 已解决**（工程师已修复为 per-library 评估，第 2 轮回归 481 全过，见 §7.1/§7.2）。
2. **MockAdapter raptor=true 为刻意偏差**：与 Wave B mock graph=true 先例一致（javadoc 明示为 CI 覆盖分支）；生产语义仍由 RagflowAdapter（按 raptor-enabled 开关）与 NoopAdapter（false）保证。若主理人要求 mock 严格对齐「false」，属设计口径调整，非本次缺陷。
3. 迁移 SQL 未在本环境实际执行 flyway（仅静态核对段位与幂等守卫）；建议部署环境执行 V34 后按文件内自检 SQL 复核（2 行登记 + 一码一菜单 0 行 + 幂等）。

---

## 六、结论

- P1f 契约：**已落地**（每次 PUT 恒带 chunk_method + 完整 parser_config，含 raptor+graphrag 共存、无 random_seed）。
- 24 参透传点：**全部核对通过**（主代码 10 处构造点均为 24 参 canonical）。
- 各模块通过率（第 1 轮）：mis-kb 480/481（99.8%，唯一失败为 S4.6 源码 Bug）；mis-admin-bff 264/264（100%）；前端 typecheck 0 错误。
- 路由判定（第 1 轮）：**Engineer**（1 个源码 Bug，详见 §4.1）；QA 自修 6 处测试 Bug 全部验证通过。
- 第 2 轮回归：**工程师已修复 S4.6，全部通过，见 §七。**

---

## 七、第 2 轮回归（S4.6 修复后全量复跑）

- 日期：2026-08-12（工程师修复 `RetrieveQueryResolver.java` S4.6 就绪闸门后）
- 方式：独立复跑（JDK17 classworlds），不采信工程师自报；代码走查 + 全量测试 + BFF/前端抽查

### 7.1 代码走查（git diff 逐行走查）

| 项 | 核对结果 |
|---|---|
| 变更范围 | 仅 `RetrieveQueryResolver.java`（71 行变更）；**未动任何测试代码**（测试目录 7 文件变更均为 QA 第 1 轮自修） |
| 新增 import / 签名变化 | 无新增 import；`applyOverride` 仍为 `private RagSettings applyOverride(RagSettings base, ParamOverride ov)`，公共 API 零变化 |
| 修复正确性 | ✅ 就绪闸门改为 per-library 评估：单库沿用 `base.raptorBuildStatus()==ready`；多库取「所有 useRaptor=true 库均 ready 才放行」，任一未就绪 → `useRaptor=false` + degradedReason 回显首个未就绪库状态（`RagSettings.normalizeRaptorBuildStatus`） |
| 信号修正 | ✅ 多库任一库 useRaptor=true 即视为请求增强（与图谱 S4.5 同款口径；RAPTOR 无单库限制，T00 P3c 不适用，不设「仅单库」闸门） |
| 24 参 canonical | ✅ `applyOverride` 补全 7 个 RAPTOR 字段透传（useRaptor/raptorMaxTokenNum/raptorThreshold/raptorMaxCluster/raptorPrompt/raptorBuildStatus/raptorBuildMessage），不再走 14 参旧构造（record 末位追加铁律 §10-8） |
| 服务层铁律 | ✅ `KbRaptorService`/`KbHitTestService` 无 RAPTOR 内联降级判断（降级只发生在 Resolver S4.6，§10-9） |
| 检索期零回归 | ✅ `RetrieveQuery` 零改动，`useRaptor` 仅进 `EffectiveRetrieveParams` 第 11 位回显 |

### 7.2 测试执行结果（独立复跑）

| 模块 | 命令 | 结果 |
|---|---|---|
| mis-kb | `-o -pl mis-kb -am test`（JDK17 classworlds） | **481 用例全过（0 失败 / 0 错误 / 0 跳过，BUILD SUCCESS）** |
| mis-admin-bff | `-o -pl mis-admin-bff -am test` | **264 用例全过（BUILD SUCCESS）** |
| 前端 | `cd frontend/mis-admin-web && npm run typecheck` | **tsc --noEmit 0 错误（exit 0）** |

关键测试类逐一核对（surefire 逐报告）：

| 测试类 | 用例 | 结果 | 说明 |
|---|---|---|---|
| `RetrieveQueryRaptorDegradeTest` | 8 | 8/8 | **含第 1 轮失败 `multiLibrarySignalCorrection`（expected true got false）→ 现通过**；能力/未就绪/未构建/失败/多库/放行/零回归/override 全过 |
| `RetrieveQueryGraphDegradeTest` | 7 | 7/7 | 图谱降级零回归（S4.5 不受影响） |
| `RetrieveQueryResolverTest`（各嵌套类） | 39 | 39/39 | Boundaries/CapabilityDegradation/DocumentFilter/ModelPoolMerge/MultiLibrary/RecordFallback/RequestOverride/SingleLibrary/SynonymStep 全过 |
| `RagSettingsTest` | 9 | 9/9 | 24 参透传/override 保字段 |
| `KbRaptorServiceTest` | 10 | 10/10 | 建树/状态回写/幂等 |
| `RagSettingsServiceTest`（Raptor 嵌套） | 21 | 21/21 | max_token/threshold/max_cluster 边界 |
| `RagflowClientHttpTest`（UpdateDatasetSettings） | 8 | 8/8 | P1f 契约：全量 PUT 含 chunk_method+完整 parser_config、无 random_seed |

### 7.3 第 2 轮路由判定：**NoOne（全绿通过）**

- 工程师修复**方向正确、范围克制**：只改 S4.6 就绪闸门，per-library 评估与修复建议一致（单库沿用 base、多库全 ready 才放行、未就绪回显状态）。
- 未引入回归：图谱 S4.5、检索零回归、P1f 契约、24 参透传全部保持通过。
- 全量回归：**mis-kb 481/481（100%）+ mis-admin-bff 264/264（100%）+ 前端 typecheck 0 错误**。
- 验收结论：**通过**，无遗留阻塞项（已知非阻塞事项见 §五）。
