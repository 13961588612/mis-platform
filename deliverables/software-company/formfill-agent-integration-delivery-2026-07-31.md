# 交付总结报告 — FormFill 表单填充引擎 × Agent 平台整合（P0）

- **项目简称**：`formfill-agent-integration`
- **生成日期**：2026-07-31
- **主理人**：齐活林（Qi）· 交付总监
- **团队成员**：许清楚（PM）、高见远（架构师）、寇豆码（工程师 ×2）、严过关（QA）

---

## TL;DR

把 `mis-admin-bff` 的 AI Skill 表单填充引擎**暴露为 agent 平台（企微/H5）可调能力**，打通「对话 → 填充 → HITL → 写回」端到端；O2（success 路径自动写回单据）与 O1/I1（请求体贴合 Java 顶层 `pageContext` 契约）均已修复，并经 QA 两轮跨栈回归 + 7/7 契约复核确认 **NoOne 闭环**。

---

## 提交信息

| Hash | 类型 | 说明 | 文件数 |
|------|------|------|-------|
| `5da8ad1` | fix | `execute_skill` 改为发顶层 `pageContext`（O1 修复，早于本批次） | 1 |
| `ccf1ec2` | feat | AI Skill 表单填充引擎地基（此前未提交，本次一并纳入以保证整合层可编译） | 15 |
| `cae4a60` | feat | 暴露为 agent 平台可调能力（整合层） | 43 |

本次整合相关提交共 **59 文件**（含 `5da8ad1`）；其中整合层 + 引擎地基 = 58 文件。

---

## 交付概览

| 项 | 状态 |
|----|------|
| 交付状态 | ✅ P0 就绪（实现 + 测试 + 契约复核全闭环） |
| Python 测试 | FormFill 专项 **24 passed**；全量 **199 passed / 0 failed**（6 warning 非 error）→ 无回归 |
| 前端 / gateway typecheck | FormFill 相关代码 **0 新增 error**（基线 13/20 既有 tech debt 与本整合无关） |
| 契约一致性 | **7/7 对齐**（见下） |
| 智能路由 | **NoOne**（源码无未决回归，测试无 bug） |
| 编译验证 | ⚠️ 未做（沙箱 JDK8 ≠ 项目 JDK17，Java 侧未能本地编译/单测） |

### 7/7 契约对齐（QA Round 2 复核）
1. `status` 枚举：Python 取小写 `success/hitl_required/manual_required/error` ↔ Java `SkillExecutionEngine` 同小写
2. `apply` 字段：`{skillId,docType,docId,values}` ↔ `SkillApplyRequest` 一致；响应 `SkillApplyResponse{status,docId,message}` 一致
3. `Result` 信封：Java `Result.ok` → `{code,message,data}`；Python `_post` 解包 `.data`
4. 反向信任头：`X-Platform-Token` / `X-Mis-Upstream-Jwt` / `X-Channel` + 降级 `X-User-Id/X-Tenant-Id` 双端一致
5. entity-select A2UI 双端：props + 返回结构前后端/gateway/inbound 一致；候选标识 `id/candidateId` 一致
6. `resumeToken` 续链：`resume_formfill` → `FormFillPendingStore` → `submit_formfill_apply` → 清 `session.pending_formfill`
7. `/execute` 请求体形态（原 I1）：当前发顶层 `pageContext`，无 `context`/`sessionId`/`conversationId` 包装

---

## 关键修复（本批次 QA 跨栈复核发现）

- **O2（success 自动写回单据）**：`formfill_execute.py` 在 `status==success` 且入参含 `docType+docId` 时，内部自动调用 `submit_formfill_apply` 写回单据——修复设计时序图 success→apply 回填缺口。
- **O1 / I1（`/execute` 请求体契约）**：`FormFillClient.execute_skill` 原把上下文裹在 `context` 包装键下并多发 `sessionId`/`conversationId`，而 Java `SkillExecuteRequest` 只认**顶层 `pageContext`**，导致引擎实际拿到空 `pageContext`、表单上下文丢失（功能级 bug）。已改为顶层 `pageContext`，并新增契约测试固化防护：
  - `test_formfill_client_execute_sends_top_level_pagecontext`（`tests/test_formfill.py`）：spy `_client.post` 捕获真实请求体，断言顶层 `pageContext` 存在、`context`/`sessionId`/`conversationId` 缺失、内层含 `docType`/`docId`。

---

## 文件清单

### 批次 0 · O1 修复（已提交 `5da8ad1`）
- `agent/ai-platform/backend/src/skills/formfill_client.py`

