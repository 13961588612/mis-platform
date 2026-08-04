# QA 报告：mis-kb P1/P2 增量收尾补齐验证（T15 / T17 / T18）

- **报告人**：QA 工程师（严过关）
- **日期**：2026-08-04
- **团队**：software-kb-incremental-fix
- **验证对象**：工程师寇豆码补齐的 3 项（自报 IS_PASS: YES，基于静态自审）
  - **T15 F-04** 引用原文定位（前端抽屉）：`features/kb/components/kb-citation-list.tsx`
  - **T17 L-06** 库详情文档 Tab（前端）：`features/kb/library/kb-library-detail-page.tsx` + 新建 `features/kb/document/kb-document-table.tsx`
  - **T18 A-02b** 评价统计看板（后端+前端）：`KbOperationsService.stats` 改写 + `KbDashboardVO`(21字段) + BFF `KbDashboardVO` 镜像 + 前端 `types.ts` + `kb-dashboard-tab.tsx`

---

## 一、IS_PASS 结论

**IS_PASS = YES（有条件：运行时联调仍待用户环境验收）**

理由（严把关）：
- 质量门禁全绿：前端 typecheck 通过、增量 Java 可编译、真实 Maven `clean test` 构建 26 例（22 既有 + 4 新增）全绿、前后端字段镜像静态一致。
- 静态复核发现的 **1 处源码契约缺陷**（T18 看板日期区间筛选静默回退 30 天）已由工程师寇豆码按后端方案修复（`OperationsController.parseInstant(String, boolean)` 增补纯日期分支），并经真实 `clean test` 回归构建验证：wiped `target/` 后重新编译并跑通全部 26 例相关单测（0 失败），证明修复可编译、无回归（见第四节“问题 1”状态、第六节）。
- 仍余 2 项待用户环境验收（dev 栈 PG 自检、BFF↔mis-kb 联调 + 日期筛选运行时回归）在我沙箱内无法执行，须用户在 JDK17+Docker+PG 环境完成（见第五节、第八节）。

**结论**：补齐代码“能编译、类型安全、聚合单测通过、字段镜像正确、已知源码缺陷已修复且回归绿”，达到可放行标准；仅剩运行时集成验收（JPA/联调/日期筛选真实 HTTP）属沙箱不可达项，须用户在联调环境闭环。

---

## 二、验证范围与方法

| # | 验证项 | 方法 | 门禁类型 |
|---|--------|------|----------|
| 1 | 前端 typecheck | `cd frontend/mis-admin-web && npm run typecheck`（tsc --noEmit） | 自动门禁 |
| 2 | Java 回归编译+单测 | 真实 Maven 构建 `-pl mis-kb,mis-admin-bff -am test`（JDK17.0.2） | 自动门禁 |
| 3 | 核心逻辑单测 | 新增 `KbOperationsServiceStatsTest`（纯 Mockito/内存数据集，不启 Spring/不连库） | 自动门禁 |
| 4 | 静态一致性复核 | 逐文件核对：抽屉受控 API、KbDocumentTable 复用、前后端字段镜像 | 人工静态 |
| 5 | 智能路由判定 | 源码 Bug→工程师；测试 Bug→QA 自修；全过→成功（最多 2 轮） | 流程 |

---

## 三、逐项结论

### T15 F-04 引用原文定位（前端抽屉）
- **源码**：`kb-citation-list.tsx` 已加 `page`/`offset` 定位徽标；抽屉按需拉库元信息（密级/分类，模块级缓存 + 单飞）；复用既有 `getLibrary`/`listCategories`，不新增后端字段；`KbCitationLocator` 独立可空渲染页码/偏移，两者皆空则不渲染；`source` 优先展示、缺失回退 ID。
- **typecheck**：通过（exit 0），增量文件无新增类型错误。
- **端到端链路**：mis-kb `QaCitationVO` 已带 `offset`/`page`/`source`（实体列名 `chunk_offset`/`page_no`，对外固定 `offset`/`page`）；BFF `AiRagCitation` 有 `source`；前端 `normalizeSessionDetail` 已补齐 `source/offset/page` 键位。链路自洽。
- **结论**：PASS（编译/类型/静态链路均通过）。

