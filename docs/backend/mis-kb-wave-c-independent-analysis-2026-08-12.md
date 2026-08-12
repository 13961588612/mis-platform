# MIS 知识库 Wave C（RAPTOR/TOC）脱离 Wave B 门禁独立开发 — 可行性评审 + 配置参数缺口分析

- **作者**：高见远（软件架构师）
- **日期**：2026-08-12
- **状态**：评审报告（待主理人复核待拍板事项）
- **2026-08-12 T00 实测后修订**：参数口径按 [`ragflow-raptor-probe-2026-08-12.md`](ragflow-raptor-probe-2026-08-12.md) 收口（§2.0 参数表 / §1.4 条件清单 / §3 落地建议已更新）；门禁文案修订见 phase2-plan §7 与 app-plan §8（U2 拍板）
- **上游文档**：
  - `docs/backend/knowledge-base-app-plan.md` §8（二期扩展表，C 条件启动）
  - `docs/backend/knowledge-base-phase2-plan.md` §7（Wave C 条件启动）+ §6.3（门禁）+ §4.1/4.2（能力码与字段矩阵）
  - `docs/backend/mis-kb-wave-b-graphrag-design-2026-08-11.md`（Wave B 技术设计，已实现）
  - `docs/backend/ragflow-graphrag-probe-2026-08-11.md`（Wave B T00 探测记录）
- **代码基线**（2026-08-12 实况核实）：
  - `backend/mis-kb/src/main/java/com/mis/kb/domain/model/RagSettings.java`（17 字段 record）
  - `backend/mis-kb/src/main/java/com/mis/kb/domain/model/EngineCapabilities.java`（能力码）
  - `backend/mis-kb/src/main/java/com/mis/kb/engine/RagflowClient.java`（建库期白名单 / 检索期）
  - `backend/mis-kb/src/main/java/com/mis/kb/engine/RagflowAdapter.java` / `RagflowProperties.java`
  - `backend/mis-kb/src/main/java/com/mis/kb/domain/model/DocumentChunkConfig.java`（切片校验常量）
- **外部依据**：RAGFlow 官方文档 `ragflow.io/docs/enable_raptor`（Web 核实，注意文档对应版本为 v0.6.0，与部署实例 v0.26.4 存在版本差异）

---

## 0. 结论摘要（TL;DR）

| 问题 | 结论 |
|---|---|
| Wave C 能否脱离 Wave B 门禁单独开发？ | **可以（已确认）**。代码开发与 Wave B 金标门禁零依赖；T00 实测已闭环引擎契约（C1/C2），剩余条件 = RAPTOR 自身金标验收（C3）+ 排期资源建议（C4，见 §1.4） |
| 五维解耦结论 | 能力码=可解耦 / RagSettings 字段=可解耦 / 检索链路=**已消解**（T00 P3a/P3b 实测） / 构建任务=**已闭环**（T00 P2c 实测不互斥可并行） / 前端开关=可解耦 |
| 是否需要修订 phase2-plan §7 门禁文案 | **建议修订**，把「仅 B 达标后」改为「Wave C 可独立启动，门禁 = RAPTOR 自身金标/试点库验收 + 共享引擎契约 T00 实测」 |
| RAPTOR 参数缺口 | 需新增 7~8 个库级字段 + 5~6 个全局配置项（零 DDL，追加末位）；`raptorMaxTokenNum` 经 T00 实测收口为 **[512, 2048]、默认 1024**（用户原期望 4096 超引擎上限被拒，见 §2.0） |
| 风险等级 | 整体中低；最高风险 = 引擎版本差异（官方文档 v0.6.0 vs 部署 v0.26.4）与 LLM token 成本 |

---

## 第 1 部分：Wave C 脱离 Wave B 的可行性结论

### 1.1 现状限制（引用规划原文）

Wave C 当前被「仅 B 达标后」门禁绑定，原文证据：

1. **主规划** `knowledge-base-app-plan.md` §8 二期扩展表：
   > | C 条件启动 | RAPTOR / TOC 等 | **仅 B 达标后** |
2. **二期规划** `knowledge-base-phase2-plan.md` §7 标题：
   > ## 7. Wave C — 条件启动（仅 Wave B 达标后）
3. **二期规划** `knowledge-base-phase2-plan.md` §6.3 门禁：
   > **不达标 → 不进 Wave C，不全量打开 Graph。**

**挂起风险分析**：Wave B 金标实测仍待联调（前置：运维库 1786339952827 取消归档 + 百货收银 1786439846183 补文档 + mis-kb 服务注入 apiKey）。若 Wave C 启动**硬绑**在 Wave B 金标达标上，则：
- Wave B 金标是「多跳/关系型问答」评测，依赖真实业务文档与真实引擎构图，前置条件多、排期不可控；
- Wave C（RAPTOR 长手册/长 PDF）业务价值独立，与 GraphRAG 解决的问题域不同（长文档层次摘要 vs 实体关系多跳）；
- 单一门禁串行会形成**非必要的长阻塞**，且把「Wave B 达标」与「Wave C 值得做」两个无关命题绑死。

### 1.2 五维解耦分析

#### 维度 1：引擎能力码 — ✅ 可解耦

