# MIS 知识库 RAGFlow 切片设置增量 PRD：overlap% / 自动关键字 / 自动问题 + 文件级扩展与继承

- **作者**：许清楚（软件产品经理）
- **日期**：2026-08-19
- **类型**：增量简单 PRD（默认模式，进入标准 SOP 开发；需求已拍板，不做竞品分析）
- **状态**：需求已锁定，转交架构师做技术设计；overlap% 与文件级 PUT 键支持待**实测确认**（见 §6）
- **上游**：`docs/backend/mis-kb-system-design.md`、`deliverables/software-company/kb-settings-model-chunk-prd-2026-08-10.md`、`deliverables/software-company/kb-enterprise-phase1-prd-2026-08-11.md`、`deliverables/software-company/mis-kb-wave-b-qa-2026-08-12.md`
- **代码事实依据**（已核实，PRD 收敛范围）：
  - `backend/mis-kb/src/main/java/com/mis/kb/domain/model/RagSettings.java` —— 26 参 record；`pageIndex`（默认 true）/`imageTableContextWindow`（默认 256）已追加末位；`chunkOverlapTokenNum` 第 14 位存在（能力 `parser_overlap` 支持前**不下发**）；**无 `auto_keywords`/`auto_questions` 字段**。
  - `backend/mis-kb/src/main/java/com/mis/kb/engine/RagflowClient.java` —— `updateDatasetSettings` 构建 parser_config（chunk_token_num/delimiter/raptor/graphrag/toc_extraction/image_table_context_window）；**P1f 契约：每次 PUT 恒下发完整 parser_config**；未知键 → code:101/102 拒整单（OCR/overlap 旧实例实测教训）。
  - `backend/mis-kb/src/main/java/com/mis/kb/engine/RagflowAdapter.java` L878-892 —— `parser_ocr`/`parser_overlap` **恒不声明**；`EngineCapabilities` 能力码翻转即放行下发，代码分支不动。
  - `backend/mis-kb/src/main/java/com/mis/kb/domain/entity/KbDocument.java` —— chunkMethod/chunkTokenNum/separator 三列（V23）；`backend/mis-kb/src/main/java/com/mis/kb/domain/model/DocumentChunkConfig.java` 同三字段。
  - `frontend/mis-admin-web/src/features/kb/components/kb-doc-chunk-dialog.tsx` —— 三字段表单，全空 = 清覆盖继承库级。
  - `frontend/mis-admin-web/src/features/kb/library/kb-library-detail-page.tsx` —— RagForm/toForm/toSettings；`frontend/mis-admin-web/src/features/kb/types.ts` —— KbRagSettings（26 字段镜像）/KbDocumentChunkConfig。
  - 上传快照机制在 `RagflowAdapter`（reparseDocument Javadoc：RAGFlow「重新解析」使用文档自身保存的 parser_config 快照，上传时从 dataset 复制；改动库级参数对存量文档不生效，正确路径是删除后重新上传）。
  - **迁移版本修正**：team-lead 提到文件级扩展列用「V39 迁移」，但 V39 已被 `V39__system_management_real_data.sql` 占用；`backend/mis-migrator` 当前最新为 **V61**（`V61__agent_ops_v50_menu_api_binding.sql`），文件级扩展新迁移应为 **V62**（见 §6 Q3）。

---

## 1. 变更背景

MIS 知识库（mis-kb）对接 RAGFlow 引擎：库级 RAG 设置在 `kb_library.rag_settings_json`（`RagSettings` record）持久化，建库/更新期经 `RagflowClient.updateDatasetSettings` 以 **PUT 恒下发完整 parser_config** 的方式同步到引擎（P1f 契约）；文档级切片设置为「库级默认 + 文件级覆盖」（方案 B，`kb_document` 三列 + `DocumentChunkConfigResolver` 收口合并）。

上一轮（2026-08-12 前后）已完成 RAGFlow 解析器增量：`pageIndex`（→ `parser_config.toc_extraction`，默认 true）与 `imageTableContextWindow`（→ `parser_config.image_table_context_window`，默认 256）已在库级实现并参与引擎下发，QA 全绿。本轮在此基础上做两件事：**① 库级新增三参数对齐** —— 重叠百分比（overlapped percent %）、自动关键字提取（auto_keywords）、自动问题提取（auto_questions）；**② 文件级切片设置扩展** —— 把上述解析器参数（pageIndex、图像与表格上下文窗口、自动关键字、自动问题；overlap% 视文件级支持与否）接入文件级切片设置，并纳入「新建文件快照继承库级」的继承范围。

