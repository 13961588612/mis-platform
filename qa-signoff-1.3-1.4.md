# MIS 平台 Agent 控制台 1.3 / 1.4 独立验收 Sign-off 报告

> 验收人：严过关（QA 工程师）
> 方式：不采纳工程师"已全绿"自述，独立读源码 + 独立跑门禁 + 独立下结论
> 环境：Git Bash；Python 3.13.12；pytest 用 `.venv`；前端 `tsc --noEmit`
> 测试轮次：第 1 轮（发现 10 陈旧测试 → QA 自修 + 1 源码缺陷）→ 第 2 轮（复跑确认源码缺陷仍在）→ 达两轮上限 EXIT
> 回归范围：`pytest src/coordinator tests/`

---

## 一、九道门禁逐项结论

### Gate 1 — 后端 py_compile  ✅ PASS
- 命令：`python -m py_compile <工作树全部 21 个改动/新增 .py>`
- 实际输出：`TOTAL=21 FAIL=0`（8 个 src 修改 + 3 个 src 新增 + 10 个 tests）
- 结论：全部编译通过。

### Gate 2 — 后端 pytest  ❌ FAIL（遗留 1 源码缺陷）
- 工程师口径：仅 `test_t05_hard_constraints.py` + `test_invoke_agent.py` → 16 passed / IS_PASS:YES（仅覆盖 2 文件）
- 独立全量回归：`pytest src/coordinator tests/` → **895 passed, 1 failed**
- 失败用例：`tests/test_qa_coordinator.py::TestRedlineLazyImports::test_lazy_imports_stay_function_local[skills/tools/invoke_agent.py-forbidden0]`
- 结论：工程师未跑全量回归，自述"全绿"不实；遗留 1 源码缺陷（见 BUG-1）。

### Gate 3 — 前端 typecheck  ✅ PASS
- 命令：`cd frontend/mis-admin-web && npx tsc --noEmit`
- 实际输出：exit 0，0 错误。
- 结论：通过。

### Gate 4 — BFF 零改动审查  ⚠️ 范围 PASS / 透明度缺陷
- 1.3/1.4 硬约束本身不需要 BFF 改动 → 范围层面 PASS
- 但工作树实际改动 `backend/mis-admin-bff/.../AgentOpsFacadeService.java`：`createChatSession` 注入 `user_name`（L463-479）+ `listFeedback` 回填 `user_name`（L336-387），属"user_name 跨会话注入"关联改动
- 工程师"本次零改动"声明**不实**——BFF Java 确有改动，且前端 `agent-chat-api.ts` / `agent-feedback-page.tsx` / `types.ts` 亦有改动（见观察项 O-2）
- 结论：门禁范围 PASS，但声明与实际不符，记入观察项。

### Gate 5 — 硬约束四道闸代码核验  ✅ PASS（见第二节逐项）

### Gate 6 — 前后端常量镜像  ✅ PASS
- 后端单一事实源：`catalog.py:68  ADMIN_HELPER_AGENT_IDS = frozenset({"mis-admin-helper"})`
- 前端镜像：`agent-coordination-page.tsx:87  const LOCKED_WORKERS: readonly string[] = ['mis-admin-helper']`
- 二者一致。

### Gate 7 — 无残留硬编码  ✅ PASS（prompt 漂移见 O-1）
- 前端 `src` 全仓 grep `mis-extract|mis-summary`：**0 引用**
- 后端 `src` grep：仅 stale 文案 + `DEFAULT_WHITELIST` 兜底（非调用点）+ catalog 特例/灰度备注；**无 `agent__invoke("mis-extract")` 之类硬编码调用点**
- `configs`：mis-extract / mis-summary `metadata.yaml` 均 `enabled: false`（R3 灰度生效）
- 例外：mis-copilot prompt `runtime/prompts/system.md` 仍有 5 处 mis-extract/mis-summary 示例（L21/22/30/31/64）→ 内容漂移，见 O-1

### Gate 8 — search tool 可插拔  ✅ PASS
- `search_providers.py`：`SearchProvider` Protocol + `MockSearchProvider` + `GenericApiSearchProvider` + `get_search_provider()` 工厂（按 `SEARCH_PROVIDER` 返回）
- `search_tool.py`：`SearchTool` 异常转 `ToolResult(is_error=True)`；`list_skills_tool.py`：`ListSkillsTool`
- 注册：`tool_registry_builder.py:365-366` 注册 SearchTool / ListSkillsTool
- 能力面：mis-admin-helper `runtime.yaml` `allowed_tools` 含 `search` ✅；mis-user-helper **不含** `search` ✅