| 核查点 | 实况（代码核实） | 结论 |
|---|---|---|
| 码值是否独立声明 | `EngineCapabilities` 码值集中定义：`CAP_HYBRID`/`CAP_RERANK`/`CAP_METADATA_FILTER`/`CAP_REPLACE`/`CAP_DELETE`/`CAP_PARSER_OCR`/`CAP_PARSER_OVERLAP`/`CAP_GRAPH="graphrag"`。`supports(capability)` 按 list contains 判定，互不依赖 | 独立 |
| raptor/toc 码是否存在 | **⚠️ 实测修正**：当前代码**尚无** `CAP_RAPTOR`/`CAP_TOC_ENHANCE`（phase2-plan §4.1 表已规划「条件」，但未落地）。`synonym` 能力码同样未进代码。即 Wave C 需要**新增**两个能力码 | 新增即可，且新增不触碰 `graphrag` 位 |
| 声明是否独立 | `RagflowAdapter.capabilities()` 用 `EngineCapabilities.of(...)` 逐位传参构造；`raptorSupported=true` 不需要 `graphSupported=true` | 独立 |
| 降级是否独立 | 能力翻转（如 `raptor` 翻 false）只走 RAPTOR 三道防线（前端置灰 + 保存强制关 + 检索降级），不影响 `graphrag` | 独立 |

**共享文件耦合点（非业务耦合）**：`EngineCapabilities` 是 record，新增布尔位必须**追加末位**并扩展 `of(...)` 重载——与 Wave B 新增 `graphSupported` 同款模式，属代码文件级共享，不是业务依赖。

#### 维度 2：RagSettings 字段 — ✅ 可解耦

| 核查点 | 实况（代码核实） | 结论 |
|---|---|---|
| 存储形态 | `RagSettings` 整体序列化进 `kb_library.rag_settings_json`（TEXT），**零 DDL**；`KbJson` 已关闭 `FAIL_ON_UNKNOWN_PROPERTIES` | 独立追加 |
| 追加铁律 | record 位置参数，新字段一律追加末位（现末位 = `kgBuildMessage`）；兼容构造（11/14 参）保持旧调用点零改动 | 独立追加 |
| 默认值兜底 | `withDefaults()` 对 null 逐字段兜底；存量 JSON 读出 null 自动补齐 | 独立追加 |
| 与图谱字段依赖 | `useRaptor`/`raptorMaxTokenNum` 等与 `useKnowledgeGraph`/`kgBuildStatus` 无字段级依赖，可共存 | 无依赖 |
| 校验复用 | `chunkTokenNum` 校验区间 `[256, 4096]`（`DocumentChunkConfig.MIN/MAX_TOKEN_NUM`）可为 `raptorMaxTokenNum` 提供常量参考，但**语义不同**（切片 vs 摘要 chunk），建议独立常量 | 可复用模式、不共用字段 |

#### 维度 3：检索链路 — ✅ 已消解（T00 P3a/P3b 实测）

| 核查点 | 实况（代码核实 + T00 实测 2026-08-12） | 结论 |
|---|---|---|
| Wave B 图谱检索 | 必须走 `POST /datasets/{id}/search` + `use_kg:true`；`/api/v1/retrieval` 静默忽略 use_kg（T00 G5 实测陷阱） | — |
| RAPTOR 检索机制 | 官方文档：RAPTOR 是**解析期建树**（`parser_config.raptor.use_raptor` + Generate 构建），生成后「chat assistant 和 Retrieval 组件会默认使用 RAPTOR 树」——即检索期**原则上不需要** use_kg 这类增强开关字段，融合是引擎内部行为 | 与 Wave B 检索参数无共享 |
| 潜在耦合点 ① | **已实测（P3a）**：建树后经典 `/api/v1/retrieval` **自动融合 RAPTOR 摘要、零专属参数**——与 Wave B **完全零共享**（互不干扰） | ✅ 已消解 |
| 潜在耦合点 ② | **已实测（P3b）**：`/datasets/{id}/search` + `use_kg:true` + `doc_ids` 与 RAPTOR **同请求体共存 code:0**（同时返回摘要 + 普通 chunks）——端点共享无冲突 | ✅ 已消解 |
| 单库/多库限制 | **已实测（P3c）**：多库 `/datasets/search` 仍受「多库 embedding 一致性」限制（code:102，与 Wave B G8 一致）；单库无此限制。RAPTOR 不改变该限制 | 沿用 Wave B 降级策略 |

**结论**：检索链路耦合点**已全部消解**（T00 P3a/P3b/P3c）——RAPTOR 走经典 `/retrieval` 自动融合（零回归），`/datasets/search` + use_kg 与 RAPTOR 可共存；T03 简化为纯 MIS 侧（无需改检索请求体）。

#### 维度 4：构图/构建任务队列 — ✅ 已闭环（T00 P2a/P2b/P2c 实测）

| 核查点 | 实况（代码核实 + T00 实测 2026-08-12） | 结论 |
|---|---|---|
| Wave B 构建入口 | `POST /datasets/{id}/index?type=graph`；状态 `GET /datasets/{id}/index?type=graph`；type 传 `graphrag` → code:102 拒绝 | — |
| RAPTOR 构建入口 | **已实测（P2a）**：`POST /datasets/{id}/index?type=raptor` → code:0 返回 `task_id`，与 graph 完全同构（T00 G2 错误信息已证 `raptor` 为合法 type） | 独立 type |
| 状态查询 | **已实测（P2b）**：`GET /datasets/{id}/index?type=raptor` → task dict（progress 1.0=完成 / -1=失败 / 其他=构建中、task_type="raptor"、process_duration）与 graph 完全同构；dataset 级 `raptor_task_id`/`raptor_task_finish_at` 佐证 | 独立状态 |
| 任务队列是否共享 | 同一端点体系 `/datasets/{id}/index`，type 参数不同 → 引擎内部任务类型不同（`graphrag` vs `raptor`） | 部分共享（端点） |
| 互斥性 | **已实测（P2c）**：**graph/raptor 构建任务不互斥、可并行**（双向实测通过，各自 task_id/finish_at 互不覆盖）；重复触发 raptor 幂等跳过（`already has raptor RAPTOR chunks, skipping`） | ✅ 已消解 |
| MIS 侧状态机 | `kgBuildStatus` 四态（none/building/ready/failed）模式可完全复制为 `raptorBuildStatus`，**互不阻塞** | 独立 |