> ⚠ **overlap% 前提**：存量已有 `chunkOverlapTokenNum`（分块重叠 token 数）字段但被能力闸门挡住不下发（旧实例实测不支持 overlap 键）。用户反馈 RAGFlow 现已提供「overlapped percent %」参数，**疑似引擎已升级支持**，须由团队对目标实例**实测确认**（键名 / 单位是百分比还是 token 数 / 默认值）后方可纳入下发（见 §6 Q1）。

## 2. 产品目标

1. **切片参数与 RAGFlow 官方对齐**：库级切片设置覆盖 RAGFlow naive chunk method 的可配置项（自动关键字数量、自动问题数量、重叠百分比），默认值与引擎一致，用户无需登录 RAGFlow 控制台即可完成同等配置。
2. **两级切片语义完整贯通**：文件级切片设置支持新增解析器参数，新建文件自动继承库级设置作为默认值且可修改；覆盖/清除语义清晰透明（全空 = 继承库级），不产生歧义。
3. **能力降级可感知、不静默失效**：overlap% 等未获实测支持的键，遵循「只落库 + 回显 + 提示」既有口径（与 OCR 同款），引擎升级后翻转能力码即放行，配置不丢、不阻塞保存。
4. **零回归**：存量库/文档字段不迁移不回填（新增字段由 `withDefaults()` 兜底），既有 26 参 record 与兼容构造（11/14/17 参）铁律不破。

## 3. 用户故事

#### 知识库管理员（库管理视角）

- **US-L1（R-P0-01）**：As a 知识管理员，I want 在库详细设置中配置自动关键字提取数量（0=关，0~32）、自动问题提取数量（0=关，0~10）与重叠百分比，so that 切片粒度与 RAGFlow 官方行为一致，无需切到控制台。
- **US-L2（R-P0-03）**：As a 知识管理员，I want 保存库设置后引擎侧配置真实生效（PUT 恒含新键且值正确），so that 设置不是「界面摆设」，重解析后切片效果可预期。

#### 文档管理员（文档管理视角）

- **US-D1（R-P1-01）**：As a 文档管理员，I want 在文件级切片设置弹窗中为单个文档覆盖页码索引/图像表格上下文窗口/自动关键字/自动问题，so that 异构文档（PDF 目录、图片表格类、术语密集类）可用各自最优解析参数。
- **US-D2（R-P1-02）**：As a 文档管理员，I want 新上传文件自动以库级当前设置为默认值（可修改），清除文件级覆盖后回库级，so that 无需重复填写且可随时还原。

#### 运维（运维视角）

- **US-O1（R-P0-02）**：As a 运维，I want 引擎实测不支持的参数（如 overlap%）在 UI 明确提示「当前引擎版本暂不支持，参数已保留待引擎升级生效」且不阻塞保存，so that 配置不丢、引擎升级后自动放行。
- **US-O2（R-P1-03 / P2）**：As a 运维，I want 能查看/对账库级与文件级切片设置与引擎侧是否一致，so that 排障时有据可查。

## 4. 需求池

> 优先级：**P0 = 必须（本期交付边界）**；P1 = 应当（紧接增强）；P2 = 可选（远期）。
> 语言约定：**必须** = 不满足即交付失败；**应当** = 强烈建议；**可以** = 可选。

### P0（本期交付边界）

