# MIS 知识库二期 Wave D（同义词与术语扩展）· T14 验收报告

| 项 | 值 |
|----|----|
| 验收对象 | Wave D 同义词与术语扩展，收尾于 commit `1f72e7e`（T10 BFF 透传层） |
| 验收人 | QA（Edward） |
| 日期 | 2026-08-04 |
| 设计依据 | `docs/backend/mis-kb-wave-d-design-2026-08-04.md` / PRD v1.1 |
| **结论** | **IS_PASS: 有条件通过（CONDITIONAL YES）** |

---

## TL;DR

**代码可执行验证全绿，三条红线全部守住，门禁项零失败。**

- 后端 **128 个用例真跑通过**（BFF 30 + mis-kb 98），两次 `BUILD SUCCESS`，退出码均为 `0`，零 Failure、零 Error、零 Skip。
- 前端 `tsc --noEmit` **退出码 0、零类型错误**；`features/kb/` 的 eslint **零 error 零 warning**（全仓 11 error / 14 warning 存量债全部落在 `features/ai/`、`features/system/`，与本波次无关）。
- **WD-06（最高红线）成立**：扩展串只有两个消费方——检索查询与只读展示 VO，扩展链路 452 行代码里**零 Repository、零 save、零 @Transactional**。
- **U4 归一化口径前后端逐字对齐**，且「繁简不折叠」已被固化为正向用例。
- **40927 契约整链无损**，`term` 原文（含全角 `ＯＫＲ`）在 mis-kb → BFF → 响应体三跳中逐字保留，且在两个层级各有独立用例守护。
- U2 运维联动说明已追加至 `deploy/ragflow/README.md` §5.7。

**「有条件」的唯一原因**：规模基准（5k–1 万词条导出）与端到端联调依赖真实 PostgreSQL + Nacos，**沙箱内无此环境，属环境阻塞，非代码缺陷**。需在用户 dev 栈补做（步骤见 §5）。**没有任何一项因代码问题被判失败。**

**路由判定：NoOne** —— 未发现源码 Bug，未发现测试代码 Bug，无需回退工程师。

---

## 1. 测试执行环境（先说清楚怎么跑起来的）

系统 `mvn` 因 `MAVEN_HOME` / `JAVA_HOME` 损坏无法直接调用。绕过方式：用 JDK17 直启 Maven 的 classworlds launcher，不经过 `mvn` 脚本。

```bash
"D:/software/jdk-17.0.2/bin/java" \
  -Dfile.encoding=UTF-8 \
  -Dmaven.home="D:/software/apache-maven-3.9.16" \
  -Dmaven.multiModuleProjectDirectory="D:/code/mis-platform/backend" \
  -Dclassworlds.conf="D:/software/apache-maven-3.9.16/bin/m2.conf" \
  -cp "D:/software/apache-maven-3.9.16/boot/plexus-classworlds-2.11.0.jar" \
  org.codehaus.plexus.classworlds.launcher.Launcher <maven-args>
```

自检输出：

```
Apache Maven 3.9.16 (2bdd9fddda4b155ebf8000e807eb73fd829a51d5)
Maven home: D:\software\apache-maven-3.9.16
Java version: 17.0.2, vendor: Oracle Corporation, runtime: D:\software\jdk-17.0.2
```

> 仓库内无 `mvnw`（`backend/mvnw` 与根 `mvnw` 均不存在），故未走 wrapper 路径。
> 已按要求加 `-Dsurefire.failIfNoSpecifiedTests=false`，避免 `-am` 带上无匹配模块时误报 "No tests matching pattern"。

---

## 2. 测试执行结果（真实数据）

### 2.1 BFF 同义词透传层（本次验收核心）

```bash
... Launcher -pl mis-admin-bff -am \
    -Dtest='KbSynonymControllerTest,KbWebClientSynonymPayloadTest' \
    -DfailIfNoTests=false -Dsurefire.failIfNoSpecifiedTests=false test
```