**结论**：MIS 侧构建链路（状态机、触发服务、回写）完全独立；引擎 `/datasets/{id}/index` 端点体系共享但 type 隔离，**无互斥拦截需求**——仅剩 LLM token/显存竞争作为排期资源建议（C4 降级）。

#### 维度 5：前端开关与能力置灰 — ✅ 可解耦

| 核查点 | 实况（代码核实） | 结论 |
|---|---|---|
| 置灰逻辑 | 前端按 `capabilities()` 显隐/置灰，`capabilities` 含码值列表 | 独立（新增码值即可） |
| 图谱区 | 库详情页已实现「开关 + 状态徽标 + 构建按钮 + 3s 轮询」 | 模式可复用 |
| RAPTOR 区 | 新增独立开关 + 独立 `raptorBuildStatus` 徽标 + 独立构建按钮，不共享图谱状态 | 独立 |

**结论**：前端完全可解耦——复用 Wave B 已验证的交互模式（开关/徽标/轮询），但状态、能力码、文案全部独立。

### 1.3 结论：Wave C 能否脱离 Wave B 限制单独开发？

**总体结论：可以，但有条件。**

**技术依据**（全部来自代码/文档核实）：
1. 能力码 `raptor`/`toc_enhance` 独立声明、独立降级，与 `graphrag` 零业务依赖；
2. RagSettings 字段零 DDL 独立追加（`rag_settings_json` + `withDefaults` 兜底，存量兼容已验证两轮：Wave A/企业级/Graph 均同款）；
3. 构建任务 type 参数不同（`graph` vs `raptor`），MIS 侧状态机可完全独立；
4. RAPTOR 是解析期建树 + 检索期引擎内部融合，原则上不需要 use_kg 类检索字段；
5. 前端开关/置灰按能力码独立。

**依赖关系澄清（重要）**：
- Wave C **不依赖**「Wave B 金标达标」——金标是验收 GraphRAG 业务价值，与 RAPTOR 是否值得做无关；
- Wave C **依赖**「Wave B 代码基线」——因为 Wave B 已交付的 `RagflowClient` 白名单/端点模式、`KbGraphService` 状态机模式、前端轮询模式是 Wave C 的复用模板。该基线已存在（commit e1d6c54，48 文件，测试全绿），**不阻塞**。

### 1.4 有条件结论的完整条件清单

| # | 条件 | 类型 | 闭环方式 |
|---|---|---|---|
| C1 | **T00 实测 v0.26.4 RAPTOR 契约**：`parser_config.raptor` 完整字段与校验范围（max_token 上限、threshold、max_cluster、prompt、random_seed）、`POST /datasets/{id}/index?type=raptor` 触发与状态查询结构、**RAPTOR 建树后检索走哪条路径**（`/retrieval` 自动融合？`/datasets/search`？是否与 `use_kg` 共存？） | 硬条件（实现契约） | ✅ **已闭环（T00 实测 2026-08-12）**：见 `ragflow-raptor-probe-2026-08-12.md`——`parser_config.raptor` 11 字段白名单与校验范围（P1a/P1b）、`type=raptor` 触发/状态与 graph 同构（P2a/P2b）、**经典 `/retrieval` 建树后自动融合、零专属参数**（P3a）、与 `use_kg` 共存 code:0（P3b） |
| C2 | **构建任务互斥性实测**：graph 构建中触发 raptor / raptor 构建中触发 graph 的行为（并行 or 拒绝） | 硬条件（排障预期） | ✅ **已闭环（T00 实测 P2c）**：**不互斥、可并行**，双向实测通过；重复触发幂等跳过。MIS 侧独立状态机即可，无需互斥拦截 |
| C3 | **RAPTOR 自身验收门禁**：试点库（长手册/长 PDF）金标 on/off 对比，替代「Wave B 金标」作为 Wave C 启动门禁 | 管理决策 | **保持**（主理人 U2 已拍板修订门禁文案，见 phase2-plan §7；金标执行见 T04） |
| C4 | **资源排期协调**：Graph 金标实测与 RAPTOR 试点若并行，LLM token/显存竞争 | 软条件（排期） | **降级为资源建议**（实测已证构建可并行，P2c）；仍建议试点排期错峰以控 LLM token 成本 |

### 1.5 门禁文案修订（已落地，U2 拍板 2026-08-12）

**修订状态**：✅ 已按本节的拟改文案落地到 `knowledge-base-phase2-plan.md` §7（标题改为「Wave C — 可独立启动（RAPTOR/TOC）」，表前补门禁修订说明，§6.3 补注不再阻塞 Wave C）与 `knowledge-base-app-plan.md` §8（Wave C 行说明列更新）。落地全文见两份规划文档。

