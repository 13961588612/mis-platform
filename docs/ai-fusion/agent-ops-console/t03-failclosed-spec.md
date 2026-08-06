# T03 — fail-closed 权限闸门 · 施工级规格

> **文档性质**：纯规格（只读，不写代码）。本文件仅新增/修订，不改动任何源码与 `impl-plan.md`、不碰 `.sql`。
> **版本**：**v1.9**（基于 v1.8 修订；本版依据主理人《T03 S9 设计阶段：`misUserId` 第五键 + 5 跳透传》2026-08-05，100% 自包含）。**S9 设计裁定**：§3.4 完整重写——4 条已批准决策（① `build_mcp_identity` 加第五键 `misUserId` 不动老 4 键 F59、② 5 跳透传链 Session→Manager→OpenHarness→Builder→Identity F60、③ 入口只由服务端填 `misUserId` 禁止客户端传入 F55/F56/F57/F58、④ 取不到 `misUserId` 即 fail-closed 拒绝），解决 v1.7 遗留 F42/F43 制约（F42 无承载位→决策①②解决、F43 无 HTTP 作用域→决策③解决）。新增 F54–F60（F54 `user_mobile` 匹配桥、F55 两渠道身份差异、F56 `create_session()` gap、F57 7+ 会话创建点、F58 服务端填充 `POST /sessions` 不收 `user_mobile`、F59 第五键不动老键、F60 5 跳透传链）。v1.8 的 #17 三步→两步（F48）+ #19 伪代码类型对齐（F49–F53）保持不变。
> **对齐基线**：`impl-plan.md` v1.1（2026-08-05）。冲突时以 `impl-plan.md` 已裁定项（§11.3）为准；本文件发现的矛盾与裁定结论汇总于 §7。
> **目标**：E1–E6 六条 Skill 执行路径 **全部 fail-closed**（`impl-plan.md` §7 T03，本期最高风险，对应 spec §3.2 五条硬约束）。
> **fail-closed 总纲**：未授权 / 匿名 / 权限码集合为空 / 权限源不可达（BFF 超时 · Redis 挂 · 5xx）一律 **拒绝**，绝不以"允许"兜底。超管豁免默认关闭，须配置项显式开启。

---

## 0. 立场与约定

| 项 | 约定 |
|---|---|
| 权限判定唯一链 | Python：`UserContext.permission_codes` → `SkillAclGuard`；Java：登录态权限码集合 → `SkillPermissionChecker`。**不**复用 `PermissionEngine`（`identity/permissions.py` 的"无限制即允许"语义与 fail-closed 相反，§1.4 结论）。 |
| 一处织入 | E1–E5 统一在工具注册层 `tool_registry_builder.create_platform_tool_registry()` 用 `AclToolWrapper` 包住 `SafeToolWrapper`（外层判权、内层安全包裹）；E6 在 BFF `AiProxyController` 入口单独判权（§2.2 策略 B）。 |
| 权限码字符串 | `ai:skill:{skill_id}:run`，**skill_id 原样保留（含点号、含大写、含连字符）**，如 `member.profile`。Java 与 Python 生成结果必须逐字节一致（§10.5 约定 3、§4.1 读图要点 3）。**_`normalize` 已作废**（#1 裁定，见 §4 注记）。 |
| 错误码（#2 裁定） | 运行时校验用**数字码**走 `BusinessException`；字符串 `AI_SKILL_FORBIDDEN` / `AI_ACL_UNAVAILABLE` 降级为 `data.code` **语义标签**（供前后端统一分支，非 wire 级 code）。详见下表与 §3.1。 |

### 0.1 错误码总表（v1.2 按 #2 裁定；v1.4 加「触发条件」列按 #12）

| 语义 | 字符串标签（`data.code`，仅语义） | Java 数字码（`BusinessException.code` / `AgentOpsErrorCodes`） | Python 侧 HTTP | Java 侧 HTTP（F2） | **触发条件（#12 明确化）** |
|---|---|---|---|---|---|
| 无执行码（运行时校验） | `AI_SKILL_FORBIDDEN` | **`40301`** `SKILL_FORBIDDEN` | 403（`HTTPException`） | **200**，`body.code=40301`，`body.data.code="AI_SKILL_FORBIDDEN"` | ① 下游 `40400` 用户不存在（F16 / `PermissionService.java:40`）；② 查到但 `required` 不在集合（含空集、`List.of()` 的"查无权限"真值，F16） |
| 权限源不可用 | `AI_ACL_UNAVAILABLE` | **`40303`** `ACL_UNAVAILABLE` | 403 | **200**，`body.code=40303`，`body.data.code="AI_ACL_UNAVAILABLE"` | 下游 `50000` 系：超时 / 连接拒绝 / 非 2xx / 无响应（`AbstractDownstreamClient.java:73-85` `block()` 原样透传或转 `INTERNAL_ERROR`，绝不静默，F16） |
| 无运营码（Python 路由侧） | `AI_OPS_FORBIDDEN` | —（Java **不定义**，属 Python 概念，加了是死码） | 403 | — | Python 路由侧 `require_ops_permission` 缺码（Java 侧不触发） |
| 执行码注册失败（非运行时） | — | **`40917`** `SKILL_CODE_UNAVAILABLE`（`ensureCode` 专用，与运行时彻底分家） | — | — | `ensureCode` 懒注册失败（非运行时，与 40301/40303 分家） |

> **关键事实（主理人实读 F1/F2/F3）**：`BusinessException.code` 是 **`int`**（F1 `:13`），可用三参构造 `BusinessException(int code, String message, Object data)`（F1 `:53`）；全局处理器 `handleBusinessException`（F2 `:34-38`）固定 `return ResponseEntity.ok(Result.fail(ex.getCode(), ex.getMessage()))` 并 `body.setData(ex.getData())` ⇒ **Java 侧 `BusinessException` 一律 HTTP 200**，拒绝信息靠 `body.code` 数字码表达。403xx 段除 `40300 FORBIDDEN` 外空闲，`SKILL_FORBIDDEN=40301` / `ACL_UNAVAILABLE=40303` 语义对位。

---

## 1. E1–E6 六条 Skill 执行路径 · 逐条落点表

> 落点精确到 `文件:方法:行号:插入位置`。所有"当前鉴权状态"均经实读代码确认（见附录行号）。

| # | 入口（文件:方法） | 当前鉴权状态（实读） | 织入点（文件:方法:插入位置） | 判权对象（skill_id 来源） | 拒绝响应形态 |
|---|---|---|---|---|---|
| **E1** | `runtime/tool_registry_builder.py:332` `registry.register(SkillTool())`（外部包 `openharness.tools.skill_tool`） | 无校验 | `create_platform_tool_registry()` **L527** `registry.register(SafeToolWrapper(tool))` → 改为 `registry.register(AclToolWrapper(SafeToolWrapper(tool), guard, registry))` | `SkillTool` 入参 `args.skill_id`（LLM 直传） | Python：`ToolResult(is_error=True, output="无权执行技能 {skill_id}，需权限码 ai:skill:{skill_id}:run", metadata={"acl":{"code":"AI_SKILL_FORBIDDEN","skill_id":...,"required_permission":"ai:skill:{skill_id}:run"}})`（HTTP 403） |
| **E2** | `runtime/tool_registry_builder.py:190` `PlatformMcpToolAdapter.execute()`（展示名 `self.name = f"mcp__{server_segment}__{tool_segment}"` 由 **L186** `_sanitize_tool_segment` 净化拼成，见 #16；`L190` 确为 `async def execute`，execute 本身没写错）；原始未净化名完整保留于 `self._tool_info.server_name` / `self._tool_info.name`（L182，F39） | 无校验（仅注入身份 header/arg，不判权） | L527 统一织入 `AclToolWrapper`（包裹 `SafeToolWrapper(PlatformMcpToolAdapter)`） | `_resolve_skill_ids` **三档**（#5 裁定，**#16 修正判权名来源**）：① **判权 skill_id 一律取 `self._tool_info.server_name` / `self._tool_info.name`（F39）拼 `f"mcp-{server_name}-{tool_name}"`**（原始未净化名），`registry.get(...)` 命中 → 用其 `ai:skill:{id}:run`；**严禁从 `self.name`（`mcp__a__b` 净化展示名）反解 / `replace` / `normalize` / `split("__")`**（F37/F38）；② 未命中 → 退判 `agent:mcp:call`（V20 已落，菜单 92060 / api 92141）；③ 连 `agent:mcp:call` 也无 → 拒绝 | Python `ToolResult(error, AI_SKILL_FORBIDDEN)`；**output 须显式带 `server` 与 `tool` 名**（运维据此补码）。HTTP 403；**`'self.name'` 是给 LLM 看的展示名、`'mcp-{原始 server}-{原始 tool}'` 是给权限系统看的判别名，两者永不互转（#16）。被包装对象取不到 `_tool_info`（非 MCP 工具）→ fail-closed 拒绝，不退回反解**。**⚠ F46 路径分离现状**：当前 MCP 是**两条分离路径**——① E2 闸门所在（sanitize 工具名，yaml `config.mcp_servers` → 独立 `McpClientManager`）与 ② 原生 skill_id（`registry.py:196` `mcp-{raw}-{raw}`，yaml + admin API 注册 → 平台 `MCPManager` 单例）；**admin API 注册的 server 只进路径②、不进路径①**，故当前不触发跨站漂移，但 yaml server 同时进两条路径，一旦 yaml 加入含 `.` 的 server 即刻断裂；两路径若未来统一到同一 manager，敞口全面引爆——故 #16-c 从源头校验 server_name（见 §2.9）。** |
| **E3** | `skills/tools/formfill_execute.py:92` `FormFillExecuteTool.execute()` → `client.execute_skill()` → **反调 BFF `POST /api/v1/ai/skill/execute`** | 无校验 | ① Python：`create_platform_tool_registry()` L527 织入 `AclToolWrapper`（包裹 `SafeToolWrapper(FormFillExecuteTool())`，注册于 `create_agent_source_registry()` L335）；skill_id = `resolve_skill_id(arguments.skill_id)`（`formfill_execute.py:104` 调用处，默认 `'user-fill'` **定义于 L69 `Field(default="user-fill")` 与 L48 `_default_skill_id`**，#16 行号收口）。② BFF 侧：反调命中 **E6** 再判一次（双重闸门） | `arguments.skill_id`（经 `resolve_skill_id`，默认 `user-fill`） | Python 侧 `ToolResult(error, AI_SKILL_FORBIDDEN)`；反调 BFF 侧 **HTTP 200 + body.code=40301 + data.code=AI_SKILL_FORBIDDEN**（见 E6） |
| **E4** | `skills/tools/formfill_apply.py:91` `FormFillApplyTool.execute()` / `:32` `submit_formfill_apply()` → **反调 BFF `POST /api/v1/ai/skill/apply`** | 无校验 | ① Python：`create_platform_tool_registry()` L527 织入 `AclToolWrapper`（包裹 `SafeToolWrapper(FormFillApplyTool())`，注册于 L336）；skill_id = `arguments.skill_id`（默认 `user-fill`）。② BFF 侧：反调命中 **E6** 再判 | `arguments.skill_id`（默认 `user-fill`） | 同 E3（Python + BFF 双向拒绝） |
| **E5** | `skills/tools/invoke_agent.py:187` `InvokeAgentTool.execute()`（委派 mis-extract/summary/rag/crm-assistant） | 受 worker 白名单 + 深度 + `role=worker` 剔除保护，**无 Skill ACL 码校验** | `create_platform_tool_registry()` L527 织入 `AclToolWrapper`（包裹 `SafeToolWrapper(InvokeAgentTool())`，注册于 L340）。`AclToolWrapper` 对 `agent__invoke` 返回特殊标记 `__delegate__`，**本层不直接判 skill 码**，依赖：(a) 既有白名单/深度治理；(b) 被委托子 Agent 自身工具注册表里的 E1–E5 闸门（递归 fail-closed） | 委派目标是 Agent（非单一 skill）。`AclToolWrapper` 对 E5 放行至下游，由子 Agent 执行其工具时经 E1–E5 受控 | 委派本身被白名单拒时返回既有 `ToolResult(error, "目标智能体不在白名单…")`；子 Agent 内调用无码 skill 仍被 E1–E5 拒（fail-closed 全覆盖）。（**#6 裁定：本期不做独立 `ai:agent:{id}:invoke` 委派码，四重兜底足够**） |
| **E6** | `controller/AiProxyController.java`：`skillExecute`——**L263 是 `@PostMapping("/skill/execute")` 注解，L264 才是方法签名**；`applySkillFill`——**L290 是 `@PostMapping("/skill/apply")` 注解，L291 才是方法签名**（#17 行号收口）；E6 两端点均经 `SkillExecutionEngine.execute()` / `DocWriteRegistry.apply()` 执行 | **零校验**。`/api/v1/ai/skill/execute` 与 `/apply` **未登记 `sys_api`**（#59/#60），`ApiPermissionInterceptor` 按 `deny-unmapped=false` 静默放行 ⇒ 任意登录用户可调 | `skillExecute()`：在 **L267** `ResolvedIdentity identity = resolveIdentity(httpRequest);` 之后、**L269** `skillExecutionEngine.execute(...)` **之前**插入 `skillPermissionChecker.assertCanRun(httpRequest, request.getSkillId());`。`applySkillFill()`（**#17 两步显式落点，缺一不可**）：① **改签名（L291）** `applySkillFill(@RequestBody SkillApplyRequest request)` → `applySkillFill(@RequestBody SkillApplyRequest request, HttpServletRequest httpRequest)`（Spring MVC 自动注入，`L29 import jakarta.servlet.http.HttpServletRequest;` 已存在，无需新增 import，不影响既有调用方与 OpenAPI 契约）；② **插闸门**：在 **L295** `docWriteRegistry.apply(...)` **之前**调 `skillPermissionChecker.assertCanRun(httpRequest, request.getSkillId());`（**无 `resolveIdentity`**：`applySkillFill` 不需委托身份——`assertCanRun` 自读 `httpRequest` 的 `ReverseTrustContext` 判来路，`DocWriteRegistry.apply(...)` 不接收 `userId`/`tenantId` 参数，`resolveIdentity` 产出的 `identity` 为死变量，工程师已删除，F48）。 | `request.getSkillId()`，拼 `ai:skill:{skillId}:run` 在**端用户**权限码集合中查（反向信任支直连 `iamWebClient.loadPermissions` 取端用户真码，见 §3.1）。**E6 判权粒度为用户级跨 App 权限码并集；本期不做 app-scoped 隔离，因上游 `PermissionService.loadAndCache` 不支持按 appId 过滤（F13）**。**⚠ userId 可信前提（#14 / F19–F23）**：E6 取 `ctx.userId()` 用作 `loadPermissions` 入参时，**必须**满足 `ReverseTrustContext.fromUpstreamJwt()==true`（JWT 签名支）；该支 `userId`=MIS JWT `sub`=MIS userId（F19）。`fromUpstreamJwt()==false` 的**降级支**（`ReverseTrustInterceptor.java:183-198`）将 HTTP `X-User-Id` 当 userId，而 `X-User-Id`=**employeeId**（非 MIS userId，F20/F21）→ 若用其 `userId` 调 `loadPermissions` 会命中**他人**权限集（横向越权）。故 §3.1 反向信任支 `assertCanRunReverse` 锁定 `fromUpstreamJwt()==true`，否则直接 `BusinessException(40301)` 拒绝且**零次** `loadPermissions` 调用（详见 §3.1 / §7 #14 / §5 TC-41）。 | BFF `Result.fail(SKILL_FORBIDDEN=40301, …)` → 全局处理器封装为 **HTTP 200**，body `{code:40301, message, data:{code:"AI_SKILL_FORBIDDEN", skillId, requiredPermission:"ai:skill:{id}:run"}}`（F2）。源不可达 → `body.code=40303` |

### 1.1 #59 / #60 已知缺口（依据 §11.3 Q8 裁定）

- `#59 POST /api/v1/ai/skill/execute`、`#60 POST /api/v1/ai/skill/apply` **维持不登记 `sys_api`**（裁定结论：body 级 `skill_id` 粒度无法用 URL 级 permission 表达；form-fill 是全员功能，挂码判权强度≈0）。
- 这两个端点的**唯一**权限门是 T03 的 `SkillPermissionChecker`（fail-closed）。**本 spec 必须为 #59/#60 各补至少一条 fail-closed 用例**（见 §5 TC-24/TC-26/TC-31/TC-32）。
- 实读确认：`AiProxyController` 两端点当前无任何 `Depends`/`assertCanRun` 调用，`resolveIdentity` 仅产出 `ResolvedIdentity(userId, tenantId)`（L321–328），**不含权限码** ⇒ E6 织入时必须自行解析端用户权限（见 §3.1，按来路分支识别）。

### 1.2 落点明确性结论

**E1、E2、E3、E4、E6 落点全部明确且精确到方法内插入位置**。E5 织入点明确，但其"判权对象"为委派目标 Agent 而非单一 skill —— 本层不单独判 skill 码、靠下游 E1–E5 递归 fail-closed 兜底（#6 裁定：本期不做独立委派码，四重兜底足够）。

### 1.3 E1–E5 Python 侧身份来源与 MIS userId 解析（#15）

> E1–E5 走 Python 服务，其判权依赖「端用户 MIS userId → `MisPermissionResolver.resolve(mis_user_id, …)`」。但 Python 侧**当前拿到的不是 MIS userId**（F24–F34），必须新增一层身份解析才能喂给权限解析器。本小节定位问题，解法见 §2.8（契约）/ §3.4（衔接）/ §6 S8（数据迁移）。**核心结论：Python E1–E5 的 `user_id` 不可直接作为 `mis_user_id` 传给 `loadPermissions`；必须先经 `resolve_mis_user_id` 三档解析（#15-a）。**

| 身份来路 | Python 侧实际拿到的标识 | 是否即 MIS userId | 事实出处 |
|---|---|---|---|
| RS256（MIS JWT） | 顶层 `user_id`=**employeeId**；真实 MIS userId 在 `profile["mis_user_id"]` | **否**（`user_id`≠MIS userId） | F24 `deps.py:112` RS256 返顶层 `user_id`=employeeId；F20 `identity/models.py:274` 同；F19 `JwtClaims.java:6-11` `userId≠employeeId` |
| HS256（企微 JWT） | `TokenPayload.user_id`=**企微 userid 字符串**；无 `tenant/app/mis_user_id`/`mis` 标志 | **否**（且缺 MIS 关联字段） | F25 `deps.py:129` `TokenPayload` 无 `mis_user_id`/`mis`；F28 `auth.py:187-194` 回退 `user_id`=企微 userid |
| 反向信任头 `X-User-Id` | employeeId（由 `reverse_trust.py:77-81/119-120` 写入） | **否** | F21 |

**Python 路由层身份对象现状（F27，重大缺口）**：`api/routes/skill.py`（8 端点）、`api/routes/mcp.py`（9 端点）**零 `Depends(` / `Header(`** —— 请求作用域内**根本没有身份对象**（`get_current_user` 仅用于 `agent.py`/`files.py`/`mis_capability.py`/`push.py`，前缀 `/api/v1/skills`、`/api/v1/mcp`；`mcp.py:174 call_tool` 亦然）。⇒ E2 经 `/{name}/call` 触发时，**请求链路里取不到 MIS userId**，必须由 `resolve_mis_user_id` 在「JWT 解析层」提前解析并注入 `UserContext.mis_user_id`（§2.6 / §2.8），而非在路由层临时拼。

**数据层缺口（F26/F29/F32–F34）**：`mis_user_id` 全仓**写 1 处、读 0 处**（`models.py:291`）；`UserModel`（表 `users`）有 `wecom_user_id` 但**无 MIS 列**（F29）；MIS Java 侧**零 `wecom_user_id`**（F31）；仅 1 个 Alembic 迁移 `001_add_agent_memory.py`，其余表靠 `session.py:91 Base.metadata.create_all`（F32）；`wecom_sync.py` **零引用** ⇒ `users` 表实际未被读写（F33/F34）。⇒ 需新增 Alembic `002_add_users_mis_user_id.py` 给 `users` 加 `mis_user_id BIGINT NULL` + 唯一索引（无回填，#15-b，见 §6 S8）。

### 1.4 #15 拆分与阻塞关系（#15-a / #15-b / #15-c）

- **#15-a**（T03 内）：`resolve_mis_user_id` 三档解析（RS256→`profile["mis_user_id"]`；HS256→按 token `user_id` 查 `users.mis_user_id`；无→403）。契约 §2.8，衔接 §3.4。
- **#15-b**（T03 内）：Alembic `002_add_users_mis_user_id.py` 加列 + 唯一索引（无回填）。实施 §6 S8。
- **#15-c**（T06，不阻塞 T03）：企微↔MIS 绑定运维（绑定 / 解绑 UI + `user_lookup` 落 `users.mis_user_id` + 激活 `wecom_sync`）。T03 的 HS256 分支在绑定前按「缺码即 403」fail-closed 处理，不依赖 #15-c。

---

## 2. Python 侧文件契约

### 2.1 `identity/mis_permissions.py`（新，约 150 行）— `MisPermissionResolver`

**职责**：解析并缓存「端用户在某 App 下的 MIS 权限码集合」，是 Python 侧**唯一**权限码来源（走 BFF `GET /internal/permissions`，不直接连库，§4.1 读图要点 2）。