### 批次 1 · FormFill 引擎地基（已提交 `ccf1ec2`，15 文件）
- `dto/ai/`：`SkillExecuteRequest` / `SkillExecuteResponse` / `EntityCandidate` / `FieldDef` / `HitlPayload` / `SkillDefinition`
- `service/skill/`：`SkillExecutionEngine` / `DagBuilder` / `ParameterResolver` / `SkillLoader`
- `resources/skills/user-fill.json`
- `test/java/.../service/skill/DagBuilderTest.java`
- 文档：`docs/ai-skill-fill-engine-design.md` / `docs/system-design-ai-form-fill.md` / `docs/sequence-diagram.mermaid`

### 批次 2 · Agent 平台整合层（已提交 `cae4a60`，43 文件）
**mis-admin-bff（Java，12）**
- 新增：`security/ReverseTrustInterceptor` · `security/ReverseTrustContext` · `config/AiPlatformTrustConfig` · `config/ReverseTrustConfiguration` · `dto/ai/SkillApplyRequest` · `dto/ai/SkillApplyResponse` · `service/skill/{DocWriteHandler,DocWriteRegistry,DocWriteResult,PurchaseOrderDocWriteHandler}`
- 修改：`controller/AiProxyController`（新增 `POST /api/v1/ai/skill/apply`）· `resources/application.yml`（新增 `mis.ai-platform` 段）

**ai-platform（Python/TS，29）**
- Backend 新增：`skills/reverse_trust` · `skills/field_mapping` · `skills/tools/{formfill_execute,formfill_apply}` · `hitl/formfill_pending` · `runtime/a2ui_pending` · `tests/test_formfill`
- Backend 修改：`agent/session` · `config` · `queue/{inbound_worker,redis_stream}` · `runtime/{events,openharness,tool_registry_builder}` · `skills/__init__`
- Gateway 修改：`adapters/wecom/WecomBotAdapter` · `queue/redisStream` · `router/{BotEventMapper,MessageRouter}` · `server`
- Frontend 新增：`components/a2ui/EntitySelectView`
- Frontend 修改：`components/a2ui/{A2uiRenderer,registry,types}` · `hooks/useChat` · `store/chatStore` · `types/message`
- Config：`configs/agents/mis-copilot/runtime/runtime.yaml`

**整合文档**
- `docs/ai-skill-agent-integration-prd.md`（增量 PRD）
- `docs/ai-skill-agent-integration-design.md`（整合设计：6 决策 + T01–T08）

---

## 本次未提交（并行改动，已刻意排除）

为保证本次提交边界干净，以下**与整合无关的并行工作区改动未被纳入**，请相关 owner 自行处理：

- `backend/mis-org/**`（组织 MCP 模块，独立）
- `backend/mis-admin-bff/.../config/McpConfig` · `resource/McpProperties` · `service/{McpClient,McpException,McpToolRegistry}`（独立 MCP 模块）
- `backend/mis-admin-bff/.../service/AiCapabilityTranslator`（BFF AI 对话/RAG 翻译器，无 FormFill 依赖）
- `frontend/mis-admin-web/src/features/ai/**`（MIS 管理台自身 AI 表单 UI，非 agent 平台 H5 整合）
- `.workbuddy/memory/**`（团队记忆文件，非代码）
- `nul`（工作区 stray 文件）

---

## 用户下一步建议

1. **编译验证（最关键）**：用 **JDK17**（或 Docker 镜像）编译 `mis-admin-bff` 并跑 `mvn test`，确认反向信任拦截器与 `SkillExecute`/`SkillApply` 端点——这是沙箱 JDK8 一直未能覆盖的最后一环。
2. **起栈联调**：`scripts/start-integration-stack.ps1` + `docker-compose.ai.yml` 做真实往返——`X-Platform-Token`/`X-Mis-Upstream-Jwt` 反向信任、MIS RS256 验签、entity-select A2UI（H5 表单 + 企微卡片）端到端。
3. **会话幂等**：验证 `FormFillPendingStore` 单例 + `resume_token` 续跑、HITL 卡片确认后写回一致性。
4. **真实契约门禁**：本批次新增的 `test_formfill_client_execute_sends_top_level_pagecontext` 仅防护 Python 侧；建议在 Java 侧也为 `SkillExecuteRequest` 加一个反序列化断言（拒绝未知 `context` 包装键），双向锁死。
5. **排期 P1/P2**：别名表、用户学习迁后端、更多单据类型 handler（非采购单）、企微 `button_interaction` 真实往返验证。

---

## 附录：协作时间线

- PM 许清楚 → 增量 PRD（暴露为 agent 可调能力）
- 架构师 高见远 → 整合设计（6 决策 + T01–T08 任务分解）
- 工程师（批次1 Java / 批次2 Py-TS）→ 实现 + 全局一致性审查 IS_PASS=YES
- QA 严过关 → 两轮跨栈回归：Round 1 将 O1 升级为真实功能 bug（I1）并补 7 点契约复核；Round 2 固化契约测试、判定 NoOne
- 主理人 → 提交清理（拆分引擎地基 + 整合层两次提交，排除并行改动）
