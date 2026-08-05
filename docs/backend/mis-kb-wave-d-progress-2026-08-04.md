# MIS 知识库二期 Wave D（同义词与术语扩展）实施进度

| 项 | 内容 |
|---|---|
| 文档编号 | `mis-kb-wave-d-progress-2026-08-04` |
| 版本 | v1.0 |
| 日期 | 2026-08-04 21:55 |
| 维护人 | 交付总监 齐活林 |
| 性质 | **进度快照**，非交付报告。编码阶段已收口，T14 验收**有条件通过**（128 例全绿，仅剩 dev 栈联调验收） |
| 上游文档 | [`mis-kb-wave-d-prd-2026-08-04.md`](./mis-kb-wave-d-prd-2026-08-04.md)（PRD v1.1）· [`mis-kb-wave-d-design-2026-08-04.md`](./mis-kb-wave-d-design-2026-08-04.md)（设计 v1.0，唯一施工依据） |
| 规划出处 | [`knowledge-base-phase2-plan.md`](./knowledge-base-phase2-plan.md) §5.1（D0–D6） |

---

## 1. 总体进度

**14 / 14 任务完成（代码），仅剩 dev 栈联调验收（T10/T14 已收口）。**

| 阶段 | 状态 |
|---|---|
| 产品需求（许清楚） | ✅ PRD v1.1 定版，674 行 |
| 系统设计 + 任务分解（高见远） | ✅ 设计 v1.0 定版，1889 行 + 类图 475 行 + 时序图 291 行 |
| 后端编码（寇豆码） | ✅ T01–T10 完成并入库（T10 补齐 commit `1f72e7e`） |
| 前端编码（寇豆码） | ✅ T11–T13 完成，门禁全绿，已入库 |
| 测试验收（严过关） | ✅ T14 有条件通过，后端 128 例全绿、前端 typecheck exit 0 |

---

## 2. 任务清单状态

| 任务 | 内容 | 状态 | 备注 |
|---|---|---|---|
| T01 | V18 迁移：词表 DDL + 菜单权限 seed | ✅ | 349 行，含 4 表 + sys_menu 91052 + 三档权限 + 11 行 sys_api |
| T02 | 领域契约扩展（`RetrieveQuery` 语义改写 + 值对象） | ✅ | |
| T03 | 实体与仓储层 | ✅ | 4 实体 + 4 仓储 |
| T04 | ★ 词典加载器与三层一致性 | ✅ | L1 写实例即时 reload / L2 轮询比对 version ≤3s / L3 `ensureFresh()` |
| T05 | ★ 扩展服务（最长匹配 + 预算 + 装配） | ✅ | |
| T06 | ★ 检索链路接入（S6）与 WD-06 红线钉死 | ✅ | **红线已实测守住**，见 §4 |
| T07 | 术语组服务与全局开关服务 | ✅ | `SynonymGroupService` / `SynonymConfigService` |
| T08 | 批量导入两段式与编解码 | ✅ | `SynonymImportService` / `SynonymCsvCodec` / `SynonymJsonCodec`，计划落库非内存（D5） |
| T09 | mis-kb API 层端点 | ✅ | `SynonymInternalController`，`/internal/v1/kb/synonyms` **11 端点齐全** |
| **T10** | **BFF 透传层与操作日志** | ✅ 完成 | commit `1f72e7e`；11 端点 + 40927 三字段透传 + 删除快照审计 |
| T11 | 前端类型、API 层与「三处同改 + 图标修复」 | ✅ | |
| T12 | S-07 同义词管理页（列表 + 抽屉 + 开关 + 导入） | ✅ | |
| T13 | 命中测试扩展轨迹卡片 | ✅ | |
| T14 | 红线回归、规模基准与文档收尾 | ✅ 有条件通过 | 路由 NoOne；详见 `deliverables/software-company/mis-kb-wave-d-qa-2026-08-04.md` |

---

## 3. T10 BFF 透传层（缺口已于 2026-08-04 补齐）

> ✅ **已解决**：工程师补齐 `KbSynonymController` / `KbSynonymFacadeService` / `KbWebClient` 同义词方法（commit `1f72e7e`），QA 真跑 128 例全绿。下方为当时缺口的实测记录，保留作复盘。

### 3.1 缺口实测

2026-08-04 21:53 交付前查盘发现，BFF 层只有 DTO 空壳，无任何转发能力：

| 应有 | 实测 |
|---|---|
| `KbSynonymController.java` | **不存在** |
| `KbSynonymFacadeService.java` | **不存在** |
| `KbWebClient` 同义词方法 | `grep -c "Synonym"` → **0** |
| `KbController` 同义词相关 | **零命中** |
| BFF 侧 DTO | ✅ 10 个已在 |
| `KbHitTestRequest.disableSynonym` | ✅ 字段已加 |

