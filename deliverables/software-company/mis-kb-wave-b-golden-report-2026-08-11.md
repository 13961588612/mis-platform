# MIS 知识库 Wave B GraphRAG PoC —— 金标对比报告（T04）

- **日期**：2026-08-11
- **阶段**：T04 金标对比 + 集成联调 + 全量回归
- **设计依据**：`docs/backend/mis-kb-wave-b-graphrag-design-2026-08-11.md` §7
- **实测依据**：`docs/backend/ragflow-graphrag-probe-2026-08-11.md`（T00）

---

## 0. 结论速览（PoC 门禁）

| 门禁项 | 结果 | 说明 |
|---|---|---|
| R2 契约「useKnowledgeGraph=true → /datasets/{id}/search + use_kg:true」 | ✅ 单测锁定 | `RagflowClientSearchDatasetContractTest` 对线上字节断言（见 §3） |
| S4.5 降级（能力/单库/kgBuildStatus） | ✅ 单测锁定 | `RetrieveQueryGraphDegradeTest` 三道防线全覆盖 |
| RfSearchChunk 剥离 `<weight>` 标记（含嵌套） | ✅ 单测锁定 | `RfSearchChunkTest` 九类边界 |
| KbGraphService 上限 + 状态机 | ✅ 单测锁定 | `KbGraphServiceTest` 上限/重复触发/刷新回写 |
| mis-kb + mis-admin-bff 全量回归 | ⏳ 待执行 | 见 §4（本会话已完成编译 + 前端 typecheck 门禁） |
| **金标 A/B 实测（12 条 × 2 组）** | ⏳ **待联调环境执行** | 见 §2 前置条件（本会话无引擎 apiKey / DB 写权限） |

> **重要**：Wave C 是否启动以本报告金标 A/B 实测结论为准（设计 §6.3 门禁结论前置）。
> 若实测不达标，`graphrag` 能力码保留 true 但**不新增开图库**、前端开关维持上限置灰，
> 图谱仅作为已开库的增强项。本报告交付时 A/B 实测尚未执行，**不得视为放行 Wave C 的依据**。

---

## 1. 候选库与内容现状（集成库实测，T00 结论）

| 库 | 集成库现状 | 引擎侧 | 前置动作 |
|---|---|---|---|
| **百货收银**（id 1786439846183，category 运维，public，enabled） | kb_document 0 条 | dataset `76f53a3e...`（use_graphrag=true 已配置、chunks=0） | **需先上传真实业务文档**才能跑金标 |
| **运维**（id 1786339952827，category 信息，public，**已归档**） | kb_document 0 条 | dataset `66e5a448...`（PAD问题集.docx，7 chunks，DONE） | **需先取消归档**（U1 已裁决：取消归档后即可构图） |

> 金标问题集基于运维库 `PAD问题集.docx` 已实测内容设计（退货失败/银联退款权限/积分抵现单边数据/
> 收款台号一致性等），覆盖 POS 收银与运维 FAQ 两个关系密集场景（设计 §7.1）。

---

## 2. 金标 A/B 实测（待联调执行）

### 2.1 前置条件（联调环境需满足）

1. **运维库取消归档**（id 1786339952827）：DB 更新 `kb_library.status` 为 enabled，恢复引擎映射可检索；
2. **百货收银补文档**（id 1786439846183）：上传真实业务文档并等解析 DONE（当前 chunks=0）；
3. **运行中的 mis-kb 服务**：注入 `MIS_KB_ENGINE_API_KEY`（仅服务端持有，禁进 Git——本会话无该凭据，
   已实测 RAGFlow `10.254.16.6:9380` 可达，返回 401 需鉴权）；
4. **图谱构建**：保存 `useKnowledgeGraph=true` → 自动触发构图 → 轮询至 `kgBuildStatus=ready`
   （探测库 2 chunks 实测 ~9s 完成，`process_duration: 8.85s`，见 T00 G4）。

### 2.2 执行方法（设计 §7.3）