落地文案要点（与 T00 实测对齐）：
> ## 7. Wave C — 可独立启动（RAPTOR/TOC）
>
> | 能力 | 做法 |
> |------|------|
> | RAPTOR | 库级开关 + `raptor` capability；长手册库试点 |
> | TOC 增强 | retrieve `toc_enhance`；长 PDF 试点 |
> | Parent-Child | 映射引擎 chunk 策略；不另起产品名 |
>
> **启动门禁（修订）**：Wave C 可独立启动。门禁调整为：
> 1. **RAPTOR 自身验收**：试点库金标 on/off 对比（≥60% 问题有新增/更相关证据，时延增量 ≤2×，记录 token/资源）；
> 2. **引擎契约 T00 实测固化**：`/datasets/{id}/index?type=raptor` 触发/状态、`parser_config.raptor` 字段与检索融合行为，见 `ragflow-raptor-probe-2026-08-12.md`；
> 3. **与 Wave B 共存**：Graph 与 RAPTOR 构建任务实测**不互斥、可并行**（P2c）；排期错峰仅作资源建议。

app-plan §8 同步改为：`| C 独立启动 | RAPTOR / TOC 等 | 可独立启动（2026-08-12 修订）；门禁 = RAPTOR 自身金标 + 引擎契约 T00 实测；详见 phase2-plan §7 |`。

---

## 第 2 部分：RAPTOR 配置参数缺口清单

### 2.0 参数口径差异（T00 实测收口，2026-08-12）

> **修订说明**：下表「部署实例 v0.26.4」列已由 `ragflow-raptor-probe-2026-08-12.md` T00 实测（P1/P2/P3）填实，替代原「未实测」；「修正后 MIS 口径」列以实测为准（引擎优先）。

| 项 | 用户期望（主理人转达） | RAGFlow 官方文档（v0.6.0） | 部署实例 v0.26.4（T00 实测） | 修正后 MIS 口径 |
|---|---|---|---|---|
| **RAPTOR 最大 token 数** | **512 – 4096，默认 1024** | 默认 256，上限 2048 | **合法区间 `[1, 2048]`**，默认 256；**4096 → code:101 被拒**（`Input should be less than or equal to 2048`）；0/-1 → code:101 | **MIS 范围收窄为 `[512, 2048]`、默认 1024**（1024 实测通过；**用户原期望 4096 超引擎上限，明确不可用**）；超限直接拒绝或适配层 clamp；独立 `RaptorConfig.MAX_TOKEN_NUM=2048` 常量 |
| 聚类相似度阈值 Threshold | — | 默认 0.1，上限 1 | **合法区间 `[0, 1]`**（**含 0**），默认 0.1 | MIS 范围 `[0, 1]`、默认 0.1（注意可含 0，与 scoreThreshold 的 (0,1] 语义不同） |
| 最大聚类数 Max Cluster | — | 默认 64，上限 1024 | **合法区间 `[1, 1024]`**，默认 64 | MIS 范围 `[1, 1024]`、默认 64 |
| Prompt | — | 递归摘要 prompt，含 `{cluster_content}` | 可自定义；**不含 `{cluster_content}` 占位符也接受**（code:0，引擎不强制） | 默认用官方 prompt；长度校验可宽松（引擎无占位符强校验） |
| Random seed | — | 文档写 `seed`（可选） | **`seed` → code:101 被拒；正确键 `random_seed`**（实测回读生效） | MIS 字段映射 **`raptorSeed → parser_config.raptor.random_seed`**（禁止写 `seed`） |
| 开关 | — | `parser_config.raptor` 默认 `{"use_raptor": false}` | 确认；11 字段白名单含 `use_raptor` | `useRaptor` 默认 false |
| **未知键错误码** | （Wave B P3 记录为 code:102） | — | **RAPTOR 场景未知键报 `code:101`**（`Extra inputs are not permitted`，pydantic extra=forbid）；102 是业务校验（非法 index type / 多库 embedding） | **共享知识修正**：`parser_config` 顶层与 `raptor` 子对象未知键均报 **101**，非 102；PUT body 只放白名单键 |
| **chunk_method 切换契约（新增最高优先级）** | 未涉及 | — | **切换 `chunk_method` 会把 `parser_config` 重置为该方法的默认模板**（raptor 回退 `{"use_raptor": false}`、graphrag 同清空，P1f 实测） | `RagflowClient.updateDatasetSettings` **每次 PUT 必须同时带 `chunk_method` + 完整 `parser_config`**（含 raptor + graphrag 全字段），否则先前 RAPTOR/图谱配置静默丢失 |
| 字段白名单（官方文档未列全） | — | 仅列 max_token/threshold/max_cluster/prompt/seed | **11 字段**：`use_raptor`(bool) / `max_token`(int) / `threshold`(float) / `max_cluster`(int) / `prompt`(str) / `random_seed`(int) / `clustering_method`(`gmm`\|`ahc`) / `scope`(`file`\|`dataset`) / `tree_builder`(`raptor`\|...) / `auto_disable_for_structured_data`(bool) / `ext`(dict) | `RagSettings` **只暴露子集**（useRaptor/raptorMaxTokenNum/raptorThreshold/raptorMaxCluster/raptorPrompt/raptorSeed），其余走引擎默认；若暴露枚举需白名单校验（P1g） |
| `parser_config.llm_id` | — | — | **不在 PUT 白名单**（code:101） | 构建走系统默认 chat 模型；MIS 无需传 chat 模型（可保留软提示，见未验证项 U1） |