```
[INFO] Results:
[INFO] Tests run: 30, Failures: 0, Errors: 0, Skipped: 0
[INFO] Reactor Summary for MIS Platform 0.1.0-SNAPSHOT:
[INFO] MIS Platform ....................................... SUCCESS [  0.986 s]
[INFO] mis-common ......................................... SUCCESS [  0.019 s]
[INFO] mis-common-core .................................... SUCCESS [  3.015 s]
[INFO] mis-common-web ..................................... SUCCESS [  1.757 s]
[INFO] mis-common-security ................................ SUCCESS [  0.782 s]
[INFO] mis-common-redis ................................... SUCCESS [  0.849 s]
[INFO] mis-admin-bff ...................................... SUCCESS [ 17.804 s]
[INFO] BUILD SUCCESS
[INFO] Total time:  27.461 s
EXIT_CODE=0
```

**逐内部类用例数**（⚠️ `@Nested` 外层类显示 `Tests run: 0` 属正常，真实用例在内部类）：

| 测试类 | 内部类 | 用例数 |
|--------|--------|--------|
| `KbWebClientSynonymPayloadTest` | `ConflictDetailPassthrough` | 5 |
| | `SuccessPath` | 3 |
| | `EdgeCases` | 2 |
| | `SilentLossRegression` | 2 |
| | **小计** | **12** |
| `KbSynonymControllerTest` | `Routing` | 6 |
| | `DeleteSnapshot` | 4 |
| | `ImportExportShape` | 3 |
| | `ConflictDetailReachesResponseBody` | 3 |
| | `QueryParamPassthrough` | 2 |
| | **小计** | **18** |
| | **合计** | **30** |

> **日志中有一条 `ERROR ... Unhandled exception` 是预期的，不是失败。**
> 来源：`NoHandlerFoundException: No endpoint GET /api/v1/kb/synonyms/abc`，
> 由 `KbSynonymControllerTest$Routing.nonNumericIdIsNotRouted`（`KbSynonymControllerTest.java:155`）
> 故意触发，用于断言非数字 ID 不被 `{id}` 路由吞掉。该用例本身 PASS。

### 2.2 mis-kb 领域层（额外补跑，用于给红线提供"可执行"证据）

发现 `mis-kb` 测试同样**零 `@SpringBootTest`**（`grep -rln "@SpringBootTest" src/test` 无输出），因此可离线运行。为让 WD-06 / U4 / 40927 三条红线不止停留在"读代码"，补跑了领域层：

```bash
... Launcher -pl mis-kb -am \
    -Dtest='SynonymTermNormalizerTest,SynonymExpandServiceTest,SynonymGroupServiceTest,RetrieveQueryResolverTest' \
    -DfailIfNoTests=false -Dsurefire.failIfNoSpecifiedTests=false test
```

```
[INFO] Results:
[INFO] Tests run: 98, Failures: 0, Errors: 0, Skipped: 0
[INFO] mis-kb ............................................. SUCCESS [ 25.415 s]
[INFO] BUILD SUCCESS
[INFO] Total time:  33.773 s
EXIT_CODE=0
```

| 测试类 | 内部类分布 | 小计 |
|--------|-----------|------|
| `SynonymTermNormalizerTest` | MustFold 5 / MustNotFold 2 / Contract 3 / WordBoundary 5 | **15** |
| `SynonymExpandServiceTest` | BasicExpansion 6 / FourStates 6 / BudgetTruncation 5 / FreshnessContract 4 / WordBoundary 3 / LongestMatch 2 / ShortTerms 2 | **28** |
| `SynonymGroupServiceTest` | Conflict 7 / Search 7 / Terms 6 / VersionAndReload 5 | **25** |
| `RetrieveQueryResolverTest` | SynonymStep 6 / Boundaries 5 / SingleLibrary 5 / CapabilityDegradation 4 / RecordFallback 4 / MultiLibrary 3 / RequestOverride 3 | **30** |
| | | **98** |

### 2.3 后端合计