### Gate 9 — create_skill 落盘复用  ✅ PASS
- 前端 `agent-skill-form-dialog.tsx`：复用 `parseSkill` / `applyParsedSkill`（skill-builder 既有逻辑）+ `createSkill` → `POST /skills` → `save_custom_skill`；**无 create_skill 专属分支**
- `createChatSession('mis-admin-helper')`（L254）复用既有会话创建
- 结论：复用成立。

---

## 二、硬约束四道闸逐项核验

| 闸 | 约束 | 代码位置（实际读到） | 结论 |
|----|------|----------------------|------|
| ① | `coordination.yaml` 的 `worker_ids` 不含 mis-admin-helper | `configs/agents/mis-copilot/coordination.yaml` → `worker_ids: [crm-assistant, mis-rag, mis-user-helper]` | ✅ |
| ② | `INVOKE_AGENT_WHITELIST` 默认不含 mis-admin-helper | `config.py:329-336` = `["mis-rag","crm-assistant","mis-user-helper"]`（注释明确"绝不"含 mis-admin-helper） | ✅ |
| ③ | `build_scoped_catalog(coordinator_id)` 过滤全局目录 + 剔除 `ADMIN_HELPER_AGENT_IDS`；`tool_registry_builder` 注入 scoped catalog | `catalog.py:559` `if wid in allowed and not (wid in ADMIN_HELPER_AGENT_IDS)`；`tool_registry_builder.py:590-618` `_resolve_scoped_catalog` + `create_platform_tool_registry(..., config.agent_id)`；`oh_runtime_builder.py:204` 传 `agent_id` 使 scoped catalog 生效 | ✅ |
| ④ | `write_coordination` 拒 admin-helper 入 `worker_ids` + `session.py create_session` 校验 `agent:skill:manage`(403 fail-closed) + `invoke_agent.py execute` 显式拒 | `coordination_service.py:265-272` 拒 `ADMIN_HELPER_AGENT_IDS & set(worker_ids)`；`session.py:737-777` `require_admin_helper_access` 作 `create_session` Depends；`invoke_agent.py:254-258` 显式拒 `if agent_id in ADMIN_HELPER_AGENT_IDS` | ✅（代码成立；但 `invoke_agent.py:35` 违反懒导入红线，见 BUG-1） |

**纵深防御观察**：`tool_registry_builder.py:_resolve_scoped_catalog` 异常分支 fallback 全局目录（含 admin-helper），纵深弱化；但运行时闸④（`invoke_agent.py:254` / `session.py:737` / `coordination_service.py:265`）仍 fail-closed 兜住，不影响隔离结论。记入 O-3。

---

## 三、BUG 清单（文件:行 + 路由判定）

### BUG-1 【Engineer / 源码缺陷 · 建议打回】
- **文件:行**：`agent/ai-platform/backend/src/skills/tools/invoke_agent.py:35`
- **现象**：顶层 `from src.coordinator.catalog import ADMIN_HELPER_AGENT_IDS`
- **违反**：设计 T03「`invoke_agent.py` 不得顶层 import `src.coordinator.catalog`，须函数内懒导入避免循环依赖」红线
- **影响**：运行时 import 当前不报循环依赖（功能可用），但违反硬约束设计红线，被 `test_qa_coordinator.py::test_lazy_imports_stay_function_local[...invoke_agent.py-forbidden0]` 卡住；属**源码缺陷**非测试 bug
- **路由判定**：**Engineer（Alex）** — 建议打回，改为函数内懒导入（如 `from src.coordinator import catalog` 后使用 `catalog.ADMIN_HELPER_AGENT_IDS`）
- **修复后复测**：该红线测试应转绿，后端回归应达 **896 passed / 0 failed**