> **差异解释定稿（T00 实测后）**：用户期望「512–4096/默认1024」中 4096 超引擎上限不可用；MIS 最终口径 **[512, 2048]/默认 1024**，与官方默认 256 的差异是产品级自定（MIS 语义），非引擎约束。
> **报告立场（更新）**：以「T00 实测引擎契约为唯一事实源」；官方文档（v0.6.0）仅供参考。

### 2.1 新增库级字段（RagSettings 追加末位，零 DDL）

| # | MIS 字段名 | 类型 | 默认值 | 建议范围 | 引擎映射键 | 落点 | 是否复用现有字段 | 校验位置 |
|---|---|---|---|---|---|---|---|---|
| R1 | `useRaptor` | Boolean | `false` | — | `parser_config.raptor.use_raptor` | **建库期**（+ 构建触发联动，false→true 自动触发） | 否（对齐 `useKnowledgeGraph` 模式） | `RagSettingsService.validate`（非 null 即可）+ `enforceRaptorAvailability`（能力闸门） |
| R2 | `raptorMaxTokenNum` | Integer | `1024` | **`[512, 2048]`**（T00 实测收口；4096 被拒） | `parser_config.raptor.max_token` | **建库期** | **不复用** `chunkTokenNum`（语义不同）；独立 `RaptorConfig.MIN/MAX_TOKEN_NUM` 常量 | `RagSettingsService.validate`（区间校验，独立常量） |
| R3 | `raptorThreshold` | Double | `0.1` | **`[0, 1]`**（T00 实测含 0） | `parser_config.raptor.threshold` | **建库期** | **不复用** `scoreThreshold`（检索阈值 vs 聚类相似度，语义不同） | `validate`（[0,1] 区间） |
| R4 | `raptorMaxCluster` | Integer | `64` | `[1, 1024]` | `parser_config.raptor.max_cluster` | **建库期** | 否 | `validate`（区间） |
| R5 | `raptorPrompt` | String | 官方默认 prompt | 非空 + 长度上限（T00 实测引擎不强制 `{cluster_content}` 占位符，校验可宽松） | `parser_config.raptor.prompt` | **建库期** | 否 | `validate`（非空 + 长度） |
| R6 | `raptorSeed` | Integer | `null`（引擎默认 0） | 任意整数；null = 不下发（引擎保持默认） | `parser_config.raptor.random_seed` | **建库期** | 否 | `validate`（整数即可，可选） |
| R7 | `raptorBuildStatus` | String | `none` | `none` \| `building` \| `ready` \| `failed` | `GET /index?type=raptor` progress 映射（**与 graph 完全同构**，T00 P2b） | **状态回写**（MIS 唯一事实源 + 查询时引擎刷新，同 `kgBuildStatus` 模式） | 复用四态枚举**模式**，字段独立 | `validate`（四态白名单） |
| R8 | `raptorBuildMessage` | String | `null` | ≤200 | `progress_msg` 摘要 | **状态回写** | 复用模式，字段独立 | `validate`（长度 ≤200） |

> **字段名修正（T00 P1i）**：引擎键是 **`random_seed`**，不是官方文档的 `seed`（写 `seed` → code:101 被拒）；MIS 字段名用 `raptorSeed`，`RagflowClient` 白名单写 `random_seed`。
> **构建任务（T00 P2a/P2c）**：`POST /index?type=raptor` 与 `type=graph` 完全同构（返回 task_id / progress / task_type="raptor"）；**graph/raptor 不互斥可并行**；重复触发幂等跳过（`already has raptor RAPTOR chunks, skipping`）——MIS 触发前可先查状态避免无谓请求。
> **检索融合（T00 P3a/P3b）**：建树后**经典 `/api/v1/retrieval` 自动融合 RAPTOR 摘要、零专属参数、零回归**；`/datasets/search` + `use_kg` + `doc_ids` 与 RAPTOR 共存 code:0——**检索链路耦合点消解**，T03 无需改检索请求体（仅命中测试可选回显「库已建树」状态）。
> **响应（T00 P4a）**：RAPTOR 摘要 chunk 与普通 chunk **字段完全同构**（无新增层级/树节点字段），沿用 Wave B `RfSearchChunk` 即可；区分靠内容前缀 `**Summary of ...**`。
> **⚠️ chunk_method 重置契约（T00 P1f）**：`RagflowClient.updateDatasetSettings` 每次 PUT 必须**同时带 `chunk_method` + 完整 `parser_config`**（含 raptor + graphrag 全字段），否则切换切片方法会静默清空 RAPTOR/图谱配置。
>
> 注：TOC 增强参数（可选，Wave C 第二部分）：`tocEnhance`（Boolean，默认 false，能力码 `toc_enhance` 闸门）为**检索期**开关，字段独立追加；引擎字段需独立 T00 实测（本次未探测，见 probe 未验证项 U6）。

### 2.2 新增全局默认配置（Nacos，`mis.kb.engine.*`）

对齐 rerank「全局默认 → 库级覆盖」层级口径（S-05 → L-08）：