| 指标 | 值 |
|------|-----|
| 真实用例总数 | **128**（BFF 30 + mis-kb 98） |
| Failures | **0** |
| Errors | **0** |
| Skipped | **0** |
| BUILD | **SUCCESS × 2** |
| 退出码 | **0 × 2** |

---

## 3. 红线与契约静态核查

### 3.1 WD-06（最高红线）：扩展串绝不写回词表 —— ✅ 成立

**结论：成立，且是结构性成立（不是"当前没写"，是"这条链路没有写的能力"）。**

**证据一 · 扩展服务本身无任何写库能力**

```bash
grep -n "save|insert|delete|Repository|@Transactional" \
     mis-kb/.../domain/service/SynonymExpandService.java
→ 无输出
```

`SynonymExpandService.java`（452 行）**不含任何 Repository 依赖、不含任何 save/insert/delete、不含 `@Transactional`**。其构造函数只注入两个只读依赖：

```java
// SynonymExpandService.java:68
public SynonymExpandService(SynonymDictLoader dictLoader, SynonymProperties properties)
```

`SynonymDictLoader.java`（332 行）同样零写操作（唯一 `@Transactional` 命中是第 260 行的一句注释，说明"刻意不加"）。

**证据二 · 扩展结果只有两个消费方，都不落词表**

```bash
grep -rn "expandedQuery|expandedTerms|addedTerms" mis-kb/src/main/java --include=*.java
```

去掉定义处（`SynonymExpansion.java`）后，全部消费点仅两处：

| 位置 | 用途 | 是否写词表 |
|------|------|-----------|
| `RetrieveQueryResolver.java:233` | `new RetrieveQuery(expansion.expandedQuery(), ...)` → 送检索引擎 | ❌ 否 |
| `SynonymExpansionVO.java:130` | 只读 VO，供命中测试页展示扩展轨迹 | ❌ 否 |

`RetrieveQueryResolver` 自身也无 Repository / save / `@Transactional`（grep 无输出）。

**证据三 · 词表的写入点全部来自人工动作，与扩展链路无交集**

```bash
grep -rn "termRepository\.(save|delete|saveAll|deleteAll)|groupRepository\.(save|delete|saveAll)" \
     mis-kb/src/main/java --include=*.java
```

| 文件:行号 | 触发来源 |
|-----------|---------|
| `SynonymGroupService.java:192, 229, 233, 257, 258, 482` | 管理员在页面新建 / 编辑 / 删除术语组 |
| `SynonymImportService.java:724, 741, 791, 800` | 管理员显式提交导入批次 |

**写入点合计 10 处，全部集中在这两个由管理员显式动作驱动的服务里，无一处位于扩展/检索链路。**

**证据四 · 可执行验证**：`SynonymExpandServiceTest` 28 个用例全绿，其中 `FourStates`(6) / `BudgetTruncation`(5) 覆盖了扩展的四种状态与预算截断，均未涉及也未产生任何持久化副作用。

---

### 3.2 U4 · NFKC 归一化前后端对齐 —— ✅ 一致

**后端口径**（`SynonymTermNormalizer.java:43-55`）：

```java
String trimmed = raw.trim();
if (trimmed.isEmpty()) return "";
String folded = Normalizer.normalize(trimmed, Normalizer.Form.NFKC);
return folded.trim().toLowerCase(Locale.ROOT);
```

**前端口径**（`frontend/mis-admin-web/src/features/kb/types.ts:858-859`）：

```typescript
export function normalizeSynonymTerm(raw: string): string {
  return raw.trim().normalize('NFKC').toLowerCase();
}
```

| 环节 | 后端 | 前端 | 一致 |
|------|------|------|------|
| trim | `String.trim()` | `String.prototype.trim()` | ✅ |
| NFKC | `Normalizer.Form.NFKC` | `.normalize('NFKC')` | ✅ |
| 小写 | `toLowerCase(Locale.ROOT)` | `.toLowerCase()` | ✅ |
| 顺序 | trim → NFKC → lower | trim → NFKC → lower | ✅ |
| 繁简折叠 | 不做 | 不做 | ✅ |

