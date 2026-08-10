# MIS 知识库二期 · Wave A（质量线）QA 门禁验收报告

- **报告日期**：2026-08-07
- **执行人**：Edward（QA 工程师）
- **被测范围**：Wave A 质量线 —— Hybrid / Rerank / 命中测试 / 切片 UI
- **代码基线**：`master` @ `2289e5a`（Wave A 实现入库于 `697c8cc`）
- **设计依据**：`docs/backend/mis-kb-phase2-wave-a-design-2026-08-04.md`（§5.1 发布门禁划分 · line 753）
- **规划依据**：`docs/backend/knowledge-base-phase2-plan.md` §9 验收清单

---

## 1. TL;DR

**IS_PASS：YES（有条件放行）** —— 离线可验证的 P0 门禁项 **100% 通过**，无代码缺陷需回退工程师。

| 维度 | 结论 |
|---|---|
| 后端单测（mis-kb + mis-admin-bff + 公共层） | **270 用例 / 0 失败 / 0 错误 / 0 跳过**，`BUILD SUCCESS`，退出码 `0` |
| 前端 typecheck (`tsc --noEmit`) | **退出码 0，零类型错误** |
| 前端 ESLint (`src/features/kb`) | **退出码 0，零 error 零 warning** |
| P0 门禁（T01–T03/T04–T05/T07–T09/T11–T13/T15–T17） | **全部通过**（其中 T04 引擎侧真实触发需 dev 栈复核，见 §7） |
| P1/P2 非阻塞（T06/T10/T14②/T18/T19） | 均已实现或按裁决可后置，**不阻塞发布** |
| 红线核查（禁写五表 / 归一化不回写 / 越权拒绝） | **三条全部守住**，且均有自动化断言背书 |
| 代码缺陷（需回退工程师） | **0 项** |

**本轮 QA 的增量贡献**：发现并补齐了一个**门禁盲区** —— 设计文档 T02 声明的
`RagSettingsServiceTest` 在 Wave A 入库时缺失，导致门禁清单第 2 条（权重落库 0.3 /
区间 [0,1] / rerank 无模型强制 false / **归一化不回写的落库侧对偶**）**零自动化证据、
仅靠人工读码背书**。QA 已补写该测试类（26 用例，全绿），该缺口现已关闭。

**放行条件（1 项）**：`docs/backend/knowledge-base-phase2-plan.md` §9 中「切片参数改后
提示重解析并**可用**」的「可用」二字需 dev 栈（RAGFlow + PG）联调复核，本轮保留
`🟡 待 dev 栈联调` 标注，不阻塞发布但需在上线前补一次冒烟。

---

## 2. 测试执行结果（真实数据）

### 2.1 环境与运行方式

系统 `mvn` 脚本损坏、仓库无 `mvnw`，采用 **Java 17 直启 Maven classworlds** 绕行：

- JDK：`D:\software\jdk-17.0.2`（`openjdk version "17.0.2" 2022-01-18`）
- Maven：`D:\software\apache-maven-3.9.16`（`boot/plexus-classworlds-2.11.0.jar`）

```bash
cd D:/code/mis-platform/backend
MH="D:/software/apache-maven-3.9.16"
"D:/software/jdk-17.0.2/bin/java" \
  -cp "$MH/boot/plexus-classworlds-2.11.0.jar" \
  -Dmaven.home="$MH" \
  -Dmaven.multiModuleProjectDirectory="D:/code/mis-platform/backend" \
  -Dclassworlds.conf="$MH/bin/m2.conf" \
  org.codehaus.classworlds.Launcher \
  -B -pl mis-kb,mis-admin-bff -am test
```

> ⚠️ **必须显式 `-pl mis-kb,mis-admin-bff`**：两模块之间无 Maven 依赖，
> 只写 `-pl mis-admin-bff -am` 不会把 `mis-kb` 带进反应堆，会静默漏测 147 个用例。
> 本轮已按此执行，反应堆确认 `[9/9]` 含 `mis-kb`。

### 2.2 Round 1 · 定向门禁用例（设计 §5.1 指定类）

```
-Dtest='RetrieveQueryResolverTest,KbControllerHitTestPermissionTest,RetrieveHitsVoContractTest,
        KbVisibilityServiceTest,QaRoleWidthTest,KbOperationsServiceStatsTest'
-Dsurefire.failIfNoSpecifiedTests=false
```

