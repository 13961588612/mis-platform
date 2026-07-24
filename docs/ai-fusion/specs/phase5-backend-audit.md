# 后端集成契约审计报告（BFF ↔ ai-platform）

> 审计人：QA（接任，重新独立完成）
> 审计对象：`mis-admin-bff`（Java，静态核对）↔ `ai-platform`（Python，可实跑）
> 审计方式：BFF 侧仅静态读码；平台侧结合静态读码 + 实跑测试（`tests/test_mis_integration.py`、`tests/test_identity_enrichment.py` 全绿）交叉验证。
> 参考：架构师《phase5-frontend-design.md》§0.2（结论已逐项复核，下文标注「与架构师一致/补充」）。
> 标注约定：**[实跑]** = 经 pytest/运行时验证；**[静态]** = 仅代码静态推断（含 BFF 外部公共模块不可见部分）。

---

## 0. 审计清单总览

| # | 核查点 | 结论 | 性质 |
|---|---|---|---|
| 1 | URL 路径 / 方法 / base URL | **匹配** | 结构一致 |
| 2 | agent 映射（summary/extract/rag/chat → 4 个 agent_id） | **匹配** | 结构一致 [实跑] |
| 3 | 请求体字段 | **匹配** | 结构一致 |
| 4 | 响应体解析 + 包络 `Result{code,data,traceId}` | **匹配** | 结构一致 [实跑] |
| 5 | `X-Mis-*` 头名 / JSON 值结构 | **匹配** | 结构一致 [实跑] |
| 6 | 错误码传播（503 / 401） | **存疑 / 待优化** | 非阻断，建议改进 |
| 7 | SSE 流式端点 | **不匹配（已知缺口）** | 非阻断，设计已记录 T-stream |

**总体结论：后端集成 BFF↔平台 无阻断性结构性坑。** 核心契约（URL/方法、agent 映射、请求体、响应体、X-Mis-* 头）逐项结构一致、可联通、可解析；存在 2 个非阻断项（错误码透传收敛、SSE 流式未透传），均不阻断联调。

---

## 1. URL 路径 / 方法 / base URL —— 匹配

| 侧 | 证据 | 说明 |
|---|---|---|
| BFF 拼 URL | `AiPlatformClient.chat()`：`.uri("/api/v1/agents/{agentId}/chat", agentId)`，`client().post()`（`AiPlatformClient.java:89-90`，POST） | 路径含 `/api/v1/agents/{agentId}/chat` |
| base URL 来源 | `AiPlatformClient` 构造器：`plainBuilder.baseUrl(properties.getBaseUrl()).build()`（`AiPlatformClient.java:69`）；`AiPlatformProperties.getBaseUrl()` 默认 `http://localhost:8000`（`AiPlatformProperties.java:16`） | base URL 取 `mis.ai-platform.base-url` 配置 |
| 平台路由 | `main.py:358` `app.include_router(mis_capability_router, prefix="/api/v1")` + `mis_capability.py:61` `@router.post("/agents/{agent_id}/chat")` | 平台实际挂载为 `/api/v1/agents/{agent_id}/chat`，POST |

- **结论**：BFF 目标 = `http://localhost:8000/api/v1/agents/{agentId}/chat`（POST）== 平台路由（POST `/api/v1/agents/{agent_id}/chat`）。**路径、HTTP 方法、base URL 字段来源三者一致。**
- 探针：`AiPlatformClient.healthProbe()` 调 `.uri("/health")`（`:103-113`）；平台 `main.py:276-279` `@app.get("/health")` 返回 `{"status":"ok", ...}` —— 与 BFF `AiFeatureConfigService.probe()` 的 `"ok".equalsIgnoreCase(status)` 判定一致（**修正**：平台另有 `/ready` 返回 `ready/not_ready`，但 BFF 探的是 `/health` 返回 `ok`，无误配）。**[实跑]** 端点测试 `test_valid_rs256_enters_processing` 命中 `/api/v1/agents/mis-summary/chat` 返回 200 闭环验证。

---

## 2. agent 映射 —— 匹配（[实跑]）