- 每条金标问题在**命中测试**执行两轮：
  - **A 组 hybrid-only**：`enableGraph=false`（或库开关关）；
  - **B 组 hybrid+graph**：`enableGraph=true`（需 `kgBuildStatus=ready`）。
- 检索配置统一：`topK=5 / threshold=0.2 / hybrid / 无 rerank / use_kg=on|off`。
- 记录：命中条数、A/B 两组 top1/top5 证据 chunk 文本、B 组是否出现「跨实体关系证据」新 chunk、
  `elapsedMs`、构图耗时/图节点边规模（软指标，记录即可）。

### 2.3 金标问题集（12 条，设计 §7.2 原样引用）

| # | 金标问题 | 期望的多跳/关系点 |
|---|---|---|
| 1 | 哪些情况可能导致 PAD 厅房收银退货操作失败？ | 退货失败 → 多种原因（版本/数据/银联）归因 |
| 2 | 老版本收银程序为什么会导致退货失败？它缺少了什么信息？ | 老版本 → 未保存退货信息 → 失败（因果链） |
| 3 | 退货时如果原消费单出现单边数据，系统会做什么？ | 单边数据 → 数据检查 → 核对失败（条件-行为） |
| 4 | 银联退款权限需要向谁申请？没开通会怎样？ | 银联设备 → 当地银联申请 → 无权限无法退款（主体-动作） |
| 5 | 银联对当天退款金额有什么限制？什么情况下直接做退款可能失败？ | 银联 → 当日限额 → 无消费记录退款失败（约束-后果） |
| 6 | 最新版本对退货收款台有什么要求？ | 新版本 → 原单/退货收款台号一致（约束关系） |
| 7 | 原单使用的某种收款方式在退货时有什么问题？ | 旧积分抵现 → 原消费单 → 单边数据（跨实体关联） |
| 8 | PAD 退货前系统会做数据检查，检查对象是什么？ | 数据检查 → 原单/收款方式（动作-对象） |
| 9 | 如果当天商场还没有任何银联消费，能直接退货吗？ | 银联消费 → 当日退货 → 失败（否定约束） |
| 10 | 退货失败与「原单收款台号」的关系是什么？ | 收款台号 → 一致性要求（关系型） |
| 11 | 商场要支持 PAD 退货，需要在银联侧提前准备什么？ | 退货 → 银联退款权限 → 申请（前置条件链） |
| 12 | 积分抵现参与退货时，为什么可能核对失败？ | 积分抵现 → 单边数据 → 核对失败（实体-属性-结果） |

> 百货收银库补文档后追加 6~8 条（商品-供应商-门店-会员-促销关系型），两库合计 12~20 条。

### 2.4 通过判据（设计 §7.3）

- **硬指标**：B 组在 ≥60% 金标问题上召回**新增或更相关**的证据 chunk（与 A 组相比 top1 命中目标
  实体关系），答案可用性由 QA/业务抽样判定；
- **软指标**：B 组时延增量 ≤ 2× A 组（图谱检索额外一次 LLM 调用）；
- **资源指标**：构图耗时 / task process_duration / 图节点边规模 / 构图期间引擎负载观察（记录）。

### 2.5 记录模板（设计 §7.4 原样引用）

```markdown
## 金标对比报告 —— 库：运维/PAD问题集
- 构图信息：触发时间 / 完成时间 / process_duration / 图节点数 / 图边数 / kgBuildStatus
- 检索配置：topK=5 / threshold=0.2 / hybrid / 无 rerank / use_kg=on|off
| # | 问题 | A组 hits | B组 hits | A组 top1 证据 | B组 top1 证据 | B组新增证据 | A组 ms | B组 ms | 判定 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | ... | 7 | 8 | ... | ... | 是/否 | 120 | 380 | PASS/FAIL |
```

---

## 3. 工程侧已完成的自动化验证（本会话）

> 金标 A/B 依赖真实引擎与数据，无法在本会话执行（§2.1）。作为替代，把设计 §4.2 列出的
> **自动化单测/契约测试**全部落地并锁定，作为集成联调前的工程防线。

### 3.1 新增测试（T04）