| 模块 | Tests run | Failures | Errors | Skipped |
|---|---|---|---|---|
| `mis-admin-bff` | **9** | 0 | 0 | 0 |
| `mis-kb` | **53** | 0 | 0 | 0 |
| **合计** | **62** | **0** | **0** | **0** |

`BUILD SUCCESS` · `Total time: 01:01 min` · **退出码 `0`**

`mis-kb` 逐类明细（`@Nested` 外层类 `Tests run: 0` 属正常，真实用例在内部类报告）：

```
Tests run: 8, ... -- in com.mis.kb.api.dto.RetrieveHitsVoContractTest
Tests run: 4, ... -- in com.mis.kb.domain.model.QaRoleWidthTest
Tests run: 4, ... -- in RetrieveQueryResolverTest$RecordFallback
Tests run: 6, ... -- in RetrieveQueryResolverTest$SynonymStep
Tests run: 5, ... -- in RetrieveQueryResolverTest$Boundaries
Tests run: 4, ... -- in RetrieveQueryResolverTest$CapabilityDegradation
Tests run: 3, ... -- in RetrieveQueryResolverTest$RequestOverride
Tests run: 3, ... -- in RetrieveQueryResolverTest$MultiLibrary
Tests run: 5, ... -- in RetrieveQueryResolverTest$SingleLibrary
Tests run: 0, ... -- in RetrieveQueryResolverTest          ← 外层壳，正常
Tests run: 4, ... -- in com.mis.kb.domain.service.KbOperationsServiceStatsTest
Tests run: 7, ... -- in com.mis.kb.domain.service.KbVisibilityServiceTest
```

### 2.3 Round 1 · 两模块全量回归（不加 `-Dtest` 过滤）

| 模块 | Tests run | Failures | Errors | Skipped |
|---|---|---|---|---|
| `mis-common-jpa` | 4 | 0 | 0 | 0 |
| `mis-common-web` | 3 | 0 | 0 | 0 |
| `mis-common-security` | 10 | 0 | 0 | 0 |
| `mis-common-redis` | 3 | 0 | 0 | 0 |
| `mis-admin-bff` | **103** | 0 | 0 | 0 |
| `mis-kb` | **121** | 0 | 0 | 0 |
| **合计** | **244** | **0** | **0** | **0** |

`BUILD SUCCESS` · **退出码 `0`**

### 2.4 Round 2 · 补齐 `RagSettingsServiceTest` 后的最终回归

QA 补写 `backend/mis-kb/src/test/java/com/mis/kb/domain/service/RagSettingsServiceTest.java`
（26 用例，见 §3）后重跑同一命令：

```
[INFO] Tests run: 4,   Failures: 0, Errors: 0, Skipped: 0   ← mis-common-jpa
[INFO] Tests run: 3,   Failures: 0, Errors: 0, Skipped: 0   ← mis-common-web
[INFO] Tests run: 10,  Failures: 0, Errors: 0, Skipped: 0   ← mis-common-security
[INFO] Tests run: 3,   Failures: 0, Errors: 0, Skipped: 0   ← mis-common-redis
[INFO] Tests run: 103, Failures: 0, Errors: 0, Skipped: 0   ← mis-admin-bff
[INFO] Tests run: 147, Failures: 0, Errors: 0, Skipped: 0   ← mis-kb (121 + 26 新增)
[INFO] BUILD SUCCESS
```

反应堆汇总：

```
MIS Platform ....................................... SUCCESS [  0.380 s]
mis-common ......................................... SUCCESS [  0.007 s]
mis-common-core .................................... SUCCESS [  1.026 s]
mis-common-jpa ..................................... SUCCESS [  2.964 s]
mis-common-web ..................................... SUCCESS [  8.497 s]
mis-common-security ................................ SUCCESS [ 10.629 s]
mis-common-redis ................................... SUCCESS [  5.699 s]
mis-admin-bff ...................................... SUCCESS [ 17.449 s]
mis-kb ............................................. SUCCESS [  9.523 s]
Total time:  57.083 s
Finished at: 2026-08-07T22:17:26+08:00
```

**最终口径：270 用例 / 0 失败 / 0 错误 / 0 跳过 · BUILD SUCCESS · 退出码 `0`**