| 编号 | 需求 | 验收要点（可度量） |
|---|---|---|
| **R-P0-01** | **库级新增三参数（后端模型 + 校验 + 下发）**：`RagSettings` **必须**追加末位三字段 —— `overlapPercent`（Double，语义/默认待实测，见 §6 Q1；若实测单位是百分比则区间建议 0~100）、`autoKeywords`（Integer，0=关，合法 0~32，默认 0）、`autoQuestions`（Integer，0=关，合法 0~10，默认 0）。`defaults()`/`withDefaults()`/`withGraphOverride`/`withRaptorOverride` 及 `RagSettingsService` 4 处 canonical 全量透传点（enforceRerankAvailability / enforceGraphAvailability / enforceRaptorAvailability / withServerGraphState）**必须**同步补参；兼容构造（11/14/17 参）补 null；`validate()` 越界（autoKeywords>32、autoQuestions>10、overlap 越界）**必须**拒绝（不做静默截断）。 | 新字段位于 record 末位且所有透传点值不丢；autoKeywords=33/autoQuestions=11 保存被拒并回显原因；越界不做静默截断；老 JSON 无字段由 `withDefaults()` 兜底默认值。 |
| **R-P0-02** | **库级下发（RagflowClient）**：`updateDatasetSettings` 的 parser_config **必须**按实测结果下发新键 —— `auto_keywords`（int）、`auto_questions`（int）随每次 PUT **恒下发**（P1f 契约）；overlap% **必须**先实测确认键名/单位/默认值后决定是否下发（支持 → 恒下发；不支持 → 保持能力闸门「只落库不下发」，见 §6 Q1）。`auto_keywords`/`auto_questions` 是否受能力闸门保护以实测为准（官方 naive 白名单键，若无旧实例兼容问题可直发，与 pageIndex/imageTableContextWindow 同款口径）。 | 库级保存后引擎侧 parser_config 恒含 auto_keywords/auto_questions 且值正确；overlap% 实测支持则恒含且值正确；不支持则绝不出现该键且保存不失败。 |
| **R-P0-03** | **库级前端切片设置面板**：`kb-library-detail-page.tsx` RagForm/toForm/toSettings 与 `types.ts` KbRagSettings **必须**新增三字段。交互：auto_keywords / auto_questions 建议**数量输入**（0=关，带 0~32 / 0~10 范围提示，与 RAGFlow 滑块语义一致，交互取舍见 §6 Q2）；overlap% 控件待实测确认单位后实现（不支持时置灰 + 提示「当前引擎版本暂不支持，参数已保留待引擎升级生效」，值仍可回显/保存）。 | 面板出现三控件且与 RAGFlow 官方语义一致；保存后回显一致；越界输入前端即时拦截提示；overlap% 不支持时控件置灰 + 提示且保存照常成功。 |
| **R-P0-04** | **overlap% 实测前置任务**：团队对目标 RAGFlow 实例**必须**实测确认 overlapped percent % 的键名 / 单位（百分比 vs token 数）/ 默认值 / 白名单支持，产出探测记录后本 PRD 相应条目方可关闭。 | 探测记录覆盖：PUT 带候选键 → 引擎接受/拒绝（code:101/102）；回读 parser_config 确认键名与单位；默认值。 |

### P1（应当）

| 编号 | 需求 | 说明 |
|---|---|---|
| **R-P1-01** | **文件级切片设置扩展（数据模型 + 后端）**：`KbDocument` 新增列 + `DocumentChunkConfig` 扩展字段 —— pageIndex（boolean）/ imageTableContextWindow（int）/ autoKeywords（int）/ autoQuestions（int），overlap% 视文件级实测支持与否（不支持则跳过）。列式 vs JSON 快照列的取舍见 §6 Q3（产品倾向：独立列，见下方产品视角说明）。`DocumentChunkConfigResolver` 合并逻辑**必须**同步扩展（文件级 ?? 库级 ?? 全局默认），来源标记语义不变。 | 文件级任一新增字段非空 = FILE_OVERRIDE，否则 LIBRARY；存量文档新列为 NULL 读取行为与现状一致（继承库级）；迁移可重复执行（ADD COLUMN IF NOT EXISTS）。 |
| **R-P1-02** | **文件级切片设置扩展（前端弹窗）**：`kb-doc-chunk-dialog.tsx` 新增对应控件（页码索引开关、图像表格上下文窗口数字输入、自动关键字/自动问题数量输入；overlap% 视支持与否）。**必须**保留「全空 = 清覆盖继承库级」语义，并把新增字段纳入 hasOverride 判定与清除覆盖提交体；弹窗文案（快照式继承 + 库级变更不跟进存量文档）同步更新。 | 弹窗可对新增字段做文件级覆盖并保存；任一字段有值即出现「清除文件级配置」入口；清除后全字段回 null = 继承库级；保存触发重解析提示不变。 |
| **R-P1-03** | **新建文件快照继承扩展**：上传/文件级设置保存链路 **必须**把新增字段纳入「快照式继承」范围 —— 新建文件从库级当前设置（含新参数）取默认值下发引擎；库级后续变更**不**自动跟进存量文档（现有机制，语义确认见 §6 Q4）。`RagflowClient.updateDocumentConfig` **必须**实测文件级 PUT 对新增键（toc_extraction / image_table_context_window / auto_keywords / auto_questions）的接受度，只下发实测接受的键（参考 T00 P3/P5：文档 PUT 白名单曾只含 chunk_token_num/delimiter；未知键可能被拒）。 | 新建文件后引擎侧文档 parser_config 含新增键默认值；文件级可修改覆盖；库级变更后存量文档不自动跟进（与现状一致）；文件级不支持的键不下发、不阻塞保存。 |