**公开函数签名**：
```python
class PermissionUnavailable(Exception):
    """权限源（BFF / Redis）不可用时抛出；调用方须转为 AI_ACL_UNAVAILABLE 并拒绝。"""

class MisPermissionResolver:
    def __init__(self, redis, bff_base_url: str, ttl_seconds: int = 300,
                 timeout_seconds: float = 1.5) -> None: ...

    def resolve(self, user_id: str, app_id: str, raw_jwt: str) -> set[str]: ...
    def invalidate(self, user_id: str, app_id: str) -> None: ...
    def _cache_key(self, user_id: str, app_id: str) -> str: ...   # "perm:{user_id}:{app_id}"
```

**输入输出与语义**：
- `resolve(user_id, app_id, raw_jwt)`：
  1. `GET redis[_cache_key]` → 命中返回 `set[str]`（含空集合，用于穿透防护，见缓存策略）。
  2. 未命中 → `GET {bff_base_url}/internal/permissions?userId={user_id}&appId={app_id}`，请求头带原始 `raw_jwt`（Bearer）。
  3. 2xx → 解析 `data.codes`（或 `data.permissionCodes`）为 `set[str]`，`SETEX ttl`。
  4. 超时 / 连接拒绝 / 非 2xx / 解析异常 → **抛 `PermissionUnavailable`**（绝不返回空集放行）。
- `invalidate`：删除该 key（授权变更后 BFF 侧可主动调，或依赖 TTL 自然过期）。

**异常语义**：`PermissionUnavailable` 只代表"源不可用"；`SkillAclGuard` 捕获后转 `SkillAclDenied(code="AI_ACL_UNAVAILABLE")`。

**缓存策略（TTL / 失效 / 并发 / 穿透）**：
- TTL **300s**（与 `impl-plan.md` §6.2 / §8.3 一致，亦与 Java 侧 `mis:acl:skillperm:{userId}` 对齐，见 §3.1）。
- **空集合也缓存**（300s）：避免"无权限用户"每次请求都回源 BFF（防穿透）；空集合 → `SkillAclGuard` 判 `contains` 失败 → 拒绝，符合 fail-closed。
- **源失败不写缓存**：`PermissionUnavailable` 路径不 `SETEX`，下次请求重试回源（避免把"不可用"钉死成"拒绝"或"放行"）。
- 并发：依赖 Redis 单线程；无进程内锁。多副本各自回源，BFF 侧 `IamWebClient` 限流保护（§8.3）。

**MIS 不可达降级语义**：**fail-closed（拒绝）**，返回 `AI_ACL_UNAVAILABLE`，**禁止 fallback 到允许**（§4.2 规则 2、§8.3）。（Python 侧 HTTP 403 异常，独立于 Java 技术栈，#10 裁定不强求统一 HTTP 状态。）

### 2.2 `skills/acl.py`（新，约 170 行）— `SkillAclGuard` / `SkillAclDenied`

**职责**：fail-closed 唯一判定器（不改造 `PermissionEngine`）。

**公开函数签名**：
```python
@dataclass
class SkillAclDenied:
    code: str            # "AI_SKILL_FORBIDDEN" | "AI_ACL_UNAVAILABLE"（语义标签，非 wire 码）
    skill_id: str
    required_permission: str
    message: str

class SkillAclGuard:
    def __init__(self, resolver: MisPermissionResolver,
                 registry: "SkillRegistry | None" = None,
                 settings: "Settings | None" = None) -> None: ...

    def permission_code(self, skill_id: str) -> str: ...
    def assert_can_run(self, ctx: "UserContext", skill_id: str) -> None: ...
    def filter_runnable(self, ctx: "UserContext", skill_ids: list[str]) -> list[str]: ...
```

**语义**：
- `permission_code(skill_id)`：**原样**返回 `f"ai:skill:{skill_id}:run"`。**【#1 裁定·作废 `_normalize`】严禁任何 lower / 转义 / 改写 / 非法字符转 `-`**；点号、大写、连字符一律保留，与 Java `SkillGrantVO.permissionCodeOf` 逐字节一致（跨语言黄金向量见 §4）。
- `assert_can_run(ctx, skill_id)`：
  1. `ctx` 为 `None` 或 `ctx` 无身份（`user_id` 空）→ 抛 `SkillAclDenied(code="AI_SKILL_FORBIDDEN")`（§4.2 规则 1）。
  2. `codes = resolver.resolve(ctx.user_id, ctx.profile["app_id"], ctx.raw_jwt)`；把结果写回 `ctx.permission_codes`（§4.1 `UserContext o-- MisPermissionResolver`）。`resolver` 抛 `PermissionUnavailable` → 转 `SkillAclDenied(code="AI_ACL_UNAVAILABLE")`。
  3. 若 `permission_code(skill_id) not in codes` → 抛 `SkillAclDenied(code="AI_SKILL_FORBIDDEN")`（§4.2 规则 3，码集合为空即拒绝）。
  4. 超管豁免：仅当 `settings.acl.superadmin_bypass_role_codes` 显式配置且 `ctx` 的某 role 命中时才放行；**默认关闭**（§4.2 规则 4）。
- `filter_runnable(ctx, skill_ids)`：非抛出版本，返回 `ctx.permission_codes` 中"有执行码"的 skill_id 子集（供检索/排序预过滤，不替代执行期判定）。

**错误返回统一格式**（前端据此提示"缺少权限码 X，请联系管理员"，§4.2）：
```json
{ "code": "AI_SKILL_FORBIDDEN",
  "message": "无权执行技能 member.profile",
  "data": { "skill_id": "member.profile", "required_permission": "ai:skill:member.profile:run" } }
```
> 注：Python 侧 `AI_SKILL_FORBIDDEN` 即 `SkillAclDenied.code`，经 `HTTPException(403, detail={...})` 透传给前端；与 Java 侧 `data.code` 同源同名，前后端统一分支（#2 裁定）。

### 2.3 `runtime/acl_tool_wrapper.py`（新，约 160 行）— `AclToolWrapper`

**职责**：执行前判权，覆盖 E1–E5；包在 `SafeToolWrapper` **外层**（先判权再执行安全包裹，被拒不进入任何副作用逻辑，§4.1 读图要点 1）。

**签名**：
```python
class AclToolWrapper(BaseTool):
    def __init__(self, inner: BaseTool, guard: SkillAclGuard,
                 registry: "SkillRegistry | None" = None) -> None: ...
    async def execute(self, arguments, context: ToolExecutionContext) -> ToolResult: ...
    def _resolve_skill_ids(self, arguments, context) -> list[str] | Literal["__delegate__"]: ...
```

**`execute` 流程**：
1. `skill_ids = self._resolve_skill_ids(args, ctx)`。
2. 若 `skill_ids == "__delegate__"`（E5）：**跳过 skill 码判定**，直接 `return await self._inner.execute(args, ctx)`（治理交给白名单 + 下游 E1–E5）。
3. 否则对每个 `sid`：`guard.assert_can_run(ctx.user_context, sid)`；捕获 `SkillAclDenied` → 返回 `ToolResult(is_error=True, output=f"无权执行技能 {sid}，需权限码 {guard.permission_code(sid)}", metadata={"acl": {...}})`（**不调用 inner**，无副作用）。
4. 全部通过 → `return await self._inner.execute(args, ctx)`（`_inner` 即 `SafeToolWrapper`）。

**`_resolve_skill_ids`**（#5 裁定：E2 改三档）：
- 有 `args.skill_id` 且非空（E1 `SkillTool`、E3/E4 `FormFill*`）→ `[args.skill_id]`。
- E2 `PlatformMcpToolAdapter`（**#16 判权名来源修正**）：判定 skill_id **一律取 `self._tool_info.server_name` / `self._tool_info.name`**（F39 已证 `__init__` L182 `self._tool_info = tool_info` 完整保留原始未净化名），拼 `f"mcp-{server_name}-{tool_name}"` 查 `registry`。**⚠ 严禁从 `self.name`（`mcp__a__b` 净化展示名）反解、`replace` / `normalize` / `split("__")`**（F37/F38）；不新增 `_raw_server_name` 之类冗余属性（`_tool_info` 已是单一事实源）。被包装对象取不到 `_tool_info`（非 MCP 工具 / 结构变更）→ **fail-closed 拒绝**，不退回反解：
  1. `registry.get(f"mcp-{server_name}-{tool_name}")` 命中 → 取其 skill 的 `ai:skill:{id}:run`；
  2. 未命中 → 取 `agent:mcp:call`（V20 已落真实码，菜单 92060 / api 92141）；
  3. 连 `agent:mcp:call` 也不在码集合 ⇒ `assert_can_run` 拒绝（fail-closed）。

> **#16 命名铁律**：`self.name` = "给 LLM 看的展示名"（`mcp__member_profile__query`，点号被 sanitize）；`'mcp-{server}-{tool}'` = "给权限系统看的判别名"（`mcp-member.profile-query`，点号原样）。§4.1 黄金向量表新增 `member.profile` 两形态并列行，二者**永不互推**（反解会退档 / 误匹配，TC-46 / TC-47 断言）。
  拒绝时 `output` **必须显式带 `server` 与 `tool` 名**（如 `"无权调用 MCP 工具 {server}/{tool}，需权限码 ai:skill:...:run 或 agent:mcp:call"`），否则运维不知该给哪个 server 补码。
- E5 `InvokeAgentTool`：返回 `"__delegate__"`。

### 2.4 `runtime/tool_registry_builder.py`（改，约 +30 行）— 织入 E1–E5

- `create_platform_tool_registry()`：构造 `guard = SkillAclGuard(resolver, registry, settings)`（resolver 来自依赖注入/单例）。
- **L527** 由 `registry.register(SafeToolWrapper(tool))` 改为：
  ```python
  registry.register(AclToolWrapper(SafeToolWrapper(tool), guard, source))
  ```
- `create_agent_source_registry()` 内 `SkillTool()` / `FormFillExecuteTool()` / `FormFillApplyTool()` / `InvokeAgentTool()` 的注册（L332–340）**不变**，统一在 L527 处被外层包裹。
- `AclToolWrapper` 必须包在 `SafeToolWrapper` **外层**（T03 关键约束）。

### 2.5 `api/deps.py`（改，约 +70 行）— `require_ops_permission` / `require_skill_run`

```python
async def require_ops_permission(
    required: str | None = None,
    authorization: str = Header(default=""),
    ctx: dict = Depends(get_current_user),
) -> dict:
    """运营端点鉴权。解析端用户权限码后，若 required 不在集合中 → 403 AI_OPS_FORBIDDEN。
    required 省略时由调用方在路由内显式检查具体 agent:* 码。"""

async def require_skill_run(
    skill_id: str | None = None,
    authorization: str = Header(default=""),
    ctx: dict = Depends(get_current_user),
) -> dict:
    """直接 skill 执行路由鉴权（如 mcp.py /{name}/call 触发 E2）。调 SkillAclGuard.assert_can_run。"""
```

- 二者均先 `get_current_user()` 得 `ctx`（含 `mis=True`），再用 `MisPermissionResolver` 解析 `ctx["permission_codes"]`（`raw_jwt` = `authorization[7:]`）。
- `require_ops_permission` 缺码 → `HTTPException(403, detail={"code":"AI_OPS_FORBIDDEN",...})`（Python 路由侧码，Java 侧不定义，#2 裁定）。
- `skill.py` 8 个端点、`mcp.py` 9 个端点当前**零鉴权**（实读确认），全部补 `Depends(require_ops_permission("agent:xxx:yyy"))`；`mcp.py POST /{name}/call` 额外 `Depends(require_skill_run(skill_id=<由 name/req 推导>))` + `require_ops_permission("agent:mcp:call")`。

### 2.6 `identity/models.py`（改，约 +15 行）— `UserContext` 增强

- 新增字段 `permission_codes: set[str] = Field(default_factory=set)`（§3.3、类图 §4.1）。
- 新增 `raw_jwt: str | None = None`（供 resolver 回源 BFF；或 resolver 直接从 `deps` 拿到 `authorization`，二选一，推荐后者不污染模型）。
- 新增方法 `has(self, code: str) -> bool`：`code in self.permission_codes`。
- **不改** `build_user_context`（权限码由 `MisPermissionResolver` 在请求期填充，不在此构造）。
- 注意：`tenant_id` / `app_id` 当前落在 `profile` 字典（`build_user_context` L288–295），`resolver.resolve` 取 `ctx.profile["tenant_id"]` / `ctx.profile["app_id"]`。

### 2.7 `skills/registry.py`（改，约 +20 行）— 码表暴露

- `SkillRegistry.permission_code(self, skill_id: str) -> str`：返回 `f"ai:skill:{skill_id}:run"`（与 guard 同源，避免漂移）。
- `SkillRegistry.all_permission_codes(self) -> list[str]`：遍历 `list_active()` 生成批量码表（供 `filter_runnable` / 授权页预填）。
- 不改既有注册/索引逻辑。

### 2.8 `identity/mis_user_id.py`（新，约 90 行）— `resolve_mis_user_id`（#15-a）

**职责**：把 Python 侧「JWT / 反向信任头」产出的身份对象，解析为 **MIS userId（`int`）**，供 `MisPermissionResolver.resolve(mis_user_id, …)` 取端用户权限码。这是 E1–E5 fail-closed 的**前置身份闸门**——解析不出 MIS userId 即视为无身份，直接 `SkillAclDenied(code="AI_SKILL_FORBIDDEN")`。

**公开函数签名**：
```python
def resolve_mis_user_id(
    identity: "UserContext | dict",
    db: "Session | None" = None,
) -> int | None:
    """返回 MIS userId（int）；解析不出 → None（调用方 fail-closed 403）。
    - 严禁返回顶层 user_id（那是 employeeId / 企微 userid，非 MIS userId，F20/F24/F28）。
    - 仅 RS256 用 profile["mis_user_id"]；HS256 查 users.mis_user_id；其余 → None。"""
```

**三档解析伪码（#15-a，F24–F31）**：
```python
def resolve_mis_user_id(identity, db=None) -> int | None:
    # 档 1：RS256（MIS JWT）—— 真 MIS userId 只在 profile["mis_user_id"]
    if getattr(identity, "mis", False) or identity.get("mis") is True:
        profile = identity.profile if hasattr(identity, "profile") else identity.get("profile", {})
        mis_uid = profile.get("mis_user_id")          # ⚠ 绝不用顶层 user_id（= employeeId，F20/F24）
        if mis_uid is not None:
            return int(mis_uid)
        return None                                   # RS256 但缺 mis_user_id → fail-closed

    # 档 2：HS256（企微 JWT）—— token.user_id 是企微 userid 字符串（F28）
    wecom_uid = identity.get("user_id") or getattr(identity, "user_id", None)
    if wecom_uid is not None and db is not None:
        row = db.query(UserModel.mis_user_id).filter(
            UserModel.wecom_user_id == str(wecom_uid)).first()
        if row and row[0] is not None:
            return int(row[0])                        # 已绑定（#15-c 完成前多为 None → 下一档 None）
        return None                                   # 未绑定 → fail-closed（不阻塞：#15-c 在 T06）

    # 档 3：反向信任头 / 其它 —— X-User-Id=employeeId（F21），非 MIS userId → 拒绝
    return None
```

**与 `UserContext` 的衔接（§2.6 / §3.4）**：`resolve_mis_user_id` **必须在 JWT 解析层（`api/deps.py:get_current_user` / `identity/models.py:build_user_context`）调用**，把结果写入 `UserContext.mis_user_id`（§2.6 新增字段），再交给 `AclToolWrapper` / `require_skill_run`。**禁止在 `skill.py` / `mcp.py` 路由层临时解析**（见下方 F27 警告）。

> **⚠ F27 现象（属实，但攻击面归属 Q13·管理类 REST，非 E1–E5）**：`api/routes/skill.py`（8 端点）、`api/routes/mcp.py`（9 端点，含 `mcp.py:174 call_tool`）**零 `Depends(` / `Header(`**——请求作用域内**确实没有身份对象**（F27 现象属实，值得记录）。**但 E1–E5 并不经这两个路由文件触发**：它们走 **Agent 工具注册表层**（`tool_registry_builder.py:527` 织入 `AclToolWrapper`，身份经 `tool_metadata["identity"]`，见 F35/F36），身份由 `runtime/oh_runtime_builder.py:218-223` 注入、经 7 跳单字段链透传（F42/F43）。`skill.py`/`mcp.py` 是**管理类 REST**，经 BFF PEP + 58 条 `sys_api` 收口，归属 **Q13**（观察项，不在 T03 修）。**归因修正不影响 v1.5 落地方案的正确性**：「不在路由层临时解析、由 JWT 解析层注入 `UserContext.mis_user_id`、缺失即 fail-closed、绝不回退 `ctx.user_id`（employeeId）去调 `loadPermissions`」仍然成立（那是 #14 同款横向越权防线）；只是施工者须知**改 `skill.py`/`mcp.py` 覆盖不了 E1–E5**——E1–E5 的身份缺口由 F42/F43 描述的工具层链路决定，最终实现方式待 T03 边界裁定（见 §3.4 末提示）。**S2/S3/S4 验收信号保留**：`mis_user_id` 注入成功 / 缺失即拒 / 绝不回退 employeeId（Q12，P1）。

**异常语义**：返回 `None` ⇒ 调用方（`SkillAclGuard.assert_can_run` / `require_skill_run`）转 `SkillAclDenied(code="AI_SKILL_FORBIDDEN")` / `HTTPException(403, detail={"code":"AI_SKILL_FORBIDDEN",...})`（Python 独立技术栈，#10 口径）。**不抛异常、不返回 employeeId**。

### 2.9 `api/routes/mcp.py` + yaml loader — MCP server 命名准入（#16-c）

**唯一命名权威**：`^[A-Za-z][A-Za-z0-9_-]{0,63}$`（与 `_sanitize_tool_segment` 允许集**完全对齐**，首字符限字母同时消灭 `mcp_` 前缀分支，见 Q4）。`_sanitize_tool_segment` **退化为纯防御性兜底**——正常路径下此正则应让任何合法名**零改写**通过，不应再触发任何字符替换。

**两处强制校验（#16-c，进 T03，不留 backlog）**：
1. **运行时 admin API**：`api/routes/mcp.py:103 register_server` 对 `req.name` 校验，不合规 → `400` 拒绝注册（**不写入 `MCPManager`**），错误信息明确指出允许字符集。
2. **启动期 yaml loader**：`loader.py:89,100` 附近加载期做**同一条**正则校验，不合规 → **启动失败**（fail-fast）并打印违规 server 名，**不得**静默 sanitize 后继续启动。

**影响章节**：§1 E2（F46 路径分离）、§2.3（#16 命名铁律已要求取 `_tool_info` 原始名）、§3.2（#16 施工禁令）、§4.1、§5 TC-48/TC-49/TC-50。

---

## 3. Java 侧文件契约

### 3.1 `security/SkillPermissionChecker.java`（新，约 110 行）

**包位置**：`com.mis.adminbff.security`（与 `UserPermissionLoader` 同包）。

**公开签名**（#2 / #3 / #4 裁定：持 `IamWebClient` + `StringRedisTemplate`，按来路分支识别）：
```java
@Component
public class SkillPermissionChecker {
    private final IamWebClient iamWebClient;                 // 直连加载端用户真码（非 UserPermissionLoader）
    private final StringRedisTemplate redisTemplate;         // 独立缓存键 mis:acl:skillperm:{userId}
    private final ObjectMapper objectMapper;                 // F52：缓存 JSON 序列化/反序列化
    private final SkillPermissionCodeService codeService;    // permissionCode(skillId) 委托
    // superadmin bypass 配置：acl.superadminBypassRoleCodes（默认空 ⇒ 关闭）
    private final Set<String> superadminBypassRoleCodes;

    public String permissionCode(String skillId);            // 委托 SkillGrantVO.permissionCodeOf(skillId)
    public void assertCanRun(HttpServletRequest request, String skillId);  // 单一入口，内部按来路分支
}
```

**来路分支识别（#3 裁定，照抄 `AiProxyController.java:323` 既有写法）**：
```java
public void assertCanRun(HttpServletRequest request, String skillId) {
    Object attr = request.getAttribute(ReverseTrustInterceptor.ATTRIBUTE_NAME);
    if (attr instanceof ReverseTrustContext ctx) {
        assertCanRunReverse(ctx, skillId);     // 反向信任（ai-platform）支
    } else {
        assertCanRunDirect(skillId);           // 直连（mis-admin-web）支
    }
}
```

> **【#18 配套 #14】`assertCanRun` 必须自读 `request.getAttribute(ReverseTrustInterceptor.ATTRIBUTE_NAME)`，`instanceof ReverseTrustContext ctx` 后**先判 `ctx.fromUpstreamJwt()`**（false → 直接 `BusinessException(SKILL_FORBIDDEN=40301)` 拒、**不回源**，#14；true → 取 `ctx.userId()`）；**非反向信任支回落 `SecurityContextHolder.getOptional()`**（F53：用 `getOptional()` 非 `getLoginUser()` / `.getContext().getAuthentication()`，取 `Optional<LoginUser>` 后判 null）。**严禁复用 `AiProxyController.resolveIdentity(...)` 返回值**（`AiProxyController.java:321-328` 的 `ResolvedIdentity` 仅带 `userId/tenantId`、**不携带 `fromUpstreamJwt`**，两条信任支被揉平——若用它判权，降级支 `X-User-Id`=employeeId 会被当 userId 调 `loadPermissions` ⇒ 命中他人权限集，重演 #14，F41）。**不修改 `resolveIdentity` 本身**（服务于既有执行链，改签名波及已上线 FormFill 反向链路）。

