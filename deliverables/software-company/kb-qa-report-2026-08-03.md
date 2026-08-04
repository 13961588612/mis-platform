# MIS 知识库 + RAG P0 — QA 静态验证与回归核查报告

- 审查人：严过关（QA）
- 日期：2026-08-03
- 范围：P0 全栈（mis-kb / mis-admin-bff / ai-platform(mis-rag) / mis-admin-web）
- 边界：不写新测试、不改业务代码、不做全量走查；Java 编译与单测由用户 JDK17 环境执行，QA 侧核对其 surefire 产物

## 一、可执行验证

| 命令 | 结果 | 说明 |
|---|---|---|
| `cd frontend/mis-admin-web && npx tsc --noEmit` | **通过**（已执行，exit 0，耗时 56s） | 全量 TypeScript 类型检查零错误 |
| `cd frontend/mis-admin-web && npx eslint src/features/kb` | **通过**（已执行，exit 0） | kb 模块 15 个文件零 lint 告警 |
| `cd agent/ai-platform/backend && python -m compileall src` | **通过**（已执行，exit 0） | 24 个包全部字节码编译成功，无语法错误 |
| `cd deploy/ragflow && docker compose --env-file .env.example config -q` | **失败**（已执行，真实退出码 1） | 见「三、发现的源码问题」P-01。**根因有两层**：①`docker-compose.yml` 4 个变量共 5 处 `:?` 强口令断言（40/71/94/100/123 行）无插值来源即报错——此为 README §4.1 刻意的安全设计，非缺陷；②服务级 `env_file: - .env` 硬依赖一个仓库未提供的文件——此为真 bug。**原报告的复现方式不足以定位根因**：`cp .env.example .env` 同时消解了①和②两层，无法区分是哪层生效。有效判据是本行命令 `--env-file .env.example`（它填平了插值来源，从而隔离掉①，只考验②的 env_file 声明） |
| `mvn -pl mis-kb,mis-admin-bff -am clean test` | **通过**（用户 JDK17 环境已执行，**22/22**） | `KbVisibilityServiceTest` 7/7、`AiCapabilityTranslatorTest` 5/5、`DagBuilderTest` 10/10，Failures/Errors 均为 0。产物：`backend/mis-kb/target/surefire-reports/`、`backend/mis-admin-bff/target/surefire-reports/`（mtime 2026-08-03 15:56）；编译产物 `mis-kb/target/classes` 99 个 class、`mis-admin-bff/target/classes` 208 个 class（含全部 `dto/kb/*`）。**非 QA 亲自执行**：QA 沙箱仅 JDK1.8 且 mvn 启动器损坏，本行结果取自对仓库内 surefire 产物的逐份核对 |

> 注 1：docker compose 那条命令用管道时退出码被 `tail` 掩盖成 0，必须去掉管道才拿到真实码 1。本表结果取自去管道后的复跑。
>
> 注 2：`surefire-reports/2026-08-03T15-56-29_244.dumpstream` 中 `Boot Manifest-JAR contains absolute paths in classpath 'd:\maven\repository\...'` 与 `'other' has different root`，是**项目在 `D:` 盘、maven repo 在 `d:\maven` 跨盘符引发的 surefire 无害告警**，不代表测试失败——三份 `.txt` 报告 Failures/Errors 全为 0。勿将该 dumpstream 误读为错误。

## 二、5 个高危回归点结论

以下全部为**静态确认**（读代码推导），非运行时测试通过。

| # | 检查点 | 判定 | 依据（文件:行号） |
|---|---|---|---|
| R1 | IDOR 越权 | **通过** | 见下 R1 详述 |
| R4 | 四层契约字段对齐 | **有问题**（1 处中危 + 2 处低危，主链路可用） | 见下 R4 详述 |
| R3 | 可见性公式 | **通过**（单测覆盖有 2 处缺口） | 见下 R3 详述 |
| R2 | 反馈 editable_once | **有问题**（低危并发 TOCTOU） | 见下 R2 详述 |
| R5 | 降级兼容 | **通过** | 见下 R5 详述 |

### R1 IDOR 越权 —— 通过

| 判定项 | 结论 | 依据 |
|---|---|---|
| `appendMessage` 调 `requireOwnedSession` | ✅ | `KbQaService.java:110` |
| `saveCitations` 调 `requireOwnedSession` | ✅ 先按 `messageId` 取消息，再校验其所属会话归属，堵住「借 messageId 挂引用」 | `KbQaService.java:130-132` |
| 越权统一返回 `KB_SESSION_NOT_FOUND` | ✅ 不泄露他人会话存在性 | `KbQaService.java:275-283`（写路径）、`:176-179`（读详情）、`:220-223`（反馈） |
| `createSession` 用 `X-User-Id` 覆盖请求体 `userId` | ✅ `Long owner = actingUserId != null ? actingUserId : req.userId()`，且不一致时 WARN 留痕 | `KbQaService.java:80-87` |
| Controller 正确注入实际用户 | ✅ 三个写端点均传 `currentUserId()`（从 `SecurityContextHolder` 解析） | `QaInternalController.java:83, 94, 101, 104-106` |