> 全部用例均为**离线纯单测**（Mockito + `standaloneSetup` MockMvc），
> 零 `@SpringBootTest`，不依赖 PG / Nacos / Redis / RAGFlow。

---

## 3. QA 补齐的测试盲区：`RagSettingsServiceTest`

### 3.1 缺陷性质：**测试缺失**，非源码缺陷

设计文档 T02 明确把 `backend/mis-kb/src/test/java/.../RagSettingsServiceTest.java`
列为源文件之一，完成判据为「权重传 `1.5` 返回 `KB_RAG_SETTINGS_INVALID`；
`rerank-model-id` 为空时保存 `rerank=true` 落库结果为 `false` 且日志可见」。

**实际入库时该文件不存在**。`git ls-files backend/mis-kb/src/test` 全量比对确认。
后果：门禁清单第 2 条（WA-01/03/04/05/06）此前**完全没有自动化证据**，
只能靠人工读 `RagSettingsService.java` 背书。

按智能路由规则，这属于**测试代码缺口 → QA 自行修复**，不回退工程师。

### 3.2 补写内容（26 用例，5 组）

| 组 | 用例数 | 守住的判据 |
|---|---|---|
| `Validation` | 11 | 权重 `1.5/-0.1/1.0001/100` 越界 → `KB_RAG_SETTINGS_INVALID`；边界 `0.0/0.3/0.7/1.0` 放行（闭区间）；非法 `retrievalMethod=graph`、非法 `emptyResultStrategy`、topK/threshold/chunkTokenNum 越界均被拒 |
| `Defaults` | 3 | 不传权重 → 落库 `0.3`；null 设置整体回落 `defaults()`；`get()` 永不返回 null |
| `RerankAvailability` | 4 | **无全局模型 + `rerank=true` → 落库 `false`**；已配模型时不被误关；静默改写不抛错；`rerank=false` 时其余字段逐字保留 |
| `WeightPersistence` | 4 | ★ **归一化不回写（落库侧对偶）**，见 §4.2 |
| `EngineSync` | 4 | 引擎同步失败不回滚本地；无引擎映射 / 库停用时跳过同步 |

**两处刻意加严的断言口径**（避免「假绿」）：

1. **拒绝必须先于落库**。校验类用例不只断言抛异常，还一律
   `verify(libraryRepository, never()).save(...)`。理由：「先存后抛」同样能让
   异常断言变绿，但脏值已经进库了。
2. **断言落库 JSON 而非方法返回值**。`persisted()` 辅助方法把真正写进
   `KbLibrary.ragSettingsJson` 的那串 JSON 反序列化回来再断言。理由：
   返回 `false` 但存 `true`，正是「界面显示已关、实际检索还在重排」的经典事故形态，
   只看返回值抓不到。

### 3.3 独立运行验证

```
-pl mis-kb -Dtest='RagSettingsServiceTest'

Tests run: 11, ... -- in RagSettingsServiceTest$Validation
Tests run: 4,  ... -- in RagSettingsServiceTest$EngineSync
Tests run: 4,  ... -- in RagSettingsServiceTest$WeightPersistence
Tests run: 4,  ... -- in RagSettingsServiceTest$RerankAvailability
Tests run: 3,  ... -- in RagSettingsServiceTest$Defaults
Tests run: 0,  ... -- in RagSettingsServiceTest              ← 外层壳
Tests run: 26, Failures: 0, Errors: 0, Skipped: 0
BUILD SUCCESS · 退出码 0
```

---

## 4. 红线核查（三条）

### 4.1 红线一 · 命中测试禁写 `kb_qa_*` 五表

**结论：守住，且是「四重保险」而非单点约束。**

| 层 | 证据 | 位置 |
|---|---|---|
| ① 依赖断源 | `KbHitTestService` 构造器**只注入** `KbLibraryRepository` / `KbDocumentRepository` / `KbVisibilityService` / `KnowledgeEnginePort` / `RetrieveQueryResolver`，**零 `kb_qa_*` 仓储** —— 从依赖上就无法写入 | `KbHitTestService.java:84-95` |
| ② 事务只读 | 方法标注 `@Transactional(readOnly = true)`，即便有人绕过 ① 也会在运行期被拦 | `KbHitTestService.java:107` |
| ③ 端点隔离 | `QaInternalController#hitTest` 只调 `hitTestService.run(...)`，不触碰同类中注入的 `KbQaService` | `QaInternalController.java:94-97` |
| ④ VO 契约恒等 | `RetrieveHitsVoContractTest` 对问答链路响应体做**键集合恒等**断言（`{hits, emptyResultStrategy, effectiveParams}`，多一个即红灯）+ 类型图谱递归扫描 + 反向对照 | 8 用例全绿 |