**`permissionCode(skillId)`**：`SkillGrantVO.permissionCodeOf(skillId)` → `ai:skill:{skillId}:run`（**原样保留点号**，与 Python 一致）。

**反向信任支 `assertCanRunReverse(ReverseTrustContext ctx, skillId)`（#3 裁定核心 + #14 硬约束）**：
- **【#14 硬约束·横向越权防护】`userId` 可信前提**：进入本支**必验** `ctx.fromUpstreamJwt()==true`（`ReverseTrustContext.java:16-22` 位标；JWT 签名支 `:179` 置 `true`、降级支 `:197` 置 `false`，F23）。`fromUpstreamJwt()==true` ⇒ `ctx.userId()`=MIS JWT `sub`=MIS userId（`RsaJwtIssuer.java:46` `sub=userId`、`JwtClaims.java:6-11` `userId≠employeeId`，F19）。`fromUpstreamJwt()==false` ⇒ 降级支把 HTTP `X-User-Id` 当 userId，而 `X-User-Id`= **employeeId**（`reverse_trust.py:77-81/119-120` 写入，F21；`identity/models.py:274` `user_id`=employeeId，真实 MIS userId 在 `profile["mis_user_id"]`，F20）→ 若用其 `userId` 调 `loadPermissions` 会命中**他人**权限集（横向越权）。**故锁定 JWT 支，降级支直接拒，零 `loadPermissions` 调用**：
  ```java
  void assertCanRunReverse(ReverseTrustContext ctx, String skillId) {
      if (!ctx.fromUpstreamJwt()) {                 // 降级支：X-User-Id 是 employeeId，不可信
          throw new BusinessException(
              SKILL_FORBIDDEN /*40301*/, "反向信任降级支无可信 userId，拒绝",
              Map.of("code","AI_SKILL_FORBIDDEN","skillId",skillId,
                     "requiredPermission",required,"reason","reverse_trust_degraded_no_jwt"));
      }
      Long userId = ctx.userId();                   // F49：ReverseTrustContext 为 record，userId() 返 Long（= MIS sub = MIS userId）
      // ↓ 进入「统一取码伪码」（loadPermissions(userId)），绝不用 employeeId
      ...
  }
  ```
  **关键不变量**：降级支被拒时，`iamWebClient.loadPermissions` 调用次数 = **0**（不取码、不回源、不写缓存）。对应 §5 **TC-41**（fromUpstreamJwt=false→40301，zero loadPermissions）。
- **明令禁止读 `LoginUser.getPermissions()`** —— 那是 `ReverseTrustInterceptor` 硬编码塞入的 `Set.of("ai:*:use")`（伪造值，F5 双模式 / `ReverseTrustInterceptor.java:63`），用它判权等于放行。改由 `iamWebClient.loadPermissions(ctx.userId())` 直连 mis-iam 加载**端用户真实码**。
- **统一取码伪码（#12 明确化，F16 绝不静默）**：拿到 `userId`（反向信任支 `ctx.userId()` / 直连支 `SecurityContextHolder.getOptional()` 取 `LoginUser` 后 `.getUserId()`）后两支路共用；缓存键 `mis:acl:skillperm:{userId}`，TTL **60s**（#13，见缓存键纪律）：
  ```java
  // 1) 缓存命中直接用（含空集，防穿透）。F51：StringRedisTemplate 存 JSON 字符串，
  //     用 ObjectMapper 序列化/反序列化（非裸字符串集合）
  String json = redisTemplate.opsForValue().get(KEY(userId));
  Set<String> perms = null;
  if (json != null && !json.isBlank()) {
      try {
          perms = new LinkedHashSet<>(objectMapper.readValue(json, STRING_LIST));  // F51
      } catch (JsonProcessingException ex) {
          log.warn("反序列化技能权限缓存失败: key={}", KEY(userId), ex);
          // 反序列化失败 → 降级回源（perms 保持 null）
      }
  }
  if (perms == null) {
      try {
          // F50：iamWebClient.loadPermissions(userId) 返 List<String>；
          //      内部 loadPermissions(Long) 转为 Set<String>（LinkedHashSet）
          List<String> list = iamWebClient.loadPermissions(userId);   // F16：下游失败一律抛 BusinessException，绝不静默
          perms = list == null ? Set.of() : new LinkedHashSet<>(list);
      } catch (BusinessException ex) {
          if (ex.getCode() == 40400) {                    // 用户不存在（PermissionService.java:40）
              throw new BusinessException(SKILL_FORBIDDEN /*40301*/, "用户无执行技能权限",
                  Map.of("code","AI_SKILL_FORBIDDEN","skillId",skillId,"requiredPermission",required));
          }
          throw new BusinessException(ACL_UNAVAILABLE /*40303*/, "权限源不可用",   // 50000 系：超时/非2xx/无响应
              Map.of("code","AI_ACL_UNAVAILABLE","skillId",skillId));
      }
      try {
          redisTemplate.opsForValue().set(KEY(userId), objectMapper.writeValueAsString(perms), Duration.ofSeconds(60));  // F51：JSON 序列化写入；异常不写缓存；空集也写（防穿透）
      } catch (JsonProcessingException ex) {
          log.warn("序列化技能权限缓存失败: key={}", KEY(userId), ex);
      }
  }
  // 2) 判权：查到了但没权限（含空集 / 下游 data.permissions 为 null 返 List.of()）→ 40301
  if (perms == null || perms.isEmpty() || !perms.contains(required)) {
      throw new BusinessException(SKILL_FORBIDDEN /*40301*/, "无权执行技能 "+skillId,
          Map.of("code","AI_SKILL_FORBIDDEN","skillId",skillId,"requiredPermission",required));
  }
  ```
  > 三档语义（与 §0 错误码表「触发条件」列一致）：① 下游 `40400` 用户不存在 → `SKILL_FORBIDDEN=40301`（视为无权限）；② `50000` 系（超时/连接拒绝/非 2xx/无响应，F16 `block()` 原样透传或转 `INTERNAL_ERROR`）→ `ACL_UNAVAILABLE=40303`（源不可用，fail-closed）；③ 查到但 `required` 不在集合（**含空集**、含 `List.of()` 的"查无权限"真值，F16 证明 `IamWebClient.java:206` 的 `List.of()` 仅在此实触发）→ `SKILL_FORBIDDEN=40301`。**空集 WARN 日志**（F6 `loadPermissions` body 为 null 静默返 `List.of()`，会误把"源结构异常"判成"无权限"，接受此不精确，但留痕）。
- **fail-closed 兜底**：`userId` 取不到（直连支 `SecurityContextHolder.getOptional()` 返 null / `getUserId()` 抛空）或加载失败 → 拒绝，不得放行。

**直连支 `assertCanRunDirect(skillId)`（与反向信任支**共用同一条取码链路**）**：
- `LoginUser loginUser = SecurityContextHolder.getOptional().orElse(null);`（F53：用 `getOptional()` 非 `getLoginUser()` / `.getContext().getAuthentication()`）；超管豁免先判 `loginUser` 角色（默认关闭）；`loginUser == null || loginUser.getUserId() == null` → 直接 `BusinessException(ACL_UNAVAILABLE=40303, "无法解析登录用户身份")` 拒绝，fail-closed；否则 `userId = loginUser.getUserId()`（F9 确认 `LoginUser` 经网关头解析**必定注入 `userId`**）。
- **明令禁止读 `LoginUser.getPermissions()`**：直连链路上它**恒为 null** —— F9 `LoginUserHeaderResolver.java:18-36` 只调 `setUserId/setTenantId/setAppId/setEmployeeId/setUsername`，**从不调 `setPermissions`**，故 `LoginUser.permissions` 初始即 null；再叠加 F11 —— E6 的 #59/#60 未登记 `sys_api`，`ApiPermissionInterceptor:52-58` 判定 `match.isEmpty()` 且 `deny-unmapped=false` 直接 `return true`，**根本走不到 `:76-80` 的权限回填**，所以 PEP 永远不会为 E6 补权限码。因此直连支读 `getPermissions()` 永远拿不到码，是死代码。
- 取码走**上方「统一取码伪码」**（缓存键 `mis:acl:skillperm:{userId}`，TTL **60s**），与反向信任支**完全相同**；本支只负责提供 `userId`，不重复取码逻辑。
- 判 `required ∈ codes` → 否则 `BusinessException(SKILL_FORBIDDEN=40301, …)`；超管豁免：`superadminBypassRoleCodes` 非空且登录用户某 role 命中才放行（默认关闭）。

> **取码逻辑统一（M1 修正，推翻 R1 原 #3 直连支取码方式）**：E6 两条支路**共用同一条** `iamWebClient.loadPermissions(userId)` + `mis:acl:skillperm:{userId}` 缓存取码链路；分支**只用于确定 `userId` 的来源**（反向信任支 `ctx.userId()` / 直连支 `SecurityContextHolder.getOptional()` 取 `LoginUser` 后 `.getUserId()`），**绝不用于确定取码方式**。原"直连支读 `LoginUser.getPermissions()`、为空才回源"的双套逻辑，因 `getPermissions()` 恒为 null（F9+F11），实际每次都走回源分支——纯属死代码，v1.3 已删除。**实现要点：一个取 `userId` 的三元分支 + 一条统一取码链路**，不要写成两套。

**为什么不动 `ReverseTrustInterceptor` 的 `ai:*:use`（#3 裁定理由，F4 证据）**：`ReverseTrustConfiguration.java:29-32` 反向信任拦截器**只拦两条路径** `/api/v1/ai/skill/execute`、`/api/v1/ai/skill/apply`，即 `ai:*:use` 的污染面精确等于 E6、不外溢；而 #59/#60 已裁定不登记 `sys_api`，风险已闭合。为 T03 去改它会把回归面扩到 T02 刚验收的 58 条端点，不划算。**本 spec 明确：T03 不修改 `ReverseTrustInterceptor`。**

**为什么 `ai:*:use` 是死码、动它只有回归风险（C2 实锤，支持 #3 不碰）**：`ApiPermissionInterceptor.java:82-86` 的权限比对是 `userPerms.contains(required)` 的纯 `Set.contains` **字面量循环，无通配符**、无 `*` 展开。因此 `ai:*:use` 匹配不上任何真实权限码（`ai:skill:member.profile:run` 等都不等于它），是一个**无效占位符**——风险等级从"可能通配符误放（零鉴权）"**下调为"最多误拒"**。再叠加 F11（E6 的 #59/#60 路径 PEP 在 `:52-58` 提前 `return true`，根本不进入 `:82-86` 比对），`ai:*:use` 当前**连误拒都不会发生**。结论：它既不危险也不起作用，**T03 不修改 `ReverseTrustInterceptor`、不增删 `ai:*:use`**。

**为什么完全不走 `UserPermissionLoader`（#4 裁定证据）**：`UserPermissionLoader.load()` 有两道短路 —— `:42-43` `appId == null → return Set.of()`、`:46-47` `getPermissions()` 非空 → 原样返回**永不回源**。反向信任支必然踩第二道（permissions 被塞了 `ai:*:use`，非空），拿到的是伪造空集，判权直接失效。故 E6 禁用 `UserPermissionLoader`，直连 `iamWebClient.loadPermissions`。

**缓存键纪律（#4 / #13 裁定）**：本检查器独占 `mis:acl:skillperm:{userId}`，**TTL 60s**（#13：由 300s 下调——mis-iam `RbacCacheSupport.onUserPermissionsChanged`(:47-54) 只 DEL `mis:rbac:permissions:*`，不感知本键（F17），300s=最长 5 分钟越权窗口；E6 走对话触发 QPS 低、回源压力可接受，故用 60s 换更小越权窗口）。**严禁复用 `CacheConstants.RBAC_PERMISSIONS`**（那是 `tenantId+appId+userId` 三元组、被 `UserPermissionLoader` 语义占用，混写污染正常登录态权限缓存；其 appId 取自 `SysUser` 实体字段（F14），反向信任支拿不到 ⇒ 独立键决策仍成立，但要付 F17 的代价（F18））。

**抛法固定格式（#2 裁定，F1+F2 协同）**：
```java
throw new BusinessException(
    AgentOpsErrorCodes.SKILL_FORBIDDEN,                 // 40301
    "无权执行技能 " + skillId,
    Map.of("code", "AI_SKILL_FORBIDDEN",               // 字符串语义标签，非 wire 码
           "skillId", skillId,
           "requiredPermission", required));
```
全局处理器（F2）用 `body.setData(ex.getData())` 把结构化明细送到前端 `body.data`，并固定返回 **HTTP 200**（`body.code=40301`）。

### 3.2 `controller/AiProxyController.java`（改，约 +8 行）— E6 织入

- 构造函数注入 `SkillPermissionChecker skillPermissionChecker`。
- `skillExecute()`（L263–278）：在 L267 `ResolvedIdentity identity = resolveIdentity(httpRequest);` 之后、`skillExecutionEngine.execute(...)`（L269）**之前**插入：
  ```java
  skillPermissionChecker.assertCanRun(httpRequest, request.getSkillId());
  ```
- `applySkillFill()`（L290–302）：当前**未**调用 `resolveIdentity`；在 L295 `docWriteRegistry.apply(...)` **之前**插入：
  ```java
  skillPermissionChecker.assertCanRun(httpRequest, request.getSkillId());
  ```
- `SkillPermissionChecker.assertCanRun(HttpServletRequest, …)` 内部自行按 `ReverseTrustInterceptor.ATTRIBUTE_NAME` 判来路（§3.1），无需在 controller 里区分。
- 拒绝时 `BusinessException(SKILL_FORBIDDEN=40301)` 由全局处理器封装为 **HTTP 200 + body.code=40301 + body.data.code=AI_SKILL_FORBIDDEN**（F2），前端据此展示"缺少权限码 X"。

**⚠ 施工禁令（M2，F12 证据）：`SkillPermissionChecker` 必须在 Controller 方法体内调用，禁止做成拦截器 / AOP 切面。**
- 理由：`ApiPermissionInterceptor.java:40-43` 中 `DispatcherType.ASYNC` / `ERROR` 直接 `return true` 跳过鉴权，注释写明"SSE/Flux 异步写出时会二次进入拦截器，此时 `LoginUser` 已空"。若 `skillExecute` 走 SSE/流式响应，`DispatcherType.ASYNC` 会二次进入拦截器链，届时 `SecurityContextHolder` 已被 `GatewayContextFilter:39` 的 finally 清空。把判权做成拦截器会在异步二次进入时踩空——要么 NPE，要么被迫加 `ASYNC` 跳过逻辑，而那等于开了个绕过闸门的后门。
- **钉死位置**：本 spec 规定在 `skillExecute()` / `applySkillFill()` **方法体内**、执行引擎调用**之前**显式 `skillPermissionChecker.assertCanRun(...)`（§3.2 上方两处插入点）。该位置在同步主流程中执行，`SecurityContextHolder` 有效；即便将来接口改流式，主流程的同步判权仍在首次进入时生效，不依赖拦截器二次进入。**不得**为"统一"而抽成拦截器 / 切面。

- **【#16 施工禁令·E2 命名铁律】**：E2 判权 skill_id **一律**由 `PlatformMcpToolAdapter._tool_info`（原始 `server_name` / `name`）拼 `f"mcp-{server_name}-{tool_name}"` 得来；`self.name`（净化展示名 `mcp__a__b`）**仅给 LLM 看，绝不参与判权、绝不反解**。不新增 `_raw_*` 冗余属性（`_tool_info` 即单一事实源）。反解 / `normalize` / `split("__")` 一律禁止——会退档（E2 三档→两档，per-skill 判权永久失效）或跨 server 误匹配（越权放行，比 #14 更隐蔽，发生在权限码解析之前）。

- **【#17 施工禁令·`httpRequest` 形参前置】**：凡落点出现 `httpRequest` 的 Java 方法，施工前**必须确认方法签名已含 `HttpServletRequest` 形参**；没有就先补（如 `applySkillFill` 增 `HttpServletRequest httpRequest`，Spring 自动注入，无需新增 import），**禁止另起 `RequestContextHolder` 旁路取法**（保持与 `skillExecute` L267 单一范式）。照抄 L267 写法时先核对签名，避免 `cannot find symbol` 编译失败。

### 3.3 `service/agentops/SkillPermissionCodeService.java` — `ensureCode` 时序衔接

已实读确认（L95–184）懒注册已实现且并发安全。与 T03 校验的衔接：

| 时序 | 行为 | T03 影响 |
|---|---|---|
| 创建 Skill 成功后（§5.4 Q1-b 调用点 a） | BFF 创建 Skill 端点成功 → 同步 `ensureCode(skillId)` → `createMenu` 建 `ai:skill:{id}:run` 按钮节点 | **注册失败不回滚主流程**；响应体返回 `permissionCodeRegistered: false` 让前端提示。注册成功后才返回 200 ⇒ 管理员在 200 后尝试 E6 执行时码已存在 |
| 进 grants 授权页（调用点 b） | 若码缺失则 `ensureCode` 补建 | 兜住"经 registry.yaml / 手工建"的历史 Skill |
| 并发竞态 | 两实例同时发现码不存在、同时 `createMenu` → 第二个撞 `uk_menu_app_permission` → `createCode` catch 后 `findMenuIdByPermission` 回扫，扫到当成功，扫不到才真失败 | 无 5xx，最终状态正确 |
| **Skill 刚创建、码尚未注册** | 若 `ensureCode` 未完成（或失败）时端用户就触发 E6 | `assertCanRun` 在端用户码集合查不到 `ai:skill:{id}:run` → **拒绝（HTTP 200 + body.code=40301）**，fail-closed 正确；直到 `ensureCode` 成功 + 权限缓存刷新后可执行 |
| 码生成规则一致性 | `SkillGrantVO.permissionCodeOf(skillId)` = `f"ai:skill:{skillId}:run"`（点号原样）；`menuCodeOf` 生成 `ai_skill_run_{slug}`（下划线化，仅 menu.code 用） | Python `SkillAclGuard.permission_code` 必须逐字节一致（见 §4、§7 #1） |

### 3.4 Python 侧身份解析衔接（S9 设计：`misUserId` 第五键 + 5 跳透传，#15-a / F42–F43 / F54–F60）

E6 Java 侧**不受 #15 / S9 影响**：MIS Java 侧**零 `wecom_user_id`**（F31），其 `userId` 来自 MIS JWT `sub`（F19），本就是 MIS userId；§3.1 已用 `fromUpstreamJwt()` 锁定 JWT 支（#14），降级支直接拒。S9 仅作用于 **Python E1–E5** 工具层身份链。

#### S9 问题根因（F42/F43 制约，v1.7 遗留 → v1.9 裁定）

v1.7 §3.4 末尾的 F42/F43 制约提示已由主理人在 S9 设计阶段裁定，核心问题：

- **F42**：工具层身份是一条 **7 跳单字段链，全程只传 `user_id`、无 `mis_user_id` 承载位** ⇒ 即使 `UserContext.mis_user_id` 注入成功也**传不到工具层**，`AclToolWrapper` 在工具层拿到的是 dict 而非 `UserContext`
- **F43**：企微入站链路 = Redis Stream → `inbound_worker.py` 消费 → `ensure_session` → `manager.run`，**全程无 HTTP 请求作用域** ⇒ `Depends(get_current_user)` **永不执行**，JWT 解析层的 `resolve_mis_user_id` 无法触发
- **F55（S9 关键洞察）**：两条渠道 `user_id` 语义不同——Web `user_id` 经 MIS gateway JWT 下发**就是 MIS userId**（F19 `sub`=userId）；企微 `user_id = f"wecom_{wecom_user_id}"`（`wecom_sync.py:177` 平台本地 ID）**非** MIS userId

**结论**：v1.5/v1.7 的「在 JWT 解析层注入 `UserContext.mis_user_id`、由 `AclToolWrapper` 读 `ctx.mis_user_id`」方案**对企微链路不适用**（F43 无 HTTP 作用域），对 Web 链路也**传不到工具层**（F42 无承载位）。S9 改为**在 session 创建点解析 `misUserId` + 全链 5 跳透传 + `build_mcp_identity` 加第五键**，绕开 F42/F43。

#### S9 设计方案（4 条已批准决策，不可推翻）

**决策 1：开新字段不动老字段（F59）**

`build_mcp_identity`（`mcp_identity.py:35-48`）加第五键 `misUserId`：
```python
# mcp_identity.py — L19 IDENTITY_ARG_KEYS 追加第五键
IDENTITY_ARG_KEYS = ("userId", "userMobile", "channel", "channelUserId", "misUserId")

# L35-48 build_mcp_identity 增 mis_user_id 形参
def build_mcp_identity(*, user_id="", user_mobile="", channel="",
                       channel_user_id="", mis_user_id="") -> dict[str, str]:
    return {
        "userId": (user_id or "").strip(),
        "userMobile": (user_mobile or "").strip(),
        "channel": (channel or "").strip(),
        "channelUserId": (channel_user_id or "").strip(),
        "misUserId": (mis_user_id or "").strip(),   # 第五键，空串=未解析/无身份
    }
```
- `identity_from_tool_metadata`（L107-128）同步追加读取 `"misUserId"` / `"mis_user_id"`
- **不改 `userId`**（保持向后兼容：`userId` 仍是平台 user_id / 企微本地 ID，供 HTTP Header 透传与日志用）
- `IDENTITY_HEADER_MAP`（L27-32）**不增 `misUserId`**（该字段仅内部判权用，不下发 HTTP Header——避免 `X-Mis-User-Id` 泄漏 MIS userId 到下游）