**存在性预言机（oracle）检查**：会话不存在与会话属他人，两条路径都经 `requireSession` → `KB_SESSION_NOT_FOUND`，错误码与文案完全一致，攻击者无法据此区分 → 无侧信道泄露。

**补充观察（低危，见 P-04）**：`actingUserId == null` 时按设计跳过归属校验（纯内部服务调用）。该分支安全性依赖 Gateway 严格限制 `/internal/**` 来源 + `X-User-Id` 不可被外部伪造。此为架构前提，非代码缺陷，但建议在部署清单中列为强制核查项。

### R4 四层契约字段对齐 —— 有问题

**请求方向（前端 → BFF → Python → mis-kb）：主链路对齐 ✅**

| 字段 | 前端 kb-api.ts | BFF AiRagRequest | BFF buildRagMetadata | Python from_message | 结论 |
|---|---|---|---|---|---|
| question | `question` :328 | `question` :19 | `"question"` :126 | `meta["question"]` :147 | ✅ |
| libraryIds | `libraryIds` :329 | `libraryIds` :31 | `"library_ids"` :128 | `library_ids`/`libraryIds` 双读 :152 | ✅ |
| topK | `topK` :331 | `topK` :28 | `"top_k"` :130 | `top_k`/`topK` 双读 :154 | ✅ |
| threshold | **未发送**（见 P-03） | `threshold` :37 | `"threshold"` :131 | `threshold` :160 | ⚠️ 链路通但前端无入口 |
| sessionId | `sessionId` :330 | `sessionId` :34 | `"session_id"` :132 | `session_id`/`sessionId` 双读 :173 | ✅ |

- `buildBody` 对 extraMetadata 做 `if (v != null)` 过滤（`AiCapabilityTranslator.java:100-104`），null 不下传，避免 Python 侧解析歧义 ✅
- Python → mis-kb 出参正确转回 camelCase：`libraryIds/topK/threshold`（`kb_client.py:167-173`）、`CitationItem.to_api()` 的 `libraryId/documentId/chunkText/score`（`retrieve.py:159-166`）✅

**响应方向：`sessionId` / `kbSessionId` 语义分离 ✅（关键回归点，已确认无互相覆盖）**

- Python `QaAnswer.to_api()` 把 **KB 数值会话 ID** 写进 JSON 的 `sessionId` 键（`retrieve.py:248-253`）
- BFF `parseRag` 把该键读入 **`kbSessionId`**（`AiCapabilityTranslator.java:310`），而 `resp.setSessionId(data.getSessionId())` 取的是**平台 UUID**（`:306`）——两者来源不同、互不覆盖 ✅
- `readLong`（`:345-362`）对非数值容错返回 null，平台 UUID 不会被误塞进 `kbSessionId` ✅
- 前端优先取 `kbSessionId`，回退 `sessionId` 且用 `normalizeSessionId` 过滤非正整数（`kb-api.ts:285-289, 337`）——平台 UUID 归一为 null，不会污染 KB 会话 ID ✅

**citations 8 字段端到端：Python/BFF 齐全，前端丢 2 个（见 P-02）**

| 字段 | Python to_api :220-231 | BFF AiRagCitation | 前端 RawRagCitation :275-282 | 前端 KbQaCitation types.ts:103-109 |
|---|---|---|---|---|
| id | ✅ | ✅ :21 | ✅ | ✅ |
| libraryId | ✅ | ✅ :33 | ✅ | ✅ |
| documentId | ✅ | ✅ :36 | ✅ | ✅ |
| chunkText | ✅ | ✅ :39 | ✅ | ✅ |
| score | ✅ | ✅ :30 | ✅ | ✅ |
| **source** | ✅ | ✅ :24 | ❌ **未声明未读取** | ❌ **无此字段** |
| chunk | ✅ | ✅ :27 | ✅（仅作 chunkText 兜底） | — |
| **messageId** | ✅ | ✅ :42 | ❌ 未读取 | ❌ 无此字段 |

### R3 可见性公式 —— 通过（单测覆盖有缺口）