> 附带确认：`KbHitTestService` 同样**不注入** `SynonymConfigService`，
> 「本次不使用同义词」不会误改全局开关 —— 同一套「靠依赖断源而非靠注释」的手法。

**无法在离线单测覆盖的部分**：「执行命中测试后 `kb_qa_*` 表行数不变」的**实测**
需要真实 PG。静态证据链（①②③④）已足以支撑放行，但建议 dev 栈补一次
`SELECT count(*)` 前后对比作为最终确认。

### 4.2 红线二 · 归一化不回写（`vector→1.0 / keyword→0.0` 只准发生在检索期）

**结论：守住，且现已在「合并期」与「落库期」两侧各有独立断言。**

这条红线有两个可能的破口，设计文档 T07-判据3 与 T16-判据2 是**成对**的：

| 破口 | 守卫 | 状态 |
|---|---|---|
| **合并期污染**：Resolver 把归一化结果写回传入的 `RagSettings` 实例 | `RetrieveQueryResolverTest$Boundaries#weightOverwriteNeverTouchesPersistedSettings` —— 断言 `resolve` 后 `stored.vectorSimilarityWeight()` 仍是 `0.4` | ✅ 原有，通过 |
| **落库期污染**：`RagSettingsService.save()` 顺手做同款归一化 | ❌ **此前无任何守卫** → QA 已补 `RagSettingsServiceTest$WeightPersistence` | ✅ 本轮补齐，通过 |

补齐的落库侧断言：

- 参数化：`retrievalMethod ∈ {vector, keyword, hybrid}` 三种情况下保存权重 `0.4`，
  落库 JSON 中权重**恒为 0.4**；
- 端到端复现 T16-判据2：`设 0.4(hybrid) → 切 vector 保存 → get() 重新读取 → 仍为 0.4`。

读码复核同时确认 `RagSettingsService.validate()` 的 Javadoc 已把该口径写死：
「本方法只校验不改写……不得污染持久化值」（`RagSettingsService.java:139-143`）。

### 4.3 红线三 · 越权访问被拒

**结论：守住。两层判权各司其职，均有自动化断言。**

⚠️ **文档口径校正**：设计文档 T08 完成判据写的是「返回 `KB_LIBRARY_FORBIDDEN`」，
但代码库中**不存在**该结果码。实际实现为两个语义更精确的码：

| 层 | 场景 | 实际结果码 | 断言 |
|---|---|---|---|
| BFF | 无 `kb:hittest:run` 权限码 | `ResultCode.FORBIDDEN` = **40300** | `KbControllerHitTestPermissionTest`（9 用例） |
| mis-kb | 有权限码但对该库无 ACL | `KbResultCode.KB_NO_READ_PERMISSION` = **40310** | `KbVisibilityServiceTest`（7 用例）覆盖可见性判定 |

两者均为 403 语义，**功能行为符合设计意图**，属于**文档命名与实现不一致的文档债**
（见 §7 已知问题 D-1），不构成代码缺陷。

`KbControllerHitTestPermissionTest` 的断言口径值得单独表扬 —— 拒绝路径除断言异常码外，
一律 `verifyNoInteractions(kbFacadeService)`，这是「判权发生在任何下游调用之前」的
唯一可证伪证据。覆盖场景：权限码缺失 / 权限集为空 / loader 返回 null（不 NPE）/
相近码不放行（`kb:hittest` `kb:hittest:run:all` `KB:HITTEST:RUN` 三种均拒）/
userId 为空 → 40100 / 无登录上下文 → 40100 / 正向放行 + 入参原样透传 / 顺序回归锁。

**审计留痕**：`KbController#hitTest` 已挂
`@OperLog(module = "知识库", operation = "命中测试", recordParams = true)`
（`KbController.java:400`），位于 `requireHitTestPermission()` **之外**，
故越权被拒场景同样留痕。`sys_oper_log` 实际落行数需 dev 栈验证。