**决策 2：5 跳透传链（F60，一处漏则断）**

`misUserId` 从 session 到 `build_mcp_identity` 的 5 跳透传：

| 跳 | 文件:行号 | 当前签名（实读） | S9 改动 |
|---|---|---|---|
| ① Session | `session.py:81` `Session.__init__` | `user_id, user_mobile, channel, channel_user_id` | 增 `mis_user_id: str = ""` 形参 + `self.mis_user_id` 字段；`to_dict()`(L168) / `get_session()`(L334) 同步序列化/反序列化 |
| ② Manager | `manager.py:82-90` `runtime.run(...)` | `user_id=session.user_id, user_mobile=session.user_mobile, ...` | 增 `mis_user_id=session.mis_user_id` |
| ③ OpenHarness | `openharness.py:374` `run(*, ...)` → `:469` `build_native_query_engine(...)` | `user_id, user_mobile, channel, channel_user_id` | 增 `mis_user_id: str = ""` 形参；`:469` 透传 `mis_user_id=mis_user_id` |
| ④ Builder | `oh_runtime_builder.py:155` `build_native_query_engine(*, ...)` → `:219` `build_mcp_identity(...)` | `user_id, user_mobile, channel, channel_user_id` | 增 `mis_user_id: str = ""` 形参；`:219` 透传 `mis_user_id=mis_user_id` |
| ⑤ Identity | `mcp_identity.py:35-48` `build_mcp_identity(*, ...)` | 4 键 | 增 `mis_user_id` 形参 → 返回 `misUserId` 第五键（决策 1） |

**消费侧**：`tool_registry_builder.py:207` `identity_from_tool_metadata(context.metadata)` 自动读到 `misUserId`（决策 1 已改 `IDENTITY_ARG_KEYS`）；`AclToolWrapper`（§2.2 / §2.3）从 `identity["misUserId"]` 取 MIS userId 喂 `MisPermissionResolver.resolve`。

**决策 3：入口只由服务端填（F55/F56/F57/F58）**

`misUserId` 在 **session 创建点**由服务端解析，**禁止客户端传入**（F58）。两条渠道解析逻辑不同（F55 关键洞察）：

| 渠道 | session `user_id` 真实含义 | `misUserId` 解析方式 | 代码落点 |
|---|---|---|---|
| **Web / RS256** | MIS gateway JWT 下发，**就是 MIS userId**（F19 `sub`=userId） | `resolve_mis_user_id(identity)` 取 JWT `profile["mis_user_id"]`（§2.8 档1）；Web 场景 `user_id` 已是 MIS userId ⇒ **亦可直取** `mis_user_id = user_id` | `api/routes/session.py:95` `POST /sessions`：从 `get_current_user()` 取 JWT 身份，调 `resolve_mis_user_id`，写入 session |
| **企微 / HS256** | `f"wecom_{wecom_user_id}"`（`wecom_sync.py:177` 平台本地 ID，非 MIS userId） | 查 `users.mis_user_id`（需 #15-b Alembic `002` 加列）；未绑定 → 空串 → fail-closed | `queue/inbound_worker.py:426` `ensure_session(...)`：从 `inbound.user_id` 提取 `wecom_user_id`，查库取 `mis_user_id`，写入 session |
| 其它 / 反向信任头 | `X-User-Id`=employeeId（F21） | 不取（非 MIS userId） → 空串 → fail-closed | — |

**`create_session()` gap（F56）**：当前 `create_session()`（`session.py:215`）签名仅 `(agent_id, user_id, channel, runtime_type)`，**不收** `user_mobile`/`channel_user_id`/`mis_user_id`；而 `ensure_session()`（L263）收 `user_mobile`/`channel_user_id`。S9 须给 `create_session()` 补 `mis_user_id: str = ""` 形参（以及 `user_mobile`/`channel_user_id`，与 `ensure_session` 对齐），避免 `POST /sessions`（Web 入口）走 `create_session` 时丢失 `misUserId`。

**7+ 会话创建点（F57）——每一处都须确保 `mis_user_id` 被解析并写入 session**：

| # | 文件:行号 | 入口类型 | S9 动作 |
|---|---|---|---|
| 1 | `session.py:215` `create_session()` | 底层创建 | **补 `mis_user_id` 形参**（F56 gap） |
| 2 | `session.py:263` `ensure_session()` | 底层创建/恢复 | **补 `mis_user_id` 形参** |
| 3 | `api/routes/session.py:95` `POST /sessions` | **Web 入口** | 调 `resolve_mis_user_id` 解析，传给 `create_session` |
| 4 | `api/routes/mis_capability.py:313` | Web/MIS 能力 | 解析并透传 |
| 5 | `api/routes/mis_capability.py:415` | Web/MIS 能力 | 解析并透传 |
| 6 | `agent/mis_rag/qa_pipeline.py:631` | RAG 管线 | 解析并透传 |
| 7 | `skills/tools/invoke_agent.py:844` | 委派工具 | 解析并透传 |
| 8 | `queue/inbound_worker.py:426` `ensure_session()` | **企微入口** | 查 `users.mis_user_id`，传给 `ensure_session` |

> **`user_mobile` 匹配桥（F54，备选非强制）**：企微 API `mobile` 经 `wecom_sync.py:160` 存入 `UserModel.phone`，`user_mobile` 已在 session/identity 链中透传（`session.py:88` / `inbound_worker.py:431` / `mcp_identity.py:38`）。当 `users.mis_user_id` 为空（未绑定）时，**可**用 `user_mobile` → `UserModel.phone` 反查 MIS userId 作为备选匹配桥。但 S9 首选 `wecom_user_id` → `users.mis_user_id` 直查；`user_mobile` 桥留作 T06 绑定运维增强项，不在 T03 强制实现。

**决策 4：判权只认新字段，取不到即拒（fail-closed）**

`AclToolWrapper`（§2.2 / §2.3）从 `identity["misUserId"]` 取 MIS userId：
```python
mis_uid_str = identity.get("misUserId", "")
if not mis_uid_str:
    # 取不到 misUserId → fail-closed 拒绝（决策 4）
    raise SkillAclDenied(code="AI_SKILL_FORBIDDEN",
                         skill_id=skill_id, reason="mis_user_id_missing")
mis_uid = int(mis_uid_str)
# 喂 MisPermissionResolver.resolve(mis_uid, ...) 取端用户权限码
```
- **绝不回退 `identity["userId"]`**（那是 employeeId / 企微本地 ID，非 MIS userId，F20/F24/F55）
- **绝不回退 `identity["userMobile"]`** 做判权（手机号非身份标识）
- 企微用户 `mis_user_id` 为空（未绑定）→ **拒绝**，不等同于"匿名放行"

#### 业务风险标注

- **企微绑定前所有企微用户全被拒**：`users.mis_user_id` 列加完后初始全 NULL（#15-b 只加不回填），在 #15-c（T06）激活绑定运维前，**所有企微渠道的 E1–E5 工具调用一律 fail-closed 拒绝**。这是设计预期，不是 bug。
- **兜底在 T06**：企微↔MIS 绑定 UI + `wecom_sync` 激活 + `user_lookup` 落 `users.mis_user_id` 均在 T06（#15-c），不在 T03 范围。T03 只负责：① 加列（#15-b Alembic `002`）② 透传链 + `misUserId` 第五键 ③ fail-closed 语义。
- **Web 用户不受影响**：Web/RS256 的 `user_id` 已是 MIS userId（F55），`misUserId` 可直取，无需绑定。

#### 与既有裁定的关系

- **#15-a**（§2.8 `resolve_mis_user_id`）：函数签名不变，但**调用点从「JWT 解析层」前移到「session 创建点」**（F43 制约：企微无 HTTP 作用域，JWT 解析层永不执行）。Web 入口仍可经 `get_current_user()` 取 JWT 后调 `resolve_mis_user_id`；企微入口改在 `inbound_worker.py` 的 `ensure_session` 调用前查库。
- **#15-b**（Alembic `002`）：仍需加列 `users.mis_user_id`，S9 不改。
- **#15-c**（T06 绑定运维）：仍不在 T03 范围，S9 不改。
- **F42/F43**：S9 直接解决——F42（无承载位）由决策 1+2（第五键 + 5 跳透传）解决；F43（无 HTTP 作用域）由决策 3（session 创建点解析）解决。v1.7 的「待 T03 边界裁定」状态**已关闭**。
- **§7 #15 / #16 既有裁定**：不受影响。

---

## 4. 权限码规则

| 项 | 值 / 规则 |
|---|---|
| 码格式 | `ai:skill:{skill_id}:run` |
| skill_id 处理 | **原样保留**（含点号、大写、连字符，如 `member.profile` / `CRM-Lookup`）。**禁止** lower/转义/改写/非法字符转 `-`。（#1 裁定：**作废** `impl-plan.md` §4.2 那句"需先经 `_normalize`"——本 spec 注记，不改 impl-plan；V21 L91–94、`SkillGrantVO.permissionCodeOf`、`§4.3` 表外附注均为权威依据）。Python `SkillAclGuard.permission_code` 禁止 `_normalize`（§2.2）。 |
| 挂载 App | **`system`**（app_id=1，跨端能力：业务页 / 企微 / Agent 对话）。可选同时挂 `agent` App（调试对话），但判定取"当前 JWT `appId` 下角色聚合的码"，故同一人在不同 App 下结果可能不同（符合设计，§5.4 跨 App 语义、UI#2 需文案说明）。**注意**：BFF 侧 `iamWebClient.loadPermissions(userId)` 无 appId 入参（F6），**E6 侧做不到 app-scoped 判定**，跨 App 语义仅在 Python 侧成立（见 §5 TC-34 标注）。 |
| 菜单节点 ID 段 | `92200–92299`（V21 占位）。`92200` = 目录「AI 技能执行权」（`type=1, permission=NULL, visible=0`）；`92201`+ = 每 Skill 一个 `type=3` 按钮节点。 |
| 种子（V21 已落） | `92201 ai:skill:member.profile:run`、`92202 ai:skill:member.points-account:run`、`92203 ai:skill:member.coupons-account:run`；`visible=1`（按钮进权限码集合，`permissionCodes()` 不过滤 visible/type）。 |
| menu.code（slug，区别于 permission） | `ai_skill_run_{下划线化 slug}`（如 `ai_skill_run_member_profile`），仅供 `uk_menu_app_code` 唯一，不参与判权。 |
| 与 `sys_role_permission` 关系 | `sys_role_permission(role_id, perm_type='menu', target_id=sys_menu.id)`；种子仅授 `role_id=1`（D11）。码必须先以 `sys_menu` 行存在，`MenuService.permissionCodes()` 才会聚合进用户码集合（V21 L10–14）。 |
| 新增 Skill | 走 `SkillPermissionCodeService.ensureCode` 懒注册（§3.3 / §5.4 Q1-b），菜单 ID 走 `IdGenerator`，沿用 92200–92299 段。 |
| Java ⇄ Python 一致性 | 两侧 `permission_code` 实现各自独立但**字符串必须完全一致**（§4.1 读图要点 3、§10.5 约定 3），以 `SkillGrantVO.permissionCodeOf` 为权威格式参考。 |

### 4.1 跨语言黄金向量清单（#1 裁定 · TC-37 依据 · 防漂移唯一保险）

> Java（`SkillGrantVO.permissionCodeOf`）与 Python（`SkillAclGuard.permission_code`）各写一条单测，按此表**逐字节断言**。`agent:mcp:call` 为 V20 已落真实码，列入对照供 E2 中档（#5）断言。

