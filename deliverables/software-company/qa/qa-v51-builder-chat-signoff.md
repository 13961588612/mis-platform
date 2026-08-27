# QA 回归验证报告 —— V51 builder/chat sys_api 补登

- 验证人：Edward（QA 工程师）
- 日期：2026-08-16
- 范围：V29/V46 id 碰撞导致 `POST /api/v1/agent-ops/skills/builder/chat` 漏登的 BugFix 收口
- 轮次：Round 1（一轮通过，未进入 Round 2）

---

## 1. 静态复核结论

### 1.1 id / code 段位空闲性

| 检查项 | 方法 | 结果 |
|---|---|---|
| `92176` 在 mis-migrator 全仓命中 | grep 全量 | 仅 V51 自身 11 处，**零外部占用** ✓ |
| `00920077` 在 mis-migrator 全仓命中 | grep 全量 | 仅 V51 自身 5 处，**零外部占用** ✓ |
| `sys_api` 921xx 段最大已用 id | 全量抽取排序 | `92175`（V50），V51 取 `92176` 为**紧邻下一个空位** ✓ |
| `sys_api` code 段最大已用 | 全量抽取排序 | `00920076`（V50），V51 取 `00920077` **连续无跳号** ✓ |
| `sys_menu_api` 921xx 段最大已用 id | 仅在 sys_menu_api INSERT 块内抽取 | `92172`，`92176` 空闲 ✓ |

V51 文件头自述的「sys_api 最大 92175 / sys_menu_api 最大 92172」与实测**完全一致**，无夸大。

### 1.2 根因复验（独立确认，非采信工程师结论）

- `V29__agent_mcp_tool_permissions.sql:34` → `(92158, 92020, 92090, '00920059', ... 'GET', '/api/v1/agent-ops/mcp/tools', 59, ...)`
- `V46__agent_ops_skill_builder_perms.sql:25` → `(92158, 92020, 92090, '00920059', ... 'POST', '/api/v1/agent-ops/skills/builder/chat', 59, ...)`

两者在 **id(92158)** 与 **(module_id=92020, code='00920059')** 上双重碰撞；V46 的守卫 `WHERE NOT EXISTS(id=92158)` 在 V29 先执行后恒为 false ⇒ 静默跳过，不报错。
其 `sys_menu_api (92158, 92051, 92158)` 亦与 V29 的 `(92158, 92039, 92158)` 撞 id ⇒ 同样跳过。
**根因描述准确，已独立确认。**

### 1.3 path 唯一性（V51 是唯一有效登记来源）

grep `/api/v1/agent-ops/skills/builder/chat` 全仓：仅命中 V46（已证实被跳过，无实际行）与 V51（第 40 行真实 VALUES）。
⇒ **V51 是该端点在 sys_api 的唯一有效登记来源** ✓

### 1.4 菜单 92051 权限确认

`V20__agent_ops_api_perms.sql:66`：
```
(92051, 1, 92010, 92037, 'agent_skill_manage', '技能创建/编辑/删除/启停', 3, NULL, NULL,
 'agent:skill:manage', NULL, 1, 1, 1, NOW(), NOW())
```
⇒ 菜单 `92051` 的 permission 列确为 **`agent:skill:manage`** ✓
另 `V20:318` 将菜单 `92051–92063` 批量授予 role_id=1，**该权限已有角色持有**，绑定后可真实生效（不会出现「登记了但没人有权限」的假修复）。

### 1.5 幂等与守卫风格一致性

V51 两条 INSERT 的守卫与 `V50` **逐字同构**：
1. `NOT EXISTS (id = v.id)`
2. `NOT EXISTS (module_id = v.module_id AND code = v.code)`
3. `NOT EXISTS (type='api' AND status=1 AND http_method AND path_pattern)`
4. `EXISTS (id = 92090)` —— catalog 前置存在性（V20:126 已定义 `92090` 智能体运营 catalog）✓

`sys_menu_api` 段额外带 `EXISTS(sys_menu m WHERE m.id=92051)` + `EXISTS(sys_api a WHERE a.id=92176)` 双外键前置校验 —— 比 V46 更严，**不会因外键缺失报错，只会安全跳过**。

重复执行安全性推演：
- **全新库**：V29 先占 92158 → V46 仍跳过（与线上同构）→ V51 插入 92176。**收敛一致** ✓
- **线上现存库**：92176 不存在、path 无行 → V51 正常插入 ✓
- **V51 重复执行**：id 92176 已存在 → 守卫 1 拦下，无 PK 冲突 ✓

### 1.6 SQL 结构完整性

- Flyway 版本号无重复（V51 唯一）✓
- 2 条 INSERT / 2 个语句终止分号，配平 ✓
- 括号配平 19/19 ✓
- 列清单 12 列 vs VALUES 元组 12 值 vs `AS v(...)` 别名 12 项，三者一致 ✓（`sys_menu_api` 为 5/5/5 ✓）
- 无 `tenant_id`/`app_id` 列（V8 已 DROP），与 V20/V46/V50 口径一致 ✓