| 判定项 | 结论 | 依据 |
|---|---|---|
| `(public ∧ enabled)` | ✅ 先 `findByStatus(ENABLED)` 再判 `Secrecy.isPublic` | `KbVisibilityService.java:44-56` |
| `∪ ACL(user)` | ✅ | `:63-65` |
| `∪ ACL(role)` | ✅ 遍历 IAM 返回的角色逐个查 ACL | `:67-74` |
| `− disabled` **一票否决** | ✅ **从数据源头掐断**：候选集只来自 `findByStatus(ENABLED)`，受限库集合 `restricted` 也只在 enabled 内构造。即使 ACL 授权了 disabled 库，因其压根不在候选集中，`granted.contains(libId)` 永无机会命中 | `:44, 50, 75-79` |
| 检索只命中可见库（禁止先全库召回再过滤） | ✅ **在引擎调用前收敛范围**：`filterVisible` 求交集得 `scoped`，`scoped` 为空则**直接返回空**、根本不调引擎；`scoped` 作为 `RetrieveQuery` 参数下传，引擎只在可见库内检索 | `KbRetrieveService.java:50-57` |
| IAM 降级 fail-safe | ✅ `KbSubjectClient` 未配置 base-url 或调用抛异常时返回空列表 → `granted` 只剩用户级 ACL，无角色授权 → 受限库不可见 | `KbSubjectClient.java:31-33, 37-40, 53-56` |

**关键确认**：`filterVisible(requested, visible)` 在 `requested` 为空时回退返回 `visible`（`KbVisibilityService.java:85-87`），是「不指定库=全部可见库」的正确语义，**不是 fail-open**——因为 `visible` 本身已是收敛后的可见集。

**单测 review（`KbVisibilityServiceTest.java`，7 个用例，不重写）**：现有覆盖合理——public 默认可见、受限无 ACL 不可见、用户级 ACL、角色级 ACL、disabled 排除、IAM 降级仅 public、filterVisible 交集。

两处覆盖缺口（建议补，非阻断）：
1. **`disabledLibrary_isNeverVisible_evenWithAcl`（:108-118）测试强度不足**：它把 `findByStatus(ENABLED)` mock 成空列表，等于假设「仓储已过滤好」，只验证了 mock 行为而非服务逻辑。真正的一票否决语义（返回 enabled+disabled 混合集时 disabled 仍被排除）未被覆盖。不过该风险由 `findByStatus` 的 SQL 语义天然保证，实际泄露风险低。
2. **`− deleted` 分支完全未覆盖**：设计公式含 `deleted`，但服务代码只按 `status=ENABLED` 过滤，未见 `deleted` 字段处理。需确认库表是否用 `status` 兼表软删（若 deleted 是独立列则为逻辑遗漏）——**本轮无法判定，建议工程师确认**。

### R2 反馈 editable_once —— 有问题（低危并发）

| 判定项 | 结论 | 依据 |
|---|---|---|
| 首次提交建记录并置 `editable_once=1` | ✅ | `KbQaService.java:231-236` |
| 第二次提交更新并置 0 | ✅ | `:239-242` |
| 第三次抛 `KB_FEEDBACK_ALREADY` | ✅ 且对 `editableOnce == null` 做了防御（历史脏数据按已用尽处理） | `:237-238` |
| 归属校验（防止改他人反馈） | ✅ 越权同样返回 `KB_SESSION_NOT_FOUND` | `:220-223` |
| 分值边界校验 | ✅ 0~5，null 放行 | `:224-227, 296-303` |
| 状态机闭合性 | ✅ 三态（不存在 → 1 → 0）无遗漏分支 | `:230-242` |
| **并发安全** | ⚠️ **存在 TOCTOU**，见 P-05 | `:230-248` |

**并发分析**：
- **重复插入**已被 DB 兜住：`kb_qa_feedback` 有 `CONSTRAINT uk_kb_feedback_session UNIQUE (session_id)`（`V12__kb_schema.sql:135`），并发首次提交只有一方成功，另一方触发约束异常 → 不会产生重复行（也保护了 `findBySessionId` 返回 Optional 不会炸）。
- **但「改一次」额度可被并发突破**：两个并发的第二次提交都读到 `editableOnce=1`，都走 else 分支置 0 并 save，两次写入均成功 → 实际发生 3 次有效写入，违反 editable_once 语义。实体无 `@Version` 乐观锁，`findBySessionId` 也未加悲观锁。
- **影响面小**：同一用户同一会话的反馈并发双击才触发，且仅多覆盖一次评分，无越权、无数据损坏。

### R5 降级兼容 —— 通过