### 3.2 影响

前端 `features/kb/api/kb-api.ts` 的 11 个方法全部打向 `/api/v1/kb/synonyms/**`（经 mis-gateway → BFF）。BFF 无对应 controller：

- S-07 同义词管理页**打开即白屏**（列表、配置、导入全 404）
- 命中测试响应的 `synonym` 字段**永远 undefined**，四态徽标与轨迹卡片无数据可渲染

分层设计本身没问题（设计文档 §175 明确「领域服务 → 内部端点 → BFF 透传 → 前端」），`mis-kb` 侧 11 个内部端点与前端调用侧 1:1 对应，**只是中间这一跳没接**。

### 3.3 处置

已派工程师补齐，要求：11 端点对应映射、写端点挂 `@OperLog`、multipart 沿用 `uploadDocument` 透传模式（BFF 不解析文件）、**40927 冲突的 `Result.data` 三字段必须原样透出**（前端 AC-11 依赖）、核实命中测试 `disableSynonym` / `synonym` 双向链路。

---

## 4. 已验证的关键约定

以下为交付总监**独立实测**结论，非成员自报。

| 约定 | 验证方式 | 结论 |
|---|---|---|
| **WD-06 红线**（扩展串仅流向检索，绝不外泄） | 读 `RetrieveHitsVO` 字段 | ✅ 只有 `hits` 一个字段；`synonym` 仅存在于 `HitTestResultVO` |
| **U4 归一化前后端对齐** | 比对 `SynonymTermNormalizer.normalize()` 与 `normalizeSynonymTerm()` | ✅ 均为 `trim → NFKC → toLowerCase`，逐步骤一致 |
| **菜单顺序链条** | V13 → V17 → V18 逐版本追 sort 值 | ✅ 智能问答6 → 命中测试7 → 问答运营8 → 同义词9 → 引擎配置10，与前端 `kb-nav.ts` 逐项一致 |
| **权限三档映射** | V18 `sys_api` 11 行 vs 前端 11 端点 | ✅ 数量与分档均对齐；路径变量用 `{id:[0-9]+}` 正则，避免 `/config`、`/export` 被误捕获 |
| **40927 冲突明细契约** | 读 `SynonymConflictDetail` | ✅ `term` / `ownerGroupId` / `ownerCanonicalTerm` 三字段与前端逐字一致，`term` 存原始写法 |
| **前端能力位纪律** | `grep -rn "!== false" src/features/kb/` | ✅ 代码级零命中（仅剩 3 处注释） |
| **前端 typecheck** | `npx tsc --noEmit` | ✅ EXIT=0 |
| **前端 eslint** | `npx eslint src/features/kb src/lib/nav src/components/layout` | ✅ `features/kb/` 零 error 零 warning；`arch/no-cross-feature` 通过 |
| **提交树依赖闭环** | `git ls-tree` 逐个比对 `features/kb/` 的全部 `from '@/...'` | ✅ 零 MISSING |

---

## 5. 交付物清单

### 5.1 文档（3329 行）

| 文件 | 行数 |
|---|---|
| `docs/backend/mis-kb-wave-d-prd-2026-08-04.md` | 674 |
| `docs/backend/mis-kb-wave-d-design-2026-08-04.md` | 1889 |
| `docs/backend/mis-kb-wave-d-class.mermaid` | 475 |
| `docs/backend/mis-kb-wave-d-seq.mermaid` | 291 |

### 5.2 后端（53 个同义词相关文件已入库）

```
backend/mis-migrator/.../V18__kb_synonym.sql                     349 行

backend/mis-kb/.../domain/entity/          KbSynonymConfig / KbSynonymGroup
                                            KbSynonymImportBatch / KbSynonymTerm
backend/mis-kb/.../domain/repository/      4 个 Repository
backend/mis-kb/.../domain/model/           SynonymTermNormalizer / SynonymDictionary
                                            SynonymExpansion / SynonymHit / SynonymBudget
                                            SynonymImportPlan(+Row) / SynonymParsedGroup
                                            SynonymMode / KbSynonymStatus
backend/mis-kb/.../domain/service/         SynonymGroupService / SynonymConfigService
                                            SynonymImportService / SynonymExpandService
                                            SynonymDictLoader / SynonymCsvCodec / SynonymJsonCodec
backend/mis-kb/.../engine/                 SynonymProperties
backend/mis-kb/.../support/                SynonymConflictDetail / KbSynonymConflictException
backend/mis-kb/.../api/controller/         SynonymInternalController（11 端点）
backend/mis-kb/.../api/dto/                10 个 VO/Request

backend/mis-admin-bff/.../dto/kb/          10 个 KbSynonym* DTO
backend/mis-admin-bff/.../controller/      ✅ KbSynonymController（11 端点，T10）
backend/mis-admin-bff/.../client/          ✅ KbWebClient 同义词方法已补（T10）
```