| 输入 `skill_id` | 期望 `permission_code`（Java == Python 逐字节） | 验证点 |
|---|---|---|
| `member.profile` | `ai:skill:member.profile:run` | 点号原样保留 |
| `member.points-account` | `ai:skill:member.points-account:run` | 点号 + 连字符原样 |
| `member.coupons-account` | `ai:skill:member.coupons-account:run` | 同上 |
| `user-fill` | `ai:skill:user-fill:run` | 纯小写无点号 |
| `CRM-Lookup`（构造样本：含大写与连字符） | `ai:skill:CRM-Lookup:run` | **大写与连字符均保留，证明无 lower / 无 `-`→`-` 改写** |
| （E2 中档）`agent:mcp:call` | `agent:mcp:call`（V20 已落，菜单 92060 / api 92141） | E2 未映射 skill 时退判此码 |
| （E2 MCP·`member.profile` 两形态，**#16** 新增）server 名含点号 `member.profile` | 展示名 `mcp__member_profile__query`（`self.name`，点号被 `_sanitize_tool_segment` 变 `_`）；判别名 `mcp-member.profile-query`（registry skill_id，`_tool_info` 原始名，点号原样） | **两形态并列、永不互推**：E2 第①档必须用判别名 `mcp-member.profile-query` 查 `registry`（命中 `ai:skill:mcp-member.profile-query:run`）；**严禁从展示名反解**，否则退档 / 误匹配（TC-46 / TC-47 断言） |
| （源不可用·错误路径）`mis-iam` 返 500 / 超时 / 连接拒绝（下游 `50000` 系） | —（不构成 permission_code） | `assertCanRun` → `body.code=40303` `AI_ACL_UNAVAILABLE`（F16 `block()` 绝不静默，异常原样透传/转 `INTERNAL_ERROR），对应 **TC-39** |
| （用户不存在·错误路径）`userId` 下游返 `40400`（`PermissionService.java:40`） | —（不构成 permission_code） | `assertCanRun` → `body.code=40301` `AI_SKILL_FORBIDDEN`（视作无权限，#12 三档①），对应 **TC-40** |

---

## 5. fail-closed 测试矩阵

> **断言口径（#10 裁定，全量重写；C4 一致性补注）**：
> - **Java / E6 侧**：`BusinessException` 经全局处理器（F2）**一律 HTTP 200**；拒绝靠 `body.code` 数字码表达 —— 无码 `body.code == 40301` 且 `body.data.code == "AI_SKILL_FORBIDDEN"` 且 `body.data.requiredPermission == "ai:skill:{id}:run"`；源不可达 `body.code == 40303`。**所有 E6 用例不得断言 HTTP 403**（旧口径会让 QA 全红、误判代码 bug）。
> - **Python / E1–E5 侧**：维持 `HTTPException(403, detail={"code": ...})`（Python 独立技术栈、独立基座，不强求与 Java 统一 HTTP 状态，仅统一 `code` 字符串语义标签）。
> - **与 PEP 既有拒绝形态一致（C4 实锤）**：`ApiPermissionInterceptor.java:55/:63/:87` 三处拒绝**全部** `throw new BusinessException(ResultCode.FORBIDDEN)` ⇒ 经 `GlobalExceptionHandler` ⇒ **HTTP 200 + body.code=40300**。本 E6 的 `40301` / `40303` 与基座 `40300` **同为 HTTP 200 + body.code**，前端只需按 `body.code` 分支，不写两套；QE/前端断言统一据此。
> - 覆盖：有权限 / 无权限 / 权限码不存在 / Skill 不存在；MIS 不可达 / 超时 / 5xx；缓存命中 / 过期 / 穿透；#59/#60 专项；六路径各 ≥1 正 + ≥1 反。每行：用例 ID · 路径 · 前置条件 · 操作 · 期望结果（精确状态码 + 错误码）· 覆盖风险点。

| ID | 路径 | 前置条件 | 操作 | 期望结果 | 覆盖风险点 |
|---|---|---|---|---|---|
| TC-01 | E1 | 用户持有 `ai:skill:member.profile:run` | LLM 调 `skill` 工具 `skill_id=member.profile` | 执行成功（HTTP 200） | 正向基线 |
| TC-02 | E1 | 用户无该执行码 | 同上 | `ToolResult(is_error=true, acl.code=AI_SKILL_FORBIDDEN, required_permission=ai:skill:member.profile:run)`；HTTP 403；**无副作用** | 无码拒绝 · 无副作用 |
| TC-03 | E2 | MCP 工具 `mcp__crm__lookup` 映射到已注册 skill 且有码 | LLM 调该 MCP 工具 | 执行成功（三档①命中 skill 码） | E2 正向（映射命中） |
| TC-04 | E2 | MCP 工具未映射到 skill，但 `agent:mcp:call`（V20 已落）有码 | LLM 调 `mcp__unknown__x` | 执行成功（三档②退 `agent:mcp:call`，#5 裁定） | E2 中档兜底（复用已落码） |
| TC-04b | E2 | MCP 工具未映射 skill，且 `agent:mcp:call` 也无 | LLM 调 `mcp__unknown__x` | `AI_SKILL_FORBIDDEN` 拒绝（HTTP 403），`output` 显式带 `server`+`tool` 名 | E2 三档皆失 fail-closed |
| TC-05 | E3 | 用户有 `ai:skill:user-fill:run`；BFF 侧也有码 | 触发 `formfill__execute`（经 SkillTool→反调 BFF） | Python 侧通过 + BFF E6 通过 | 双向闸门正向 |
| TC-06 | E3 | 用户无码 | 同上 | Python `AI_SKILL_FORBIDDEN`（HTTP 403）；即便绕过 Python 直接反调 BFF，E6 仍 HTTP 200 + body.code=40301 + data.code=AI_SKILL_FORBIDDEN | 双重闸门 · 无码拒绝 |
| TC-07 | E4 | 用户有 `ai:skill:user-fill:run` | 触发 `formfill__apply` | Python 通过 + BFF `/apply` 通过 | E4 正向 |
| TC-08 | E4 | 用户无码 | 同上 | Python `AI_SKILL_FORBIDDEN`（HTTP 403）；直接反调 BFF `/apply` 仍 HTTP 200 + body.code=40301 | E4 双重拒绝 |
| TC-09 | E5 | 委派 `crm-assistant`（白名单内） | LLM 调 `agent__invoke` | 委派通过（白名单）；子 Agent 执行受 E1–E5 控 | E5 治理 + 下游递归 |
| TC-10 | E5 | 委派不在白名单 / 子 Agent 调无码 skill | `agent__invoke` 非白名单目标 | 返回"目标不在白名单"；子 Agent 内无码 skill 被 E1 拒 | E5 治理未退化 · 下游 fail-closed |
| TC-11 | E1 | BFF `/internal/permissions` **超时** | 执行任一 skill | `AI_ACL_UNAVAILABLE` 拒绝（HTTP 403，Python 侧） | 源超时 fail-closed |
| TC-12 | E1 | BFF 返回 **5xx** | 同上 | `AI_ACL_UNAVAILABLE` 拒绝 | 源 5xx fail-closed |
| TC-13 | E1 | Redis 挂，但 BFF 可达 | 执行 skill | 回源 BFF 成功，重写缓存，执行通过 | 缓存失效不影响 |
| TC-14 | E1 | BFF **连接拒绝**（不可达） | 执行 skill | `AI_ACL_UNAVAILABLE` 拒绝 | 源不可达 fail-closed |
| TC-15 | E1 | 权限码已缓存 | 执行 skill | 命中缓存，不调 BFF，执行通过 | 缓存命中 |
| TC-16 | E1 | 缓存**过期** | 执行 skill | 回源 BFF，重写缓存，执行通过 | 缓存过期回源 |
| TC-17 | E1 | 用户**无任何权限**（空集合） | 执行 skill | 空集合被缓存(300s)，判 `contains` 失败 → `AI_SKILL_FORBIDDEN` 拒绝；不每次回源 | 穿透防护 + 空集合拒绝 |
| TC-18 | E1 | 匿名 / `UserContext` 为 None | 执行 skill | `AI_SKILL_FORBIDDEN` 拒绝（§4.2 规则 1） | 匿名拒绝 |
| TC-19 | E1 | skill_id 合法但 `sys_menu` 无该行（码不存在） | 执行该 skill | resolver 返回集合不含该码 → `AI_SKILL_FORBIDDEN` 拒绝 | 码不存在拒绝 |
| TC-20 | E1 | registry 无此 skill（`SkillTool` 会 404） | 执行不存在的 skill | 判权优先于执行：若码也不存在 → `AI_SKILL_FORBIDDEN`；SkillTool 自身 404（双重保险） | Skill 不存在处理 |
| TC-21 | E1 | 配置了某 role 但 `superadmin_bypass_role_codes` 未开 | 该 role 用户无码执行 | 仍 `AI_SKILL_FORBIDDEN` 拒绝 | 超管豁免默认关闭 |
| TC-22 | E1 | `superadmin_bypass_role_codes` 显式配置含该 role | 该 role 用户无码执行 | **放行** | 超管豁免显式开启 |
| TC-23 | E6 #59 | 前端直连，用户有码 | `POST /api/v1/ai/skill/execute` | HTTP 200 + body.code=0（成功） | E6 正向 |
| TC-24 | E6 #59 | 前端直连，用户无码 | 同上 | **HTTP 200 + body.code=40301 + body.data.code="AI_SKILL_FORBIDDEN" + body.data.requiredPermission="ai:skill:{id}:run"** | #59 无码拒绝（§4.3 要求，#10 口径） |
| TC-25 | E6 #60 | 前端直连，用户有码 | `POST /api/v1/ai/skill/apply` | HTTP 200 + body.code=0（成功） | E6 正向 |
| TC-26 | E6 #60 | 前端直连，用户无码 | 同上 | **HTTP 200 + body.code=40301 + body.data.code="AI_SKILL_FORBIDDEN"** | #60 无码拒绝（§4.3 要求，#10 口径） |
| TC-27 | E6 #59 | ai-platform 反向信任调用，端用户有码 | `POST /api/v1/ai/skill/execute`（带反向信任头） | HTTP 200 + body.code=0（用**端用户**真码判权，经 `iamWebClient.loadPermissions`） | 反向信任端用户判权（#3 裁定） |
| TC-28 | E6 #59 | ai-platform 反向信任，端用户**无**码（即便 reverse-trust 通过） | 同上 | **HTTP 200 + body.code=40301 + body.data.code="AI_SKILL_FORBIDDEN"** | 反向信任不绕过 fail-closed（第二道是真闸门，非橡皮图章） |
| TC-29 | E6 | 登录态/端用户权限码取不到（IAM 不可达，`loadPermissions` 抛异常） | 直连执行 | **HTTP 200 + body.code=40303（ACL_UNAVAILABLE）**，异常不写缓存 | E6 源不可用（#4 异常≠空集） |
| TC-30 | E6 | 新建 Skill 刚创建、码尚未注册完成 | 立即触发 E6 执行 | **HTTP 200 + body.code=40301**（直到 `ensureCode` 成功 + 缓存刷新） | 新码竞态 fail-closed |
| TC-31 | #59 | `ApiPermissionInterceptor` 未登记该端点（deny-unmapped 静默放行） | 无码执行 | 仅靠 `SkillPermissionChecker` 拦下 → HTTP 200 + body.code=40301 | 证明缺口由代码层兜住（§11.3 Q8） |
| TC-32 | #60 | 同上 | 无码 apply | 仅靠 `SkillPermissionChecker` 拦下 → HTTP 200 + body.code=40301 | 同上 |
| TC-33 | E1/E3/E4/E6 | 被拒用例（TC-02/06/08/24/26 等） | 执行 | 断言：**无**外呼 BFF 写库、**无** MCP 调用、**无** `SkillExecutionEngine.execute` | 无副作用断言（B3 验收） |
| TC-34 | **仅 E1–E5**（#4 裁定：E6 侧因 F6 无 appId 无法验证） | 同一人持 `system` App JWT 有码、持 `agent` App JWT 无码 | 在两 App 下分别执行（仅 Python 侧走 `/internal/permissions?appId=`） | system→通过，agent→拒绝（跨 App 判定语义） | 跨 App 判定语义（**标注：不适用 E6**） |
| TC-35 | T03 并发 | 两个请求同时为新 skill `ensureCode` | 并发创建执行码 | 仅建 1 条菜单，无 `uk_menu_app_permission` 5xx；最终状态一致 | 并发竞态（§3.3） |
| TC-36 | E1 | 批量 skill 列表，部分有权 | `filter_runnable(ctx, [有码,无码])` | 返回仅含"有码"子集，**不抛** | `filter_runnable` 预过滤 |
| TC-37 | 跨语言 | Java `SkillGrantVO.permissionCodeOf` 与 Python `SkillAclGuard.permission_code` | 按 §4.1 黄金向量表（含 `member.profile` / `member.points-account` / `member.coupons-account` / `user-fill` / `CRM-Lookup`）逐条断言两边输出**逐字节相等** | 两边均通过，无漂移 | **#1 裁定·防漂移唯一保险**（原样保留点号/大写/连字符） |
| TC-39 | E6（#12 三档②） | mis-iam `loadPermissions` 返 500 / 超时 / 连接拒绝（下游 `50000` 系，F16 `block()` 绝不静默） | `POST /api/v1/ai/skill/execute`（含反向信任调用） | **HTTP 200 + body.code=40303 + body.data.code="AI_ACL_UNAVAILABLE"** | 源不可用 fail-closed（对应 §4.1 错误路径①） |
| TC-40 | E6（#12 三档①） | 端用户 `userId` 在 mis-iam 不存在（下游 `40400`，`PermissionService.java:40`） | `POST /api/v1/ai/skill/execute`（含反向信任调用） | **HTTP 200 + body.code=40301 + body.data.code="AI_SKILL_FORBIDDEN"**（用户不存在视作无权限） | 用户不存在判无权限（对应 §4.1 错误路径②） |
| TC-41 | E6 #59（**#14**） | 反向信任**降级支**（`fromUpstreamJwt()==false`）调 `POST /api/v1/ai/skill/execute`（`X-User-Id`=employeeId，F20/F21） | 同上（带降级支反向信任头） | **HTTP 200 + body.code=40301 + body.data.code="AI_SKILL_FORBIDDEN" + body.data.reason="reverse_trust_degraded_no_jwt"**；断言 **`iamWebClient.loadPermissions` 调用次数 = 0**（不取码、不回源、不写缓存） | #14 横向越权防护：降级支直接拒、零 `loadPermissions`（绝不用 employeeId 查他人权限） |
| TC-42 | E6 #59（**#14**） | 反向信任 **JWT 支**（`fromUpstreamJwt()==true`），端用户有码 | 同上（带合法 MIS JWT） | HTTP 200 + body.code=0（用端用户 MIS `sub`=MIS userId 真码判权放行） | #14 正向：JWT 支正常判权 |
| TC-43 | E1/E2（**#15-a 档1**） | RS256（MIS JWT），`profile["mis_user_id"]` 存在且有执行码 | LLM 调 `skill` / MCP 工具 | Python 通过（`resolve_mis_user_id` 取 `profile["mis_user_id"]`，**绝不用顶层 `user_id`**（=employeeId，F20/F24）） | #15 档1 正确取到 MIS userId |
| TC-44 | E1/E2（**#15-a 档2**） | HS256（企微 JWT），`user_id`=企微 userid，`users.mis_user_id` **未绑定**（#15-c 未做） | 同上 | `AI_SKILL_FORBIDDEN` 拒绝（HTTP 403）；`detail`/`output` 含 `reason="wecom_unbound"`（**不回退 employeeId**） | #15 档2 未绑定 → fail-closed |
| TC-45 | E1/E2（**#15-a 档2**） | HS256（企微 JWT），`users.mis_user_id` **已绑定**（#15-c 完成后） | 同上 | Python 通过（`resolve_mis_user_id` 按 `wecom_user_id` 查到 `mis_user_id` 且有码） | #15 档2 绑定后放行 |

| TC-46 | E2（**#16**） | server 名含点号 `member.profile`（`_tool_info.server_name="member.profile"`），registry 已注册 skill `mcp-member.profile-query` 且有码 | LLM 调 `mcp__member_profile__query`（展示名，点号已 sanitize） | E2 第①档取 `_tool_info` **原始名**拼 `mcp-member.profile-query` → `registry.get` 命中 → 用 `ai:skill:mcp-member.profile-query:run` 判权**通过**；**不得**退到 `agent:mcp:call`、**不得**误判"skill 不存在"而误拒 | #16 判权名来源修正：raw server/tool → 正确判别名（点号原样） |
| TC-47 | E2（**#16**） | `member.profile` 与 `member_profile` **同时注册**（净化后展示名同名，但判别名 `mcp-member.profile-query` vs `mcp-member_profile-query` 不同） | LLM 分别调两个 MCP 工具 | **断言**：`member.profile` → `mcp-member.profile-query`、`member_profile` → `mcp-member_profile-query`，各自解析到**正确** skill_id，**不发生跨 server 误匹配**（越权防线，写成断言非注释） | #16 重灾：净化后同名 → 跨 server 误匹配越权；raw 名区分则安全 |
| TC-48 | `api/routes/mcp.py` `POST /mcp`（**#16-c**） | 注册 server 名 `member.profile`（含非法字符 `.`） | 调 `register_server(name="member.profile")` | **400 拒绝注册**，且不写入全局 `MCPManager` 单例（准入正则 `^[A-Za-z][A-Za-z0-9_-]{0,63}$` 拦截） | #16-c 源头准入：非法名从注册端被消灭 |
| TC-49 | `api/routes/mcp.py` `POST /mcp`（**#16-c**） | 注册 server 名 `1srv`（数字开头）/ `_srv`（下划线开头，Q4 前缀分支） | 分别调 `register_server` | **均 400 拒绝**（首字符限字母，消灭 `mcp_` 前缀分支） | #16-c 首字符约束 |
| TC-50 | yaml 加载（`loader.py:89,100` 附近，**#16-c**） | `mcp-servers.yaml` 含非法 server 名 | 启动加载 | **启动期 fail-fast 报错并指明违规 server 名**，**不得**静默 sanitize 后继续启动 | #16-c yaml 侧同条正则、fail-fast |

**矩阵统计**：共 **50** 条。六路径正向：E1(01,43)/E2(03,04,43,46)/E3(05)/E4(07)/E5(09)/E6(23,25,27,42)；六路径反向：E1(02)/E2(04b,47)/E3(06)/E4(08)/E5(10)/E6(24,26,28,30,31,32,41)。#59/#60 专项：TC-24/26/31/32。**#14 横向越权防护**：TC-41（降级支拒、零 `loadPermissions`）/TC-42（JWT 支放行）。**#15 Python 身份链**：TC-43（RS256 档1）/TC-44（HS256 未绑定拒）/TC-45（HS256 绑定放行）。**#16 E2 判权名来源**：TC-46（点号 server 正确命中）/TC-47（净化后同名不误匹配，断言）。**#16-c server_name 准入**：TC-48（`member.profile`→400 拒、不写 `MCPManager`）/TC-49（`1srv`/`_srv` 前缀分支→400 拒）/TC-50（yaml 非法名→启动 fail-fast）。源不可用：TC-11/12/14（Python）+TC-29/TC-39（E6, body.code=40303）。用户不存在：TC-40（E6, body.code=40301）。缓存：TC-13/15/16/17。边界：TC-18/19/20/21/22/34/36。跨语言：TC-37。

---

## 6. 实施顺序与依赖

> T03 拆有序子步骤。**依赖**：T01（V21 执行码已落）、T02（BFF 转发 + 反向信任三因子可复用 + 新建独立 `InternalPermissionController` 挂 `/internal/permissions`，见 S5/#9）。T03 与 T04 可并行（§8.1 第 3 波），交叉点 `api/deps.py` 与 `routes/skill.py|mcp.py` 约定 **T03 先合**（§8.2）。

| 步骤 | 内容 | 依赖 | 并行/串行 | 验收信号 |
|---|---|---|---|---|
| **S1** | Python 数据模型 + 解析器：`identity/models.py`（+`permission_codes`/`has`）、`identity/mis_permissions.py`（`MisPermissionResolver` + `PermissionUnavailable`） | T01, T02 | 可并行写码（与 S2/S3/S4/S6 码面并行） | `MisPermissionResolver` 单测：缓存命中/过期/空集合缓存/超时抛 `PermissionUnavailable` |
| **S2** | Python 判定器 + 包装：`skills/acl.py`（`SkillAclGuard`/`SkillAclDenied` + **禁止 `_normalize`** + 黄金向量断言）、`runtime/acl_tool_wrapper.py`（`AclToolWrapper` + E2 三档）、`skills/registry.py`（码表） | S1 | 串行（依赖 resolver） | `SkillAclGuard` 单测 4 条 fail-closed 语义（§4.2）+ `AclToolWrapper` 单测：E1/E3/E4 拒绝返回 `ToolResult(error)`、E2 三档、E5 放行至下游；**TC-37 黄金向量逐字节断言** |
| **S3** | Python 织入：`runtime/tool_registry_builder.py` L527 包裹 E1–E5 | S2 | 串行 | 集成：LLM 调 E1–E5 无码一律 `ToolResult(error)`，有码执行 |
| **S4** | Python 路由鉴权：`api/deps.py`（`require_ops_permission`/`require_skill_run`）、`api/routes/skill.py`（8 端点）、`api/routes/mcp.py`（9 端点，含 `/{name}/call` 额外 `require_skill_run`） | S1,S2 | 与 S3 并行（同改注册表/路由，约定 T03 先合避免冲突） | `skill.py`/`mcp.py` 零鉴权端点清零；无 `agent:*` 码 → 403 `AI_OPS_FORBIDDEN` |
| **S5** | BFF 内部接口（#9 裁定，#11 C1 结案已裁定）：新建独立 **`InternalPermissionController`** 挂 **`/internal/permissions`**（非 `/api/v1/**`，天然绕开 PEP、不需 sys_api、T02 的 58:58 完好）；鉴权重用反向信任三因子（`ReverseTrustConfiguration.java:29-32` 的 `addPathPatterns` 追加 `/internal/permissions`）；**端点签名仅 `userId`（去掉 `appId` 参数——F13 证明上游 `PermissionService.loadAndCache` 返回跨 App 并集、传 appId 不起作用，留着是误导）**。**解除阻塞（C1 结案）**：主理人实读 `mis-iam` 源码确认 `/internal/v1/permissions/{userId}` 返回**用户级跨 App 权限码并集**（`PermissionService.java:38-46` 签名无 appId、`SysRolePermissionRepository.java:15-20` JPQL 无 appId 条件、`SystemMenuClient.java:37-45` 批量换码亦无 appId，F13），E6 判权粒度即跨 App 并集、本期不做 app-scoped 隔离 | T02 | 必须在 S1 集成测试前就绪（可提前并行开发） | 端点返回端用户 `permissionCodes`（跨 App 并集，非 app-scoped）；仅服务间可调；不污染 `/api/v1/agent-ops/**` 双射 |
| **S6** | Java 判定器 + E6 织入：`security/SkillPermissionChecker.java`（新，持 `IamWebClient`+`StringRedisTemplate`、来路分支、独立键 `mis:acl:skillperm:{userId}`、数字码 40301/40303）、`AgentOpsErrorCodes` 新增 `SKILL_FORBIDDEN=40301`/`ACL_UNAVAILABLE=40303`、`AiProxyController.java`（E6 织入 + 注入） | T02 | 与 S1–S4 完全独立（可并行） | `skillExecute`/`applySkillFill` 无码 → HTTP 200 + body.code=40301 + data.code=AI_SKILL_FORBIDDEN；反向信任用端用户真码判权（拒 `ai:*:use`）；源不可达 body.code=40303 |
| **S7** | 集成测试矩阵（§5 全部 45 条）+ 回归 `PermissionEngine` 检索排序不受影响 | S1–S6, S8 | 串行（最后） | §7 T03 验收 ①–⑤ 全绿；B3 golden case（任意路径触发该 Skill 一律拒绝且无副作用） |
| **S8** | 数据层迁移（**#15-b**）：新增 Alembic `002_add_users_mis_user_id.py`，给 `users` 表加 `mis_user_id BIGINT NULL` + 唯一索引（`NULL` 允许多行）；**无回填**（绑定运维留 #15-c / T06）。与 Python 身份解析链（`S1/S2/S3/S4`）**并行**——仅加列，不阻塞取码；HS256 未绑定分支按「缺码即 403」fail-closed（§2.8 / §3.4） | 独立（仅逻辑并行 S1） | 可与 S1 并行开发、先于 S7 落地 | `alembic upgrade head` 成功；`users` 含 `mis_user_id` 列 + 唯一索引；现有数据零改动（F26 写 1 读 0、`wecom_sync.py` 零引用 F33/F34，无回填风险） |

> **⚠ F27 现象与归因修正（Q12，P1）**：`skill.py`/`mcp.py` **零 `Depends`/`Header`（F27 现象属实）**——但这是**管理类 REST** 攻击面，经 BFF PEP + 58 条 `sys_api` 收口，归属 **Q13**，E1–E5 **不**经这两个路由触发（走 Agent 工具注册表层，`tool_registry_builder.py:527` 织入、身份经 `tool_metadata["identity"]`，见 F35/F36）。故「S2/S3/S4 隐含路由层可取身份」的前提需修正为：**E1–E5 身份经工具层 7 跳单字段链透传（F42/F43），当前链上无 `mis_user_id` 承载位**——这才是 Q12 工作量被低估的根因（不是路由层缺 `Depends`，而是工具层链缺 `mis_user_id` 透传）。**落地方案不变**：不在路由层临时解析、由 JWT 解析层注入 `UserContext.mis_user_id`、缺失即 fail-closed、绝不回退 `ctx.user_id`=employeeId（#14 同款横向越权）；**S2/S3/S4 验收信号保留** ① 注入成功 ② 缺失即拒 ③ HS256 未绑定 403。最终实现受 F42/F43 制约，待 T03 边界裁定（见 §3.4 末）。

**可并行分组**：`[S1 写码 ↔ S2 ↔ S3 ↔ S4]`（Python 链，内部串行）与 `[S5 ↔ S6]`（Java/BFF 链）、`[S8]`（数据迁移，独立）可并行；`S5` 的端点须在 `S1` 集成测试前可用。最终 `S7` 汇流。

---

## 7. 风险与待明确事项（R1 裁定书结论）

> 以下为实读 `impl-plan.md` 与源码后发现的内部分歧 / 缺口，已凭主理人《T03 裁定书 R1》（2026-08-05）全量裁定。本 spec 不自行修改 `impl-plan.md` / `.sql`。

1. **【R1 裁定·采纳】`SkillAclGuard.permission_code` 是否 `_normalize`**：作废 `_normalize`。Python 与 Java 一律 `f"ai:skill:{skill_id}:run"` 原样拼串，点号/大写/连字符保留。`impl-plan.md` §4.2 那句"需先经 `_normalize`（小写、非法字符转 `-`）"标注为**已作废**（本 spec §4 注记，不改 impl-plan）。**落地**：新增跨语言黄金向量表（§4.1）+ TC-37 单测逐字节断言，作为防漂移唯一保险。

2. **【R1 裁定·修正原建议】E6 运行时错误码**：Java 侧**必须用数字码**（F1 `code` 是 `int`，抛字符串编译不过）。`AgentOpsErrorCodes` 新增 `SKILL_FORBIDDEN=40301`（运行时无执行码）、`ACL_UNAVAILABLE=40303`（权限源不可达）；403xx 段除 `40300` 外空闲。`SKILL_CODE_UNAVAILABLE=40917` 语义不变、**仅**留 `ensureCode` 注册失败，与运行时彻底分家。**不新增** `OPS_FORBIDDEN`（Python 路由侧概念，Java 加了是死码）。抛法固定三参构造 `BusinessException(40301, "无权执行技能 "+skillId, Map.of("code","AI_SKILL_FORBIDDEN",...))`，借 F2 `body.setData` 把结构化明细送到前端。`AI_SKILL_FORBIDDEN` 降级为 `data.code` 语义标签。

3. **【R1 裁定·否决(b)，采纳(a)+来路分支；v1.3 修正】E6 反向信任端用户判权来源**：否决"扩展 `ReverseTrustContext` 携带 Python 已解析码"（理由：循环信任/confused deputy、威胁模型不成立、可测性归零）。裁定：按 `request.getAttribute(ReverseTrustInterceptor.ATTRIBUTE_NAME) instanceof ReverseTrustContext` 分两支（照抄 `AiProxyController:323`）——**但 v1.3 修正：分支仅用于确定 `userId` 来源，取码统一回源 `iamWebClient.loadPermissions(userId)`**。**原 R1 写"直连支读 `SecurityContextHolder` 登录态码、空才回源"为错误**：F9 网关头解析从不调 `setPermissions`，直连链路 `LoginUser.permissions` 恒为 null；F11 `#59/#60` 未登记 `sys_api` ⇒ PEP `ApiPermissionInterceptor:52-58` `match.isEmpty()` 且 `deny-unmapped=false` 直接 `return true`，**永不回填权限码**。故直连支读 `getPermissions()` 等于死代码。修正后：**反向信任支** `userId = ctx.userId()`、**直连支** `userId = SecurityContextHolder.getLoginUser().getUserId()`（F9 确认 `userId` 必有值），两路统一走 `iamWebClient.loadPermissions(userId)` + 缓存 `mis:acl:skillperm:{userId}`。**两条路都明令禁止读 `LoginUser.getPermissions()`**（反向信任支是伪造 `ai:*:use`，直连支恒为 null，F9+F11）。**不动** `ReverseTrustInterceptor` 的 `ai:*:use`（F4：作用域仅 E6 两路径，#59/#60 不登记 sys_api，风险已闭合；改它会扩回归面到 T02 的 58 端点）。

4. **【R1 裁定·采纳+强化】`UserPermissionLoader` 坍塌**：E6 **完全不走** `UserPermissionLoader`（F 证据：`:42-43` `appId==null→Set.of()`；`:46-47` `getPermissions()` 非空→原样返回永不回源；反向支必踩第二道拿到伪造 `ai:*:use`）。**异常≠空集必须分开**：`loadPermissions` 抛异常（连接拒绝/超时/5xx）→ `BusinessException(ACL_UNAVAILABLE=40303)`；正常返回但集合不含目标码 → `SKILL_FORBIDDEN=40301`；两者均拒绝但语义可分。**空集 WARN 日志**（F6 `loadPermissions` body 为 null 静默返 `List.of()`，接受此不精确，但不改 `IamWebClient`）。**缓存**：独立键 `mis:acl:skillperm:{userId}` TTL 300s，空集写/异常不写，**严禁复用 `CacheConstants.RBAC_PERMISSIONS`**（污染登录态缓存）。**跨 App 限制**：F6 `loadPermissions(userId)` 无 appId 参数，E6 侧无法按 App 维度过滤端用户权限码，故跨 App 判定语义**仅 Python E1–E5 侧经 `/internal/permissions?appId=` 验证**（TC-34 已标注"不适用 E6"）；E6 侧当前只做"端用户真码 contains 目标码"（取码统一回源 `iamWebClient.loadPermissions`，**不读 `LoginUser.getPermissions()`**——F9+F11 恒为 null，与 #3 一致）。跨 App 细粒度收敛见 §7.1 Q7。

5. **【R1 裁定·采纳】E2 三档落地**：`AclToolWrapper` 对 `mcp__{server}__{tool}` 解析出 `{server}/{tool}` 后走三档：① 映射到已注册 skill → 判 `ai:skill:{id}:run`；② 未映射但 `agent:mcp:call`（V20 已落，菜单 92060 / api 92141）有码 → 退判 `agent:mcp:call`；③ 二者皆无 → fail-closed 拒绝，且错误 `ToolResult` 的 `output` **显式带 server 名 + tool 名**（便于排障）。原 spec 想用 `ai:mcp:{server}:call`，但 V20 未落此码 → 否决，复用已落 `agent:mcp:call`。**遗留 backlog**：server 级执行码收敛至 §7.1 Q7。

6. **【R1 裁定·采纳】E5 不设独立委派码**：本阶段**不新增** `ai:agent:{id}:invoke`。E5 治理仅靠 `agent_whitelist`（委派白名单）拦截越权目标；子 Agent 执行具体 skill 时仍递归进 E1–E5 各自闸门。理由：delegate 是编排动作而非"执行技能"，套 `ai:skill:` 码语义错；白名单已够治。**遗留 backlog**：独立委派码收敛至 §7.1 Q7。

7. **【R1 裁定·确认】Python 路由无 `agent:*` 码**：`api/deps.py` + `routes/skill.py|mcp.py` 一律基于 `ai:skill:*` / `ai:ops:*` 判定；无 `agent:*` 资源码 → 403 `AI_OPS_FORBIDDEN`。与 §4.2 规则一致，原 spec 方向正确，保留。

8. **【R1 裁定·确认】MCP server 白名单 + 执行码双控**：`runtime/acl_tool_wrapper.py` 在 E2 织入点既判 server 是否在白名单、又判执行码；白名单缺失即拒（先于码判定）。原 spec 设计正确，保留；具体白名单来源（MCP 注册表）由工程师在 T03 现状摸底中确认。

9. **【R1 裁定·新增】`/internal/permissions` 独立落位**：新增独立 **`InternalPermissionController`** 挂 **`/internal/permissions`**（**非** `/api/v1/**`），因此天然绕开 PEP（`ApiPermissionInterceptor` 是 `/api/v1/**` 公共基类，F7 不许改；F8 `ApiPermissionConfiguration:44 addPathPatterns("/api/v1/**")`）、不需 sys_api 注册（#59/#60 已证 BFF 零 `/internal` 路径），**完整保留 T02 的 58:58 `/api/v1/agent-ops/**` 双射**（F8 关键）。鉴权重用反向信任三因子：需将 `/internal/permissions` 追加进 `ReverseTrustConfiguration:29-32` 的 `addPathPatterns`。**前置核查（工程师 T03 摸底）**：mis-iam `/internal/v1/permissions/{userId}` 是否按 `appId` 维度返回权限码（F6 `IamWebClient.loadPermissions(userId)` 无 appId 参，E6 侧跨 App 细粒度暂不可达）。

10. **【R1 裁定·新增】断言口径全量改写**：§5 矩阵断言口径按 F2 重写——E6 侧因全局处理器一律 HTTP 200，拒绝靠 `body.code` 数字码表达（`40301` 无码 / `40303` 源不可达），**所有 E6 用例不得再断言 HTTP 403**（旧口径会让 QA 全红、误判代码 bug）；Python E1–E5 侧维持 `HTTPException(403)`（独立技术栈，仅统一 `code` 语义标签）。据此新增 **TC-04b**（E2 三档皆失 fail-closed）、**TC-37**（跨语言黄金向量逐字节断言），**TC-34** 标注"仅 E1–E5，不适用 E6"。矩阵由 36 → **38** 条。

11. **【R2 裁定·C1 结案】E6 判权粒度为跨 App 并集，不做 app-scoped 隔离（#11）**：主理人实读 `mis-iam` 源码确认 `/internal/v1/permissions/{userId}` 返回**用户级跨 App 权限码并集**——`PermissionService.java:38-46` `loadAndCache(Long userId)` 签名无 appId、`SysRolePermissionRepository.java:15-20` JPQL 无 appId 条件、`SystemMenuClient.java:37-45` 批量换码亦无 appId（F13）。故 `InternalPermissionController` 端点签名**去掉 appId 参数**（传了不起作用，留着是误导），§6 S5 解除阻塞、标为已裁定。E6 判权语义在 §1 E6 段补明"跨 App 并集、本期不 app-scoped"。**遗留 backlog Q9**（app-scoped Skill 判权，P2）：需改 `mis-iam` `loadAndCache` 签名 + `SysRolePermissionRepository` JPQL 加 appId + 连带修 F14 键语义（键 app-scoped、值跨 App 的既有错配），跨服务变更，超 T03 边界。注意 F14 `RBAC_PERMISSIONS` 键虽 app-scoped 但值跨 App，本 T03 不可依赖它做 app 隔离。

12. **【R2 裁定·C5 结案】取码三档明确化（#12）**：`SkillPermissionChecker` 取码段写成明确伪码（§3.1「统一取码伪码」），三档与 §0 错误码表「触发条件」列一致——① 下游 `40400` 用户不存在 → `SKILL_FORBIDDEN=40301`（视作无权限）；② `50000` 系（超时/连接拒绝/非 2xx/无响应）→ `ACL_UNAVAILABLE=40303`（源不可用，fail-closed）；③ 查到但 `required` 不在集合（含空集、`List.of()` 的"查无权限"真值）→ `SKILL_FORBIDDEN=40301`。关键事实 F16：`AbstractDownstreamClient.java:73-85` `block()` **任何失败都抛**，绝不静默——`BusinessException` 原样透传、`WebClientResponseException` 转 `INTERNAL_ERROR`、其余 `Exception` 转 `INTERNAL_ERROR`、`RequestContext.java:64-72` `result==null`→`INTERNAL_ERROR`、非成功→透传真实码。⇒ `IamWebClient.java:206` 的 `List.of()` **仅**在"下游 2xx + code=0 + data.permissions 为 null"时触发，语义是"查到了但没权限"**不是**源不可达（F15 下游故障均抛 `INTERNAL_ERROR`，仅 menuIds 为空返 `List.of()`）。§4.1 黄金向量表补 2 行错误路径、§5 新增 **TC-39**（500/超时→40303）/ **TC-40**（用户不存在 40400→40301），矩阵 38 → **40** 条。

13. **【R2 裁定·F17 风险处置】独立键 TTL 300s → 60s + 撤销联动 backlog（#13）**：`mis:acl:skillperm:{userId}` TTL 由 300s 下调至 **60s**（§3.1 缓存键纪律）。理由：`mis-iam` `RbacCacheSupport.onUserPermissionsChanged`(:47-54) 只 `redisTemplate.delete(RBAC_PERMISSIONS...)`，**不感知本键**（F17）——按 300s 撤销后最长 5 分钟仍放行；E6 走对话触发 QPS 低、回源压力可接受，用 60s 换更小越权窗口。F18 佐证：既有键 TTL 取 `iamProperties.getPermissionsTtlMinutes()`（~15min）靠 F17 主动 DEL 兜底；复用该键需 (tenantId,appId,userId) 三元组、反向信任支拿不到 appId ⇒ **独立键决策仍成立**，但要付 F17 的代价。**遗留 backlog Q10**（权限撤销即时联动，P1，优先级高于 Q9）：候选 ① 读缓存时比对 `CacheConstants.java:69 RBAC_PERM_VERSION` 版本号、不一致强制回源（不改 mis-iam，主理人倾向此案）；② 在 `onUserPermissionsChanged` 追加 DEL 本键。**由本 spec 裁定采用 ①**：不改动 mis-iam、仅在 BFF 侧比对版本号即可在角色撤销后即时失效，代价最小、回归面最小；② 需跨服务改 mis-iam，不在 T03 边界。

14. **【v1.5 裁定·#14 E6 反向信任降级支横向越权防护】**：`ReverseTrustContext` 有**两支**——JWT 签名支（`fromUpstreamJwt()==true`，`:179`，`userId`=MIS JWT `sub`=MIS userId，F19）与**降级支**（`fromUpstreamJwt()==false`，`:197`，把 HTTP `X-User-Id` 当 userId，而 `X-User-Id`=`reverse_trust.py:77-81/119-120` 写入的 **employeeId**，F20/F21/F23）。若 E6 用降级支 `userId` 调 `iamWebClient.loadPermissions` ⇒ 命中**他人**权限集（横向越权）。裁定：`SkillPermissionChecker.assertCanRunReverse` **必验 `fromUpstreamJwt()==true`**，否则直接 `BusinessException(40301)` 拒绝且**零次** `loadPermissions` 调用（不取码、不回源、不写缓存）。§1 E6 段补「userId 可信前提」、§3.1 反向信任支加硬约束与伪码、§5 新增 **TC-41**（降级支拒 + 零 `loadPermissions`）/ **TC-42**（JWT 支放行）。**本裁定不动 `ReverseTrustInterceptor`**（延续 #3 不碰原则，F4 作用域仅 E6）。

15. **【v1.5 裁定·#15 Python E1–E5 身份链（用户决策：Python 侧手工绑定）】**：Python 侧 E1–E5 当前拿不到 MIS userId——RS256 顶层 `user_id`=employeeId（F20/F24）、HS256 `TokenPayload` 无 `mis_user_id`/`mis`（F25/F28）、`skill.py`/`mcp.py` 路由层**零身份对象**（F27）、`users` 表无 MIS 列且 `wecom_sync` 零引用（F26/F29/F32–F34）、MIS Java 侧零 `wecom_user_id`（F31）。裁定拆三档：
    - **#15-a（T03 内）**：新增 `resolve_mis_user_id`（§2.8 / §3.4）三档解析——① RS256 → `profile["mis_user_id"]`（**绝不用顶层 `user_id`**）；② HS256 → 按 token `user_id`（企微 userid）查 `users.mis_user_id`；③ 其它 / 反向信任头（`X-User-Id`=employeeId）→ `None`。返回 `None` ⇒ `SkillAclDenied(AI_SKILL_FORBIDDEN)` / 403。必须在 **JWT 解析层**注入 `UserContext.mis_user_id`，**路由层不可解析**（F27）。§5 新增 **TC-43**（RS256 档1 正确取 MIS userId）/ **TC-44**（HS256 未绑定拒）/ **TC-45**（HS256 绑定放行）。
    - **#15-b（T03 内）**：新增 Alembic `002_add_users_mis_user_id.py`，`users` 加 `mis_user_id BIGINT NULL` + 唯一索引（`NULL` 允许多行），**无回填**（F26/F33/F34 无回填风险）。实施 §6 **S8**，与 Python 链并行。
    - **#15-c（T06，不阻塞 T03）**：企微↔MIS 绑定运维（绑定/解绑 UI + `user_lookup` 落 `users.mis_user_id` + 激活 `wecom_sync`）。T03 的 HS256 未绑定分支按「缺码即 403」fail-closed，不依赖 #15-c。新增 backlog **Q12**（F27 工作量重估，P1）。

16. **【v1.6 裁定·#16【严重·判权精度全线塌陷】MCP 工具名 sanitize 漂移】**：`tool_registry_builder.py:100-112` `_sanitize_tool_segment(value)` = `re.sub(r"[^A-Za-z0-9_-]", "_", value)`，首字符非字母再补 `mcp_` 前缀 ⇒ `.`、`:` 等一律变 `_`；`L184-186` 工具名由净化后片段拼成 `self.name = f"mcp__{_sanitize_tool_segment(server)}__{_sanitize_tool_segment(tool)}"`（F37【决定性】）；而 `skills/registry.py:196` skill_id 用**原始未净化**名 `f"mcp-{server}-{tool}"`（F38【决定性】）；`PlatformMcpToolAdapter.__init__` **L182 `self._tool_info = tool_info`** 完整保留原始 `McpToolInfo`（含未净化 `server_name`/`name`，F39）。server `member.profile`（§4.1 黄金向量样例，非假想）：展示名 `mcp__member_profile__query` vs 判别名 `mcp-member.profile-query`。若 E2 第①档从 `self.name` 反解再拼 `mcp-{server}-{tool}` 查 registry：轻则查不到→退第②档 `agent:mcp:call`（持该码者可调**任意** MCP 工具，per-skill 精细判权**永久失效**）；重则 `member.profile` 与 `member_profile` 并存（净化后同名）→ 跨 server 误匹配→拿错权限码→越权放行（比 #14 更隐蔽，发生在权限码解析**之前**）。与 #1（禁 `_normalize`、点号原样保留）**同源但方向相反**：#1 保住 permission_code 一侧，没料到上游工具名一侧早已被 sanitize ⇒ #1 的防漂移在 E2 路径上**单边生效**。裁定：E2 判定 skill_id **一律**取 `self._tool_info.server_name` / `self._tool_info.name`（F39）拼 `f"mcp-{server_name}-{tool_name}"`；**严禁**从 `self.name`（`mcp__a__b`）反解 / `replace` / `normalize` / `split("__")`；**不新增** `_raw_server_name` / `_raw_tool_name` 冗余属性（我前一封提过，此处**撤回**——`_tool_info` 已是单一事实源，再存一份违反单一事实源原则）；被包装对象取不到 `_tool_info`（非 MCP 工具/结构变更）→ **fail-closed 拒绝**，不退回反解。**否决备选（把 registry skill_id 也 sanitize）**：违反 #1 裁定，且改动 skill 注册键、牵连 V19/V20 权限码数据，回归面远大于本方案。本方案零新增字段、不动 sanitize 逻辑、不动 registry、零数据迁移。落地：§1 E2 行「判权对象」列 + §2.3 `_resolve_skill_ids` + §3.2 施工禁令补「展示名≠判别名」；§4.1 黄金向量表新增 `member.profile` 两形态行；§5 新增 **TC-46**（点号 server 正确命中）/ **TC-47**（净化后同名不误匹配，写成断言）。

**#16-c（v1.7 追加·server_name 准入校验，进 T03 不留 backlog）**：#16-b（E2 取 `_tool_info` 原始名、禁反解）**保留且仍正确，但不充分**——它只在消费端防漂移，源头仍可注入非法名（F45：`server_name` 管理员可自由填写、零校验）。补 #16-c：① `api/routes/mcp.py:103 register_server` 对 `req.name` 增加准入校验 `^[A-Za-z][A-Za-z0-9_-]{0,63}$`（与 `_sanitize_tool_segment` 允许集完全对齐，首字符限字母同时消灭 `mcp_` 前缀分支），不合规 → `400` 拒绝注册且不写入 `MCPManager`，错误信息明确指出允许字符集；② yaml loader（`loader.py:89,100` 附近）加载期做**同一条**校验，不合规 → 启动失败并打印违规 server 名（fail-fast，不得静默 sanitize 后继续启动）；③ §2 新增「MCP server 命名准入」小节，写明该正则是**唯一命名权威**，`_sanitize_tool_segment` 退化为纯防御性兜底（正常路径下应永不改写任何字符）。§1 E2 段补 F46 路径分离现状说明。**配套用例 TC-48/TC-49/TC-50**（#16-c）。（否定「只治消费端、不治源头」方案，明确本条进 T03 实施范围，不转 backlog。）

17. **【v1.6 裁定·#17【施工阻断·照抄必编译失败】`applySkillFill` 签名缺形参】**：`AiProxyController.java` 两 E6 端点身份链不对称（F40）：`skillExecute` L264-266 有 `HttpServletRequest httpRequest` 形参、L267 `resolveIdentity(httpRequest)` 完整；`applySkillFill` **L291 仅 `@RequestBody SkillApplyRequest request`、无 `HttpServletRequest`**，方法体 L291–L302 全量已读（docType 空值校验 → L295 `docWriteRegistry.apply(...)` → 组装响应 → `Result.ok`），**无任何身份/权限动作**；`L321 private ResolvedIdentity resolveIdentity(HttpServletRequest request)` 取身份必须有实参；`L29 import jakarta.servlet.http.HttpServletRequest;` 已存在。**spec §1 E6-d 原让在 L295 前插 `assertCanRun(httpRequest, ...)`，但 `httpRequest` 在该方法作用域内不存在 ⇒ `cannot find symbol` 编译失败**（原 spec 提了"需补 resolveIdentity"、漏了前置签名变更）。裁定 E6-d 三步显式落点，**缺一不可**：① **改签名（L291）** `applySkillFill(@RequestBody SkillApplyRequest request)` → `applySkillFill(@RequestBody SkillApplyRequest request, HttpServletRequest httpRequest)`（Spring MVC 自动注入，**不影响**既有调用方与 OpenAPI 契约，标为**施工第一动作**）；② **补身份解析**：方法体首行插 `ResolvedIdentity identity = resolveIdentity(httpRequest);`（与 L267 写法完全对齐）；③ **插闸门**：L295 `docWriteRegistry.apply(...)` **之前**调 `skillPermissionChecker.assertCanRun(httpRequest, request.getSkillId());`。§3.2 施工禁令补「凡落点出现 `httpRequest` 的 Java 方法，施工前必须确认签名已含 `HttpServletRequest` 形参；没有就先补，禁止另起 `RequestContextHolder` 旁路取法」（保持与 L267 单一范式）。

18. **【v1.6 裁定·#18【配套 #14】`resolveIdentity` 揉平信任支，`SkillPermissionChecker` 不得复用】**：`AiProxyController.java:321-328` `resolveIdentity` 返回 `new ResolvedIdentity(ctx.userId(), ctx.tenantId())`，`L331 private record ResolvedIdentity(Long userId, Long tenantId) {}` **不携带 `fromUpstreamJwt`**，两条信任支被揉平、来源信息丢失（F41）。裁定：`SkillPermissionChecker.assertCanRun` **不得复用 `resolveIdentity` 返回值**判权——必须自读 `request.getAttribute(ReverseTrustInterceptor.ATTRIBUTE_NAME)`，`instanceof ReverseTrustContext ctx` 后**先判 `ctx.fromUpstreamJwt()`**：false → 直接 `SKILL_FORBIDDEN=40301`、不回源（#14）；true → 取 `ctx.userId()` 继续；非反向信任支 → 回落 `RequestContext.requireLoginUser().getUserId()`。**不修改 `resolveIdentity` 本身**（服务于既有执行链，改签名波及已上线 FormFill 反向链路）。§3.1 伪码按此写（#14 已含 `fromUpstreamJwt` 硬约束，#18 补「不复用 `resolveIdentity`」禁令）。

### 7.1 遗留 Backlog 优先级表（R1 / R2 / v1.5 / v1.6 后）

| Backlog | 事项 | 来源裁定 | 优先级 | 收敛条件 |
|---|---|---|---|---|
| **Q7** | E2 中档 `agent:mcp:call` 收敛为目标 server 级执行码 `ai:mcp:{server}:call`（消除"中档兜底"语义含糊） | #5 | **P1** | 待 V20 落 `ai:mcp:{server}:call` 后切换；当前先复用 `agent:mcp:call` |
| **Q7b** | E5 独立委派码 `ai:agent:{id}:invoke` | #6 | **P2** | 后续若需细粒度委派治理再评估；本阶段靠白名单 |
| **Q8** | `ApiPermissionInterceptor` 未登记端点静默放行缺口（deny-unmapped 未开） | TC-31/32 已证由代码层兜住 | **P3** | 仅记录不修；若 T04 全量切 PEP 再议 |
| **Q9** | app-scoped Skill 判权（跨 App 隔离） | #11（C1 结案） | **P2** | 需改 `mis-iam` `loadAndCache` 签名 + `SysRolePermissionRepository` JPQL 加 appId + 连带修 F14 键语义，跨服务变更，超 T03 边界 |
| **Q10** | 权限撤销即时联动（消除独立键撤销窗口） | #13（F17 风险） | **P1**（高于 Q9） | 采用候选①：读缓存时比对 `CacheConstants.java:69 RBAC_PERM_VERSION` 版本号、不一致强制回源（不改 mis-iam，回归面最小）；候选② 跨服务改 `onUserPermissionsChanged` 不在 T03 边界 |
| **Q11** | E6 反向信任降级支横向越权修复（锁定 `fromUpstreamJwt()==true`） | #14（F19–F23） | **P1** | 已纳入 T03：§3.1 硬约束 + TC-41/42；不动 `ReverseTrustInterceptor`（延续 #3 不碰） |
| **Q12** | F27 工作量重估：`skill.py`/`mcp.py` 路由层零身份对象，须在 JWT 解析层注入 `UserContext.mis_user_id` + 缺失即拒（不回退 employeeId） | #15（F27） | **P1** | 已纳入 T03：§2.8 / §3.4 / §6 S8 + TC-43/44/45；S2/S3/S4 验收信号追加「注入成功 / 缺失即拒 / HS256 未绑定 403」 |
| **Q13** | 管理类 REST 旁路观察：`api/routes/skill.py`（8 端点）/ `mcp.py`（9 端点）零 `Depends`/`Header`（F27），但这些是**管理类 REST**、经 BFF PEP + 58 条 `sys_api` 收口，**不属 E1–E6 攻击面**（F27 归类修正：E1–E5 走 Agent 工具注册表层、`tool_metadata["identity"]`，不经这两个路由文件） | F27 归类修正 | **P2** | 仅记录观察，不在 T03 修；若后续这些端点被直连暴露（绕过 BFF）再升级 |

> 当前 T03 验收**不阻塞**上述 backlog：Q7/Q7b 为"后续增强"，Q8 已被 `SkillPermissionChecker` 代码层兜死，Q9 跨服务超边界，Q10 采用版本号比对方案不阻塞本期（60s TTL 已封顶越权窗口）；**Q11（#14 降级支越权）/ Q12（#15 F27 工作量）已在本 v1.5 纳入 T03 实施范围**（§3.1 硬约束 + §6 S8 + TC-41~45）；**#16/#17/#18 已在本 v1.6 纳入 T03 实施范围**（§1 E2/E3/E6 行号与落点修订 + §2.3 `_resolve_skill_ids` 判权名来源 + §3.1 #18 不复用 `resolveIdentity` + §3.2 两条施工禁令 + §4.1 `member.profile` 两形态行 + §5 TC-46/TC-47）；**Q13（F27 归类修正·管理类 REST 观察）已补入 backlog（P2，仅记录，不在 T03 修）**；**#16-c（server_name 准入校验）已在本 v1.7 纳入 T03 实施范围**（§2.9 / §1 E2 F46 / §5 TC-48/TC-49/TC-50），不留 backlog**。不阻塞本期验收。

---

## 附录 A：R1 / R2 / v1.5 / v1.6 / v1.7 / v1.8 / v1.9 裁定书事实溯源（F1–F60）

> 主理人实读源码后给出的硬事实：F1–F8 来自 R1 裁定书，F9–F12 来自 R1 修正案，F13–F18 来自 R2 裁定书 / C1·C5 结案，F19–F34 来自 v1.5 增量单 / #14·#15 裁定，F37–F41 来自 v1.6 编号收口 / #16·#17·#18 裁定，F35/F36（补编号缺口）+ F42–F47（E1–E5 身份链 / sanitize 漂移影响面）来自 v1.7 增量单，F48–F53（#17 三步→两步修正 + #19 伪代码类型对齐）来自 v1.8 修订单，**F54–F60（S9 设计：`misUserId` 第五键 + 5 跳透传 + `user_mobile` 匹配桥 + 两渠道身份差异 + `create_session` gap + 7+ 会话创建点 + 服务端填充约束）来自 v1.9 S9 设计阶段**。v1.9 后编号 **F1–F60 连续无缺口**，落盘 **60 条**。本 spec 所有相关裁定均以其为准。

| 事实 | 内容 | 源码出处 | 影响章节 |
|---|---|---|---|
| F1 | `BusinessException.code` 为 `int`；3-参构造 `BusinessException(int, String, Object)` 位于 `:13` / `:53` | `BusinessException.java` | §0 / §2 / §3.1（数字码强制） |
| F2 | `GlobalExceptionHandler.handleBusinessException` `:34-38` 返 `ResponseEntity.ok(Result.fail(ex.getCode(), ex.getMessage()))` + `body.setData(ex.getData())` ⇒ Java `BusinessException` **一律 HTTP 200**，拒绝靠 `body.code` | `GlobalExceptionHandler.java` | §0 / §5（断言口径 #10） |
| F3 | `ResultCode.FORBIDDEN=40300`；403xx 段除 40300 外空闲；`SKILL_CODE_UNAVAILABLE=40917` 已占 | `ResultCode.java` | §0（码段分配） |
| F4 | `ReverseTrustConfiguration:29-32` 拦截器**仅匹配** `/api/v1/ai/skill/execute` 与 `/apply`（污染 = E6 仅两路径） | `ReverseTrustConfiguration.java` | §3.1（不动 `ai:*:use`） |
| F5 | `ReverseTrustInterceptor` 双模；`:54 ATTRIBUTE_NAME`、`:125 setAttribute(ATTRIBUTE_NAME, ctx)`、`:132 setAttribute(ATTR_TRUST_APPLIED, TRUE)`；`AiProxyController:323` 已有 `attr instanceof ReverseTrustContext` 先例 | `ReverseTrustInterceptor.java` / `AiProxyController.java` | §3.1（来路分支） |
| F6 | `IamWebClient.loadPermissions(Long userId)` `:201` **无 appId 参**；`:206` body 为 null 静默返 `List.of()` | `IamWebClient.java` | §3.1（独立键 / 跨 App 限制）/ §6 S5 / §7 #4 |
| F7 | `ApiPermissionInterceptor` 为共享公共基类，T03 **不得修改** | `ApiPermissionInterceptor.java` | §6 S5 / §7 #9 |
| F8 | `ApiPermissionConfiguration:44 addPathPatterns("/api/v1/**")`；BFF 零 `/internal` 路径 | `ApiPermissionConfiguration.java` | §6 S5 / §7 #9 |
| F9 | `LoginUserHeaderResolver.java:18-36` 网关头解析**只**调 `setUserId/setTenantId/setAppId/setEmployeeId/setUsername`，**从不调 `setPermissions`** ⇒ 直连链路 `LoginUser.permissions` 初始为 **null**；`:27` `setAppId` 确有调用，直连 `appId` 有值（头缺失为 null，C3 解答）。 | `LoginUserHeaderResolver.java` | §3.1（直连支取码统一回源 / 不读 `getPermissions`）/ §7 #3 |
| F10 | `ApiPermissionInterceptor.java:76-80` PEP **命中规则时** `userPerms = permissionLoader.apply(user); if (null) → Set.of(); user.setPermissions(userPerms)` 回填 `LoginUser`——这是 `/api/v1/agent-ops/**` 那 58 条端点上 `LoginUser.permissions` 有值的**唯一**来源。 | `ApiPermissionInterceptor.java` | §3.1 / §7 #3（对照 F11） |
| F11【决定性】 | `ApiPermissionInterceptor.java:52-58` `match = registry.match(...)`；`match.isEmpty()` 且 `denyUnmapped=false` ⇒ **`:57` 直接 `return true`**，走不到 `:76-80` 回填。E6 的 #59/#60 **未登记 sys_api** ⇒ 恒 `match.isEmpty()` ⇒ **PEP 永远不为 E6 回填权限码**；叠加 F9（网关不注入）⇒ **E6 直连支 `LoginUser.getPermissions()` 恒为 null**。 | `ApiPermissionInterceptor.java` | §3.1 / §7 #3（推翻原 #3 直连支取码方式） |
| F12 | `ApiPermissionInterceptor.java:40-43` `DispatcherType.ASYNC` / `ERROR` 直接 `return true` 跳过鉴权，注释"SSE/Flux 异步写出时会二次进入拦截器，此时 `LoginUser` 已空"。 | `ApiPermissionInterceptor.java` | §3.2（施工禁令：必须在 Controller 方法体内调用，禁做拦截器/AOP） |
| F13【C1 结案·决定性】 | `/internal/v1/permissions/{userId}` 返回**跨 App 并集**，非 app-scoped：`PermissionService.java:38-46` `loadAndCache(Long userId)` 签名无 appId；`SysRolePermissionRepository.java:15-20` JPQL `SELECT DISTINCT rp.targetId ... WHERE ur.userId=?1 AND rp.permType=?2` 无 appId 条件；`SystemMenuClient.java:37-45` 按 menuId 批量换码亦无 appId 条件。 | `mis-iam` `PermissionService.java` / `SysRolePermissionRepository.java` / `SystemMenuClient.java` | §1 E6 段 / §6 S5（解除阻塞）/ §7 #11 / §7.1 Q9 |
| F14 | 键 app-scoped、值跨 App，既有语义错配：`PermissionService.java:43` 写缓存用 `(user.getTenantId(), user.getAppId(), user.getId())`，appId 取自 **SysUser 实体自带字段**（用户单 App 归属）非请求上下文；键 `CacheConstants.java:56 RBAC_PERMISSIONS="mis:rbac:permissions:%d:%d:%d"`。**不在 T03 修复范围**，但不可依赖它做 app 隔离。 | `PermissionService.java` / `CacheConstants.java` | §3.1（缓存键纪律）/ §7 #11 / §7.1 Q9 |
| F15 | `SystemMenuClient.java:52`/`:59` 下游故障均抛 `BusinessException(INTERNAL_ERROR)`，仅 `:38-40` menuIds 为空时返 `List.of()`。 | `SystemMenuClient.java` | §7 #12（F16 佐证：源不可用必抛，非静默） |
| F16【C5 结案】 | BFF `block()` 任何失败都抛，绝不静默：`AbstractDownstreamClient.java:73-85` `BusinessException` 原样透传 → `WebClientResponseException` 转 `INTERNAL_ERROR "下游调用失败: HTTP {n}"` → 其余 `Exception`（超时/连接拒绝）转 `INTERNAL_ERROR`；`RequestContext.java:64-72` `result==null`→`INTERNAL_ERROR "下游无响应"`、`!isSuccess()`→透传真实码。⇒ `IamWebClient.java:206` 的 `List.of()` **仅**在"下游 2xx + code=0 + data/permissions 为 null"时触发，语义是"查到了但没权限"**不是**源不可达。 | `AbstractDownstreamClient.java` / `RequestContext.java` / `IamWebClient.java` | §3.1（统一取码伪码）/ §0 错误码表「触发条件」/ §4.1 / §5 TC-39/40 / §7 #12 |
| F17【新风险】 | 权限撤销与独立键不联动：`RbacCacheSupport.java:47-54` `onUserPermissionsChanged` 只 `redisTemplate.delete(RBAC_PERMISSIONS...)`，**不感知 `mis:acl:skillperm:{userId}`** ⇒ 按 v1.2/v1.3 的 TTL 300s，撤销后最长 5 分钟仍放行。 | `RbacCacheSupport.java` | §3.1（缓存键纪律 TTL→60s）/ §7 #13 / §7.1 Q10 |
| F18 | `RbacCacheSupport.java:56-68` 既有键 TTL 取 `iamProperties.getPermissionsTtlMinutes()`（~15min），靠 F17 的主动 DEL 兜底才安全；复用该键需 (tenantId, appId, userId) 三元组，反向信任支拿不到 appId ⇒ **独立键决策仍成立**，但要付 F17 的代价。 | `RbacCacheSupport.java` / `iamProperties` | §3.1（缓存键纪律）/ §7 #13 |
| F19 | MIS JWT `sub`=userId，且 `userId≠employeeId`：`RsaJwtIssuer.java:46` 写 `sub=userId`；`JwtClaims.java:6-11` 字段定义中 `userId` 与 `employeeId` 为不同字段 | `RsaJwtIssuer.java` / `JwtClaims.java` | §1 E6 userId 可信前提 / §3.1 #14 / §7 #14 |
| F20 | Python `identity/models.py:273-296`：`build_user_context` L274 置 `user_id`=employeeId；L291 才把真实 MIS userId 放 `profile["mis_user_id"]`（顶层 `user_id`≠MIS userId） | `identity/models.py` | §1.3 / §2.8 档1 / §3.4 / §7 #15 |
| F21 | `reverse_trust.py:77-81` / `:119-120` 把 **employeeId** 写入 HTTP `X-User-Id`（降级支据此当 userId） | `reverse_trust.py` | §1 E6 段 / §3.1 #14 / §7 #14 |
| F22 | `ReverseTrustInterceptor.java:183-198` 降级支（`match` 未命中 / 无 JWT）直接用 `X-User-Id` 当 userId 注入 `ReverseTrustContext` | `ReverseTrustInterceptor.java` | §3.1 #14 / §7 #14 |
| F23 | `ReverseTrustContext.java:16-22` 含 `fromUpstreamJwt` 位标：JWT 签名支 `:179` 置 `true`、降级支 `:197` 置 `false` | `ReverseTrustContext.java` | §1 E6 段 / §3.1 #14 / §7 #14 |
| F24 | `api/deps.py:112` RS256 分支返回顶层 `user_id`=employeeId；真实 MIS userId 仅在 `profile.mis_user_id` | `api/deps.py` | §1.3 / §2.8 档1 / §7 #15 |
| F25 | `api/deps.py:129` HS256 `TokenPayload` **无** `tenant`/`app`/`mis_user_id`/`mis` 标志（企微 JWT 缺 MIS 关联字段） | `api/deps.py` | §1.3 / §2.8 档2 / §7 #15 |
| F26 | `mis_user_id` 全仓**写 1 处**（`models.py:291`）、**读 0 处** ⇒ 绑定状态无从落地，须 #15-b 加列 | `models.py` | §1.3 / §2.8 / §6 S8 / §7 #15-b |
| F27 | `api/routes/skill.py`（8 端点）、`api/routes/mcp.py`（9 端点，含 `mcp.py:174 call_tool`）**零 `Depends(` / `Header(`**——请求作用域无身份对象；`get_current_user` 仅用于 `agent.py`/`files.py`/`mis_capability.py`/`push.py`（前缀 `/api/v1/skills`、`/api/v1/mcp`） | `api/routes/skill.py` / `api/routes/mcp.py` / `api/deps.py` | §1.3 / §2.8 F27 警告 / §3.4 / §6 S8 Q12 / §7 #15 |
| F28 | `auth.py:187-194` HS256 回退 `user_id`=**企微 userid 字符串**（无 MIS 关联） | `auth.py` | §1.3 / §2.8 档2 / §7 #15 |
| F29 | `UserModel`（表 `users`）有 `wecom_user_id` 但**无 MIS 列**（`mis_user_id` 等）⇒ 缺承载列，须 #15-b | `models.py` | §1.3 / §2.8 / §6 S8 / §7 #15-b |
| F30 | `routes/auth.py:101` `verify_wecom_user` **无 `user_lookup`** ⇒ 生产企微 OAuth 命中 F28 回退（userId 无法落 MIS 关联） | `routes/auth.py` | §1.3 / §7 #15-c |
| F31 | MIS Java 侧**零 `wecom_user_id`**（Java `User`/`LoginUser` 无此字段）⇒ 反向上 Java 不依赖企微绑定，#15 仅 Python 侧 | MIS Java 用户模型 | §3.4 / §7 #15 |
| F32 | 仅 1 个 Alembic 迁移 `001_add_agent_memory.py`；其余表靠 `session.py:91 Base.metadata.create_all` 自动建 ⇒ 加列须走 Alembic（`002`）而非 create_all | `alembic` / `session.py` | §6 S8 / §7 #15-b |
| F33 | `wecom_sync.py` **零引用**（无调用点）⇒ `users` 表实际未被读写，绑定状态无落地路径 | `wecom_sync.py` | §1.3 / §6 S8 / §7 #15-c |
| F34 | 综合 F26/F29/F32/F33：`users.mis_user_id` 现状「写 1 读 0、无列、无同步」⇒ #15-b 加列 + 唯一索引（无回填）、#15-c（T06）激活绑定与 `wecom_sync` 才有数据 | 综合 | §6 S8 / §7 #15 |
| F35 | `runtime/mcp_identity.py:35-48` `build_mcp_identity(*, user_id="", user_mobile="", channel="", channel_user_id="") -> dict[str,str]`，返回**固定四键** `{"userId","userMobile","channel","channelUserId"}`（docstring 明写"四个字段始终存在，空字符串也不省略"）—— **无 `misUserId` 承载位**；`:107-128` `identity_from_tool_metadata` 按同一组键解析 `context.metadata["identity"]` | `runtime/mcp_identity.py` | §1.3 / §2.3 / §3.4 / §7 #16-c |
| F36 | `runtime/oh_runtime_builder.py:218-223` 是工具层身份的**唯一注入点**：`build_mcp_identity(user_id=..., user_mobile=..., channel=..., channel_user_id=...)` → `:233-237` `QueryEngine(tool_metadata={"extra_skill_dirs":..., "session_id":..., "identity": mcp_identity})`；`tool_registry_builder.py:207` `identity: dict[str,str] = identity_from_tool_metadata(context.metadata)` 为唯一消费点 | `runtime/oh_runtime_builder.py` / `tool_registry_builder.py` | §1.3 / §2.3 / §3.4 / §7 #16-c |
| F37【决定性】 | `tool_registry_builder.py:100-112` `_sanitize_tool_segment(value)` = `re.sub(r"[^A-Za-z0-9_-]", "_", value)`，首字符非字母再补 `mcp_` 前缀 ⇒ **`.`、`;` 等一律变 `_`**；`L184-186` 工具名由**净化后**片段拼成：`self.name = f"mcp__{_sanitize_tool_segment(tool_info.server_name)}__{_sanitize_tool_segment(tool_info.name)}"` | `tool_registry_builder.py` | §1 E2 行 / §2.3 `_resolve_skill_ids` / §4.1 / §7 #16 |
| F38【决定性】 | `skills/registry.py:196` skill_id 用**原始未净化**名：`skill_id = f"mcp-{server_name}-{tool.get('name','unknown')}"`；`L205` `handler = f"mcp:{server_name}:{tool.get('name')}"` 同为原始名 ⇒ 工具名（净化）与 registry skill_id（原始）**两套命名并存** | `skills/registry.py` | §1 E2 行 / §2.3 / §4.1 / §7 #16 |
| F39 | `PlatformMcpToolAdapter.__init__` **L182 `self._tool_info = tool_info`** —— 原始 `McpToolInfo`（含未净化 `server_name` / `name`）**已完整保留为实例属性**，判权时可直接取用，无需从 `self.name` 反解 | `runtime/tool_registry_builder.py` | §1 E2 行 / §2.3 / §7 #16 |
| F40 | `AiProxyController.java` 两 E6 端点身份链**不对称**：`L264-266` `skillExecute(..., HttpServletRequest httpRequest)` 有实参、L267 `resolveIdentity(httpRequest)` 完整；`L291` `applySkillFill(@RequestBody SkillApplyRequest request)` **无 `HttpServletRequest`**，方法体 L291–L302 全量已读（docType 空值校验 → L295 `docWriteRegistry.apply(...)` → 组装响应 → `Result.ok`）无任何身份/权限动作；`L321 private ResolvedIdentity resolveIdentity(HttpServletRequest request)` 取身份必须有实参；`L29 import jakarta.servlet.http.HttpServletRequest;` 已存在 | `AiProxyController.java` | §1 E6-d / §3.2 / §7 #17 |
| F41 | `AiProxyController.java:321-328` `resolveIdentity` 揉平两条信任支：`return new ResolvedIdentity(ctx.userId(), ctx.tenantId());`，`L331 private record ResolvedIdentity(Long userId, Long tenantId) {}` **不携带 `fromUpstreamJwt`**，来源信息丢失 ⇒ 若 `SkillPermissionChecker` 复用其返回值判权会丢 #14 的 `fromUpstreamJwt` 区分 | `AiProxyController.java` | §3.1 #18 / §7 #18 |
| F42【决定性】 | 工具层身份是一条 **7 跳单字段链，全程只传 `user_id`，无任何 `mis_user_id` 承载位**：`inbound.user_id` → `queue/inbound_worker.py:429 ensure_session(user_id=...)` → `agent/session.py:104 self.user_id`（`to_dict:171` / `from_dict:340`）→ `agent/manager.py:86 runtime.run(user_id=session.user_id)` → `runtime/openharness.py:374 run(user_id)` → `:469` 透传 → `runtime/oh_runtime_builder.py:155` 形参 → `:219 build_mcp_identity(user_id=user_id)` → `mcp_identity.py:44 {"userId": ...}` → `tool_metadata["identity"]` → `tool_registry_builder.py:207 identity_from_tool_metadata`。⇒ 即使 `UserContext.mis_user_id` 注入成功，**也传不到工具层**；`AclToolWrapper` 在工具层拿到的是 dict，**不是 `UserContext`** | `queue/inbound_worker.py` / `agent/session.py` / `agent/manager.py` / `runtime/openharness.py` / `runtime/oh_runtime_builder.py` / `runtime/mcp_identity.py` / `tool_registry_builder.py` | §3.4（F42/F43 制约提示）/ §7 |
| F43【决定性】 | 企微入站链路 = Redis Stream → `queue/inbound_worker.py` 消费 → `ensure_session` → `manager.run`，**全程无 HTTP 请求作用域** ⇒ FastAPI 的 `Depends(get_current_user)` **永远不会执行**。⇒ 这同时解释 F33/F34（`users` 表事实上无人读写）：企微链路压根不查用户表 | `queue/inbound_worker.py` / `agent/manager.py` | §3.4（F42/F43 制约提示）/ §7 |
| F44 | 现网存量**全合法、零中招**：全仓仅 1 个 `mcp-servers.yaml`（`configs/agents/crm-assistant/system/mcp-servers.yaml:9` `name: mcp-api-suite`），唯一具名 tool `callApi`（`tests/test_invoke_agent.py:163`）。二者字符全在 `[A-Za-z0-9_-]` 内 ⇒ 含非法字符 0/2、零撞名、零前缀触发 | `configs/agents/crm-assistant/system/mcp-servers.yaml` / `tests/test_invoke_agent.py` | §4.1 / §7 #16 / #16-c |
| F45【决定性】 | `server_name` **管理员可自由填写、零校验** ⇒ **永久敞口**：`api/routes/mcp.py:71` `RegisterServerRequest.name: str`；`:103-113` `register_server` 直接 `MCPServerConfig(name=req.name)` 写入全局 `MCPManager` 单例；`mcp/manager.py:30` `name: str` 同样无正则/白名单。运行期任何能调 `POST /mcp` 的角色可随时录入 `member.profile` / `1srv` / `_srv` | `api/routes/mcp.py` / `mcp/manager.py` | §1 E2 F46 / §2.9 / §5 TC-48/49/50 / §7 #16-c |
| F46【关键·纠正 #16 前提】 | MCP 当前是**两条分离路径**：①（E2 闸门所在，sanitize 名）yaml `config.mcp_servers` → `agent_mcp_to_openharness_configs`(`oh_runtime_builder.py:141,167`) → 独立 `McpClientManager(mcp_configs)`(`:142`) → `PlatformMcpToolAdapter.name = mcp__{sanitize}__{sanitize}`(`tool_registry_builder.py:184-186`)；②（原生 skill_id）yaml → `load_mcp_servers_from_files`(`loader.py:89,100`) **+ admin API 注册** → 平台 `MCPManager` 单例(`bootstrap/skills_mcp.py:50-52`) → `registry.py:196 skill_id=mcp-{raw}-{raw}`。⇒ **admin API 注册的 server 只进路径②、不进路径①**，故当前**不**触发跨站漂移；**但 yaml server 同时进两条路径**，一旦 yaml 加入含 `.` 的 server 即刻断裂。两路径若未来统一到同一 manager，敞口全面引爆 | `oh_runtime_builder.py` / `tool_registry_builder.py` / `loader.py` / `bootstrap/skills_mcp.py` / `registry.py` | §1 E2 / §2.9 / §5 TC-48/49/50 / §7 #16-c |
| F47 | 命名源不统一已有代码实证：`tool_registry_builder.py:483` 调试日志用**原生** `info.server_name`/`info.name` 拼 `mcp__{raw}__{raw}`，与 `L186` 的 sanitized 工具名不一致。仅影响 debug 日志（glob `mcp__*` 仍匹配，不动闸门），但坐实同文件内命名源已打架 | `tool_registry_builder.py` | §2.9 / §7 #16 |
| F48 | **#17 修正**：`applySkillFill` 实为 **2 步**（非原 spec 三步）：① 方法签名增 `HttpServletRequest httpRequest` 参数；② 在 `docWriteRegistry.apply(...)` 之前插 `skillPermissionChecker.assertCanRun(httpRequest, skillId)`。**无 `resolveIdentity`**——`DocWriteRegistry.apply(skillId, docType, docId, values)` 不接收 `userId`/`tenantId`，`resolveIdentity` 产出的 `identity` 是死变量，工程师已删除。`skillExecute` 仍用 `resolveIdentity`（其 `skillExecutionEngine.execute(...)` 需 `userId`/`tenantId`），不受影响。 | `AiProxyController.java` L295-309 | §1 E6-d / §3.2 |
| F49 | `ctx.userId()` 返回 `Long`（`ReverseTrustContext` 是 record，`userId` 字段类型 `Long`），非 `String` | `SkillPermissionChecker.java` L78,92 / `ReverseTrustContext.java` | §3.1 |
| F50 | `iamWebClient.loadPermissions(userId)` 返回 `List<String>`（`IamWebClient.java:201`）；内部 `loadPermissions(Long userId)` 返回 `Set<String>`（`LinkedHashSet`，`SkillPermissionChecker.java:139,147` `new LinkedHashSet<>(list)`） | `SkillPermissionChecker.java` / `IamWebClient.java` | §3.1 |
| F51 | `StringRedisTemplate` 缓存用 `ObjectMapper` 做 JSON 序列化：`readCache` `objectMapper.readValue(json, STRING_LIST)`（L172）、`writeCache` `objectMapper.writeValueAsString(perms)`（L182），非裸字符串集合 | `SkillPermissionChecker.java` L166-186 | §3.1 |
| F52 | `SkillPermissionChecker` 类有 `ObjectMapper objectMapper` 字段（L57），经构造函数注入（L63,67） | `SkillPermissionChecker.java` L57,63,67 | §3.1 |
| F53 | 用 `SecurityContextHolder.getOptional()`（L76 `LoginUser loginUser = SecurityContextHolder.getOptional().orElse(null);`），非 `getLoginUser()` / `.getContext().getAuthentication()` | `SkillPermissionChecker.java` L76 | §3.1 |
| F54 | **`user_mobile` 匹配桥可用（备选非强制）**：企微 API `mobile` 经 `wecom_sync.py:160` `phone = user_data.get("mobile")` 存入 `UserModel.phone`；`user_mobile` 已在 session / identity 链中透传（`session.py:88 self.user_mobile` / `inbound_worker.py:431 user_mobile=...` / `mcp_identity.py:38 "userMobile"` 键）。当 `users.mis_user_id` 为空（未绑定）时，**可**用 `user_mobile` → `UserModel.phone` 反查 MIS userId 作备选匹配桥。S9 首选 `wecom_user_id` → `users.mis_user_id` 直查；`user_mobile` 桥留作 T06 绑定运维增强项，不在 T03 强制实现。 | `wecom_sync.py` L160 / `session.py` L88 / `inbound_worker.py` L431 / `mcp_identity.py` L38 | §3.4 决策 3 |
| F55【S9 关键洞察】 | **两渠道 `user_id` 语义不同**：① Web `user_id` 经 MIS gateway JWT 下发**就是 MIS userId**（F19 `sub`=userId）；② 企微 `user_id = f"wecom_{wecom_user_id}"`（`wecom_sync.py:177` 平台本地 ID，**非** MIS userId）。⇒ Web 场景 `misUserId` 可直取 `user_id`；企微场景必须查 `users.mis_user_id` 绑定列。此差异驱动决策 3 的两渠道分治逻辑。 | `wecom_sync.py` L177 / `RsaJwtIssuer.java`（F19 `sub`=userId） | §3.4 决策 3 / §1.3 |
| F56 | **`create_session()` gap**：`session.py:215` `create_session()` 签名仅 `(agent_id, user_id, channel, runtime_type)`，**不收** `user_mobile`/`channel_user_id`/`mis_user_id`；而 `ensure_session()`（L263）收 `user_mobile`/`channel_user_id`。⇒ Web 入口 `POST /sessions`（走 `create_session`）会丢失 `misUserId`，S9 须补 `mis_user_id: str = ""` 形参（及 `user_mobile`/`channel_user_id`，与 `ensure_session` 对齐）。 | `session.py` L215, L263 | §3.4 决策 3 / §6 |
| F57 | **7+ 会话创建点（实读 8 处）**，每处须确保 `mis_user_id` 被解析并写入 session：① `session.py:215 create_session()`（底层，须补形参 F56）；② `session.py:263 ensure_session()`（底层，须补形参）；③ `api/routes/session.py:95 POST /sessions`（**Web 入口**，调 `resolve_mis_user_id`）；④ `api/routes/mis_capability.py:313`；⑤ `api/routes/mis_capability.py:415`；⑥ `agent/mis_rag/qa_pipeline.py:631`；⑦ `skills/tools/invoke_agent.py:844`；⑧ `queue/inbound_worker.py:426 ensure_session()`（**企微入口**，查 `users.mis_user_id`）。 | `session.py` / `api/routes/session.py` / `api/routes/mis_capability.py` / `qa_pipeline.py` / `invoke_agent.py` / `inbound_worker.py` | §3.4 决策 3 / §6 |
| F58 | **`misUserId` 服务端填充、禁止客户端传入**：`POST /sessions` 的 `CreateSessionRequest` 不收 `user_mobile`（gap）；S9 规定 `misUserId` 只由服务端在 session 创建点解析，**客户端不可传 `mis_user_id`**（防伪造）。反向信任头支 `X-User-Id`=employeeId（F21）非 MIS userId → 取不到 `misUserId` → fail-closed。 | `api/routes/session.py`（`CreateSessionRequest`）/ `reverse_trust.py`（F21） | §3.4 决策 3 / 决策 4 |
| F59 | **`build_mcp_identity` 加第五键 `misUserId`、不动老 4 键**：`mcp_identity.py:35-48` 当前返回固定 4 键 `{userId, userMobile, channel, channelUserId}`（F35）；S9 追加 `misUserId` 第五键（`IDENTITY_ARG_KEYS` L19 加 `"misUserId"`、`build_mcp_identity` 增 `mis_user_id` 形参）。**不改 `userId`**（保持向后兼容：仍是平台 user_id / 企微本地 ID，供 HTTP Header 透传与日志用）；`IDENTITY_HEADER_MAP`（L27-32）**不增 `misUserId`**（仅内部判权用，不下发 HTTP Header——避免 `X-Mis-User-Id` 泄漏）。`identity_from_tool_metadata`（L107-128）同步追加读取 `"misUserId"`。 | `mcp_identity.py` L19, L27-32, L35-48, L107-128 | §3.4 决策 1 / §2.3 |
| F60 | **5 跳透传链（一处漏则断）**：`mis_user_id` 从 session 到 `build_mcp_identity` 经 5 跳透传：① Session（`session.py:81 __init__` 增 `mis_user_id` 字段 + `to_dict`/`get_session` 序列化）→ ② Manager（`manager.py:82-90 runtime.run()` 透传 `mis_user_id=session.mis_user_id`）→ ③ OpenHarness（`openharness.py:374 run()` 增形参 → `:469 build_native_query_engine()` 透传）→ ④ Builder（`oh_runtime_builder.py:155 build_native_query_engine()` 增形参 → `:219 build_mcp_identity()` 透传）→ ⑤ Identity（`mcp_identity.py:35-48 build_mcp_identity()` 增 `mis_user_id` 形参 → 返回 `misUserId` 第五键，F59）。消费侧 `tool_registry_builder.py:207 identity_from_tool_metadata` 自动读到 `misUserId`。任一跳缺失则链断裂、工具层拿不到 `misUserId`。 | `session.py` / `manager.py` / `openharness.py` / `oh_runtime_builder.py` / `mcp_identity.py` / `tool_registry_builder.py` | §3.4 决策 2 / §2.3 |

> 附 **C2 / C4 实锤**（`ApiPermissionInterceptor.java`，主理人自查）：**C2** `:82-86` 权限比对是 `userPerms.contains(required)` 纯字面量 `Set.contains` 循环、**无通配符** ⇒ `ai:*:use` 匹配不上任何真实码、是死码（风险由"误放"下调为"最多误拒"；叠加 F11 连误拒都不发生）；**C4** `:55/:63/:87` 三处拒绝全为 `throw new BusinessException(ResultCode.FORBIDDEN)` ⇒ HTTP 200 + body.code=40300，与本 E6 的 40301/40303 **同构**。

## 附录 B：版本变更记录

- **v1.0 / v1.1**（初版，377 行）：六路径落地表 + Python/Java 契约 + 权限码规则 + fail-closed 矩阵 36 条 + 实施顺序 + 风险 8 条。
- **v1.2（R1 裁定）**：§0 增错误码表（数字码 40301/40303 + F1/F2/F3 事实）；§1 E2 三档、E5 #6 注、E6 改 HTTP 200+body.code；§2.2 禁 `_normalize` + 黄金向量；§2.3 E2 三档；§3.1 重写（`IamWebClient` + 来路分支 + F5 行引 + "为何不碰 `ai:*:use`"）；§4 + §4.1 黄金向量表；§5 全量改写断言口径 + TC-04b/TC-37、TC-34 标 E1–E5；§6 S5 改独立 `InternalPermissionController`；§7 全 10 条裁定落地；新增 §7.1 backlog 表 + 附录 A/B。
- **v1.3（R1 修正案）**：仅改 **§3.1**（M1 直连支取码统一回源 `iamWebClient.loadPermissions`、删"读 `LoginUser.getPermissions()` 为空才回源"死代码，补 F9/F11 行号与双重理由；补 C2 死码论证）、**§3.2**（M2 加施工禁令：`SkillPermissionChecker` 必须在 Controller 方法体内调用、禁做拦截器/AOP，F12 理由）、**§5 表头**（补 C4 口径一致性：E6 40301/40303 与 PEP 40300 同为 HTTP 200 + body.code）、**§7 #3/#4**（M3 原 #3"直连支读登录态码"裁定更正为"分支仅定 `userId` 来源、取码统一回源"，依据 F9/F11；#4 加一致性注记）、**附录 A**（追加 F9–F12 四条事实 + C2/C4 实锤）、**附录 B**（本记录）。**其余章节未动**：§1 落点表、§4 黄金向量表、§5 的 38 条用例本体均保持 v1.2 正确状态，不返工。
- **v1.4（R2 裁定书 / C1·C5 结案）**：仅改 **§0**（错误码表加「触发条件」列，#12 三档明确化）、**§1 E6 段**（补跨 App 并集、不 app-scoped 语义，F13）、**§3.1**（取码段重写为明确伪码，F16 绝不静默三档；独立键 `mis:acl:skillperm:{userId}` TTL 300s→60s，F17/F18；缓存键纪律补 F14 引用）、**§4.1**（黄金向量表补 2 行错误路径，对应 TC-39/40）、**§5**（新增 TC-39/TC-40，用例 38→**40**）、**§6 S5**（去掉 appId 参数、标"解除阻塞·已裁定"，C1 结案）、**§7**（裁定记录 +#11/#12/#13）、**§7.1**（+Q9 app-scoped 判权 P2、+Q10 撤销即时联动 P1，裁定采用版本号比对方案①）、**附录 A**（F1–F12 → **F1–F18** + 表头/导语同步）、**附录 B**（本记录）。**其余章节未动**：§2 Python 契约、§4 权限码规则正文、§5 其余 38 条用例本体、§6 其余步骤、§7 #1–#10 均保持 v1.3 正确状态。
- **v1.5（v1.5 增量单 / #14·#15 裁定）**：仅改 **版本头**（v1.4→v1.5，F19–F34，#14/#15）、**§1 E6 段**（补「userId 可信前提」#14 警示）、**§1**（新增 §1.3 E1–E5 身份来源表、§1.4 #15 拆分与阻塞关系）、**§2**（新增 §2.8 `resolve_mis_user_id` 契约 + F27 硬警告）、**§3.1**（反向信任支加 `fromUpstreamJwt()==true` 硬约束与伪码，#14；降级支直接拒、零 `loadPermissions`）、**§3**（新增 §3.4 Python 身份解析衔接）、**§5**（新增 TC-41/42 (#14) + TC-43/44/45 (#15-a)，用例 40→**45**）、**§6**（新增 S8 Alembic `002_add_users_mis_user_id.py` #15-b + F27 工作量重估 Q12 警告；S7 计 45 条）、**§7**（裁定记录 +#14 / #15(a/b/c)）、**§7.1**（+Q11 降级支横向越权 P1、+Q12 F27 工作量重估 P1）、**附录 A**（F1–F18 → **F1–F34** + 表头/导语同步）、**附录 B**（本记录）。**其余章节未动**：§0 错误码表、§2.1–§2.7 Python 契约正文、§3.2 E6 织入、§3.3 ensureCode、§4 权限码规则、§4.1 黄金向量、§5 其余 40 条用例本体、§7 #1–#13 均保持 v1.4 正确状态。
- **v1.6（编号收口·#16/#17/#18 合并版，唯一准据）**：仅改 **版本头**（v1.5→v1.6，F37–F41，#16/#17/#18；作废此前两封冲突邮件的全部 #16–#18 / F37 编号）、**§1 落点表**（4 处行号收口：E2 工具名格式 L190→**L186**、E3-b 默认值 L104→**L69/L48**、E6-a `:263` 注解/`L264` 方法、E6-d `:290` 注解/`L291` 方法；E2 行补「判权名取 `_tool_info` 原始名、展示名≠判别名」、E6-d 段改三步显式落点（#17））、**§2.3** `_resolve_skill_ids` E2 判权名来源修正（取 `_tool_info`，禁反解 `self.name`）+「#16 命名铁律」callout、**§3.1**（来路分支识别补 #18 禁令：自读 attribute、`fromUpstreamJwt()` 先判、不复用 `resolveIdentity`）、**§3.2**（施工禁令 +#16 命名铁律 / +#17 `httpRequest` 形参前置）、**§4.1**（黄金向量表新增 `member.profile` 两形态并列行）、**§5**（新增 **TC-46/TC-47**（#16，用例 45→**47**）；矩阵统计同步）、**§7**（裁定记录 +#16 / #17 / #18）、**§7.1**（heading 加 v1.6、收口注记补 #16/#17/#18 纳入）、**附录 A**（F1–F34 → 表头/导语同步为 F1–F41，追加 **F37–F41**；F35/F36 未定义不臆造，落盘 39 条）、**附录 B**（本记录）。**其余章节未动**：§0 错误码表、§1.3/§1.4、§2.1/§2.2/§2.4–§2.8、§3.3/§3.4、§4 权限码规则、§6 实施顺序（S1–S8 不变）、§5 其余 45 条用例本体、§7 #1–#15 均保持 v1.5 正确状态。
- **v1.7（补齐缺口事实 + #16-c 准入校验）**：仅改 **版本头**（v1.6→v1.7，F35/F36 填缺口 + F42–F47，#16-c）、**§1 E2 段**（补 **F46 路径分离**现状说明）、**§2.8** F27 归因修正（现象属实但攻击面归属 **Q13 管理类 REST**、非 E1–E5；v1.5 落地方案保留）、**§2 新增 §2.9**「MCP server 命名准入」（#16-c 唯一命名权威 `^[A-Za-z][A-Za-z0-9_-]{0,63}$`、运行时 admin API + 启动期 yaml loader 双校验、`_sanitize_tool_segment` 退化为防御性兜底）、**§3.4** 末尾加 **F42/F43 制约提示**（不改方案正文）、**§6** F27 归因修正（Q12 根因改为工具层链缺 `mis_user_id` 透传）、**§5**（新增 **TC-48/TC-49/TC-50**（#16-c，用例 47→**50**）；矩阵统计同步）、**§7**（裁定记录 +#16-c（server_name 准入校验，进 T03 不留 backlog））、**§7.1**（+**Q13** 管理类 REST 观察 P2 ⇒ backlog **8** 条）、**附录 A**（F1–F41 → **F1–F47 连续**，填 F35/F36 + 追加 F42–F47，落盘 **47** 条）、**附录 B**（本记录）。**其余章节未动**：§0 错误码表、§1.3/§1.4、§2.1–§2.8、§3.1–§3.3、§4 权限码规则、§4.1 黄金向量、§6 S1–S8、§5 其余 47 条用例本体、§7 #1–#18 均保持 v1.6 正确状态。
- **v1.8（#17 三步→两步 + #19 伪代码类型对齐）**：仅改 **版本头**（v1.7→v1.8，F48–F53，#17/#19）、**§1 E6-d**（`applySkillFill` 落点由三步改两步：删除死变量 `resolveIdentity` 步骤，F48）、**§3.1**（伪代码 5 处类型对齐：F49 `ctx.userId()` 返 `Long`、F50 `iamWebClient.loadPermissions` 返 `List<String>` / 内部返 `Set<String>` `LinkedHashSet`、F51 缓存用 `ObjectMapper` JSON 序列化、F52 类增 `ObjectMapper` 字段、F53 用 `SecurityContextHolder.getOptional()`）、**附录 A**（F1–F47 → **F1–F53**，追加 F48–F53，落盘 **53** 条）、**附录 B**（本记录）。**其余章节未动**：§0 错误码表、§1.1–§1.4、§2 全部、§3.2/§3.3/§3.4、§4/§4.1、§5 全部用例、§6、§7/§7.1 均保持 v1.7 正确状态。
- **v1.9（S9 设计：`misUserId` 第五键 + 5 跳透传）**：仅改 **版本头**（v1.8→v1.9，F54–F60，S9 设计阶段）、**§3.4 完整重写**（v1.7 占位提示 → S9 设计正文：4 条已批准决策——决策 1 `build_mcp_identity` 加第五键 `misUserId` 不动老 4 键 F59、决策 2 5 跳透传链 Session→Manager→OpenHarness→Builder→Identity F60、决策 3 入口只由服务端填 `misUserId` 禁止客户端传入含两渠道分治表 F55/F56/F57/F58 + `create_session()` gap F56 + 7+ 会话创建点表 F57 + `user_mobile` 匹配桥 F54 备选、决策 4 取不到 `misUserId` 即 fail-closed 拒绝不回退 `userId`/`userMobile`；含业务风险标注——企微绑定前全拒 + 兜底在 T06 + Web 用户不受影响；含与既有裁定关系——F42/F43 制约已由决策①②③解决、#15-a 调用点前移、#15-b/#15-c 不变）、**附录 A**（F1–F53 → **F1–F60**，追加 F54–F60，落盘 **60** 条）、**附录 B**（本记录）。**其余章节未动**：§0 错误码表、§1 全部、§2 全部、§3.1/§3.2/§3.3、§4/§4.1、§5 全部用例、§6、§7/§7.1 均保持 v1.8 正确状态。**纯规格文档，不含任何代码改动。**

---

> 本文件为 **纯规格文档**，不含任何代码改动、不修改 `impl-plan.md`、不触碰 `.sql`。所有裁定以《T03 裁定书 R1》及《R1 修正案 / R2》（主理人齐活林，2026-08-05）为准。