| 判定项 | 结论 | 依据 |
|---|---|---|
| `type=noop` 时建库/上传不报错 | ✅ 返回占位 ref（`noop-<name>`），增删改查全部 no-op 不抛异常 | `NoopAdapter.java:31-68` |
| `type=noop` 时仅检索返回空 hits | ✅ `retrieve` 返回 `List.of()`；`health()` 恒绿；`capabilities()` 返回 unsupported | `NoopAdapter.java:71-83` |
| 问答落库在 noop 下可跑通 | ✅ 落库与检索解耦：`_persist` 独立于 hits，空 hits 时仍建 session/message，仅跳过 citations（`if message_id is not None and used_hits`） | `qa_pipeline.py:439-444` |
| 空检索时 prompt 不崩 | ✅ 显式插入「（无检索结果…）」占位并继续生成 | `qa_pipeline.py:292-293, 309-310` |
| 落库失败不吞答案 | ✅ 双层 `except`（`KbClientError` + 兜底 `Exception`），异常仅记日志，答案照常返回 | `qa_pipeline.py:445-459` |
| `MIS_KB_QA_ENABLED=false` 退化为纯提示词问答 | ✅ `is_kb_qa_request` 首行短路返回 False，整条 KB 管线不进入，走原通用 Agent 流程 | `qa_pipeline.py:59-60` |
| citations 为空数组而非 null（前端不白屏） | ✅ **四层均有兜底**：Python `default_factory=list`（`retrieve.py:238`）→ BFF `setCitations(null → List.of())`（`AiRagResponse.java:46-48`）→ 前端 `normalizeCitations` 非数组返回 `[]`（`kb-api.ts:305`）→ 组件 `!citations \|\| length===0` 渲染「（无引用）」（`kb-citation-list.tsx:6-8`） |

**额外确认**：前端 QA 页对 RAG 不可用是 **fail-closed 但不白屏**——`featuresLoaded` 前不判定不可用，加载后按 `rag-qa` 是否启用禁用输入框并显示 Badge 提示（`kb-qa-page.tsx:52-53, 214, 261, 267`）；历史加载失败也被 catch 成空列表，不阻断主流程（`:59-62`）。

## 三、发现的源码问题

均为**静态审查结论**，未经运行时复现（P-01 例外，已实测）。无高危、无阻断性缺陷。

| 编号 | 位置(文件:行号) | 问题 | 影响 | 建议修复 |
|---|---|---|---|---|
| **P-01** | `deploy/ragflow/docker-compose.yml:169-170` | **双根因，需分开看**：<br>**①（先触发，非缺陷）** 4 个变量共 5 处 `:?` 强口令断言——`MYSQL_PASSWORD`(:40)、`MINIO_PASSWORD`(:71)、`REDIS_PASSWORD`(:94,:100)、`ELASTIC_PASSWORD`(:123)，无 `.env` 时无插值来源即报错退出。这是 README §4.1 明文规定的**刻意安全设计**（「这四项未设置时 compose 会直接报错拒绝启动，不会静默用弱口令」），**必须保留**。<br>**②（真 bug）** 服务级 `env_file: - .env` 硬依赖一个仓库未提供、且未被 git 跟踪的文件 | **中**。仅②构成缺陷：CI 校验与新人首次拉起必踩，且 `--env-file .env.example` 这一官方文档式用法无法绕过（`env_file` 是服务级声明，与 `--env-file` 不是同一机制） | **已修复，采用方案①长语法**：改为 `env_file: - path: .env` + `required: false`（Compose v2.24+），经实测生效。三态回归（compose v5.1.4）：无 `.env`+`--env-file .env.example` → **exit 1 转 exit 0**；无 `.env` 裸跑 → 仍 exit 1，但错误**只剩** `MYSQL_PASSWORD is required`（根因①，符合预期）；`cp .env.example .env` 后 → exit 0（未回归） |
| **P-02** | `frontend/mis-admin-web/src/features/kb/api/kb-api.ts:275-282, 304-313`；`types.ts:103-109` | 引用的 `source`（文档标题）字段在前端边界被丢弃：`RawRagCitation` 未声明、`normalizeCitations` 未映射、`KbQaCitation` 无此字段 | **中**。Python 侧 `source_label()` 一路算出的人类可读来源名（文档标题，`retrieve.py:88-97`）到前端全部丢失，引用列表只能退化显示「知识库 12 · 文档 34」这类纯数字，溯源体验明显劣化。属 T10 契约补齐的遗漏项 | `RawRagCitation` 补 `source?: string \| null`；`KbQaCitation` 补 `source: string \| null`；`normalizeCitations` 映射该字段；`kb-citation-list.tsx:14-19` 优先渲染 `source`，缺失时才回退 ID 展示 |
| **P-03** | `frontend/mis-admin-web/src/features/kb/api/kb-api.ts:241-249, 325-332` | `KbRagAskPayload` 无 `threshold`，`askKbRag` 也未发送；而 BFF→Python 全链路已支持该参数 | **低**。相关性阈值无法从 UI 调节，链路能力闲置。非断链（后端有默认值兜底） | 若产品需要则补齐 payload 字段并在 QA 页暴露入口；若 P0 明确不暴露，建议在 `AiRagRequest.threshold` 注释标注「P0 暂无前端入口」，避免后续误判为断链 |
| **P-04** | `agent/ai-platform/backend/src/agent/mis_rag/qa_pipeline.py:425-459` | 续聊时 `session_id` 取自用户可控输入；若 mis-kb 因越权拒绝（`KB_SESSION_NOT_FOUND`），异常被 catch 后函数仍 `return session_id, message_id`，把**攻击者传入的他人 sessionId** 原样回传 | **低**（不构成越权）。mis-kb 侧写入已被拒、后续 `getSessionDetail`/`submitFeedback` 也都会拒（`KbQaService.java:176-179, 220-223`），无数据泄露；且会话不存在与属他人错误码一致，无存在性预言机。但表现为：本轮问答**静默未落库**而用户无感，前端 `activeSessionId` 被设成无效 ID，后续反馈请求连环失败 | 在 `except KbClientError` 分支中，若失败发生在 `append_message` 阶段则把 `session_id` 置回 `None` 再返回，避免回显未经校验的外部 ID；同时该告警日志建议提升为可告警指标 |
| **P-05** | `backend/mis-kb/.../KbQaService.java:230-248` | `submitFeedback` 的「读取-判断-写回」非原子：并发两次「第二次提交」都读到 `editable_once=1`，都置 0 并成功 save | **低**。editable_once 额度被突破一次（实际 3 次有效写入）。重复插入已由 `uk_kb_feedback_session` 唯一约束兜住（`V12__kb_schema.sql:135`），无重复行、无越权 | **已修复（悲观锁，非 `@Version`）**。实现方式为 Spring Data 派生查询 `findWithLockBySessionId` + `@Lock(PESSIMISTIC_WRITE)`（mis-kb 内 `@Query` 现已为 0），写路径（`KbQaService.submitFeedback:240`）取行锁，两个只读端点（`getSessionDetail:187`、`getFeedback:264`）保持无锁查询、不引入读放大。验证方式为静态自审 + 属性名与实体字段一致性核对。**元模型校验须待应用真实启动，尚未执行**（见五、#3）；**并发行为无测试覆盖，待 P1 补测**（见 P1 待办）。 |
| **P-06** | `backend/mis-kb/.../KbVisibilityService.java:43-81` | ~~设计公式含 `− deleted`，但实现只按 `status=ENABLED` 过滤，未见独立的 deleted/软删字段处理~~ | **非缺陷，已澄清关闭**。依据：① `V12__kb_schema.sql` 中 `kb_library` 仅有 `status SMALLINT NOT NULL DEFAULT 1`（1=enabled/0=disabled），**无独立 deleted 列**；② `KbLibraryService.delete():139` 是 `libraryRepository.delete(entity)`，P0 为**物理删除**（行直接消失）。故两条路径——物理删除（行不存在）与运营下架（`status=0`）——均被 `findByStatus(ENABLED)` 覆盖，`− deleted` 语义完整，原实现正确 | **无需代码改动，文档口径已对齐**（工程师已在 `KbVisibilityService` Javadoc 与 `docs/backend/mis-kb-system-design.md:727` 补充口径说明） |