| 测试类 | 覆盖契约 | 关键断言 |
|---|---|---|
| `RfSearchChunkTest`（9 例） | T00 G7 正文剥离（R3） | `<weight>`/`<sep>` 单/多/嵌套/自闭合/纯标记/null 五类边界全部剥离；`@JsonProperty` 字段名映射 |
| `RetrieveQueryGraphDegradeTest`（8 例） | Resolver S4.5 三道降级 | 能力 false / 多库 / kgBuildStatus!=ready → `effectiveUseKnowledgeGraph()==false` + 中文 reason；全绿 → true；`withGraphOverride` 参与判定 |
| `KbGraphServiceTest`（9 例） | 上限（U7）+ 状态机（§10-10） | `KB_GRAPH_LIBRARY_LIMIT`；building 拒重复触发；ready 清 message；NONE 保留本地（R6）；停用库不占额度 |
| `RagflowClientSearchDatasetContractTest`（8 例） | **R2 契约（最高风险）** | `useKnowledgeGraph=true` → 路径 `/api/v1/datasets/{id}/search` + `use_kg:true`；`doc_ids` 空不下发键；`rerank_mdl`（非 rerank_id）；响应字段映射；适配器分流零回归 |

### 3.2 既有回归适配

- `RetrieveQuery` 新增 10 参兼容构造（既有测试夹具零改动）；
- `RagSettingsServiceTest` 适配 T02 新增的 `KbGraphService` 构造器参数；
- `RetrieveHitsVoContractTest` `EffectiveParamsVO` 补第 10 参（`useKnowledgeGraph`，WD-06 键集合断言不受影响）。

### 3.3 编译 / 类型门禁（本会话已通过）

- ✅ `mvn -o -pl mis-kb,mis-admin-bff -am compile` → `BUILD SUCCESS`
- ✅ 前端 `npm run typecheck` → `EXIT=0`（T02/T03 全部前端改动零类型错误）

---

## 4. 全量回归（待联调阶段执行）

- mis-kb 基线 **270 例**、mis-admin-bff 基线 **141 例**（QA 口径）；
- 本会话已完成：T01/T02/T03 编译 + 前端 typecheck + 新增 T04 单测；
- **待执行**：`mvn -o test`（mis-kb / mis-admin-bff 全量）+ 前端 `npm run typecheck`（已过）。

---

## 5. 联调核对清单（无 Neo4j / 无全库强制 / 无浏览器持 Key）

| 核对项 | 期望 | 验证方式 |
|---|---|---|
| 无新增图谱引擎依赖 | 代码走查无 Neo4j/图数据库依赖 | `pom.xml` diff + 依赖树 |
| 无全局图谱接口 | 无任何「跨库图数据」端点 | `LibraryController`/BFF `KbController` 路由清单核对 |
| `GET /datasets/{id}/graph` 不代理 | BFF/前端均无该代理端点 | 路由清单核对 |
| apiKey 仍服务端 | `MIS_KB_ENGINE_API_KEY` 环境变量注入，不进 Git/前端 | `bootstrap.yml` + 前端代码走查 |
| 检索仍走 ACL | `KbRetrieveService`/`KbHitTestService` 既有 `hasPermission` 强制校验 | 代码走查（两服务均未改动 ACL 逻辑） |

---

## 6. 待办与移交

1. **联调执行人**：按 §2.1 满足前置条件后，按 §2.3/§2.5 执行 12 条 × 2 组金标，回填本报告 §2.5 模板；
2. **回归执行人**：执行 §4 全量回归并回填结果；
3. **门禁裁决**：金标 A/B 硬指标 ≥60% + 软指标 ≤2× 通过 → 主理人裁决是否启动 Wave C；
   不达标 → 能力码保留 true 但不开新图库，图谱仅作已开库增强项。

---

*本报告由工程师（寇豆码）于 T04 阶段产出；金标 A/B 实测部分因缺少联调环境凭据（引擎 apiKey /
DB 写权限）标记为「待联调执行」，属工程诚实交付，不作为 Wave C 放行依据。*