---

## 5. 门禁清单逐条结论

### 5.1 P0 阻塞发布项（16 项）

| 任务 | 主题 | WA 映射 | 验证方式 | 结论 |
|---|---|---|---|---|
| **T01** | 领域模型契约扩展 | WA-01/02/03/05 | 编译通过（反应堆 `mis-kb SUCCESS`）+ `RetrieveQueryResolverTest$RecordFallback` 4 用例验 record 兜底 | ✅ 通过 |
| **T02** | RAG 校验与全局默认收敛 | WA-01/06/13 | **QA 新补** `RagSettingsServiceTest` 26 用例：权重 `1.5` → `KB_RAG_SETTINGS_INVALID`；无模型时 `rerank=true` 落库 `false` | ✅ 通过（此前无覆盖） |
| **T03** | Client 检索请求体扩展 | WA-02/05 | 读码核验 `RagflowClient.java:248-255`：body 含 `keyword` / `vector_similarity_weight`；`rerank_id` 仅在开关真且模型非空时放入（`:250-251`），否则不出现该键 | ✅ 通过（🟡 抓包需 dev 栈） |
| **T04** | 重解析引擎调用落地 | WA-09 | 读码核验 `RagflowAdapter.java:115-116` 调 `client.parseDocuments(...)`；`RagflowClient.java:207-213` → `POST /api/v1/datasets/{id}/chunks` | ✅ 接线通过（🟡 引擎侧状态变化需 dev 栈，见 E-1） |
| **T05** | capabilities + rerank 动态判定 | WA-03/06 | 读码核验 `RagflowAdapter#capabilities()`：`hybridSupported=true`；`rerankSupported` 取 `hasRerankModel()`，为空时 `false` 并记 debug 日志（`:166-169`） | ✅ 通过 |
| **T07** ★ | 参数合并器 + 检索改造 | **WA-02（最高优先）**、WA-13 | `RetrieveQueryResolverTest` **30 用例**，四类合并全覆盖：单库生效(5) / 多库回落(3) / 覆盖优先(3) / 能力降级(4) + 边界(5) + 同义词接线(6) + record 兜底(4) | ✅ 通过 |
| **T08** | 命中测试领域服务 | WA-07 | 三条硬约束逐条核验，见 §4.1；`KbVisibilityServiceTest` 7 用例 | ✅ 通过 |
| **T09** | 空结果策略下发（WA-11①） | WA-11① | `RetrieveHitsVoContractTest` 8 用例：响应体键集合恒等含 `emptyResultStrategy`；`KbRetrieveService.java:106-108/142-145` 单库取库级、多库取全局默认，`effectiveParams.source` 可回溯 | ✅ 通过 |
| **T11** | mis-kb API 层端点 | WA-07/02 | `QaInternalController.java:94-97` `POST /internal/v1/kb/hit-test` 已注册；`RetrieveHitsVO` 兼容构造（仅 hits）键集合不变 → 老调用方 mis-rag 不受影响 | ✅ 通过 |
| **T12** | BFF 透传 + `@OperLog` | WA-07/01/03 | `KbController.java:399-404` 端点 + 权限码 + `@OperLog(recordParams=true)`；`KbControllerHitTestPermissionTest` 9 用例 | ✅ 通过 |
| **T13** | V17 权限菜单 seed | WA-08 | `V17__kb_hittest_perms.sql` 已存在：菜单 `91039`（父 `91030`，path `/kb/hit-test`，permission `kb:hittest:run`，icon `Crosshair`，sort 7）+ 仅授 `role_id=1` + D 段 `sys_api` 登记 `91061` + `sys_menu_api` 关联 | ✅ 通过（🟡 Flyway 实跑需 PG） |
| **T15** | 前端类型与 API 层 | WA-01/03/07/15 | `tsc --noEmit` 退出码 0、零错误 | ✅ 通过 |
| **T16** | L-08 RAG 面板增强 | WA-04/06/10/12 | 权重滑条仅 hybrid 显示（`kb-library-detail-page.tsx:441` + `isHybrid`）；切走隐藏不清值（`:90-92` 权重无条件提交）；rerank 置灰 + 理由文案（`:452-472`）；`hybridSupported === true` fail-safe（`:170`） | ✅ 通过（🟡 交互实测需浏览器） |
| **T17** | 命中测试页 + 路由注册 | WA-08/14/15 | 页面存在（`kb-hit-test-page.tsx` / `kb-hit-test-result-list.tsx`）；路由三处齐（`kb-nav.ts:22` + `keep-alive-outlet.tsx:99` + V17 SQL）；WA-14 对比槽 1 组 + **切库自动清空**（`:126-131/176`）；WA-15 CSV 原生 `Blob`+`createObjectURL`、不落服务端、不记审计（`:68-108`） | ✅ 通过（🟡 交互实测需浏览器） |