> 说明：`frontend/.../features/ai/context/form-fill-bridge.tsx:2` 违反架构军规1 一项，按团队交代属 FormFill 既有技术债、非本次引入，本轮不计入上表。

> ⚠️ **CI 门禁告警（针对 P-01，务必留意）**：**「裸跑 `docker compose config` 必须 exit 0」不是合理的验收判据**。由于根因①的 4 处 `:?` 强口令断言，达成「裸跑 exit 0」的唯一途径是删除这些断言——**那是安全回退，等于放行弱口令静默启动**。正确的 CI 静态校验门禁应固定使用：
> ```
> cd deploy/ragflow && docker compose --env-file .env.example config -q
> ```
> 该命令既填平插值来源、隔离掉安全断言，又能真实考验 compose 文件本身的声明正确性。

## 四、端点三层对账

**完成度：已完成**（mis-kb 8 个 Controller 全部覆盖）

| 领域 | mis-kb（`/internal/v1/kb`） | BFF KbController（`/api/v1/kb`） | 前端 kb-api.ts | 结论 |
|---|---|---|---|---|
| 分类 | CategoryController：list / create / `PUT {id}` / `DELETE {id}` | `:50, 55, 61, 67` | `listCategories:45` / `createCategory:50` / `updateCategory:55` / `deleteCategory:60` | ✅ 4/4 对齐 |
| 知识库 | LibraryController：list / create / `GET {id}` / `PUT {id}` / `DELETE {id}` | `:75, 80, 85, 91, 97` | `listLibraries:82` / `getLibrary:89` / `createLibrary:94` / `updateLibrary:99` / `deleteLibrary:104` | ✅ 5/5 对齐 |
| 文档 | DocumentController：`:30, 35, 40, 47, 56, 62` | `:105, 110, 115, 121, 128, 134` | `listDocuments:111` / `getDocument:116` / `uploadDocument:124` / `setDocumentEnabled:137` / `reparseDocument:146` / `deleteDocument:151` | ✅ 6/6 对齐 |
| ACL | AclController：`:29, 34, 39` | `:142, 147, 153` | `listAcls:164` / `grantAcl:169` / `revokeAcl:174` | ✅ 3/3 对齐 |
| 问答/反馈 | QaController：`:38, 44, 50, 56` | `:161, 166, 171, 177` | `listMySessions:181` / `getSessionDetail:186` / `submitFeedback:199` / `getFeedback:191` | ✅ 4/4 对齐 |
| 运营只读 | OperationsController：`:30, 36` | `:184, 189` | `listAllSessions:212` / `listAllFeedback:217` | ✅ 2/2 对齐 |
| 引擎 | EngineConfigController：`/health :25`、`/capabilities :31`、**`/type :37`** | `/engine/health :196`、`/engine/capabilities :201`、**无 `/type`** | `engineHealth:224` / `engineCapabilities:229` | ⚠️ **孤儿端点 1 个**：`/internal/v1/kb/engine/type` 未经 BFF 暴露、前端无调用 |
| 内部 RAG/QA | QaInternalController：`resolve-visible :54` / `retrieve :65` / `qa/sessions :81` / `qa/messages :92` / `qa/citations/batch :99` | 不经 BFF（设计如此） | 不经前端 | ✅ 由 Python `kb_client.py:36-40` 常量一一对应消费，5/5 对齐，符合 §13 编排下沉裁定 |