### T17 L-06 库详情文档 Tab（前端）
- **源码**：`kb-document-table.tsx` 为新建复用组件，props `libraryId`/`showUpload?`/`fill?`，含上传/启用/重解析/删除/解析轮询；无重复列表实现。`kb-library-detail-page.tsx` 四 Tab（基本信息/文档/授权范围/RAG 设置），文档 Tab 用 `<KbDocumentTable libraryId={libraryId} showUpload fill />`；路由 ID 从 `pathname` 尾段解析（`parsePathId`，因 `KeepAliveOutlet` 仅登记 `/kb/*` 通配）。
- **typecheck**：通过（exit 0）。
- **复用复核**：`KbDocumentTable` 单一定义、单处实例引用，无重复列表；授权范围/RAG 设置为既有 Tab 复用，未引入新后端契约。
- **结论**：PASS（编译/类型/复用静态均通过）。

### T18 A-02b 评价统计看板（后端+前端）
- **后端编译**：`KbDashboardVO`/`KbOperationsService` 等增量 Java 经真实 Maven 构建编译通过（见任务 2）。
- **后端单测**：新增 `KbOperationsServiceStatsTest` 4 例全绿，覆盖聚合口径（见任务 3）。
- **前后端字段镜像**：mis-kb `KbDashboardVO` 与 BFF `KbDashboardVO` 21 字段严格同名（primitives vs Long 兼容）；前端 `types.ts` 镜像 BFF VO，子记录 `DimensionCount`/`QuestionCount`/`LibraryScore`/`DocumentScore`/`LibraryHit`/`DailyPoint` 齐全；`kb-dashboard-tab.tsx` 实际渲染了后端算出的所有字段（含 `ratedCount` 以 `l.ratedCount`/`d.ratedCount` 形式、五块图表 negativeDimensions/topNegativeQuestions/lowScoreLibraries/lowScoreDocuments/trend 均渲染）。**后端算的字段前端都展示了，无“算了一堆前端不展示”**。
- **缺陷（已修复）**：日期区间筛选契约缺口（详见第四节“问题 1”，已由工程师按后端方案修复并经 `clean test` 回归验证）。
- **结论**：**PASS**——编译/单测/字段镜像通过；日期筛选子能力源码缺陷已修复并经 `clean test` 回归验证（mis-kb 11 例 + bff 15 例共 26 例全绿、0 失败、无回归）。

---

## 四、已知问题（已识别，需处理）

### 问题 1（源码 Bug，已修复并验证）：看板日期区间筛选静默回退 30 天
- **现象**：前端看板页日期选择器选了具体区间（如 2026-08-01 ~ 2026-08-04），看板数据却仍是“近 30 天全量”，区间筛选不生效。
- **根因（静态确认）**：
  1. 前端 `kb-dashboard-tab.tsx:92,96` 用 antd `<Input type="date">`，其 `value` 为 `YYYY-MM-DD` 字符串。
  2. `getDashboard(f, t)` 经 `cleanParams({from, to})` **原样透传**，未做 ISO 转换。
  3. 后端 `OperationsController.parseInstant`（:168-183）仅兼容 ISO-8601（`2026-08-01T00:00:00Z`）与 epoch 毫秒。`"2026-08-04"` → `Instant.parse` 失败（无 `T`）→ `Long.parseLong` 失败（含短横）→ 返回 `null`。
  4. `stats(from=null, to=null)` 按 Javadoc（:96-97）缺省“回溯 30 天”，故静默全量统计。
- **影响范围**：T18 A-02b 的日期区间筛选子能力完全失效（用户无感知地看到错误数据）。
- **修复建议（任一即可，建议工程师定夺）**：
  - 前端方案：传参前将 `YYYY-MM-DD` 拼成 `YYYY-MM-DDT00:00:00Z`（to 端 +1 天 -1ms 或 `T23:59:59.999Z`）；或
  - 后端方案：在 `parseInstant` 增补“纯日期”分支（`DateTimeFormatter.ISO_LOCAL_DATE` → 当日 `T00:00:00Z`）。
  - 倾向后端放宽（与“多写十行换掉联调事故”的设计初衷一致，且对其它调用方同样受益）。