**P0 小结：16 项全部通过，无一项阻塞发布。**

### 5.2 P1/P2 非阻塞项（5 项）

| 任务 | 优先级 | 结论 | 说明 |
|---|---|---|---|
| **T06** Noop 降级语义与日志 | P1 | ✅ 已实现 | 能力降级路径由 `RetrieveQueryResolverTest$CapabilityDegradation` 4 用例覆盖（hybrid→vector 记 1 条原因；rerank 不支持共 2 条；无全局模型第三道防线；未降级时 `degradedReasons` 为空列表非 null） |
| **T10** 重解析状态机与幂等 | P1 | ✅ 已实现，⚠️ 无单测 | `KbDocumentService.java:149-174` 幂等短路（PARSING 直接 return）+ engineDocId 校验 + 库引擎映射校验均在；但设计声明的 `KbDocumentServiceTest` **不存在**。P1 不阻塞，登记为 T-2 |
| **T14** 空结果策略消费（WA-11②） | **P2** | 🟡 按裁决可后置 | 产品已裁决「不得并入 Wave B，降级为独立技术债仍留 Wave A 名下」。本轮不作门禁项 |
| **T18** 文档反向修订与联调 | P1 | 🟡 部分完成 | 规划 §9 勾选由本报告同步完成（见 §8）；`api-permission-mapping.md` 登记 `kb:hittest:run` 未逐一核验 |
| **T19** 审计业务字段落地 | P1 | ✅ 已实现 + 公共层回归通过 | `@OperLog(recordParams=true)` 已在 BFF 端点使用；**主理人硬性要求的 `mis-common-web` 单独回归**：本轮反应堆内 `mis-common-web SUCCESS`（3 用例）+ `mis-admin-bff` 内 `OperLogAspectSensitiveKeyTest` 及其 `$KnownBlindSpots` 组全绿 |

---

## 6. WA 需求 → 验证映射总表

| WA 编号 | 需求要点 | 验证载体 | 结论 |
|---|---|---|---|
| **WA-01** | 权重落库默认 0.3、区间 [0,1] | `RagSettingsServiceTest$Validation` (11) + `$Defaults` (3) | ✅ |
| **WA-02** ★ | 检索参数真正生效（四类合并） | `RetrieveQueryResolverTest` (30) | ✅ |
| **WA-03** | `capabilities()` 含 hybrid；降级原因对用户可见 | 读码 `RagflowAdapter#capabilities()` + `$CapabilityDegradation` (4) + 前端 `effectiveParams.degradedReasons` 回显 | ✅ |
| **WA-04** | 权重滑条仅 hybrid 显示 | `kb-library-detail-page.tsx:441` + `tsc` 通过 | ✅ 🟡 |
| **WA-05** | 检索期下发 `rerank_id` | 读码 `RagflowClient.java:250-251` + `$SingleLibrary#rerankEnabledSendsModelId` | ✅ |
| **WA-06** | 无全局模型 → `rerankSupported=false` / 落库 `false` / UI 置灰给理由 | 三道防线各有断言：`RagSettingsServiceTest$RerankAvailability` (4) / `$CapabilityDegradation#rerankDegradesWhenNoGlobalModel` / 前端 `:459-472` | ✅ |
| **WA-07** | 命中测试单库 + 强 ACL + 禁写五表 + 审计 | §4.1 四重保险 + `KbVisibilityServiceTest` (7) + `KbControllerHitTestPermissionTest` (9) | ✅ |
| **WA-08** | 菜单 91039 + `kb:hittest:run` + 角色授权 | `V17__kb_hittest_perms.sql` + `kb-nav.ts` + `keep-alive-outlet.tsx` 三处一致 | ✅ 🟡 |
| **WA-09** | `parseDocuments` 真实触发重解析 | 读码 `RagflowAdapter:115` → `RagflowClient:207` | ✅ 🟡 |
| **WA-10** | 失败置 FAILED + parseError；幂等短路 | 读码 `KbDocumentService.java:149-174` | ✅ ⚠️无单测 |
| **WA-11①** | `RetrieveHitsVO` 携带 `emptyResultStrategy` | `RetrieveHitsVoContractTest` (8) + `$MultiLibrary` 策略回落 3 用例 | ✅ |
| **WA-11②** | 问答侧三分支表现差异 | — | 🟡 P2 后置 |
| **WA-12** | 术语统一「混合检索（关键字+语义）」 | 前端文案读码 + 规划 §9 第 1 项 | ✅ |
| **WA-13** | 参数合并唯一收口 | `RetrieveQueryResolver` 单一入口 + 30 用例 | ✅ |
| **WA-14** | 上一次结果并排对比 + 切库清空 | `kb-hit-test-page.tsx:126-131/176/424-451` | ✅ 🟡（P1 段） |
| **WA-15** | 前端 CSV 导出，不落服务端、不记审计 | `kb-hit-test-page.tsx:68-108`（原生 Blob，BOM 前缀，CSV 转义） | ✅ 🟡 |