**结论**：**无断链**（前端每个调用都有 BFF 与 mis-kb 对应实现）。孤儿端点 1 个（`/engine/type`），属可选诊断接口，前端「引擎能力」页未用到，**不影响 P0 功能**，可保留或后续清理。

## 五、已知限制

1. **Java 编译与单测非 QA 亲自执行，但已确认全绿**：QA 沙箱仅 JDK1.8 且 mvn 启动器损坏（父 pom enforcer 要求 JDK17），无法自行运行 `mvn -pl mis-kb,mis-admin-bff -am clean test`。该命令已由用户 JDK17 环境于 **2026-08-03 15:54–15:56** 执行，QA 侧通过**逐份核对仓库内 surefire 产物**确认结果：`KbVisibilityServiceTest` 7/7、`AiCapabilityTranslatorTest` 5/5、`DagBuilderTest` 10/10，合计 **22/22 通过**，Failures/Errors 全为 0。因此本报告 R3 章节对 `KbVisibilityServiceTest` 的评价，是「源码阅读 + 实际执行结果已绿」双重依据，非仅静态推断。
2. **无运行时/集成验证**：本轮全部结论为静态审查 + 4 条命令行检查，未启动任何服务，未做端到端联调、未验证 RAGFlow 真实检索、未做越权攻击实测。R1 的 IDOR 结论是代码路径推导，**建议在联调环境用两个账号做一次实际越权回归**。
3. **单元测试无法校验 JPA 映射层**：`mis-kb` / `mis-admin-bff` 两个模块**零集成测试**（无任何 `@SpringBootTest` / `@DataJpaTest` / `@WebMvcTest`），所有 Spring Data 派生查询的属性名、实体映射与 DDL 的对应关系，**只能在应用启动时由 Hibernate 校验**，运行期 `mvn test` 覆盖不到。对照表：

   | 环节 | 能否发现 JPA 查询/映射写错 |
   |---|---|
   | `javac` 编译 | ❌ 查询方法仅是接口声明，不解析属性名 |
   | 22 个已通过的 Mockito 用例（含 mis-kb 的 7 个） | ❌ repository 全被 `@Mock`，真实现不加载 |
   | `-am` 带上的 mis-common 等 `@SpringBootTest` | ❌ boot 的是各自 TestApplication，不含 kb 实体 |
   | **应用真实启动（连 dev 栈 PG）** | ✅ 唯一会校验的时刻（EntityManagerFactory 创建阶段） |

   **系统性缺口，不止 P-05 一处**：对一个 93 个 Java 文件、9 张新表、从未被启动过的新模块，`mvn test` 全绿与「模块能真正起来」之间存在实质鸿沟。若派生查询属性名拼错或实体映射有误，症状是 **mis-kb 启动直接失败**，要到部署/联调阶段才暴露。

   **风险变化（P-05 修复后续）**：P-05 初版修复用手写 JPQL `@Query`，现已改为 **Spring Data 派生查询** `findWithLockBySessionId` + `@Lock(PESSIMISTIC_WRITE)`（`KbQaFeedbackRepository.java:34-35`，mis-kb 内 `@Query` 命中数现为 0）。**启动期失败概率显著下降**，理由：派生查询的属性名由 Spring Data 从实体元模型解析，而 `findBySessionId` 这一同属性的派生查询在同一 repository 里已长期存在并工作，说明 `sessionId` 属性可解析；手写 JPQL 则要求人肉拼对实体名、别名、属性名，任何一处笔误都要等 `EntityManagerFactory` 启动才炸。这条改动**实质上收窄了「单元测试覆盖不到 JPA 层」这个缺口的暴露面**——但**没有消除它**：`@Lock` 是否真的生成 `FOR UPDATE`、锁是否在真实 PG 上生效，仍然只有真实启动 + 真实 PostgreSQL 才能证明（见下方 P1 待办）。

   **P1 待办（针对 JPA 盲区）**：必须跑在**真 PostgreSQL** 上（Testcontainers 或 dev 栈 PG），两线程同时提交「第二次反馈」，断言**恰好一个**拿到 `KB_FEEDBACK_ALREADY`。**禁止用 H2 替代** —— H2 的 `FOR UPDATE` 语义与 PostgreSQL 不一致，糊出来的绿灯会让人误以为该路径已验证，**比没有测试更危险**。