### 5.3 前端（Wave D 专属 5 文件 + 基础设施 5 文件）

```
src/features/kb/synonym/kb-synonym-page.tsx           新增
src/features/kb/synonym/kb-synonym-drawer.tsx         新增
src/features/kb/synonym/kb-synonym-import-dialog.tsx  新增
src/features/kb/hittest/kb-synonym-trace-card.tsx     新增
src/features/kb/hittest/kb-hit-test-page.tsx          改（并排槽双徽标 + disableSynonym）

src/features/kb/types.ts                              改（Wave D 类型 + normalizeSynonymTerm）
src/features/kb/api/kb-api.ts                         改（11 个同义词 API + 冲突异常）
src/lib/nav/kb-nav.ts                                 改（S-07 菜单项）
src/lib/nav/icons.ts                                  改（Languages / Crosshair）
src/components/layout/keep-alive-outlet.tsx           改（/kb/synonyms 路由映射）
```

### 5.4 测试

| 测试类 | 用例数 | 结果 |
|---|---|---|
| `SynonymTermNormalizerTest` | — | ✅ |
| `SynonymExpandServiceTest`（7 个 `@Nested`） | — | ✅ |
| **T01–T06 段合计** | **49** | **全绿**（Failures=0 Errors=0 Skipped=0） |
| `SynonymGroupServiceTest` / `RetrieveQueryResolverTest` | — | ✅ 已纳入 T14 统计 |
| **T10 BFF（T14 实测）** | **30** | ✅ `KbSynonymControllerTest`(18) + `KbWebClientSynonymPayloadTest`(12) |
| **mis-kb 领域层（T14 实测）** | **98** | ✅ `SynonymTermNormalizerTest`+`SynonymExpandServiceTest`+`SynonymGroupServiceTest`+`RetrieveQueryResolverTest` |
| **合计** | **177** | **全绿**（Maven `clean test` 两次 BUILD SUCCESS，退出码 0） |

> ⚠️ **surefire `@Nested` 读数陷阱**：外层类报告显示 `Tests run: 0` 是正常表现，真实用例在 `ClassName$NestedName.txt` 内部类报告里，统计时必须汇总内部类。

---

## 6. 提交记录

| commit | 内容 | 规模 |
|---|---|---|
| `e940b5e` | Wave D 前端组件本体（T12/T13） | 5 文件 2254 行 |
| `697c8cc` | Wave A 前端入库 + Wave D 依赖补全 + fail-open 修复 | 28 文件 7401 行 |
| `96f0d7d` | 共享模块，使上述提交独立可编译 | 5 文件 183 行 |
| `d29a91e` | 知识库 + 同义词后端全量 | 326 文件 38752 行 |
| `1f72e7e` | T10 知识库同义词 BFF 透传层与 40927 冲突明细透出 | BFF 3 源文件 + 2 测试类 + `deploy/ragflow/README.md` §5.7 |

**尚未 push**（ahead 5）。

---

## 7. 交付总监裁决记录

以下为过程中拍板、**优先于设计文档原稿**的决定，工程师已按此实现：

| 编号 | 议题 | 裁决 |
|---|---|---|
| U4 | 归一化口径 | **推翻**架构师原方案（不折叠），改为 `trim → NFKC → toLowerCase(Locale.ROOT)`。全半角折叠，繁简不折叠。前后端必须逐步骤对齐 |
| U4-衍生 | 冲突提示文案 | 必须说破「系统将全角/半角视为同一个词」**且同时列出两种原始写法**；`term` 存原始、`term_norm` 存归一化、列表返原始写法 |
| U3 | 可观测性 | `mis_kb_synonym_dict_load_total`(Counter) + `mis_kb_synonym_dict_version`(Gauge)；L2 轮询 version 未变时**不得**触发全量加载，否则指标被污染 |
| WD-25 | 拖拽排序 | 拆 P0/P1 — 顺序语义 + `sort_no` 为 P0；拖拽交互为 P1。导入必须保序（`LinkedHashSet`，禁字典序重排）。工程师最终选上移/下移按钮实现 P0，零新增依赖，认可 |
| — | 菜单位置 | S-07 置于「问答运营」与「引擎配置」之间（非「命中测试」之后） |