| capability | BFF `agentIdFor`（`AiCapabilityTranslator.java:44-52`） | 平台 `configs/agents/<dir>/agent.yaml` (`agent.name`) | 一致 |
|---|---|---|---|
| summary | `mis-summary` | `mis-summary/agent.yaml:8` `name: mis-summary` | ✅ |
| extract | `mis-extract` | `mis-extract/agent.yaml:8` `name: mis-extract` | ✅ |
| rag | `mis-rag` | `mis-rag/agent.yaml:10` `name: mis-rag` | ✅ |
| chat | `mis-copilot` | `mis-copilot/agent.yaml:7` `name: mis-copilot` | ✅ |

- 目录实际位于 `agent/ai-platform/configs/agents/`（非 `.../backend/configs/`，之前误判为缺失——已纠正）。
- `[实跑]` 回归测试 `test_mis_integration.py::TestAgentConfigs::test_four_mis_agents_loadable_and_agent_id_correct` 断言 4 个 `agent.yaml` 存在且 `agent.name` 与 BFF 映射一致，**已通过**。说明运行时 `AgentManager.ensure_agent_ready(<id>)` 可解析到配置，不会出现 404（AgentNotFoundError）。

---

## 3. 请求体字段 —— 匹配

| 字段 | BFF 发送（`AiCapabilityTranslator.buildBody` `:57-75`） | 平台接收（`mis_capability.AgentChatRequest` `:39-47`） | 一致 |
|---|---|---|---|
| `content` | `String content`（prompt 文本） | `content: str = Field(...)` | ✅ |
| `role` | 固定 `"user"`（`:72`） | `role: str = Field(default="user")` | ✅ |
| `metadata` | `{source, capability, page_context, employee_id}`（`:62-68`） | `metadata: dict[str, Any]` | ✅（dict 全量接收） |

- 平台 `metadata` 为开放 dict，BFF 注入的 `source="mis-bff"`、`capability`、`page_context`、`employee_id` 均被原样透传至 `Message.metadata`（`:88`），供 Agent runtime 使用。**结构一致。**

---

## 4. 响应体解析 + 包络 —— 匹配（[实跑]）

- 平台成功响应（`mis_capability.py:123-132`）：
  ```
  success(data={ "response": <text>, "session_id": <id>, "warnings": [...], "tool_errors": [...] }, message="ok", trace_id=...)
  ```
  统一包络 `{code:0, data:{...}, message, traceId}`（`src/api/response.py:19-30`）。
- BFF 接收（`AiPlatformClient.CHAT_TYPE = Result<AiPlatformChatData>`，`:49-50`）：
  - `AiPlatformChatData.response` ↔ 平台 `data.response`（`:14`）✅
  - `AiPlatformChatData.sessionId` 经 `@JsonProperty("session_id")` 显式映射（`:16`）↔ 平台 `data.session_id` ✅（关键：平台用 snake_case，BFF 已显式注解，无命名错配）
  - `warnings`/`tool_errors` 平台多返回字段，BFF DTO 不含 → Jackson 默认忽略（Spring Boot `FAIL_ON_UNKNOWN_PROPERTIES=false`），不影响解析。
- `[实跑]` `test_valid_rs256_enters_processing` 断言 `body["code"]==0`、`body["data"]["session_id"]=="sess-mock-001"`、`body["data"]["response"]=="hello from mock agent"`、`body["traceId"]=="t-abc-123"` —— 平台包络结构与 BFF 期望一致闭环成立。
- 包络说明：BFF `Result` 来自外部公共模块 `com.mis.common.core.result.Result`（源码不在本仓，未能直接读字段），但 BFF 通过 `ParameterizedTypeReference<Result<AiPlatformChatData>>` + `RequestContext.unwrap(result)`（`support/RequestContext.java:36-44`，取 `code`/`data`）消费；平台 `code:0` 即成功。该侧为 **[静态]** 推断，但上述端点实跑测试间接验证契约成立。
- `parseSummary/parseExtract/parseRag/parseChat`（`AiCapabilityTranslator.java:125-189`）从 `data.response`（平台返回的 JSON 字符串）二次解析 `points/citations/fields/answer` 等 —— 属业务层约定，非 BFF↔平台传输契约错配（架构师 §0.2 已指出 summary/extract 响应结构需升级 T-sum/T-ext，属功能缺口非联通 bug）。

---

## 5. `X-Mis-*` 头名 / JSON 值结构 —— 匹配（[实跑]）