> **关于后端多出的那次 `folded.trim()`（第 54 行）——这是补齐差异而非制造差异。**
> Java 的 `String.trim()` 只裁 `<= U+0020`，裁不掉全角空格 `U+3000`；NFKC 会把 `U+3000` 折成半角空格，所以必须再 trim 一次。
> JS 的 `trim()` 本身就按 Unicode 空白裁剪（含 `U+3000`），在第一步就已处理。
> **两侧对全角空格输入的最终输出相同**，已由 `SynonymTermNormalizerTest.trimsWhitespaceIncludingIdeographicSpace`（`" OKR "` → `"okr"`）实测覆盖。

**"只折全半角、不折繁简"已被固化为正向用例**（`MustNotFold`，2 个，均 PASS）：

- `traditionalAndSimplifiedStayDistinct`：`normalize("軟體") != normalize("软件")`
- `innerWhitespaceKept`：词内空格不压缩

**BFF / mis-kb 未对 40927 明细中的 `term` 做归一化 —— 已确认：**

```bash
grep -rn "Normalizer|NFKC|toLowerCase|normalize" \
     mis-admin-bff/.../service/KbSynonymFacadeService.java \
     mis-admin-bff/.../controller/KbSynonymController.java \
     mis-admin-bff/.../dto/kb/
→ 无输出（BFF 全层零归一化代码）
```

mis-kb 侧同样不归一化 `term`。`SynonymGroupService.checkTermConflicts` 用 `Map<String,String> rawByNorm` 建立「归一词形 → 提交原文」映射，抛异常时取的是 **value（原文）**：

```java
// SynonymGroupService.java:287-291
rawByNorm.putIfAbsent(norm, raw);      // key=归一形，value=原文
// SynonymGroupService.java:321-322
throw new KbSynonymConflictException(new SynonymConflictDetail(
        entry.getValue(), ownerGroupId, canonicalTermOf(ownerGroupId)));  // ← getValue() = 原文
```

**判重在 `term_norm` 上做，回显用原文** —— 设计意图与实现一致。

---

### 3.3 40927 契约整链无损 —— ✅ 字段不丢

链路逐跳核查：

| # | 跳 | 位置 | 行为 | 结论 |
|---|-----|------|------|------|
| 1 | mis-kb 产出 | `SynonymGroupService.java:321` | `new SynonymConflictDetail(原文term, ownerGroupId, ownerCanonicalTerm)` | ✅ 三字段齐，term 为原文 |
| 2 | 装入异常 | `KbSynonymConflictException.java:32` | `super(code, buildMessage(detail), detail)` → 走带 `data` 的构造 | ✅ 明细进 `BusinessException.data` |
| 3 | BFF 解包 | `KbWebClient.resolveSynonym():902-905` | 失败分支**刻意不做类型转换**，`toPlainData(mapper, result.getData())` | ✅ 不按成功态类型解码，字段不蒸发 |
| 4 | 摊平 | `KbWebClient.toPlainData():929-939` | `convertValue(node, Object.class)`，异常时退化为字符串**而非吞成 500** | ✅ 无归一化、无裁剪 |
| 5 | 写响应体 | `GlobalExceptionHandler.java:36-38` | `body.setData(ex.getData())` | ✅ 明细落到响应 `data` |

**关键设计点**：第 3 跳是最容易丢字段的地方。`KbWebClient` 为同义词端点单开了 `ParameterizedTypeReference<Result<JsonNode>> SYNONYM_RAW`（`KbWebClient.java:129`），全部 11 个端点统一走它，而非各自的成功态类型。若照抄其余端点用 `Result<KbSynonymGroupVO>`，Spring Boot 容器的 `ObjectMapper` 关闭了 `FAIL_ON_UNKNOWN_PROPERTIES`，三个字段会**静默蒸发**。