| 配置键 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `mis.kb.engine.raptor-max-token-num` | int | 1024 | 全局默认，新建库继承；库级 `raptorMaxTokenNum` 覆盖 |
| `mis.kb.engine.raptor-threshold` | double | 0.1 | 同上 |
| `mis.kb.engine.raptor-max-cluster` | int | 64 | 同上 |
| `mis.kb.engine.raptor-prompt` | string | 官方默认 prompt | 同上 |
| `mis.kb.engine.raptor-max-libraries` | int | 2 | **库级数量上限**（对齐 `graph-max-libraries` 模式；是否与 Graph 共用上限由 U4 拍板） |
| `mis.kb.engine.raptor-enabled`（可选） | boolean | true | 平台级总开关（如 LLM token 预算告警时可全局关） |

**层级口径（对齐 rerank 三道防线）**：
1. **全局默认**（S-05）：新建库继承；
2. **库级覆盖**（L-08）：本库 RAPTOR 参数；
3. **能力闸门**（`capabilities.raptor`）：能力 false → 前端置灰 + 保存强制 `useRaptor=false` + 检索期降级（同 `enforceGraphAvailability` 模式）；
4. **数量上限**：`useRaptor=true` 且启用库数 ≥ 上限 → 拒（`KB_RAPTOR_LIBRARY_LIMIT`，对齐 `KB_GRAPH_LIBRARY_LIMIT`）。

### 2.3 存量兼容（三件套，已验证两轮）+ T00 新增契约

| 机制 | 说明 | 状态 |
|---|---|---|
| 零 DDL | `RagSettings` 整体序列化进 `kb_library.rag_settings_json`（TEXT 列），新增字段无需迁移 | ✅ 既有模式 |
| 追加末位铁律 | record 位置参数，新字段一律追加在 `kgBuildMessage` 之后；兼容构造（11/14 参）保持旧调用点零改动 | ✅ 既有铁律 |
| `withDefaults()` 兜底 | 存量 JSON 读出 null → 自动补 `useRaptor=false` / `raptorMaxTokenNum=1024` / `raptorThreshold=0.1` / `raptorMaxCluster=64` / `raptorPrompt=官方默认` / `raptorBuildStatus=none` | ✅ 既有模式 |
| **chunk_method 重置契约（T00 P1f，新增最高优先级）** | 切换 `chunk_method` 会把引擎 `parser_config` 重置为该方法的默认模板（raptor 回退 `{"use_raptor": false}`、graphrag 同清空）。`RagflowClient.updateDatasetSettings` **每次 PUT 必须同时带 `chunk_method` + 完整 `parser_config`**（含 raptor + graphrag 全字段），否则先前的 RAPTOR/图谱配置静默丢失 | ⚠️ **新硬约束**（T00 P1f 实测） |

> ⚠️ **新增后必须核查的既有构造点**：`RagSettings` 17 参 canonical 在 `RagSettingsService`（`enforceRerankAvailability`/`enforceGraphAvailability`/`withServerGraphState`）与 `RetrieveQueryResolver.applyOverride` 均以**位置参数逐字段透传**——新增字段后这些方法必须同步扩展为 N+1 参透传（不能走旧构造，否则 RAPTOR 字段被静默置 null）。这是 Wave B 用「17 参 canonical 透传图谱三字段」换来的教训，Wave C 同理。
> ⚠️ **引擎 PUT 合并语义（T00 P1h）**：`parser_config` PUT 是**部分更新（深合并）**——不传的键保留原值；但 **chunk_method 切换例外**（整单重置，见上表）。MIS 更新单字段时按深合并构造请求体即可，但必须始终携带 chunk_method。

### 2.4 RAPTOR 配置参数缺口汇总表

| 层 | 现有 | Wave C 缺口 | 数量 |
|---|---|---|---|
| 库级字段（RagSettings） | 17 字段 | `useRaptor`/`raptorMaxTokenNum`/`raptorThreshold`/`raptorMaxCluster`/`raptorPrompt`/`raptorSeed`/`raptorBuildStatus`/`raptorBuildMessage`（+`tocEnhance` 可选） | +7~9 |
| 能力码 | 8 个（无 raptor/toc） | `CAP_RAPTOR` / `CAP_TOC_ENHANCE` + `raptorSupported`/`tocEnhanceSupported` 布尔位 | +2 |
| 全局配置（Nacos） | rerank-model-id / delete-supported / graph-max-libraries | `raptor-*` 系列（见 §2.2） | +5~6 |
| 构建链路 | `buildGraph`/`queryGraphBuildStatus`（type=graph） | `buildRaptor`/`queryRaptorBuildStatus`（type=raptor）+ `RaptorBuildSnapshot` | +2 方法 +1 DTO |
| 检索链路 | `/retrieval` + `/datasets/search`（use_kg） | **RAPTOR 零检索参数**：建树后经典 `/retrieval` 自动融合（T00 P3a）；`use_kg` 与 RAPTOR 共存实测 code:0（P3b）；`toc_enhance` 待独立 T00（本次未探测） | 0 新增（检索请求体零改动） |
| 校验 | `validate` 现有字段 | RAPTOR 字段区间/长度/四态校验 + 能力闸门 + 上限 | 扩展 |
| 前端 | 图谱区已实现 | RAPTOR 区（开关 + 状态徽标 + 构建按钮 + 轮询）；命中测试临时开关 | 新增 |

---

## 第 3 部分：独立开发的落地建议

### 3.1 独立任务切分（沿用 Wave B 的 mis-kb / BFF / 前端三段式，最多 5 任务）

> 任务分组原则：按功能模块整组交付；T01 为唯一硬依赖，T02/T03 相对独立可并行，T04 收口。T00 为独立前置探测（**已完成，2026-08-12**，见 `ragflow-raptor-probe-2026-08-12.md`）。