### BUG-2 【QA-已自修 · 10 个陈旧测试】
因 1.3/1.4 行为变更（admin-helper 加入、mis-extract/summary 灰度下线、scoped catalog 生效）未同步预期，初跑 11 failed 中 10 个为测试代码 bug，已由 QA 自行修复：
- `tests/test_worker_catalog.py`（3 处）：import 加 `ADMIN_HELPER_AGENT_IDS`；3 处 `set(DEFAULT_WHITELIST)` → `set(DEFAULT_WHITELIST) | set(ADMIN_HELPER_AGENT_IDS)`
- `tests/test_cw_audit_compat.py`（2 处）：`INVOKE_AGENT_WHITELIST` 断言改为 `["crm-assistant","mis-rag","mis-user-helper"]` 且不含 mis-admin-helper；拒绝文案同步
- `tests/test_coordinator_golden.py`（5 处）：`EXPECTED_ROLES` 加 mis-admin-helper/mis-user-helper（7 agent）；相关文案 5→7；worker 集合与 `catalog.worker_ids()` 同步
- **路由判定**：**QA（严过关）** — 已自修，复跑转绿

### 观察项 O-1 【prompt 内容漂移】
- `configs/agents/mis-copilot/runtime/prompts/system.md` L21/22/30/31/64 仍以 mis-extract/mis-summary 作为委派目标示例
- 建议：工程师同步更新为 mis-user-helper，避免误导 LLM 委派

### 观察项 O-2 【BFF / 前端未披露改动】
- 工作树含 BFF `AgentOpsFacadeService.java`、前端 `agent-chat-api.ts` / `agent-feedback-page.tsx` / `types.ts`、`session.py`(user_name)、`oh_runtime_builder.py`(传 agent_id)、`build-dev.ps1`、doc 图等改动，工程师自述"本次零改动 / 仅列 X 文件"不实
- 其中 `oh_runtime_builder.py:204` 传 `agent_id` 实为 scoped catalog 生效之必要改动（应属 1.3/1.4 范围，工程师漏列）；其余 user_name 注入链为关联 / 跨特性改动
- 建议：工程师补全变更清单与提交范围说明

### 观察项 O-3 【纵深防御弱化】
- `tool_registry_builder.py:_resolve_scoped_catalog` 异常分支 fallback 全局目录（含 admin-helper）；运行时闸④仍兜住，不影响隔离，但建议异常时 fallback 空目录或显式报错

---

## 四、最终结论

- **结论：不可交付（No-Go）**
- **依据**：Gate 2 后端回归遗留 **1 failed**（BUG-1 源码缺陷违反设计红线）；其余门禁与四道闸代码层面均成立，但存在未披露改动（O-2）与 prompt 漂移（O-1）
- **阻塞项**：BUG-1（`invoke_agent.py:35` 顶层 import）→ 必须 Engineer 修复并复测
- **建议**：工程师修复 BUG-1 后，重跑 `pytest src/coordinator tests/` 应达 896 passed / 0 failed，方可进入交付评审；O-1 / O-2 / O-3 建议同期清理

---

## 五、过程与提交状态

- **测试轮次**：第 1 轮（发现 + 修测试）→ 第 2 轮（复跑确认源码缺陷）→ 达两轮上限，EXIT（源码缺陷列入 BUG 清单，不进第 3 轮）
- **智能路由**：源码缺陷 → Engineer；测试缺陷 → QA 自修
- **是否触碰无关文件**：**是** — 工作树含工程师未列出的 BFF Java / 前端多文件 / `session.py` / `oh_runtime_builder.py` / `build-dev.ps1` / doc 图等改动（见 O-2）
- **是否提交**：**否** — 保持未提交（A/B/C 批已提交，1.3/1.4 在工作树未提交；QA 不代为提交，待 Engineer 修复 BUG-1 后由工程师统一提交）

---

## 附：门禁速览表

| Gate | 名称 | 结果 |
|------|------|------|
| 1 | 后端 py_compile | ✅ PASS (21/21) |
| 2 | 后端 pytest | ❌ FAIL (895 passed / 1 failed，源码缺陷) |
| 3 | 前端 typecheck | ✅ PASS |
| 4 | BFF 零改动审查 | ⚠️ 范围 PASS / 透明度缺陷 |
| 5 | 四道闸代码核验 | ✅ PASS |
| 6 | 前后端常量镜像 | ✅ PASS |
| 7 | 无残留硬编码 | ✅ PASS（O-1 漂移） |
| 8 | search 可插拔 | ✅ PASS |
| 9 | create_skill 复用 | ✅ PASS |