**这个失败模式已被固化为回归护栏用例**（`SilentLossRegression`，2 个，均 PASS）：

- `decodingErrorBodyAsSuccessTypeLosesEverything`：证明按成功态类型解码 → 三字段全 null 且**不报错**
- `bareMapperBehavesDifferently`：证明测试里不能用裸 `new ObjectMapper()` 替代容器实例（裸实例会抛异常，与线上"静默丢"行为相反，会得出假结论）

**两个层级的独立守护，均已实测通过：**

| 层 | 用例 | 断言要点 |
|----|------|---------|
| Client 单元 | `ConflictDetailPassthrough.keepsAllThreeFields` | `data.size()==3`、code 保持 40927 不归一成 500 |
| Client 单元 | `ConflictDetailPassthrough.keepsOriginalTermSpelling` | 全角 `ＯＫＲ` **必须原文透出**，不得归一成 `okr` |
| Client 单元 | `ConflictDetailPassthrough.nullDetailStaysNull` | 无明细时 `data` 保持 `null`，不凭空造 `{}` |
| Controller（含真实 `GlobalExceptionHandler`） | `ConflictDetailReachesResponseBody.createConflictKeepsDetail` | `$.data.term` / `$.data.ownerGroupId` / `$.data.ownerCanonicalTerm` 三字段齐 |
| Controller | `ConflictDetailReachesResponseBody.updateConflictKeepsFullWidthTerm` | `$.data.term == "ＯＫＲ"`（全角） |
| 领域层 | `SynonymGroupServiceTest$Conflict`（7 个） | 含「全角 ＯＫＲ 与半角 OKR 判为同一词但 term 回显 ＯＫＲ」「Q3 停用组仍占用」 |

> Controller 测试用 `MockMvcBuilders.standaloneSetup(...).setControllerAdvice(new GlobalExceptionHandler())`
> （`KbSynonymControllerTest.java:82-83`）挂载了**真实的**全局异常处理器，
> 因此第 5 跳 `setData` 是被真实执行验证过的，不是纸面推断。

---

## 4. U2 运维联动文档收尾 —— ✅ 已完成

**改动文件**：`deploy/ragflow/README.md`
**位置**：§5「可选：引擎原生同义词 `synonym.json`」章节末尾，新增 **§5.7**，紧邻既有 §5.6 之后、`## 6. 与 MIS 的边界约定` 之前。
**既有内容**：未删改任何一行，纯追加。

新增内容要点：

- 以表格说明「双闸」：库内 `kb_synonym_config.enabled`（管理员可自助改）与 Nacos `mis.kb.synonym.enabled`（页面只读，仅运维可改）
- 明确 `effective = enabled && killSwitchEnabled`
- **运维动作**：库内开关打开后，需同步确认 / 将 Nacos 熔断闸 `killSwitchEnabled` 置为 `true`
- 补充了一条排障口诀：「用户说『开关明明开了却没效果』，先看 `killSwitchEnabled`」

**写入前已核对语义正确性**（避免文档写反）：

| 核对项 | 代码证据 |
|--------|---------|
| Nacos 键名 | `SynonymProperties.java:19` → `@ConfigurationProperties(prefix = "mis.kb.synonym")`，字段 `enabled` |
| 默认值 | `SynonymProperties.java:28` → `private boolean enabled = true;` |
| 双闸是「与」关系 | `SynonymConfigService.java:91` → `enabled && killSwitch` |
| 页面只读 | `KbSynonymConfigUpdateRequest` 不含 `killSwitchEnabled` 字段；`KbSynonymController.java:196` 注释「不在此处开写口」 |

> 因默认值就是 `true`，文档措辞用的是「**确认 / 置为** `true`」而非「必须改成 `true`」，
> 并说明「只有此前因故障熔断降为 `false` 过才需显式改回」，避免运维照做时产生"是不是漏配了"的困惑。

---

## 5. 规模基准（5k–1 万词条导出）—— ⚠️ 环境阻塞，代码路径已确认存在

