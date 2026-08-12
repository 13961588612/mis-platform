# MIS 知识库 Wave B GraphRAG PoC —— QA 独立验收报告

- **QA**：严过关（software-qa-engineer）
- **日期**：2026-08-12
- **被测交付**：Wave B GraphRAG PoC（T01~T04，工程师寇豆码交付）
- **验收依据**：
  - `docs/backend/mis-kb-wave-b-graphrag-design-2026-08-11.md`（施工/验收唯一标准，542 行）
  - `docs/backend/mis-kb-wave-b-graphrag-class.mermaid` / `mis-kb-wave-b-graphrag-seq.mermaid`
  - `docs/backend/ragflow-graphrag-probe-2026-08-11.md`（T00 实测契约）
  - `docs/backend/knowledge-base-phase2-plan.md` §6（Wave B 范围与门禁）
  - `deliverables/software-company/mis-kb-wave-b-golden-report-2026-08-11.md`（工程师自述，已独立核实）
  - `AGENTS.md`（仓库纪律）

> 本次验收为**独立执行**，不轻信工程师自述：全量回归由 QA 重新跑通（工程师标注「待执行」），
> 设计验收点逐项读码核查，金标前置逐项实测。

---

## 0. 结论速览（路由判定）

| 项 | 结果 |
|---|---|
| **全量回归** | ✅ mis-kb **430 例全绿**（0 失败/0 错误/0 跳过，100 类）；mis-admin-bff **250 例全绿**（剔除陈旧报告后）；前端 typecheck **EXIT=0 零错误** |
| **设计验收点（10 项）** | ✅ 全部通过（逐项见 §3） |
| **边界与反例** | ✅ 全部通过（逐项见 §4） |
| **金标 A/B 实测** | ⏳ **待联调**：前置不满足（运维库仍归档、图未建、百货收银无文档、无运行中 mis-kb 服务）；如实记录，不影响代码侧验收结论 |
| **路由判定** | **NoOne** —— 未发现源码 Bug，未发现测试代码 Bug；全部通过 |
| **遗留问题** | 3 项非阻塞（金标报告计数口径误差、apiKey 表述校正、BFF 陈旧 surefire 报告残留），见 §6 |

---

## 1. 全量回归（本次核心：工程师未跑，QA 重新跑通）

执行方式：JDK17 直启 Maven classworlds（`D:/software/jdk-17.0.2` + `apache-maven-3.9.16`，offline 模式），
命令 `mvn -o -pl <模块> -am test`（本地仓库无 mis 构件，必须带 `-am` 走 reactor）。

### 1.1 mis-kb

- 命令：`mvn -o -pl mis-kb -am test`（后台执行，日志 `backend/qa-wb-miskb-test.log`）
- 结果：**BUILD SUCCESS**，surefire XML 逐类加总（100 个 TEST-*.xml）：

```
TOTAL: tests=430 failures=0 errors=0 skipped=0
```

- 与「基线 397 + 新增 ≈34」核对：**430 ≥ 430 ✓**（新增实际 33 例，见下；与金标报告自述 34 有 1 例口径差，非代码缺陷）
- Wave B 新增 4 测试类（surefire 实测计数）：

| 测试类 | 实测 | 金标自述 | 备注 |
|---|---|---|---|
| `RfSearchChunkTest` | **9** | 9 | ✅ 一致 |
| `RetrieveQueryGraphDegradeTest` | **7** | 8 | 自述多 1 |
| `KbGraphServiceTest` | **10** | 9 | 自述少 1 |
| `RagflowClientSearchDatasetContractTest` | **7** | 8 | 自述多 1 |
| **合计** | **33** | 34 | 文档口径误差（见 §6.1） |

### 1.2 mis-admin-bff

- 命令：`mvn -o -pl mis-admin-bff -am test`（后台执行，日志 `backend/qa-wb-bff-test.log`）
- **剔除陈旧报告**：`target/surefire-reports/TEST-...OperLogAspectSensitiveKeyTest$KnownBlindSpots.xml`
  时间戳 **2026-08-11 16:31**（改写前旧运行残留，claim 42 tests —— 即块① QA 已知的「42 假象」），
  不属于本次运行。本次运行生成的 `TEST-...OperLogAspectSensitiveKeyTest.xml`（08-12 08:43）为 61 例全绿。
- 结果（仅计本次运行的新鲜报告）：**BUILD SUCCESS**，**tests=250 failures=0 errors=0 skipped=0**
- 与「真实基线 250」核对：**250 = 250 ✓**；含陈旧报告才 292（42 假象混入），已剔除。