4. ~~**P-06 需工程师确认**~~ → **已澄清关闭**：`kb_library` 无独立软删列，P0 为物理删除，`− deleted` 语义由 `findByStatus(ENABLED)` 完整覆盖，实现正确。详见 P-06 条目。
5. 未覆盖：性能/并发压测、SQL 注入与文件上传安全、前端组件交互测试、mis-kb 其余 93 个 Java 文件的全量走查（按任务边界排除）。

**方法论备忘（本次修订的教训）**：判断 Java 模块是否编译/测试过，应**直接核对 `backend/*/target/surefire-reports/*.txt` 的 mtime 与内容**（以及 `target/classes` 下的 class 产物），而**不是仅凭 QA 自身沙箱能否执行该命令来下结论**。本轮初版报告即因只看沙箱能力，把用户环境已跑绿的构建误记为「环境受限未执行」。同理，读 surefire 输出时须区分 `.txt` 报告中的 Failures/Errors 计数与 `.dumpstream` 中的环境告警（如跨盘符 classpath 警告），后者不代表测试失败。

## 六、智能路由判定

**IS_PASS: YES**（有条件通过）

**路由：Engineer（寇豆码）** —— 移交 6 项非阻断问题，其中建议 P0 内修复 2 项。

判定理由：
- 5 个高危回归点中 **R1/R3/R5 三项通过**，R2、R4 仅有低-中危瑕疵，**无阻断性缺陷、无可利用的安全漏洞**；T10 的 4 处契约断链与 IDOR 修复经复核确认真实有效。
- 5 条可执行验证中 4 条通过（含 Java 构建 22/22 单测全绿），1 条失败（P-01）属部署配置问题，不影响应用代码正确性。
- 建议 P0 内修复：**P-01**（阻断全新环境拉起）、**P-02**（引用溯源体验劣化，且是 T10 契约补齐的遗漏项）。
- 可延后至 P1：P-03、P-04、P-05。
- ~~需澄清：P-06~~ → **已澄清关闭，非缺陷**。
- **放行前置条件（已满足）**：`mvn -pl mis-kb,mis-admin-bff -am clean test` 已在用户 JDK17 环境执行且 **22/22 全绿**（surefire 产物核对确认），此项不再构成未验证依赖。**剩余要求**：工程师完成 P-01/P-02 修复后**复跑一次该命令确认未回归**即可。
- **更强的门禁（建议列为 P0 交付验收项）**：本次修复最有价值的验收手段不是 `mvn test`，而是**用 dev 栈 PG 把 mis-kb 启动一次**。启动成功即证明所有**派生查询/实体映射**通过 Hibernate 校验；失败时报错会直接点名是哪个 query（与 五、已知限制 #3 互补：22/22 绿灯可信，但覆盖不到 JPA bootstrap 这一层）。

轮次说明：本轮为 Round 1，未发现测试代码缺陷（无需 QA 自修）。按 2 轮上限，若工程师修复 P-01/P-02 后需回归，Round 2 只复跑 compose config、前端 typecheck/eslint 与 Java 单测，并复核 P-02 改动点。

## 七、修订记录

> 本节为 2026-08-03（晚）的一次**事实核对更正**，仅修正因「QA 沙箱视角 ≠ 用户真实环境」导致的客观记载失真，**不涉及任何结论/判定变更**，IS_PASS: YES 不变，P-01/P-02 路由去向不变。