> 图例：✅ 离线门禁已验 · 🟡 需 dev 栈/浏览器实测复核 · ⚠️ 有实现但缺自动化覆盖

---

## 7. 前端门禁结论

### 7.1 typecheck

```bash
cd frontend/mis-admin-web && npx tsc --noEmit
TSC_EXIT=0
输出行数: 0
```

**退出码 0，零类型错误。** 按要求直接取 `npx tsc --noEmit` 的退出码，
未经 `| tail` 管道（tail 退出码恒 0 会掩盖失败）。

### 7.2 ESLint · `src/features/kb`（门禁项）

```bash
npx eslint src/features/kb
ESLINT_KB_EXIT=0
输出行数: 0
```

**零 error 零 warning。**

### 7.3 ESLint · 全量（已知债核对）

```bash
npx eslint .
ESLINT_ALL_EXIT=1
✖ 26 problems (11 errors, 15 warnings)
```

11 error 与本次门禁范围的交集经 `grep -c "features[/\\]kb"` 核对为 **0 行** ——
全部落在 `ai` / `system` 目录，属既有技术债，**不阻塞 Wave A 发布**。

---

## 8. 已知问题清单

### 8.1 代码缺陷（需回退工程师）

**无。** 本轮 QA 未发现任何源码缺陷。

### 8.2 测试覆盖缺口（QA 侧）

| 编号 | 问题 | 处置 |
|---|---|---|
| **T-1** | 设计 T02 声明的 `RagSettingsServiceTest` 缺失 → 门禁第 2 条零自动化证据 | ✅ **本轮 QA 已补齐**（26 用例全绿） |
| **T-2** | 设计 T10 声明的 `KbDocumentServiceTest` 缺失 → 重解析幂等/失败置 FAILED 无自动化断言 | ⬜ **遗留**。T10 为 P1 不阻塞发布；建议下一迭代补 3~4 个 Mockito 用例（重复触发不重复打引擎 / 无 engineDocId 抛错 / 引擎异常置 FAILED+parseError） |

### 8.3 环境阻塞项（需真实 dev 栈，非代码缺陷）