| 头 | BFF 注入（`AiPlatformClient.buildMisEnrichmentHeaders` `:141-197`） | 平台读取（`deps.get_current_user` `:60-62` alias；`models._parse_mis_headers` `:191-204`） | 一致 |
|---|---|---|---|
| `X-Mis-Depts` | `[{"id": deptId}]`（`:157`） | `_parse_dept_entries` 取 `id`/`code`/`deptId`（`:158-188`） | ✅ |
| `X-Mis-Orgs` | `[{"id": tenantId}]`（`:163`） | `_extract_ids` 取 `id`/`code`（`:112-134`） | ✅ |
| `X-Mis-Roles` | `[{"id": id, "code": code}]`（`:179`） | `_extract_role_codes` 取 `code`→回退 `id`（`:137-155`） | ✅ |

- 头名完全一致（BFF 常量 `HEADER_MIS_DEPTS/ORGS/ROLES` `:53-55` = `X-Mis-Depts/X-Mis-Orgs/X-Mis-Roles`；平台 `Header(alias="X-Mis-Depts")` 等）。
- JSON 值结构兼容：BFF 发 `{id}` / `{id,code}` 数组，平台解析函数同时支持 `{id}`/`{code}`/`{deptId}` 与裸字符串（容错回退），结构完全对齐。
- `[实跑]` `test_identity_enrichment.py::TestBuildUserContextWithHeaders` / `TestGetCurrentUserEnrichment` / `TestMisCapabilityEnrichmentEndpoint` 均以真实 RS256 token + `X-Mis-*` 头注入，断言多值字段、`allowed_categories`、`primary_org_id`、`roles` 正确填充 —— 头契约闭环验证通过。
- 备注（文档小瑕疵，非坑）：任务描述称解析函数在 `deps.py`，实际 `_parse_mis_headers`/`_extract_ids`/`_extract_role_codes` 位于 `src/identity/models.py:191-204/112-134/137-155`，`deps.py` 仅调用 `build_user_context(...)`（`:107-112`）。函数位置与任务清单描述不符，但实现一致。

---

## 6. 错误码传播 —— 存疑 / 待优化（非阻断）

### 6.1 平台不可达 → 是否 `Result.fail(503)`

**部分成立，需区分两阶段：**

- **健康门禁阶段（探针判定平台 down）**：`AiFeatureConfigService.probe()` 调 `healthProbe()` 失败 → `platformUp=false` → `platformAvailable()` 返回 false（`AiFeatureConfigService.java:68-70`）→ `proxyCapability` 在转发前 `Result.fail(AI_UNAVAILABLE=503, "AI 平台暂不可用")`（`:147-149`）。**此路径确为 503。✅**
- **运行时调用阶段（探针已过、单次调用失败）**：`AbstractDownstreamClient.block()` 捕获 `WebClientResponseException`（连接失败/超时/平台 5xx）或任意异常，统一抛 `BusinessException(ResultCode.INTERNAL_ERROR, "下游调用失败: HTTP <status>")`（`:79-83`）→ `proxyCapability` 捕获后 `Result.fail(ex.getCode(), ex.getMessage())`（`:155-157`）。此处 code = `ResultCode.INTERNAL_ERROR`（**非 503**，通常 500；该常量定义于外部模块 `com.mis.common.core.exception.ResultCode`，源码不在本仓，**数值未能直接核对**，按命名惯例为 500）。

→ 结论：「平台不可达→503」仅在**探针门禁**语义下成立；**实际 HTTP 调用失败**时返回 `INTERNAL_ERROR`（约 500），不是 503。语义上可接受（BFF 对外统一业务码），但 503 仅覆盖「平台整体不可达（门禁）」而非「单次调用失败」。

### 6.2 平台验签失败（401）如何向 MIS 前端传播

- 平台 `get_current_user` 在 RS256 分支验签失败抛 `HTTPException(status_code=401, detail=...)`（`deps.py:114-117`）；FastAPI 以 HTTP 401 返回。
- BFF `chat()` 用 `.retrieve()` → 非 2xx 触发 `WebClientResponseException(401)` → `block()` 转为 `BusinessException(ResultCode.INTERNAL_ERROR, "下游调用失败: HTTP 401")` → `Result.fail(INTERNAL_ERROR, "下游调用失败: HTTP 401")`。
- **结论（存疑/待优化）**：平台原始 401 在 BFF 被**翻译为内部错误码（INTERNAL_ERROR，约 500）**，**401 语义丢失**。MIS 前端无法区分「自己 JWT 失效（应 401 触发 refresh）」与「平台内部故障（5xx）」。此外，`RequestContext.unwrap`（`:39-43`）的 `!result.isSuccess()` 分支本可透传平台业务 `code`/`message`，但因平台错误均以**非 2xx** 返回（见 `mis_capability.py:109-142` `error_response(..., http_status=...)`），该透传分支对 `mis_capability` 端点实际是**死路径**。
- 影响评估：非阻断（联调可用），但建议改进——BFF 对 401 应映射回 401（或带 `code` 透传），否则前端统一 401 刷新逻辑失效。**[静态]** 推断（基于 `error_response` 始终带 `http_status` 且 BFF 用 `retrieve()` 而非 `exchange()`）。