| 序 | 修订日期 | 修订位置（行/章节） | 失真原记载 | 更正后事实 | 修订原因（事实核对） |
|---|---|---|---|---|---|
| 1 | 2026-08-03（晚） | 第 6 行边界说明；一、表第 16 行（mvn）；五、已知限制 #1；六、放行前置条件 | 「Java 编译与单测需 JDK17 环境补跑 / 环境受限未执行」 | 由用户 JDK17 环境于 2026-08-03 15:54–15:56 执行，**22/22 全绿**；QA 经逐份核对 surefire 产物确认（mtime 15:56，KbVisibilityServiceTest 7/7、AiCapabilityTranslatorTest 5/5、DagBuilderTest 10/10），mis-kb 99 class、bff 208 class | QA 沙箱仅 JDK1.8 且 mvn 启动器损坏，初版误按「本人能否执行」下结论，与用户环境实际已跑绿的事实不符。**非判断分歧，是客观执行状态记载错误** |
| 2 | 2026-08-03（晚） | 一、表第 15 行（docker compose）；三、P-01 条目；新增 CI 门禁告警 | 根因仅写「`env_file: - .env` 硬依赖缺失文件」，并以 `cp .env.example .env → exit 0` 作为定位证据 | 补充**双根因**：① 4 个变量 5 处 `:?` 强口令断言（:40/71/94/100/123）是 README §4.1 刻意的**安全设计，非缺陷**；② 服务级 `env_file` 真 bug，已用长语法 `- path: .env`+`required: false` 修复。`cp` 同时消解两层无法定位；有效判据是 `--env-file .env.example` | 初版把「安全断言层」误算进缺陷，且 `cp` 复现方式混淆了两层。属**事实归因不完整**，更正后对 P-01 的修复方案与判定无变化 |
| 3 | 2026-08-03（晚） | 三、P-06 条目；五、已知限制 #3 | 「− deleted 分支未覆盖，需工程师确认是否逻辑遗漏」 | **非缺陷，已澄清关闭**：`kb_library` 无独立软删列（`V12__kb_schema.sql` 仅 `status SMALLINT`），P0 为物理删除（`KbLibraryService.delete():139` 直接 `delete`），`− deleted` 语义由 `findByStatus(ENABLED)` 完整覆盖 | 经核对 DDL 与实际删除实现，原「疑为逻辑遗漏」的假设被证伪。**非缺陷**，关闭 |
| 4 | 2026-08-03（晚） | 三、P-05 条目（建议修复列）；五、已知限制 新增 #3（单元测试无法校验 JPA 映射层）+ P1 待办 + 风险变化；六、放行前置条件 追加更强门禁 | P-05「建议修复」仍停留原始二选一建议（`@Version` 或悲观锁），未记录实际修法；报告未识别 mis-kb/BFF 零集成测试导致 JPA 层无验证门禁，存在过度声称验证强度的隐患 | P-05 记录实际修法（Spring Data 派生查询 `findWithLockBySessionId` + `@Lock(PESSIMISTIC_WRITE)`，mis-kb 内 `@Query` 现已为 0；`submitFeedback:240` 取行锁、只读端点保持无锁）+ 验证强度措辞「已修复；静态自审 + 属性名与实体字段一致性核对，元模型校验须待应用真实启动尚未执行，并发无测试覆盖待 P1 补测」；五、新增 JPA 映射层盲区限制（四行环节对照表 + 系统性缺口 + 派生查询风险变化说明）+ P1 待办（真 PG 并发断言、禁 H2）；六、追加「mis-kb 启动自检」更强门禁 | 验证强度校准：原报告未识别 mis-kb/BFF 零集成测试导致 JPA 层无门禁，属结论强度问题，非事实错误 |
| 5 | 2026-08-03（晚） | 三、P-05 验证方式列；六、更强门禁 | P-05 验证方式列为「静态自审 + 启动期方法名解析/元模型校验」；六、门禁提及 `@Query` | 验证方式拆分为「已执行：静态自审 + 属性名一致性核对」与「尚未执行：元模型校验（须应用真实启动）」；删除 `@Query` 表述（全后端命中数为 0） | 将「尚待执行的验证手段」误列为「已执行的验证方式」，与本报告五、#3、186 行结论自相矛盾；措辞由主理人上一版指令引入，非 QA 判断失误 |

**更正结论一致性说明**：五处更正均不改变原报告的核心判定——
- IS_PASS: YES（有条件通过）保持不变；
- 路由仍指向 Engineer（P-01/P-02 建议 P0 内修复，P-03/P-04/P-05 延后 P1）；
- 仅将「Java 构建未执行」改为「已确认全绿（用户环境）」、「P-01 单根因」改为「双根因（1 安全设计 + 1 真 bug）」、「P-06 待确认」改为「非缺陷已关闭」。
- 第四处（验证强度校准）亦不改变结论：IS_PASS: YES 与路由保持不变；仅校准 P-05 的验证强度表述，并补记 JPA 映射层盲区与「mis-kb 启动自检」门禁。与修正一互补——22/22 绿灯**可信**，只是覆盖不到 JPA bootstrap 这一层，绝非「22/22 不可信」。
- 第五处（措辞时序校准）亦不改变结论：将 P-05「已执行验证」与「尚待执行验证」断句分开，并删除已归零的 `@Query` 表述；与五、#3、186 行自洽，非 QA 判断失误。