- **路由判定**：源码 Bug → 第 1 轮 **Send To: Engineer（software-engineer）**。
- **状态**：**已修复并验证**。工程师于本轮按“后端方案”实施：`parseInstant(String raw, boolean end)` 增补纯日期分支（`LocalDate.parse(text, ISO_LOCAL_DATE)`，`from`→当日 `00:00:00Z`、`to`→次日 `00:00` 减 1ns 含整天）；三调用点（listSessions/stats/export）同步改为 `parseInstant(from, false)` / `parseInstant(to, true)`；`LocalDate`/`ZoneOffset`/`DateTimeFormatter` 导入齐。QA 以 `clean test` 回归（wiped `target/` 后重编重跑）确认：mis-kb 11 例 + bff 15 例共 26 例相关单测全绿、0 失败，且 surefire 报告 elapsed 时间变化（如 `KbOperationsServiceStatsTest` 由 14.06s→6.15s）证明系修复后重新生成、非陈旧产物——即修复可编译、无回归。运行时真实 HTTP 回归（`from=2026-08-01&to=2026-08-04` 验证区间生效）仍属用户联调环境验收项（沙箱未跑真实 HTTP，见第八节项 3）。

### 问题 2（信息项，非阻塞）：Python retrieve.py 路径未命中
- 派工上下文引用 `agent/ai-platform/backend/src/agent/mis_rag/retrieve.py` 作为 F-04 引擎侧 `page`/`offset` 来源，实际路径不存在（目录结构不同）。
- 影响有限：主理人独立核验已确认实体列名 `chunk_offset`/`page_no`，前端 `QaCitationVO`/`normalizeSessionDetail` 键位已补齐且消费正确。仅作为来源追溯缺口记录，不阻塞放行。

---

## 五、已执行 vs 尚待执行（诚实断句分开）

### 已执行（本轮沙箱内真实跑过）
- 前端 `npm run typecheck`：执行并 exit 0，增量 5 文件无新增类型错误（复跑 `npx tsc --noEmit; echo TSC_EXIT_CODE=0` 确认）。
- Java 真实 Maven 构建：执行并 BUILD SUCCESS（MVN_EXIT=0），使用 JDK17.0.2 直接启动 classworlds launcher 绕过损坏的 `mvn` 命令；模块 mis-kb + mis-admin-bff + 依赖（含 mis-common-redis）共 29 例单测全部 0 失败（其中相关 26 例 = 22 既有 + 4 新增）。
- 新增 `KbOperationsServiceStatsTest` 4 例：执行并全绿，覆盖全指标聚合、空区间、无反馈仍计数命中、文档删除 title 留 null。
- 静态一致性复核：执行并核对 T15 抽屉受控 API、T17 KbDocumentTable 复用无重复、T18 前后端 21 字段镜像及五块图表渲染。
- 日期契约缺口：第 1 轮静态链路已逐跳确认（前端 date input → 透传 → parseInstant 失败 → 30 天回退）；第 2 轮工程师修复后，执行真实 `clean test` 回归构建（wiped `target/` 强制全量重编重跑），mis-kb 11 例 + bff 15 例共 26 例相关单测全绿、0 失败，且 surefire 报告 elapsed 时间变化证明系修复后重新生成（非陈旧产物）——增量 Java（含 `OperationsController` 2-arg `parseInstant`）可编译、无回归。

### 尚待执行（须用户在 JDK17 + Docker + PG 环境完成，我沙箱不具备）
- dev 栈 PG 启动后 mis-kb 自检：JPA 实体映射、真实库读写、统计 SQL 在真实 PG 上的行为（本轮零 @DataJpaTest/@SpringBootTest，JPA 映射层无运行验证门禁）。
- BFF↔mis-kb 联调：真实 HTTP 调用 `/operations/stats`，以及 Jackson 反序列化端到端（21 字段 Long↔primitive 兼容性仅静态判定，未跑真实响应）。
- 日期契约缺口修复后回归：问题 1 修复后，在联调环境用真实日期区间验证筛选生效（沙箱仅静态确认，未跑运行时）。
- Python retrieve.py 来源追溯：若需闭环 F-04 引擎侧 `page`/`offset` 产生逻辑，需在 agent 仓库另寻正确路径（非本仓库阻塞项）。