---

## 7. SSE 流式端点 —— 不匹配（已知缺口，非阻断）

- 平台：`mis_capability.py:145` `@router.post("/agents/{agent_id}/chat/stream")`，SSE 事件契约 `event: delta|done|error`（`:153-212`）。已挂载于 `/api/v1/agents/{agent_id}/chat/stream`。
- BFF：`AiProxyController` 仅暴露非流式端点 `/api/v1/ai/{summary,extract,rag,chat/completions}`（`:64-118`），`chatCompletions` 返回缓冲式 `Result<AiChatResponse>`（`:106-118`）。**无对应流式路由暴露给 MIS 前端。**
- `AiPlatformProperties.sseEnabled`（`:25`，默认 `false`）配置项存在，但**未被任何 controller 路由引用**（死配置）——BFF 侧没有把平台 SSE 端点透传为前端流式接口。
- **结论**：平台 SSE 端点存在，BFF **未透传**。与架构师 §0.2「❌ 缺 SSE 透传（T-stream）」**一致**。属已知设计缺口（前端 UC-5/UC-4 流式体验依赖 T-stream 后端补），非回归 bug。

---

## 8. 最终判定

**后端集成 BFF↔平台 是否存在结构性坑？ → 无阻断性结构性坑。**

- ✅ 核心契约 1–5 全部结构一致、可联通、可解析（URL/方法、agent 映射、请求体、响应体+包络、X-Mis-* 头），并有平台侧实跑测试闭环验证。
- ⚠️ 非阻断待办 2 项：
  1. **错误码/401 透传收敛**（第 6 节）：平台 401/404/500 被 BFF 统一翻译为 `INTERNAL_ERROR`，建议对 401 保留语义或透传 `code`，否则前端无法区分鉴权失效与平台故障。
  2. **SSE 流式未透传**（第 7 节）：已知缺口，设计已记录 `T-stream`，前端流式能力待补。

> 说明：本次为契约静态+实跑审计，未启动 BFF（Java）运行时联调；BFF `Result`/外部 `ResultCode` 数值属外部公共模块、不在本仓，相关断言为静态推断（已用平台侧实跑端点测试间接佐证）。

---

## 附：关键 file:line 索引

**BFF（Java，静态）**
- `backend/mis-admin-bff/src/main/java/com/mis/adminbff/client/AiPlatformClient.java:69,89-90,103-113,141-197,53-55`
- `.../service/AiCapabilityTranslator.java:44-52,57-75`
- `.../controller/AiProxyController.java:47,64-118,142-158`
- `.../config/AiPlatformProperties.java:16,25`
- `.../client/AbstractDownstreamClient.java:45-71,73-85`
- `.../dto/ai/AiPlatformChatData.java:14-17`
- `.../support/RequestContext.java:36-44`

**平台（Python，实跑验证）**
- `agent/ai-platform/backend/src/api/routes/mis_capability.py:39-47,61,123-142,145,153-212`
- `agent/ai-platform/backend/src/main.py:276-279,358`
- `agent/ai-platform/backend/src/api/deps.py:58-140`
- `agent/ai-platform/backend/src/identity/models.py:112-204,264-271,316`
- `agent/ai-platform/backend/src/api/response.py:19-30`
- `agent/ai-platform/configs/agents/{mis-copilot,mis-summary,mis-extract,mis-rag}/agent.yaml`（name 字段）
- `agent/ai-platform/backend/tests/test_mis_integration.py:53-58,361-373`（agent 映射实跑）
- `agent/ai-platform/backend/tests/test_identity_enrichment.py:123-175,216-247,253-304`（X-Mis-* 头实跑）
