# T-VERIFY Round 3 验收报告 —— MIS 组织人事域增量改造（安全差集盘点）

- **验证人**: 严过关（software-qa-engineer-2）
- **验证对象**: 工程师寇豆码提交的 Round 3 修复（V50 迁移 + BffApiRegistryDiffSurveyTest fixture 4 行）
- **目标**: `BffApiRegistryDiffSurveyTest` 由 Round 1/2 的 1 FAIL → 0 FAIL；全量回归无新红
- **日期**: 2026-08-16

---

## 1. 编译结果（JDK17 / offline）

命令：`bash deliverables/software-company/qa/mvn-run.sh -o -q -pl mis-common,mis-org,mis-admin-bff -am compile`

- 三个模块编译通过，**BUILD SUCCESS**（mis-common / mis-org / mis-admin-bff）。
- V50 迁移文件 `V50__agent_ops_sessions_timing_and_skill_parse_api.sql` 已就位（Flyway V50 命名约定识别）；
  BFF 测试类 `BffApiRegistryDiffSurveyTest.java` 在后续 `test` 阶段成功编译并执行。

## 2. 核心回归 `BffApiRegistryDiffSurveyTest`

命令：`... mvn-run.sh -o -pl mis-admin-bff test -Dtest=BffApiRegistryDiffSurveyTest`

```
Tests run: 1, Failures: 0, Errors: 0, Skipped: 0
BUILD SUCCESS
```

- **断言①（L292 `allMatch` DISPOSITIONS）**：PASS——非 KB 未登记端点所属域均有处置结论。
- **断言④（L300 `assertEquals` 精确 3 个 agent-ops 动作变量端点）**：PASS——
  期望集合 `POST /api/v1/agent-ops/agents/{id}/{action}`、
  `POST /api/v1/agent-ops/channels/wecom/bots/{botId}/{action}`、
  `POST /api/v1/agent-ops/mcp/servers/{name}/{action}` 与实际 `nonKbUnregistered` 完全一致。

✅ Round 3 核心目标达成：**1 FAIL → 0 FAIL**。

## 3. 全量回归（mis-org + mis-admin-bff）

命令：`... mvn-run.sh -o -pl mis-org,mis-admin-bff -am test`

```
Tests run: 288, Failures: 0, Errors: 0, Skipped: 0
BUILD SUCCESS
```

- Reactor 全绿：mis-common-core / mis-common-jpa / mis-common-web / mis-common-security /
  mis-common-redis / mis-org / mis-admin-bff 均 SUCCESS。
- 总失败数 **0**，无新红（对照 Round 2 基线 288 例 1 FAIL，本轮已归零）。

## 4. 前端门禁复验

命令：`cd frontend/mis-admin-web && npm run typecheck`（`tsc --noEmit`）

```
> tsc --noEmit
EXIT_CODE=0
```

✅ 类型检查通过，exit 0，无类型错误。

## 5. 工程师声明独立核验（可信）

| 核验项 | 结论 |
|---|---|
| V50 id 92173–92175 全库占用 | ✅ grep 确认 92173–92199 未被任何迁移占用（V43 止步 92172） |
| codes 00920074–00920076 冲突 | ✅ 全库无冲突 |
| parent_id=92090（agent-ops catalog）存在 | ✅ V50 带 `EXISTS(SELECT 1 FROM sys_api WHERE id=92090)` 守卫 |
| 四重幂等守卫（id + (module_id,code) + (http_method,path_pattern) + parent） | ✅ 已逐条核对 SQL |
| path 与 AgentOpsController 注解逐字一致 | ✅ 类级 `@RequestMapping("/api/v1/agent-ops")` + 方法级
  `@PostMapping("/skills/parse")` / `@GetMapping("/sessions/{id}/timing")` /
  `@PostMapping("/sessions/timing/batch")` —— 与 V50、fixture 完全一致 |
| fixture 4 行（skills/parse、skills/builder/chat、sessions/{id}/timing、sessions/timing/batch） | ✅ 已落地（L626 / L628 / L650 / L651）；Round 2 的 depts/{id}/staffing、post-types CRUD/tree、PostController 注册保持不动 |

## 6. 路由判定

**NoOne** —— 源码/迁移/V50/fixture/测试均通过，无 Bug 需回滚工程师，亦无测试代码缺陷需自修。本轮（第 3 轮）闭环。

---

## ⚠️ 7. 已知存量隐患 CAVEAT（仅记录，不计为本次失败，未修）

**V29 与 V46 在 `sys_api` 复用主键 id=92158：**

- `V29__agent_mcp_tool_permissions.sql`（L34）：`(92158, 92020, 92090, '00920059', ..., 'GET', '/api/v1/agent-ops/mcp/tools', ...)` —— 占用 id=92158、code=00920059。
- `V46__agent_ops_skill_builder_perms.sql`（L25）：`(92158, 92020, 92090, '00920059', ..., 'POST', '/api/v1/agent-ops/skills/builder/chat', ...)` —— **复用同一 id=92158、code=00920059**，仅 path 不同（builder/chat vs mcp/tools）。

**后果链：**
1. V46 带 `WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)` 守卫（V46 L27）→ 真实库因 V29 已占 92158，`builder/chat` 的 `sys_api` INSERT 被跳过、**未插入**。
2. V46 的 `sys_menu_api`（L41）：`(92158, 92051, 92158, ...)` 把菜单 92051（agent:skill:manage）指向 **错位的 92158**（即 mcp/tools 行），而非 builder/chat。

**运行时风险：** `POST /api/v1/agent-ops/skills/builder/chat` 在真实环境可能被权限拦截（注册表缺该端点）。

**注意（测试侧掩盖）：** 本测试 `REGISTERED_FIXTURE` 是**静态固化 fixture**（非真实 DB 查询），已将 `builder/chat` 列入（L628），故测试不因此红灯；但 fixture 与真实库状态存在偏差，掩盖了上述存量 bug。

**建议后续 SOP（超出本轮 dept/post 改造范围，工程师未动）：**
- 用空闲 id（如 92176+）重插 `builder/chat` 的 `sys_api` 行（code 用新值，避免与 00920059 撞）；
- 修正 `sys_menu_api` 关联，把菜单 92051 指向新的 builder/chat api_id。

> 此 caveat 不影响本轮验收结论；按主理人裁决作为存量技术债单列跟踪。

---

## 8. 结论

Round 3 修复有效：安全差集盘点测试 **1 FAIL → 0 FAIL**，全量回归 288 例 0 失败，前端 typecheck 通过，V50 迁移与 fixture 经独立核验确无冲突且 path 逐字一致。本轮闭环，路由 **NoOne**。唯一遗留为 V29/V46 存量主键复用隐患（已单列，不计入失败）。