---

## 六、测试通过率与智能路由判定

### 测试通过率
| 套件 | 用例数 | 通过 | 失败 | 跳过 |
|------|--------|------|------|------|
| 前端 typecheck（tsc --noEmit） | — | 通过 | 0 错误 | — |
| mis-admin-bff（AiCapabilityTranslatorTest 5 + DagBuilderTest 10） | 15 | 15 | 0 | 0 |
| mis-kb（KbVisibilityServiceTest 7 + 新增 KbOperationsServiceStatsTest 4） | 11 | 11 | 0 | 0 |
| mis-common-redis（依赖，TokenBlacklistServiceTest 3） | 3 | 3 | 0 | 0 |
| **合计** | **29** | **29** | **0** | **0** |

- 既有 22 例：不回归（全绿）。
- 新增 4 例（KbOperationsServiceStatsTest）：全绿，验证 `stats` 聚合口径正确。
- 既有前端 13 处技术债：本轮未触碰（按派工要求不动）。

### 智能路由判定
- 测试代码（含新增 KbOperationsServiceStatsTest）：**全绿，无测试代码 Bug** → 无需 QA 自修轮。
- 源码 Bug：**问题 1（日期筛选契约缺口）** → 第 1 轮 **Send To: Engineer（software-engineer）**；工程师按后端方案修复后，第 2 轮 QA 以 `clean test` 回归验证（26 例全绿、0 失败）→ **NoOne**（修复正确、无回归）。
- 整体门禁（typecheck / 编译 / 单测 / 静态镜像）：**通过** → 无额外路由。
- 轮次：第 1 轮发现源码 Bug（路由工程师）+ 得出编译/单测/镜像确定结论；第 2 轮工程师修复后回归绿，结束测试循环（符合“最多 2 轮”纪律）。

---

## 七、修订记录（对既有事实记载的更正）

- **更正 P0 报告“沙箱仅 JDK1.8”结论**：本轮实测确认 `D:\software\jdk-17.0.2` 真实存在且在 `C:\Users\13961\.m2\toolchains.xml` 注册，可直接用于编译测试；并实际跑通了完整 Maven 构建（29 例全绿）。P0 报告称“沙箱仅 JDK1.8、Java 编译非 QA 亲自执行”为过时/失真记载，以本报告指出为准。
- **更正“mvn 命令不可用即无法构建”**：实测 `mvn` 因 MAVEN_HOME/JAVA_HOME 配置损坏直接调用失败，但可用 JDK17 直接启动 classworlds launcher 绕过（命令见附录 A），构建全程成功。属工具链调用方式问题，非环境缺失。
- 其余 P0 报告关于“前端无 vitest/jest、唯一门禁为 typecheck、Java 零集成测试”的能力边界判断仍成立。

---

## 七-B、缺陷修复与回归追加记录（第 2 轮）

- **T18 日期筛选缺陷已修复并回归验证**：工程师寇豆码按后端方案修复 `OperationsController.parseInstant(String, boolean)`（纯日期分支含整天，三调用点同步改签名）。QA 以 `clean test`（wiped `target/` 后重编重跑）回归确认 mis-kb 11 例 + bff 15 例共 26 例相关单测全绿、0 失败，surefire 报告 elapsed 变化（`KbOperationsServiceStatsTest` 14.06s→6.15s）证明非陈旧产物。
- **IS_PASS 升级**：由第 1 轮 `NO（有条件）` 升级为 `YES（有条件：运行时联调仍待用户环境验收）`。修复经编译 + 单测门禁验证；仅剩 JPA/联调/日期筛选真实 HTTP 属沙箱不可达项。

---

## 八、待用户环境验收项清单（精确命令）