| 编号 | 项目 | 依赖 | 影响 |
|---|---|---|---|
| **E-1** | T04/WA-09 重解析**真实触发**，RAGFlow 侧 `run/progress` 状态变化 | RAGFlow 实例 | 接线已读码确认，引擎侧行为未实测 |
| **E-2** | T13 Flyway V17 实跑；`role_id=1` 登录后菜单出现「命中测试」，其余角色直连被拦 | PostgreSQL + 完整登录链路 | SQL 静态审阅通过 |
| **E-3** | 命中测试执行后 `kb_qa_*` 五表**行数不变**的实测 | PostgreSQL | 静态证据链四重保险已足（§4.1） |
| **E-4** | `sys_oper_log` 新增 1 行（含越权被拒场景）；`request_params` 中可查 `{libraryId, question, resultCount}` | PostgreSQL + BFF 运行态 | 注解与切面已就位 |
| **E-5** | T16 权重滑条交互：设 0.4 → 切 vector 保存 → 刷新 → 切回 hybrid 仍 0.4 | 浏览器 + 后端 | **后端侧已由 `RagSettingsServiceTest$WeightPersistence#weightSurvivesVectorRoundTrip` 端到端覆盖**，仅剩前端渲染层未实测 |
| **E-6** | 集成验证「某库改 keyword → 问答请求体 `keyword=true, vector_similarity_weight=0.0`」 | RAGFlow 抓包 | **合并器侧已由 `$SingleLibrary#keywordLibraryTakesEffect` 断言**（库里存 0.7 也强制 0.0）；`RagflowClient` 映射规则读码确认，仅剩真实 HTTP body 未抓包 |
| **E-7** | T17 命中测试页端到端：无权限用户被 `PermissionGate` 拦截、结果列表渲染 | 浏览器 + RAGFlow | 判权后端侧 9 用例已覆盖 |

### 8.4 文档债

| 编号 | 问题 | 建议 |
|---|---|---|
| **D-1** | 设计 T08 判据写「返回 `KB_LIBRARY_FORBIDDEN`」，但该结果码在代码库中**不存在**；实际为 BFF `FORBIDDEN(40300)` + mis-kb `KB_NO_READ_PERMISSION(40310)` | 修订设计文档 T08 判据措辞，改为实际码值。**功能行为无误，仅命名不一致** |
| **D-2** | T18 声明的 `api-permission-mapping.md` 登记 `kb:hittest:run` 未逐一核验 | P1，建议 T18 收尾时一并处理 |

---

## 9. IS_PASS 判定

### **IS_PASS = YES（有条件放行）**

**判定依据：**

1. **P0 门禁 16 项全部通过**，无一项阻塞。
2. **270 个离线单测 0 失败**，`BUILD SUCCESS`，退出码 `0`；前端 `tsc` 退出码 `0` 零错误、
   `eslint src/features/kb` 零 error 零 warning。
3. **三条红线全部守住**，且每条都有自动化断言而非仅靠注释/读码背书。
4. **零代码缺陷**，无需回退工程师。
5. 唯一发现的实质缺口（T02 测试缺失）已由 QA 在本轮内闭环修复并验证。

**放行条件（上线前需完成，不阻塞代码合入）：**

- [ ] **dev 栈冒烟一轮**，覆盖 E-1 ~ E-7 七项（重点 E-1 重解析真实触发、
      E-3 五表行数不变、E-4 审计落行）。预计 1 人天内可完成。
- [ ] release note **不得**写「空结果策略已支持」，只能按产品裁决口径写
      「已可配置并透传至问答链路，问答侧表现差异待后续」（T09 对外口径约束，
      WA-11② 尚未交付）。

### 下一步建议（按优先级）

1. **【高】** 安排一次 dev 栈联调冒烟，闭环 E-1 ~ E-7，把 §8.3 七项从 🟡 转 ✅。
   建议同时截取 RAGFlow 检索请求体（E-6）与 `sys_oper_log` 实际行（E-4）作为归档证据。
2. **【中】** 补 `KbDocumentServiceTest`（T-2），把 T10 从「有实现无断言」转为有守卫。
   成本约 1~2 小时，收益是重解析幂等这条容易在重构中被静默破坏的逻辑有了回归锁。
3. **【中】** 修订设计文档 T08 判据的 `KB_LIBRARY_FORBIDDEN` 措辞（D-1），
   避免后续验收者按不存在的码值去查而误判。
4. **【低】** T14（WA-11②）按产品裁决登记为独立技术债，**保持在 Wave A 名下**，
   不得并入 Wave B。
5. **【低】** 全量 ESLint 的 11 个 error（ai/system 目录）单独立项消化，与 KB 无关。

---

## 10. 附录：本轮变更文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `backend/mis-kb/src/test/java/com/mis/kb/domain/service/RagSettingsServiceTest.java` | **新增** | QA 补齐 T02 缺失测试，26 用例 |
| `docs/backend/knowledge-base-phase2-plan.md` | 修改 | §9 Wave A 验收清单勾选（见 §8 前置说明） |
| `deliverables/software-company/mis-kb-wave-a-qa-2026-08-07.md` | 新增 | 本报告 |

**未改动任何业务源码。**