---

## 2. 测试实际执行结果

环境可用（`deliverables/software-company/qa/mvn-run.sh` 存在且工作正常）。

首次调用因 `-am` 连带上游模块、surefire 在 `mis-common-core` 无匹配用例而中断（**环境参数问题，非代码缺陷**），补 `-Dsurefire.failIfNoSpecifiedTests=false` 后正常：

```
mvn -o -pl mis-admin-bff -am test -Dtest=BffApiRegistryDiffSurveyTest \
    -Dsurefire.failIfNoSpecifiedTests=false
```

```
Tests run: 1, Failures: 0, Errors: 0, Skipped: 0
BUILD SUCCESS   (Total time: 55.162 s)
```

完整日志：`deliverables/software-company/qa/edward_v51_bff.log`

### 2.1 断言级证据（不止看绿灯）

该测试断言 4 要求「非 KB 域未登记端点集合」**恰好等于** 3 个已知动作变量端点。实测输出：

```
--- 其余非 KB 域未登记 ---
POST /api/v1/agent-ops/agents/{id}/{action}
POST /api/v1/agent-ops/channels/wecom/bots/{botId}/{action}
POST /api/v1/agent-ops/mcp/servers/{name}/{action}
```
⇒ 与预期集合完全一致，**builder/chat 未出现在未登记清单中** ✓

且 `POST /api/v1/agent-ops/skills/builder/chat` 出现在日志第 359 行，落在「已登记端点（fixture）」段（195–438 行）内 ⇒ **已被视为已覆盖** ✓

### 2.2 语义正确性核验（关键）

`AgentOpsController.java:130` 确有 `@PostMapping("/skills/builder/chat")` ⇒ 该端点被 Controller 真实暴露，因此**必须**在 fixture 中登记，否则断言 4 直接失败。

更重要的是：`REGISTERED_FIXTURE` 是 sys_api 注册表的**人工镜像**。修复前 fixture 声称 builder/chat「已登记」，而 DB 因静默跳过实际并无该行 —— **fixture 与 DB 不一致，正是掩盖 403 的那层假象**。V51 让 DB 追上 fixture，**语义一致性由此恢复**，注释同步改为「V51 接管补登」属如实修正。

---

## 3. 改动范围核验

工作区存在大量前序故事的未提交改动（V47–V50、org/post 相关），需与本次 BugFix 区分：

- **本次 BugFix 净改动 = 新增 V51 SQL + 测试文件第 627 行注释**。
- 第 628 行字符串 `"POST /api/v1/agent-ops/skills/builder/chat"` 相对**任务开始前的工作区状态未变**（该字符串由前序故事引入，`git show HEAD` 中不存在，故 diff 显示为新增行 —— 这是工作区基线差异，非本次改动越界）。
- 无任何生产代码（main/java）被修改，**编译期行为零变更**。

---

## 4. 遗留观察（不阻塞本次收口，建议后续跟进）

1. **`AgentOpsController.java:30` javadoc 仍写「见 V46」** —— 但 V46 已证实未真实登记该端点。后续维护者按此指引去核对 V46 会看到「代码看起来是对的」，从而**再次踩进本次同一个陷阱**。建议同步改为「见 V51」。工程师已修正测试侧注释，此处属同源遗漏。（注释级，零功能影响）
2. **V50 的 3 个端点（92173–92175）只有 `sys_api` 行、无 `sys_menu_api` 绑定** —— 已核实 sys_menu_api 921xx 段不含 92173–92175。在 `deny-unmapped=true` 下 permission 为 NULL，是否等价放行取决于 `ApiPermissionInterceptor` 实现；与本次同属「登记了但可能判权异常」的同类风险。建议独立排查，本次不扩大范围。

---

## 5. 结论

- **静态复核**：92176 / 00920077 均空闲且连续；path 唯一（V51 为唯一有效来源）；菜单 92051 = `agent:skill:manage` 且已授予 role 1；守卫与 V50 同构、三重幂等、外键前置校验齐备；SQL 结构完整。
- **测试执行**：已在本环境**真实运行并通过**（1/1，BUILD SUCCESS），断言级证据齐全，未使用「环境限制」豁免。
- **路由判定**：**NoOne** —— 未发现源码 Bug，无需回退工程师；测试代码无错误断言，无需自行修复。
- **IS_PASS：YES**

**一句话总结**：V51 用空闲且连续的 `92176/00920077` 精准补登了被 V29/V46 id 碰撞静默吞掉的 builder/chat，守卫三重幂等、菜单 92051 权限链完整，BFF 差集测试真实跑通 1/1 且 builder/chat 已落入已登记段，修复有效、可安全上线。