1. **启动 dev 栈 PG 并跑 mis-kb 自检**
   ```bash
   # 在 Docker 桌面已启动前提下
   docker compose -f backend/docker-compose.yml up -d pg   # 或项目约定的 PG 启动方式
   cd backend && ./mvnw -pl mis-kb -am test   # 或本地等效 mvn 调用（JDK17）
   # 目标：确认 JPA 映射在真实 PG 上无报错、统计查询可执行
   ```

2. **BFF↔mis-kb 联调（Jackson 21 字段端到端）**
   ```bash
   # 先后启动 mis-kb 与 mis-admin-bff（dev profile，连 PG）
   # 用浏览器/Postman 调 BFF：
   GET http://localhost:<bff-port>/operations/stats?from=2026-08-01T00:00:00Z&to=2026-08-04T23:59:59Z
   # 目标：确认 BFF 正确透传、mis-kb 返回 21 字段、Jackson 反序列化无静默 null
   ```

3. **日期筛选运行时回归（对应问题 1，修复已通过编译+单测验证）**
   ```bash
   # 修复已通过 clean test 回归（编译+单测绿）；此处验证真实 HTTP 行为：
   GET http://localhost:<bff-port>/operations/stats?from=2026-08-01&to=2026-08-04
   # 目标：返回区间精确统计（[08-01 00:00, 08-04 23:59:59.999…]），而非近 30 天全量
   ```

4. **（可选）前端 date input 联调**
   - 在 mis-admin-web 看板页选择具体日期区间，核对网络请求 `from/to` 实际值及返回数据是否按区间收窄。

---

## 九、附录

### A. 沙箱内可用的 Maven 调用方式（JDK17 + 绕过损坏的 mvn）
```bash
cd "D:/code/mis-platform/backend"
"/d/software/jdk-17.0.2/bin/java" \
  -cp "D:\software\apache-maven-3.9.16\boot\plexus-classworlds-2.11.0.jar" \
  -Dclassworlds.conf="D:\software\apache-maven-3.9.16\bin\m2.conf" \
  -Dmaven.home="D:\software\apache-maven-3.9.16" \
  -Dmaven.multiModuleProjectDirectory="D:\code\mis-platform\backend" \
  -Dfile.encoding=UTF-8 \
  org.codehaus.plexus.classworlds.launcher.Launcher \
  -pl mis-kb,mis-admin-bff -am test
```
构建结果（第 1 轮）：BUILD SUCCESS，MVN_EXIT=0，29 例单测全绿（相关 26 例 + 依赖 3 例）。

### A-2. 回归构建（第 2 轮，验证缺陷修复）
```bash
# 同上命令，但加 clean 强制全量重编重跑，排除陈旧产物干扰：
org.codehaus.plexus.classworlds.launcher.Launcher -pl mis-kb,mis-admin-bff -am clean test
```
构建结果（第 2 轮）：`clean` wiped `target/` 后重编重跑，mis-kb 11 例 + bff 15 例共 26 例相关单测全绿、0 失败（surefire 报告 elapsed 变化证明系修复后重新生成，非第 1 轮陈旧产物）。增量 Java（含 `OperationsController` 2-arg `parseInstant`）可编译、无回归。

### B. 新增测试文件
- `backend/mis-kb/src/test/java/com/mis/kb/domain/service/KbOperationsServiceStatsTest.java`
  - 用例：`stats_aggregatesAllMetrics` / `stats_emptyRange_returnsZeroMetricsButKeepsTicketCounts` / `stats_sessionsWithoutFeedback_stillCountsLibraryHits` / `stats_deletedDocument_leavesTitleNull`
  - 特性：纯 Mockito，不启 Spring、不连库；覆盖聚合口径、空区间、无反馈计数、文档删除留 null。

### C. 协同产物索引
- P0 QA 报告：`deliverables/software-company/kb-qa-report-2026-08-03.md`
- 增量 PRD：`deliverables/software-company/kb-incremental-prd-2026-08-03.md`
- 主理人独立核验结论（BFF/mis-kb KbDashboardVO 21 字段逐一同名、@radix-ui/react-dialog 依赖真实存在、KbOperationsService 无手工 new）：已纳入本复核。