### 1.3 前端

- 命令：`cd frontend/mis-admin-web && npm run typecheck`（tsc --noEmit）
- 结果：**EXIT=0，零错误** ✅（门禁 §10-14 达标）

### 1.4 全量回归数字汇总

| 模块 | Tests run | Failures | Errors | Skipped | 门禁 |
|---|---|---|---|---|---|
| mis-kb | **430** | 0 | 0 | 0 | ✅ 应 ≈430+ |
| mis-admin-bff（新鲜报告） | **250** | 0 | 0 | 0 | ✅ 真实基线 250 |
| 前端 typecheck | — | 0 错误 | EXIT=0 | — | ✅ |

---

## 2. 金标报告自述核实（工程师 §3/§4 声明 vs QA 实测）

| 自述 | QA 独立核实 | 结论 |
|---|---|---|
| 代码 47 文件落盘 | git status 48 个 Wave B 相关文件（+1 个 .workbuddy memory 不计） | 口径接近 ✅ |
| 新增 4 测试类 34 例已跑全绿 | 4 类实测 **33 例**全绿（7/10/7/9） | 类数 ✅ / 计数小误差 |
| 编译 + 前端 typecheck 已过 | typecheck EXIT=0 ✅；编译由全量回归隐式验证 ✅ | ✅ |
| 全量回归未跑 | **QA 已跑通**：mis-kb 430 + BFF 250 + typecheck 0 错 | ✅（本次补齐） |
| 金标 A/B 缺引擎 apiKey/DB 写权限未实测 | apiKey **实际可从 `.env.integration` 取**（gitignored）；DB 可连（只读）；真正阻塞 = 运维库仍归档 + 无运行中 mis-kb 服务 + 百货收银 0 文档 | 自述原因不精确（见 §6.2） |
| 诚实标注「待执行」 | 属实 | ✅ |

---

## 3. 设计验收点逐项读码核查（非仅测试通过）