### 5.1 代码路径核查 —— ✅ 与设计一致

| 核查项 | 结果 | 证据 |
|--------|------|------|
| 导出走 JSON 字符串装在 `data.content` | ✅ 存在 | `SynonymFileVO.java:17` → `record SynonymFileVO(String filename, String contentType, String content)` |
| 受 `EXPORT_MAX_GROUPS` 限制 | ✅ 存在，值为 **10000** | `SynonymImportService.java:84` |
| 超限行为 | ✅ 抛 40926 而非截断 | `SynonymImportService.java:391-396`，提示含实际组数与上限，引导缩小筛选范围 |
| 分页取数 | ✅ 用硬上限而非 `Integer.MAX_VALUE` | `SynonymImportService.java:390`（注释说明后者会生成 `LIMIT 2147483647` 的荒唐语句） |
| 词条批量装载 | ✅ 批量而非 N+1 | `SynonymImportService.java:399-401` → `groupTerms(所有 groupId)` 一次取回 |

### 5.2 沙箱内能否实测 —— ❌ 不能

导出路径标注 `@Transactional(readOnly = true)`，实际执行需要：

- **真实 PostgreSQL**（`groupRepository.search(...)` 走 JPA 分页查询）
- 库内预置 5k–1 万条术语组数据

沙箱无 PG 实例、无 Nacos，`mis-kb` 现有测试全部为 Mockito 纯单测（零 `@SpringBootTest`、零 Testcontainers），**无法覆盖真实数据量下的 SQL 与序列化开销**。

**明确标记：环境阻塞，待用户 dev 栈验收。**

### 5.3 推荐的手动联调步骤（dev 栈）

1. **造数**：向 `kb_synonym_group` / `kb_synonym_term` 灌入 5000 组（每组 3–5 个别名，约 2 万词条），再单独造一批 10001 组用于验超限。
2. **测 JSON 导出**：
   `GET /api/v1/kb/synonyms/export?format=JSON`
   断言：HTTP 200、`code=0`、`data.content` 为合法 JSON 字符串、`data.filename` 以 `.json` 结尾、组数与库内一致。
3. **测 CSV 往返**（AC-09）：导出 CSV → 原样作为导入文件预检 → 断言零冲突零变更行（导出结果可直接当导入模板）。
4. **测超限**：造 10001 组后再导出，断言返回 **40926** 且 message 含实际组数，**而不是静默截断到 10000**。
5. **记录三项指标**：
   - 端到端耗时（关注是否触碰 BFF 的 WebClient `timeout()`）
   - `data.content` 字符串体积（1 万组 JSON 预计数 MB 级）
   - mis-kb 与 BFF 两侧的**堆内存峰值**

> **⚠️ 建议 dev 栈重点观察这一条**：当前实现会把全量导出内容作为**单个 String** 装进 `Result.data.content`，
> 该字符串在 mis-kb 序列化一次、BFF 反序列化 + 再序列化各一次，
> **1 万组场景下同一份数据在链路上最多同时存在 3~4 份副本**。
> 这是设计既定形态（非本次实现引入的偏差，`EXPORT_MAX_GROUPS=10000` 正是为此设的闸），
> 但**上限值是否合适应以 dev 栈实测的内存峰值为准**。若峰值不可接受，建议下一波次调低上限或改流式下载。
> **此项属容量评估建议，不构成本次验收的阻塞。**

---

## 6. 前端回归门禁 —— ✅ 通过

### 6.1 typecheck（门禁项）

```bash
cd frontend/mis-admin-web && npx tsc --noEmit
```

```
TSC_EXIT=0
```

**退出码 0，零输出即零类型错误。** 门禁通过。

> 已按要求用 `npx tsc --noEmit` 直接取码 / `${PIPESTATUS[0]}`，未用 `cmd | tail` 后取 `$?`（tail 恒 0 会掩盖失败）。

### 6.2 eslint（非门禁，确认 kb 无新增债）