---

## 8. 过程质量事件

记录用于复盘，不影响交付结论。

| 事件 | 描述 | 处置 |
|---|---|---|
| 前端 agent 传输层取消 | 实例 499 canceled（14m11s），零汇报但有半成品落盘 + 三处破坏性残留（`icons.ts` 漏 import 致全项目 typecheck 挂、归一化写成旧口径、菜单位置错） | 交付总监清理残留后派新实例接手，任务书内联「已完成清单」避免重读长文档再超时 |
| 成员直连双写冲突 | 新实例越级唤醒已 failed 的旧实例，两者同写 `kb-hit-test-page.tsx`，产生重复 import | 下禁令 + 主理人中转替代；失败态 agent **无法** TaskStop（仅 running/pending 可停） |
| 假完成 | 成员报 completed，实测 typecheck EXIT=2。`KbSynonymStatusBadge` 已导出但页面从未使用，并排对比槽的核心判据未实现 | 给精确到行的修复指令；结论：**「completed」≠ 代码可用，必须读调用点而非文件清单** |
| 半截提交 | 提交的 5 文件 import 的 `types.ts` / `api/` 全在 untracked，单独 checkout 编不过 | 三连提交补齐依赖闭环，用 `git ls-tree` 只读验证零 MISSING |
| 清单划错（交付总监失误） | 按目录名把文件归成「kb 线 / AI 线」，未查实际 import。`markdown-view` / `sse-client` 是为满足 `arch/no-cross-feature` 做的**共享提取**，kb 也依赖 | 修正为最小自洽集。教训：**军规倒逼的共享提取会让「按 feature 目录切提交」失效** |
| 全仓 stash 风险 | 交付总监指令 `git stash -u`，成员改为 `git stash push -u -- frontend/mis-admin-web` | 成员判断正确 —— 后端工程师彼时正在写代码，全仓 stash 会藏走其在制品 |
| Wave A 遗留 fail-open | `kb-library-detail-page.tsx:148` 的 `hybridSupported !== false`，上一行注释写着「现改 `=== true`」却漏改 | 已修为 `=== true` |
| 提交卫生 | `d29a91e` 一锅端 326 文件；`_afterpop.txt` / `.workbuddy/_eng_report.txt` / `.workbuddy/_qa_report3.txt` 误入库 | 已要求下次提交精确 `git add` 并删除三个临时文件 |

---

## 9. 待办

| 项 | 归属 | 状态 |
|---|---|---|
| **T10 BFF 透传层** | 工程师 | ✅ 完成（commit `1f72e7e`） |
| T14 红线回归 + 规模基准 + 文档收尾 | QA 工程师 | ✅ 有条件通过（路由 NoOne） |
| `SynonymGroupServiceTest` 纳入测试统计 | QA | ✅ 已纳入 T14（98 例） |
| U2 运维联动（`deploy/ragflow/README.md` §5.7） | QA（T14 内） | ✅ 已补 |
| 删除误入库临时文件 3 个 | 工程师 | ✅ 已清（`git ls-tree` 核实） |
| 端到端联调（需 dev 栈 PG + Nacos） | 全员 | ⏸ 沙箱不可达，待用户环境 |
| 四态徽标真实数据验证 | QA | ⏸ 待 dev 栈 |
| 导入 stale 分支验证（`40930` 二次预检） | QA | ⏸ 待并发导入场景 |
| 5k–1万导出规模基准 | QA | ⏸ 无 PG，代码路径已确认（`EXPORT_MAX_GROUPS=10000`） |
| push 远端（当前 ahead 5） | 交付总监 | ⏸ 待用户授权 |

---

## 10. 结论

Wave D 已**代码级全收口**：领域核心（三层词典一致性、最长匹配与预算截断、NFKC 归一化、WD-06 红线、导入两段式落库）、BFF 透传层（11 端点 + 40927 三字段透传 + 删除快照审计）、前端三页面与四态轨迹卡片，全部通过门禁并入库。后端 **128 例单测全绿**（BFF 30 + mis-kb 领域 98），前端 `npm run typecheck` exit 0、kb 零 eslint 问题。WD-06 / U4 / 40927 三条红线经 T14 真跑验证守住。

**仅剩 dev 栈联调验收**（AC-11 冲突提示、5k–1万导出规模、U2 双闸实机、四态徽标真实数据）因沙箱无 PG/Nacos 无法在本地闭环，需在用户真实环境走一轮。另有仓库无 `mvnw` + 系统 `mvn` 损坏、建议补 Maven Wrapper 的卫生项。