| # | 验收点 | 核查方法 | 结论 |
|---|---|---|---|
| 1 | **能力码** | `EngineCapabilities.CAP_GRAPH="graphrag"` 集中定义（第 90 行），禁硬编码；`of(...)` 8 参重载第 8 位 graph；`RagflowAdapter.capabilities()` 返回 `of(rerank,true,true,true,delete,false,false,true)` → **graphSupported=true**；`MockAdapter` 走 7 参 `of(...)` → graph=false；`NoopAdapter` → `unsupported()` 全 false | ✅ |
| 2 | **RagSettings 三字段** | `useKnowledgeGraph`(默认 false)/`kgBuildStatus`(四态)/`kgBuildMessage`(≤200) **末位追加**（record 17 参 canonical 第 15~17 位）；`defaults()` 含三字段默认；`withDefaults()` 兜底 null→false / `normalizeKgBuildStatus` 四态白名单；**零 DDL**（进 rag_settings_json） | ✅ |
| 3 | **V31 迁移** | `sys_api` 仅登记 2 端点：POST `/libraries/{id}/graph/build`（91123/00900039/91223→91044 kb:library:edit）、GET `/libraries/{id}/graph/build-status`（91124/00900040/91224→91056 kb:library:engine-ref:view）；一码一菜单（module_id+code NOT EXISTS + menu_api pair NOT EXISTS）；`uk_api_method_path` 无重复（method+path NOT EXISTS）；引用菜单 91044（V14）、91056（V26）**真实存在**；幂等（固定 ID + ON CONFLICT 语义）；V30 末段 91122 衔接无冲突 | ✅ |
| 4 | **R2 契约（最高风险）** | `RagflowClientSearchDatasetContractTest` 7 例用 JDK HttpServer + 真实 RestClient 对**线上字节**硬断言：`useKnowledgeGraph=true` → `POST /api/v1/datasets/{id}/search` + `use_kg:true` + 不含 `dataset_ids`；`rerank_mdl`（非 rerank_id）；响应字段映射。**grep 全仓**：`use_kg` 仅出现在 `/datasets/{id}/search` 请求体（`RagflowClient.searchDataset` L802），经典 `retrieve`（`/api/v1/retrieval`）**无 use_kg** | ✅ |
| 5 | **构图链路** | `KbGraphService`：上限 `KB_GRAPH_LIBRARY_LIMIT`（`RagflowProperties.graphMaxLibraries` 默认 2，`effectiveGraphMaxLibraries()` 下限 1）；`building` 拒重复触发 `KB_GRAPH_BUILD_IN_PROGRESS`；状态机 `none/failed 可重试、ready 清 message、NONE 保留本地（R6）`；停用/归档库不占额度（只统计 status=enabled 且开关为真）；`RagflowClient.INDEX_TYPE_GRAPH="graph"`（禁 graphrag，`index?type=` 拼接常量）；`updateDatasetSettings` 仅开关为真时下发 `parser_config.graphrag{use_graphrag:true, method:light}` | ✅ |
| 6 | **S4.5 降级** | `RetrieveQueryResolver` 三道防线（L287~310）：能力 false →「当前引擎不支持知识图谱增强」；多库 →「图谱增强仅支持单库检索，已回落混合检索」；`kgBuildStatus!=ready` →「图谱未构建完成（当前状态：…），已回落混合检索」。**Resolver 铁律**：服务层无内联判断（`KbHitTestService` 仅 `withGraphOverride` 内存覆写，不落库）。**多库降级闸门缺陷已修**（L293~296：多库时任一被检索库开图即置请求信号 → 由单库闸门显式降级并回显原因，不静默） | ✅ |
| 7 | **doc_ids 过滤** | 空集**不下发键**（`searchDataset` L812 仅非空才 `body.put("doc_ids",...)`，R5 同款）；不存在 doc → `resolveDocumentIds` **MIS 侧先行过滤**（只下发本次库内 + enabled=1 + 有引擎映射的文档），引擎侧软过滤 code:0；与 `use_kg` 同请求体共存（契约测试锁定） | ✅ |
| 8 | **RfSearchChunk 剥离** | 正则 `</?(?:weight|sep)[^>]*>`（`/?:` 吸收闭标签斜杠，`[^>]*` 吸收自闭合/属性）；`RfSearchChunkTest` 9 例覆盖单/多/嵌套/自闭合/纯标记/null/空白归一/字段映射 | ✅ |
| 9 | **ACL 红线** | 构图 = BFF `kb:library:edit`（V31 91123→91044）+ `KbGraphService.build` 内 `NodeAdminResolver.hasLibraryManage` 双闸门 + 库 enabled + 有引擎映射 + 文档非空；检索沿用 `KbVisibilityService`（`KbRetrieveService` L101-102、`KbHitTestService` L115 均未改动 ACL）；**grep 全仓无任何 `GET /datasets/{id}/graph` 代理端点**（Java/TS 均无匹配）；apiKey 仅服务端 `.env.integration`（gitignored），前端 features/kb 无引用 | ✅ |
| 10 | **错误码/前端** | `KbResultCode`：KB_GRAPH_UNSUPPORTED 40950 / KB_GRAPH_LIBRARY_LIMIT 40951 / KB_GRAPH_BUILD_IN_PROGRESS 40952 / KB_GRAPH_NOT_READY 40953；前端 types.ts 三字段+KbGraphStatus+KbGraphBuildResult+graphSupported（末位追加）、kb-api buildGraph/graphBuildStatus + hitTest enableGraph 三态透传、库详情页 3s 轮询+防连点+状态徽标+开关置灰、命中测试页三态开关+生效回显+降级原因、kb-library-page 保留图谱开关防误关 | ✅ |

---

## 4. 边界与反例（try to break it）

| # | 反例 | 验证方式 | 结论 |
|---|---|---|---|
| 1 | 多库检索遇 `useKnowledgeGraph=true` → 真降级 + 中文 reason（不静默、不发多库 /search） | `RetrieveQueryGraphDegradeTest.degradeWhenMultiLibrary` + 代码走查 S4.5 多库闸门（含任一库开图的信号修正） | ✅ |
| 2 | `building` 态重复触发构图 → 拒绝；并发/重复点击防护 | `KbGraphServiceTest.buildRejectedWhenAlreadyBuilding`（verify never buildGraph）；前端按钮 in-flight 防连点 + 后端状态机双保险 | ✅ |
| 3 | 上限 2 库：第 3 库开图 → `KB_GRAPH_LIBRARY_LIMIT` | `KbGraphServiceTest.canEnableGraphRejectsAtLimit`（错误 message 带上限值 2）；`canEnableGraphIgnoresDisabledLibraries`（停用不占额度） | ✅ |
| 4 | doc_ids 含不存在 id → MIS 先行过滤（防引擎拒单）；空选择行为 | `resolveDocumentIds` 只下发库内 enabled 有映射文档；`RagflowClientSearchDatasetContractTest.docIdsOnlyWhenPresent`（空 = 不下发键 = 全量） | ✅ |
| 5 | `kgBuildStatus=ready` 后切 `useKnowledgeGraph=false` → 检索回落 /retrieval 零回归 | `RagflowClientSearchDatasetContractTest.adapterBranchesByGraphFlag`（false → `/api/v1/retrieval`）；`RetrieveQueryGraphDegradeTest.graphOffIsNoOp` | ✅ |
| 6 | RfSearchChunk null/纯标记/畸形输入不炸 | `RfSearchChunkTest`（null→空串、纯标记→空串、嵌套/自闭合/无属性全部剥离） | ✅ |