```bash
npx eslint src/features/kb
→ 无任何输出，ESLINT_KB_EXIT=0
```

**`features/kb/` 零 error、零 warning。** 本波次前端代码（`features/kb/synonym/`）未引入任何新增 lint 债。

全仓基线复核：

```bash
npx eslint .
→ ✖ 25 problems (11 errors, 14 warnings)   ESLINT_ALL_EXIT=1
```

数字与工程师交接一致（11 error + 14 warning）。因 `features/kb` 单独跑为 0，可**反证 25 条问题全部落在 `features/kb` 之外**（`features/ai/`、`features/system/`，11 个 error 均为 `arch/no-cross-feature`）。**属已知存量债，非本次阻塞。**

---

## 7. 已知问题清单

**源码 Bug：0 个。测试代码 Bug：0 个。** 本轮未触发任何回退工程师的路由。

以下均为**环境阻塞**或**观察建议**，不构成代码缺陷：

| # | 类型 | 项 | 影响 | 处置 |
|---|------|-----|------|------|
| K-1 | 🔴 环境阻塞 | **5k–1 万词条导出规模基准未实测** —— 沙箱无 PG | 无法给出真实耗时 / 内存数据；代码路径已确认存在且符合设计 | **待用户 dev 栈验收**，步骤见 §5.3 |
| K-2 | 🔴 环境阻塞 | **端到端联调未做** —— 前端 → BFF → mis-kb → PG/RAGFlow 全链路 | 本次仅验证到 BFF 层（含真实 `GlobalExceptionHandler`）；40927 明细在**真实 HTTP 传输**下的表现未验 | **待用户 dev 栈验收**：重点验 AC-11 冲突提示与跳转 |
| K-3 | 🔴 环境阻塞 | **U2 双闸联动未实机验证** —— 无 Nacos 实例 | 文档已按代码语义写对，但「改 Nacos → `effective` 翻转」未实测 | **待用户 dev 栈验收**：置 `mis.kb.synonym.enabled=false`，验证库内开关为 true 时 `effective` 仍为 false |
| K-4 | 🟡 观察建议 | 导出全量内容以**单个 String** 装在 `Result.data.content`，链路上最多同时存在 3~4 份副本 | 1 万组时可能出现堆内存峰值 | 设计既定形态，非缺陷。dev 栈实测内存后再决定是否调低 `EXPORT_MAX_GROUPS` 或改流式 |
| K-5 | 🟡 已知存量债 | 前端 eslint 11 error + 14 warning | 全部在 `features/ai/`、`features/system/`，11 个 error 均为 `arch/no-cross-feature` | 与 Wave D 无关，`features/kb/` 为 0。另行排期 |
| K-6 | 🟢 环境备忘 | 系统 `mvn` 因 `MAVEN_HOME`/`JAVA_HOME` 损坏不可直接调用；仓库无 `mvnw` | 后续 CI / 他人复现测试会踩同一个坑 | 已给出 classworlds 直启方案（§1）。**建议补 Maven Wrapper 或修复环境变量** |

---

## 8. IS_PASS 判定

### **IS_PASS: 有条件通过（CONDITIONAL YES）**

**通过依据：**

| 门禁项 | 结果 |
|--------|------|
| BFF 同义词测试真跑 | ✅ 30 用例全绿，BUILD SUCCESS，exit 0 |
| mis-kb 领域层测试真跑 | ✅ 98 用例全绿，BUILD SUCCESS，exit 0 |
| WD-06 扩展串不写回词表 | ✅ 结构性成立，四类证据 |
| U4 NFKC 前后端对齐 | ✅ 逐环节一致，繁简不折叠已固化用例 |
| 40927 契约整链无损 | ✅ 五跳全通，两层用例守护，全角原文保真 |
| U2 文档收尾 | ✅ 已追加 §5.7，未破坏既有内容 |
| 前端 typecheck | ✅ exit 0，零类型错误 |
| `features/kb` 无新增 lint 债 | ✅ 零 error 零 warning |
| **规模基准实测** | ⚠️ **环境阻塞（K-1）** |
| **端到端联调** | ⚠️ **环境阻塞（K-2、K-3）** |