| 编号 | 任务 | 目标 | 涉及文件（节选，路径相对仓库根） | 依赖 | 优先级 |
|---|---|---|---|---|---|
| **T00** | **T00 引擎探测（RAPTOR 契约）** | ✅ **已完成（2026-08-12）**：`parser_config.raptor` 11 字段白名单与校验范围（P1）、`type=raptor` 触发/状态与 graph 同构（P2）、检索融合路径（P3a 经典 `/retrieval` 自动融合、P3b 与 use_kg 共存）、graph/raptor 不互斥可并行（P2c）、chunk_method 重置契约（P1f） | `docs/backend/ragflow-raptor-probe-2026-08-12.md`（交付物） | — | P0 |
| **T01** | **数据层与能力码：RagSettings RAPTOR 字段 + EngineCapabilities 新码 + V34 + DTO 骨架** | `CAP_RAPTOR`/`CAP_TOC_ENHANCE` 能力码；`RagSettings` 追加 7~9 字段 + defaults/withDefaults + canonical 透传核查；`RaptorConfig` 校验常量（`MIN=512/MAX=2048/DEFAULT=1024`，独立常量）；`RaptorBuildSnapshot`/`KbRaptorStatusVO` DTO；BFF `KbRagSettings` 镜像；前端 `types.ts`；V34 迁移（sys_api 登记 raptor build/build-status 端点，当前最大迁移号 V33，实施时以「最大 +1」为准）；构建可编译基线 | `EngineCapabilities.java`、`RagSettings.java`、`RaptorConfig.java`、`RaptorBuildSnapshot.java`、`KbRaptorStatusVO.java`、`KbRagSettings.java`、`types.ts`、`V34__kb_wave_c_raptor.sql` | T00 | P0 |
| **T02** | **建库期下发 + 构建触发：RagflowClient 白名单 + KbRaptorService + 前端 RAPTOR 区** | `updateDatasetSettings` 下发 `parser_config.raptor{use_raptor, max_token, threshold, max_cluster, prompt, random_seed}`（**字段名 `random_seed` 非 `seed`**）；**每次 PUT 必须同时带 `chunk_method` + 完整 `parser_config`**（chunk_method 重置契约 P1f）；`buildRaptor`/`queryRaptorBuildStatus`（type=raptor，与 graph 同构）；`KbRaptorService`（触发/状态刷新/上限校验/回写；重复触发幂等跳过）；`RagSettingsService` 联动（false→true 自动触发 + enforceRaptorAvailability）；库详情页 RAPTOR 区（开关 + 状态徽标 + 构建按钮 + 3s 轮询）；BFF 透传 | `RagflowClient.java`、`RagflowAdapter.java`、`RagflowProperties.java`、`KnowledgeEnginePort.java`、`KbRaptorService.java`、`RagSettingsService.java`、`LibraryController.java`、`KbController.java`、`KbFacadeService.java`、`kb-library-detail-page.tsx`、`kb-api.ts` | T01 | P0 |
| **T03** | **检索期 + 前端命中测试（已简化为纯 MIS 侧）** | **T00 实测已消解检索链路耦合**：经典 `/retrieval` 建树后自动融合 RAPTOR（P3a），**无需改检索请求体**。本任务仅：`RetrieveQuery`/`RetrieveQueryResolver` 增加 raptor 相关降级（能力闸门 + kgBuildStatus 式状态判定，供命中测试回显「库已建树」）；命中测试临时开关 + 生效回显 + 降级原因；`tocEnhance`（可选，能力闸门） | `RetrieveQuery.java`、`RetrieveQueryResolver.java`、`RagflowAdapter.java`、`HitTestRequest.java`、`KbHitTestService.java`、`KbHitTestRequest.java`、`kb-hit-test-page.tsx` | T01（可并行 T02） | P0 |
| **T04** | **试点验收 + 集成联调 + 全量回归** | RAPTOR 试点库金标 on/off 对比（替代 Wave B 金标作为 Wave C 门禁，C3）；与 Wave B Graph 共存（已实测可并行，P2c；排期错峰仅作资源建议）；全量回归（mis-kb 430 / bff 250 / 前端 tsc 0 错基线保持）；无浏览器持 Key/无全库强制核对 | 金标报告（交付物）、单测/契约测试（RaptorConfig 校验、Resolver 降级、KbRaptorService 上限、**updateDatasetSettings 必带 chunk_method+完整 parser_config**）、QA 回归清单 | T02、T03 | P0 |

### 3.2 待主理人拍板事项（U1~U5 风格）