### P2（可选）

| 编号 | 需求 | 说明 |
|---|---|---|
| R-P2-01 | 存量文档切片设置批量回填/同步（把当前库级设置批量写入存量文档） | 运维工具，可后续排期。 |
| R-P2-02 | 控制台对账展示（库级/文件级设置 vs 引擎侧 parser_config 差异视图） | 复用 T04 对账框架，排障可视化。 |

## 5. 验收标准（可测）

1. **库级下发完整性**：库级保存任一含新参数的设置后，`GET /datasets/{id}` 回读的 `parser_config` **恒含** `auto_keywords`/`auto_questions` 且值与 MIS 一致（overlap%：实测支持则恒含且值正确；不支持则恒不含且保存成功）。
2. **越界拒绝**：`auto_keywords > 32`、`auto_questions > 10`、overlap% 越界（按实测区间）均被后端 `validate()` 拒绝，前端同步拦截并回显原因；0 合法且语义为「关闭」。
3. **默认值**：未显式设置时，auto_keywords=0、auto_questions=0（overlap 按实测默认），`withDefaults()` 兜底后与 RAGFlow 官方默认一致。
4. **文件级覆盖与继承**：文件级可覆盖新增参数且生效（解析后效果/回读可验证）；新建文件默认继承库级值且可修改；清除文件级覆盖后全部回 null = 继承库级；库级变更不自动跟进存量文档（快照语义）。
5. **能力降级护栏**：overlap%（及文件级不支持的键）不支持时 UI 置灰 + 提示，保存照常成功（本地落库 + 回显），引擎侧绝不下发未知键；`syncToEngine` 对 PUT 失败保持「本地保存成功 + 记 error + 下次保存重试」显式失败护栏，不静默假成功。
6. **兼容性零回归**：11/14/17 参兼容构造调用点零改动编译通过；老库 JSON 无新字段读取正常（KbJson 容错 + withDefaults 兜底）；QA 回归覆盖库级保存/回显、文件级覆盖/清除、上传快照三条主链路。

## 6. 待确认问题（抛给架构师/技术拍板）

1. **overlap% 实测口径与兜底**：键名 / 单位（百分比 vs token 数）/ 默认值一律以对目标实例的**实测**为准。若实例不支持，采用哪种兜底 ——（a）能力闸门「只落库不下发」+ 前端置灰提示（与 OCR 同款，配置保留待升级）；还是（b）直接隐藏控件？产品倾向（a）：配置可见可保留，引擎升级翻转能力码即放行，避免用户升级后找不到入口。
2. **auto_keywords/auto_questions 前端交互**：数量输入（0=关，0~32 / 0~10）还是「开关 + 数量」双控件？产品倾向**数量输入（0=关）**——与 RAGFlow 官方滑块语义一致（0 即关闭），不引入第二个开关维度，表单更简洁；默认 0。
3. **文件级扩展列形态**：独立列（`kb_document` 加 4~5 列，**V62 迁移**，当前最新 V61）还是 JSON 快照列（单列存 JSON）？产品视角倾向**独立列**：文件级字段需要按来源判定（FILE_OVERRIDE/LIBRARY）、按字段合并（Resolver）、可能按字段查询/对账，独立列可查询性/可维护性更好；代价是一次 DDL（ADD COLUMN IF NOT EXISTS 幂等，与 V23 同款）。JSON 列迁移成本低但查询/校验/合并都退化为字符串解析，后续对账（P2-02）会很难做。请架构师权衡迁移成本后拍板。
4. **新建文件继承语义确认**：现有机制是「上传时快照 dataset 当前 parser_config」（引擎侧行为），即**快照式继承**；用户描述「自动从知识库一级的切片设置获取，作为文件级切片设置的默认值，且可以修改」与快照语义一致 —— 确认沿用上传时快照即可，不需要改为保存时实时引用库级（那会改变存量行为且与 RAGFlow 引擎语义冲突）。

---

*本文档为增量 PRD，范围收敛于上述 P0/P1；overlap% 实测与文件级 PUT 键实测为前置阻塞项，架构师需在技术设计阶段先行验证。*