---

## 5. 金标 A/B 实测（尽力而为）

### 5.1 前置核查（QA 实测，2026-08-12）

| 前置项 | 实测结果 | 状态 |
|---|---|---|
| DB 连通（psycopg2 → 10.254.16.6:5432/mis_platform，mis/mis123） | ✅ 可连（PostgreSQL 16.14） | — |
| 运维库 1786339952827 归档状态 | **status=0（仍归档）**；引擎 dataset 66e5a448…（1 doc / 7 chunks / use_graphrag=true / method=light，构图未建 `GET index?type=graph → {}`） | ❌ **未取消归档** |
| 百货收银 1786439846183 文档数 | **kb_document 0 条**；引擎 dataset 76f53a3e…（0 doc / 0 chunks / use_graphrag=true） | ❌ **无文档** |
| 引擎 apiKey | `.env.integration` 存在 `MIS_KB_ENGINE_API_KEY`（gitignored，服务端持有）；RAGFlow 10.254.16.6:9380 **可达**（401 需鉴权，带 key 可读） | ✅ 可取 |
| 运行中的 mis-kb 服务 | 本环境无运行服务（金标报告 §2.1 前置 3） | ❌ |
| 图谱构建 ready | 运维库图未建（`{}`），未达 ready（前置 4） | ❌ |

### 5.2 结论

- 金标 A/B（12 条 × 2 组）**无法按规范执行** → 标记 **「待联调」**，不影响代码侧验收结论。
- 未采取「绕过 MIS 直接 curl 引擎构图」的替代方案，理由：①运维库 MIS 侧仍归档，直接引擎构图会绕过 MIS 状态机与上限闸门，不测试交付物本体；②构图消耗 LLM tokens（R4 资源敏感）；③金标报告 §2.2 规定执行方式为「命中测试」两轮，需运行中服务。
- 联调缺口清单（满足后可执行）：
  1. 运维库取消归档（DB 写 `kb_library.status=1`，或走归档恢复接口）；
  2. 百货收银上传真实业务文档并等解析 DONE；
  3. 启动 mis-kb（注入 `MIS_KB_ENGINE_API_KEY`）；
  4. 保存 `useKnowledgeGraph=true` 自动构图 → 轮询 `kgBuildStatus=ready` → 按 §2.3/§2.5 执行 12×2 组，回填模板，按硬指标 ≥60% + 软指标 ≤2× 给门禁裁决。

---

## 6. 遗留问题（均非阻塞）

1. **金标报告新增测试计数口径误差**（`deliverables/.../mis-kb-wave-b-golden-report-2026-08-11.md` §3.1）：
   自述「4 类 34 例（9/8/9/8）」，QA surefire 实测「4 类 33 例（9/7/10/7）」。类全部存在且全绿，
   仅各测试类内部数量自述不精确。建议工程师在联调阶段顺手修正报告（非源码缺陷，不路由）。
2. **金标报告 §2.1「本会话无引擎 apiKey」表述不准确**：apiKey 实际在 `.env.integration`（gitignored）可取，
   RAGFlow 可达。真正阻塞是运维库未取消归档 + 无运行中服务 + 百货收银无文档。属自述原因不精确，已在上表纠正。
3. **BFF 陈旧 surefire 报告残留**：`mis-admin-bff/target/surefire-reports/` 留有 08-11 16:31 的
   `KnownBlindSpots.xml`（42 例假象），本次用新鲜报告口径加总（250）。建议后续回归命令带 `clean`，
   或脚本化剔除按 mtime 过滤，避免再次污染统计。

---

## 7. 路由判定

**Send To: NoOne**（全部通过）

- 源码无 Bug：设计验收点 10 项 + 边界反例 6 项全部通过；全量回归 mis-kb 430 / BFF 250 / typecheck 0 错。
- 测试代码无 Bug：4 个新增测试类断言正确（与设计/T00 契约一致），全部通过；既有测试适配正确。
- 金标 A/B 未实测系环境前置不满足（运维库归档等），**不影响代码侧验收结论**；Wave C 放行须待联调后
  金标门禁（硬 ≥60% + 软 ≤2×）通过，与工程师报告口径一致。

*QA 验收人：严过关 | 2026-08-12*