| # | 事项 | 影响 | 建议默认值 / 状态 |
|---|---|---|---|
| U1 | **`raptorMaxTokenNum` 范围**：用户期望 512–4096/默认 1024 vs 引擎实测 `[1,2048]` 默认 256（4096 → code:101 被拒） | §2.1 R2 字段与校验 | ✅ **已定（T00 实测收口）**：MIS 范围 **[512, 2048]、默认 1024**（1024 实测通过）；4096 明确不可用；独立 `RaptorConfig` 常量 |
| U2 | **是否修订 phase2-plan §7 门禁文案**（§1.5 拟改文案） | Wave C 启动时机与验收标准 | ✅ **已拍板（2026-08-12）**：已修订 phase2-plan §7（可独立启动）+ app-plan §8 表格行 |
| U3 | **试点库选择**：长手册/长 PDF 候选库（现有集成库无该类库；可选新上传或指定库） | 金标集内容与前置准备 | 待业务侧提供候选 |
| U4 | **RAPTOR 库数上限**：独立 `raptor-max-libraries`（默认 2）还是与 Graph 共用上限 | 资源控制与产品口径 | 独立配置默认 2（与 graph 分开） |
| U5 | **RAPTOR 与图谱增强可否同时开启**（单库两者均开） | 检索链路 | ✅ **已实测可共存**（T00 P1c/P3b）：同一库 `use_raptor` + `use_graphrag` 可同时 true，检索可叠加——建议允许共存 |
| U6 | **`raptorSeed` 是否暴露给业务侧** | 字段面 | 默认不暴露（null = 引擎默认 0），运维可在全局配置控制 |
| U7 | **chunk_method 重置契约联动（新增，T00 P1f）**：MIS 库设置「切换切片方案」时是否**强制重解析**并提示「RAPTOR/图谱配置将被引擎重置为默认」？切换后是否需用户确认重新下发 raptor 参数 | 前端交互 + 数据一致性 | 建议：切换 chunk_method 保存时后端**自动携带完整 parser_config**（含当前 raptor 字段值）重新下发，前端提示「切片方案变更将重置引擎 RAPTOR/图谱配置并需重解析」，避免静默丢失（U7 待拍板） |

### 3.3 风险与降级

| # | 风险 | 等级 | 降级/应对 |
|---|---|---|---|
| R1 | **引擎版本差异**：官方文档（v0.6.0）与部署实例 v0.26.4 的 RAPTOR 契约不同（`random_seed` 非 `seed`、未知键 code:101、max_token 上限 2048 等） | 高 | ✅ **已实测闭环**（T00 P1/P2/P3，唯一契约源）；能力码 `raptor` 是唯一开关，翻转 false → 三道防线（前端置灰 + 保存强制关 + 检索降级） |
| R2 | **与 GraphRAG 共存冲突**：index 任务队列互斥、/datasets/search 字段共存、LLM token/显存竞争 | 中→**低** | ✅ **已实测降级**（T00 P1c/P2c/P3b）：构建**不互斥可并行**、`use_raptor`+`use_graphrag` 可共存、`use_kg`+RAPTOR 同请求体 code:0；剩余约束 = LLM token/显存竞争（排期错峰仅作资源建议）+ 多库 embedding 一致性（沿用 Wave B G8） |
| R3 | **LLM token 成本**：RAPTOR 递归摘要消耗 token 显著（官方 WARNING） | 高 | 试点库规模控制；`raptor-max-libraries` 上限；`raptor-enabled` 平台总开关；金标记录 token/资源（对齐 Wave B §7.4）；大库建树耗时需试点实测（probe 未验证项 U4） |
| R4 | **RAPTOR 建树后检索融合行为**（是否走 /retrieval、是否需字段、是否与 use_kg 互斥） | 中→**已消解** | ✅ **已实测（T00 P3a/P3b）**：经典 `/retrieval` 建树后自动融合、零专属参数、零回归；`use_kg` 与 RAPTOR 共存 code:0——T03 无需改检索请求体 |
| R5 | **`raptorMaxTokenNum=4096` 超引擎上限 2048** | 中→**已定** | ✅ **已实测（T00 P1b）**：4096 → code:101 被拒；MIS 范围收窄 **[512, 2048]、默认 1024**，超限直接拒绝（`RaptorConfig` 常量） |
| R5b | **chunk_method 切换重置 parser_config（新增，T00 P1f）**：切换切片方法把 RAPTOR/图谱配置静默清空 | 高 | `RagflowClient.updateDatasetSettings` **每次 PUT 必须同时带 `chunk_method` + 完整 `parser_config`**（含 raptor + graphrag 全字段）；单测锁定「请求体必含 chunk_method + 完整 parser_config」；前端切换切片方案时提示重解析（U7） |
| R6 | **存量构造点静默置 null**（17 参 canonical 透传漏加 RAPTOR 字段） | 中 | T01 核查全部 canonical 透传点（`RagSettingsService` ×3 + `RetrieveQueryResolver.applyOverride`）；契约测试防回归（对齐 Wave B §10-8 教训） |
| R7 | **状态漂移/构建失败**（引擎侧任务被运维删除/重跑；系统未配 chat 模型时构建失败行为未验证） | 低 | 状态查询每次刷新回写；`none/failed` 可重新触发（同 `kgBuildStatus` 模式）；构建失败 → progress=-1 → `raptorBuildStatus=failed` + message（probe 未验证项 U1 建议保留「chat 模型可用性」软提示） |

---

## 4. 关联文档

- 主规划：[knowledge-base-app-plan.md](knowledge-base-app-plan.md) §8
- 二期规划：[knowledge-base-phase2-plan.md](knowledge-base-phase2-plan.md) §6/§7/§4.1/§4.2
- Wave B 设计：[mis-kb-wave-b-graphrag-design-2026-08-11.md](mis-kb-wave-b-graphrag-design-2026-08-11.md)
- Wave B T00 探测：[ragflow-graphrag-probe-2026-08-11.md](ragflow-graphrag-probe-2026-08-11.md)
- **Wave C T00 探测（2026-08-12）**：[ragflow-raptor-probe-2026-08-12.md](ragflow-raptor-probe-2026-08-12.md)
- RAGFlow 官方 RAPTOR 文档：https://ragflow.io/docs/enable_raptor