**「有条件」的含义**：**沙箱内可执行的全部门禁项 100% 通过，无一失败**。判"有条件"仅因 K-1/K-2/K-3 三项**依赖沙箱不具备的 PG + Nacos 环境**，属客观阻塞而非代码问题。这三项在用户 dev 栈补验通过后，即可无条件转为 **YES**。

**路由判定：`NoOne`** —— 无源码 Bug、无测试 Bug，不回退工程师。

**测试轮次：Round 1 结束即通过，未进入 Round 2。**

---

## 9. 下一步建议

1. **可以 push，但 push 前先补一次全量后端回归。** 本次为精准跑（`-Dtest=` 指定 4+2 个类），未验证 Wave D 改动是否影响其他模块。建议在 dev 栈执行 `mvn -pl mis-kb,mis-admin-bff -am test`（不带 `-Dtest`），确认无连带破坏。**注意 `mis-kb` 未被 `mis-admin-bff -am` 的反应堆带上**（两者无 Maven 依赖关系），必须显式列出，否则会漏测。

2. **dev 栈优先做 K-2（端到端 40927 验证），这是投入产出比最高的一项。** 本次已在 BFF 层用真实 `GlobalExceptionHandler` 验到响应体，剩下唯一未验的是真实 HTTP 传输 + 前端渲染。重点场景：A 组已有「OKR」→ B 组录入全角「ＯＫＲ」→ 断言提示同时显示两种写法且跳转链接指向 A 组（AC-11）。

3. **补做 K-1 规模基准，并把实测内存峰值作为 `EXPORT_MAX_GROUPS=10000` 是否合理的判据。** 若 1 万组导出堆峰值超出可接受范围，建议下一波次改流式下载而非仅调低上限（调低上限只是把问题推给用户）。

4. **修复构建环境或补 Maven Wrapper（K-6）。** 当前 `mvn` 不可直接调用、仓库无 `mvnw`，任何人（包括 CI）复现本报告的测试都要重走一遍 classworlds 绕行。这是持续性的团队摩擦，建议在 `backend/` 下补 `mvnw`。

5. **把 U2 双闸做成"可自检"而不只是"文档写着"。** 建议在同义词配置页对 `effective=false 但 enabled=true` 的状态给出显式提示（如"已被运维熔断闸关闭，请联系运维"），比 README 更能拦住工单。可作为下一波次的小改进项。

---

## 附录 · 本次执行的全部命令与退出码

| # | 命令 | 结果 |
|---|------|------|
| 1 | Maven launcher `-v` 自检 | Maven 3.9.16 / Java 17.0.2 ✅ |
| 2 | `-pl mis-admin-bff -am -Dtest='KbSynonymControllerTest,KbWebClientSynonymPayloadTest' test` | `Tests run: 30, Failures: 0, Errors: 0, Skipped: 0` / BUILD SUCCESS / **exit 0** |
| 3 | `-pl mis-kb -am -Dtest='SynonymTermNormalizerTest,SynonymExpandServiceTest,SynonymGroupServiceTest,RetrieveQueryResolverTest' test` | `Tests run: 98, Failures: 0, Errors: 0, Skipped: 0` / BUILD SUCCESS / **exit 0** |
| 4 | `npx tsc --noEmit` | 零输出 / **exit 0** |
| 5 | `npx eslint src/features/kb` | 零输出 / **exit 0** |
| 6 | `npx eslint .` | 25 problems (11 errors, 14 warnings) / exit 1（已知存量债，全部在 kb 之外） |

> 全部命令均加 `-Dsurefire.failIfNoSpecifiedTests=false`，未出现 "No tests matching pattern" 误报。
> 退出码均通过 `${PIPESTATUS[0]}` 获取，未被管道尾部命令掩盖。
