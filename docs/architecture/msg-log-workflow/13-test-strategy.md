# 13 · 测试策略与基线评估（消息/通知/待办/已办 完整改造）

> 作者：寇豆码（Kou）· 测试基建评估
> 范围：**仅评估与测试代码设计，未改动任何业务代码**
> 仓库：`D:\code\mis-platform`

---

## 摘要（先看这里）

| 结论 | 影响 |
|---|---|
| **前端安全网对 taskflow 页面够用，但对我们将要改的 3 个点几乎零覆盖** | 铃铛聚合、消息点击跳转、门户外壳三处改动**不会被现有测试拦住**，需补测|
| **唯一可能"锁死现有行为"的测试只有 1 个半**：`task-list-page.test.tsx` 的同意用例（详见 E1.3），改后**必须**改；其余改动不锁测试 |
| **后端 82 个测试中 59 个被跳过，实际只跑 23 个纯单元测试** | 所有涉及流程推进的集成测试**默认全部跳过**。CI/本地 `mvn test` 给的是**虚假绿灯** |
| **`advanceToNext` 有间接覆盖，但没有任何测试走"从待办入口推进流程"这条路** | P0-3 改`handleTask` 接通流程 = 走进完全未测的分支，风险极高 |
| **`completeTask:186` 已经反向调用 `handleTask` —— 接通后会构成双向递归** | 这是 P0-3 的**头号设计风险**，必须先定方案（见 E3.4），否则会栈溢出 |
| **并发：`handleTask` 无 `@Version`、无 `@Lock`，撑不住并发 approve** | 双击"同意"可能双成功；E4 给了修法|
| `useChat.test.ts:570` 建议**标注为已知基线并隔离**，不要在本轮修 | 与本任务无关，且改动 `useChat` 有污染本轮变更面的风险 |
| **⚠️ 新发现：`countUnread` 与 `findInbox` 都不看 `status`** | 只接通 `syncLinkedMessagesToHandled` 的话，消息**不会从未读列表消失、角标也不会变**。口径需先定（E1.1.1） |
| **⚠️ 新发现：`PortalPage` 自带 `<header>`** | 门户外壳归位若不删这段，会出**双顶栏 + 两个 `HeaderToolkit`**，且无任何测试会报警（E2.2） |

---

## 第一部分：测试基建摸底（实读+ 实跑）

### 1.1 前端 `src/features/taskflow/` 五个测试覆盖范围

工具栈：**vitest 2.1.9 + @testing-library/react 16 + jsdom**。
`vite.config.ts:51-54` 全局 `environment: 'node'`，因此**每个 React 测试文件首行必须写** `// @vitest-environment jsdom`（现有 5 个文件都写了，新测试必须照做）。

mock 方式统一为 `vi.mock('@/lib/api/xxx', () => ({...}))` **整体替换 API 模块**（少数用 `importOriginal` 保留其余导出，见 `process-shell.test.tsx:15-18`）。所有页面都是「直接 render + MemoryRouter」的真实渲染，不 mock 组件。

| 测试文件 | 用例数 | 覆盖内容 | mock 的模块 |
|---|---|---|---|
| `inbox-page.test.tsx` | 4 | 渲染收件箱列表+未读角标；点「标为已读」调`markMessagesRead(userId,[id])`；空态「暂无消息」；关键词搜索调 `searchMessages({q,tenantId,userId})` | `@/lib/api/messages` |
| `task-list-page.test.tsx` | 3 | 渲染待办列表+优先级标签「紧急」；点「同意」断言 `handleTask('5001','1','700001','APPROVE','同意')`；空态「暂无待办」 | `@/lib/api/tasks` |
| `my-processed-page.test.tsx` | 2 | 渲染已通过/已驳回历史；空态「暂无审批记录」 | `@/lib/api/tasks` |
| `my-sent-page.test.tsx` | 2 | 渲染流程实例+「进行中」状态徽标；空态「暂无发起的流程」 | `@/lib/api/workflow` |
| `process-shell.test.tsx` | 3 | 渲染进度+只读业务数据；处理人本人可见审批栏；非处理人显示「当前节点由他人处理」且无审批栏 | `@/lib/api/workflow`（保留原导出） |

**共同特征（决定了我们的测试策略）**：
- 全部**只验证"渲染出来了"和"点了调了哪个API"**，不断言业务后果。
- **零路由跳转断言**：没有任何一个测试 mock `useNavigate`，`inbox-page` 的 `handleOpen` → `navigate('/task/pending')` **完全未测**。
- **零错误/异常路径断言**：没有一处测`catch`分支的错误展示。
- `useAuthStore.setState` 直接塞登录态，不走真实鉴权。

### 1.2 `src/features/portal/` 确认零测试

已确认。目录下 6 个文件（`portal-page.tsx` + 5 个 component）**全部无测试**。同样确认**全仓 54 个测试文件中没有任何一个引用 `PortalPage`**。

### 1.3 `router.tsx` / `app-layout.tsx` 确认零测试

- `src/app/router.tsx` — 无测试
- `src/components/layout/app-layout.tsx` — 无测试

因此**路由嵌套（`ProtectedRoute` → `AppLayout` → `KeepAliveOutlet` → `element={null}` 的路径匹配机制）完全没有测试**。现有 5 个taskflow 测试都是**绕过 router 直接渲染页面组件**，所以"把 `/portal` 挪进 `AppLayout`"这种改动对它们**零影响**（既不会挂，也不会给你任何保护）。

### 1.4 实跑：taskflow 目录测试 — 全绿

```
$ cd frontend/mis-admin-web && npm run test -- src/features/taskflow

✓ src/features/taskflow/task-list-page.test.tsx (3 tests) 1274ms
✓ src/features/taskflow/inbox-page.test.tsx (4 tests) 1337ms
✓ src/features/taskflow/process-shell.test.tsx (3 tests) 868ms
✓ src/features/taskflow/my-processed-page.test.tsx (2 tests) 1036ms
✓ src/features/taskflow/my-sent-page.test.tsx (2 tests) 565ms

 Test Files  5 passed (5)
      Tests  14 passed (14)
   Duration  56.14s
```
（stderr 仅有 React Router v7 future flag 警告，无害。）

### 1.5 实跑：`npm run typecheck` — 全绿

```
> mis-admin-web@0.1.0 typecheck
> tsc --noEmit
```
无任何输出 → **类型检查通过**。注意耗时约 3 分钟。

---

### 1.6 后端 `src/test/` 清单

16 个文件，**分两类**：

**A类 · 纯单元测试（无门控，永远跑）— 4 个 / 23 个用例**

| 文件 | 用例数 | 测什么 |
|---|---|---|
| `AssignmentResolverTest` | 8 | 审批人解析规则（FIXED / 角色 / 发起人等） |
| `ConditionEvaluatorTest` | 5 | 条件表达式求值（边路由用） |
| `AuditDiffUtilsTest` | 6 | 审计 diff 工具 |
| `IdGeneratorTest` | 2 | ID 生成 |
| `TaskflowStatusTest` | 2 | 状态常量 |

**B 类 · 集成测试（`@EnabledIfEnvironmentVariable(MIS_DB_TEST=true)` 门控，默认全跳过）— 12 个 / 59 个用例**

| 文件 | 用例数 | 测什么 |
|---|---|---|
| `ProcessServiceIntegrationTest` | 10 | **流程推进核心**：启动校验白名单、生成 wf_task+sys_task、单级通过→COMPLETED、驳回→TERMINATED、**多级逐级推进**、非处理人拒绝、重复处理拒绝、实例详情历史 |
| `TaskServiceIntegrationTest` | 12 | 建任务带通知、handleTask→APPROVED/REJECTED、幂等、转办、我的待办隔离、批量、统计、跨租户拒绝 |
| `MessageServiceIntegrationTest` | 10 | 群发消息生成接收者明细、已读/未读、统计 |
| `TaskflowEndToEndTest` | 1 | **P8 E2E**：提交→代办+消息→审批→结束→Outbox 后处理→归档成功 |
| `CountersignIntegrationTest` | 4 | 会签（或签/全签）聚合 |
| `WorkflowEdgeFlowIntegrationTest` | 3 | `wf_edge` 条件分支流转 |
| `ExecutionTaskServiceIntegrationTest` | 6 | 后处理任务扫描执行 |
| `AuditOpServiceIntegrationTest` | 8 | 审计操作 |
| `DistributedLockServiceTest` | 3 | 分布式锁 |
| `TaskflowApplicationIntegrationTest` | 2 | 上下文启动 + `/internal/v1/taskflow/health` 探针 |
| `AuditProbeService` | — | 非测试（辅助类） |

### 1.7 实跑：后端 `mvn test` — BUILD SUCCESS，但**83% 被跳过**

```
$ cd backend; ./mvn.ps1 -pl mis-taskflow test "-Dsurefire.forkCount=0"

[INFO] Running com.mis.taskflow.service.AssignmentResolverTest
[INFO] Tests run: 8, Failures: 0, Errors: 0, Skipped: 0
[INFO] Running com.mis.taskflow.service.AuditOpServiceIntegrationTest
[WARNING] Tests run: 8, Failures: 0, Errors: 0, Skipped: 8
[INFO] Running com.mis.taskflow.service.ConditionEvaluatorTest
[INFO] Tests run: 5, Failures: 0, Errors: 0, Skipped: 0
[INFO] Running com.mis.taskflow.service.CountersignIntegrationTest
[WARNING] Tests run: 4, Skipped: 4
[INFO] Running com.mis.taskflow.service.DistributedLockServiceTest
[WARNING] Tests run: 3, Skipped: 3
[INFO] Running com.mis.taskflow.service.ExecutionTaskServiceIntegrationTest
[WARNING] Tests run: 6, Skipped: 6
[INFO] Running com.mis.taskflow.service.MessageServiceIntegrationTest
[WARNING] Tests run: 10, Skipped: 10
[INFO] Running com.mis.taskflow.service.ProcessServiceIntegrationTest
[WARNING] Tests run: 10, Skipped: 10
[INFO] Running com.mis.taskflow.service.TaskflowEndToEndTest
[WARNING] Tests run: 1, Skipped: 1
[INFO] Running com.mis.taskflow.service.TaskServiceIntegrationTest
[WARNING] Tests run: 12, Skipped: 12
[INFO] Running com.mis.taskflow.service.WorkflowEdgeFlowIntegrationTest
[WARNING] Tests run: 3, Skipped: 3
[INFO] Running com.mis.taskflow.support.AuditDiffUtilsTest
[INFO] Tests run: 6, Skipped: 0
[INFO] Running com.mis.taskflow.support.IdGeneratorTest
[INFO] Tests run: 2, Skipped: 0
[INFO] Running com.mis.taskflow.support.TaskflowStatusTest
[INFO] Tests run: 2, Skipped: 0
[INFO] Running com.mis.taskflow.TaskflowApplicationIntegrationTest
[WARNING] Tests run: 2, Skipped: 2
[WARNING] Tests run: 82, Failures: 0, Errors: 0, Skipped: 59
[INFO] BUILD SUCCESS
```

**关键结论：`Tests run: 82, Skipped: 59` —— 只有 23 个真的执行了。**

> **给交付总监的提醒**：后端 `mvn test` 当前是**虚假绿灯**。它报 BUILD SUCCESS，但**所有流程推进、会签、消息、审计的测试一个都没跑**。
> 本次改造要动的`handleTask` / `completeTask`，其测试**全部在跳过之列**。
> **这意味着：改坏流程推进，`mvn test` 依然会绿。**
> 详见 §3.5「把MIS_DB_TEST 变成 CI 门禁」。

### 1.8 `MIS_DB_TEST` + `RANDOM_PORT` + `TestRestTemplate` 配置方式

已确认存在，共 1 个文件：

`TaskflowApplicationIntegrationTest.java:23-28`
```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@EnabledIfEnvironmentVariable(named = "MIS_DB_TEST", matches = "true")
class TaskflowApplicationIntegrationTest {
    @Autowired private TestRestTemplate restTemplate;
    @Autowired private javax.sql.DataSource dataSource;
```

门控范式（**11 个集成测试统一使用**）：
```java
@SpringBootTest@Transactional                                    // 类级事务，测完自动回滚
@EnabledIfEnvironmentVariable(named = "MIS_DB_TEST", matches = "true")
class XxxIntegrationTest { ... }
```

启用方式（注释里写明，`TaskflowApplicationIntegrationTest.java:19-21`）：
```powershell
$env:MIS_DB_TEST="true"; $env:DB_HOST="10.254.16.6"; ... ; mvn -pl mis-taskflow test
```

**两种回滚策略并存**（新测试要选对）：
- **类级 `@Transactional`** → 测完自动回滚，不留数据。`ProcessServiceIntegrationTest` / `TaskServiceIntegrationTest` / `MessageServiceIntegrationTest` 用这个。
- **无 `@Transactional` + `try/finally` 手动清理** → `TaskflowEndToEndTest.java:97-135` 用这个（因为它要验证后处理任务在**新事务**里被扫描执行，必须脱离回滚）。

> **坑：`src/test/resources/` 目录不存在。** 没有 `application-test.yml`，DB 连接完全依赖环境变量 + Nacos 配置。CI 上要复现必须显式传全套 `DB_*` 变量。

### 1.9 是否有测试连真实数据库（10.254.16.6:5432 mis_platform）？

**是，但默认关闭。** 
- `src/main/resources/bootstrap.yml` 里没有硬编码的 DB 地址，只有 Nacos `10.254.16.6:8848`。
- `10.254.16.6` 作为 **DB_HOST 只出现在测试类的注释里**（`TaskflowApplicationIntegrationTest.java:20`），说明真实库地址是**运行时通过 `DB_HOST` 环境变量注入**的。
- 库名 `mis_platform`、端口 5432 在代码里**完全没有出现**（Java/yml/sql 全搜过），说明这些也来自环境变量或 Nacos 外部配置。

**结论：仓库里没有任何硬编码的真实库连接；测试连的是"运行时注入的外部库"，且默认被 `MIS_DB_TEST` 门控关掉。**

---

## 第二部分：关键评估

### E1 · 哪些测试会锁死现有的 bug？

逐个 grep 后，结论出人意料：**几乎不会**。安全网比你担心的薄，但同时也意味着改动**不会撞测试**——代价是**改动也没有保护**。

#### E1.1 `syncLinkedMessagesToHandled()` 接通 → 有没有测试断言 receiver 保持 ACTIVE？

**没有。全仓零断言。**

- `handleTaskFlow`（`TaskServiceIntegrationTest.java:94-104`）只断言 `sys_task.status == "APPROVED"` 和二次调用抛异常，**完全不看 `sys_message_receiver`**。
- `createTaskWithNotification`（`:63-78`）断言了 receiver 行存在、`userId` 正确，但**只测创建**，不测处理后的状态。
- `TaskService.java:206-208` 的空方法体从未被任何测试间接触达断言。

**风险等级：低。** 接通 `syncLinkedMessagesToHandled` **不会撞任何现有测试**。
**但同样地：接通后没有任何测试证明它真的生效了 → 必须新写测试（见 §3批次 1）。**

#### E1.1.1 ⚠️ 实读发现：「置为 HANDLED」本身不足以让消息消失

这是接通前必须先定的口径问题，**否则会写出假绿的测试**：

| 位置 | 事实 | 后果 |
|---|---|---|
| `SysMessageReceiverRepository.java:20-24` | `countUnread` 只过滤 `r.read = false`，**完全不看 `status`** | 即使 `status` 置为 `HANDLED`，未读角标**不会减少** |
| `SysMessageRepository.java:21-40` | `findInbox` 只按 `receiver_ids` 数组过滤，**不 join 明细表、不看 `status`** | 已处理的消息**仍会出现在收件箱列表里** |

也就是说：只接通这个空方法的话，用户看到的收件箱**和现在一模一样**（消息还在，未读数不变）。若期望是"处理完待办，消息从未读列表消失"，那**光接通空方法不够**，还要改 `countUnread` / `findInbox`。

**三个选项，请团队明确选定（直接影响测试怎么写）：**

| 选项 | 语义 | 测试断言 |
|---|---|---|
| ① 只置 `HANDLED`，不改查询（最小改动） | `status` 是审计标记，收件箱仍展示全部消息 | 只断言 `receiver.status == "HANDLED"`；**不要**断言未读数变化 |
| ② `countUnread` 改为 `read = false AND status = 'ACTIVE'` | 已处理不再计入未读角标 | 断言 `fetchMessageStats().unread` 减 1 |
| ③ `findInbox` 也过滤 `status` | 已处理消息从列表消失 | 断言收件箱列表不含该消息 |

> **建议 ①+②**：`status` 作为审计标记保留，同时让未读数反映真实待处理量。**③ 会带来"消息凭空消失"的体验问题**（用户想回看历史时找不到），不推荐。

**注意**：批次 1 的测试必须按选定口径写。若选 ①，我在批次 1 里列的「Then 该消息不再计入未读」这条**就是错的**，应改为只断言 `status`。

#### E1.2 铃铛改用真实未读数 → 有没有 `header-toolkit` 测试？

**没有。`header-toolkit.tsx` 零测试。**

顺带指出这个改动**修的是一个真bug**：`header-toolkit.tsx:92`
```ts
const unread = items.filter((n) => !n.read).length;
```
`items` 已经被 `:77` 的 `out.slice(0, 8)` **截断到最多 8 条**，所以"未读数"实际是"**前 8 条里的未读数**"，最多显示 `9+`。真实未读可能是 47，铃铛显示 `9+`。改成聚合 `fetchMessageStats().unread` + `fetchTaskStats().pending` 才是对的。

**风险等级：低。零测试可撞。但必须新写测试锁定正确行为。**

#### E1.3 同意/驳回统一走 `/tasks/{id}/handle` → `task-list-page.test.tsx` 依赖那个分支吗？

**这是唯一一个「测试和 bug 绑在一起」的点，但绑定方式很脆弱。**

关键事实：`task-list-page.tsx:89-93`
```ts
const instId = wfInstanceId(item);
if (instId && action === 'APPROVE') {
  navigate(`/task/process/${instId}`);   // ← 有 wfInstanceId 且是「同意」就跳转，不调 API
  return;
}
```
而测试的 `sampleTask`（`task-list-page.test.tsx:34`）：
```ts
metadata: '{}',        // ← 空JSON！
```
`wfInstanceId()` 解析 `'{}'` → `parsed.wfInstanceId == null` → 返回 `null` → **走不到跳转分支**。

所以 `点击同意调用 handleTask(APPROVE)` 这个用例**测的是"没有流程实例的普通待办"**，它断言的行为（同意 → 调 `handleTask`）**恰恰是我们要统一后的正确行为**。

**明确回答团队的疑问：这个测试不会因为改动而失效，反而会继续绿。**

**但是** —— `task-list-page.test.tsx` 有一个**覆盖漏洞**：由于所有 fixture 的 `metadata` 都是 `'{}'`，**`wfInstanceId` 分支（跳转分支）从未被测过**。这正是 team-lead 怀疑的"锁死 bug"的真正形态：**不是测试断言了错误行为，而是测试根本没测那条分支，所以 bug 一直活着。**

**改动后要改的用例（1 个，必须改）：**

| 用例 | 现状 | 改动后为什么要改 |
|---|---|---|
| `点击同意调用 handleTask(APPROVE)` | `metadata:'{}'` + 断言 `handleTask(...)` | **行为不变，可保留**。但**必须补一个** `metadata:'{"wfInstanceId":123}'` 的新用例，断言"同意不再跳转、而是调 `handleTask`"——这才是锁住修复的用例 |

> 另注：`my-processed-page.test.tsx:29` 的 fixture 用了 `metadata: '{"wfInstanceId":123}'`，但那个页面**不调用 `wfInstanceId()`**，所以不受影响。改动后建议保持这个 fixture 不变，可以顺便加一条"已办项显示流程实例入口"的用例。

**风险等级：中低。1 个用例需新增；0 个用例需删除。**

#### E1.4 消息点击改开详情抽屉 → `inbox-page.test.tsx` 有相关断言吗？

**没有。零断言。**

`inbox-page.test.tsx` 4 个用例全部围绕 `标为已读` 按钮和搜索框。`handleOpen`（`inbox-page.tsx:79-85`，`navigate('/task/pending')`）**从未被触发**——因为测试从不点击 `<li>` 本身，只点里面的「标为已读」按钮，而那个按钮 `onClick` 里有 `e.stopPropagation()`（`inbox-page.tsx:197`）。

**风险等级：低。改 `handleOpen` 不会撞现有测试。但也意味着改错了没人拦→ 必须新写测试。**

---

### E2 · `features/portal/` 零测试的风险

#### E2.1 现有测试会因门户外壳归位而挂掉吗？

**不会。全仓 0 个测试引用 `PortalPage`。**

已核实：`router.tsx` / `app-layout.tsx` 均无测试；54 个测试文件里没有任何一个渲染 `PortalPage` 或断言路由结构。所以把 `/portal` 从 `router.tsx:51`（`ProtectedRoute` 直挂）挪进 `router.tsx:54` 的 `AppLayout` 子路由，**现有测试全部不受影响**。

#### E2.2 两个必须提前知道的坑（实读发现）

1. **`PortalPage` 自带 `<header>`**（`portal-page.tsx:88-136`，含 logo、`HeaderToolkit`、主题切换、用户菜单）。而 `AppLayout` **也有自己的顶栏**。直接挂进去 → **双顶栏**，视觉回归，且 `HeaderToolkit` 会出现两个实例（两套铃铛、两个 `fetchMyTasks`）。
   → **门户外壳归位必须同时删掉 `PortalPage` 里的 `<header>` 整块**（`:88-136`）以及 `HeaderToolkit`、`CommandPalette`、`CopilotPanel` 的引入（`:13-18`）。这不是测试问题，但是**改动必做项**，且**没有任何测试会告诉你漏了**。

2. **`PortalPage` 的 4 个看板都吃真实接口**：`WorkbenchOverview`（`fetchTaskStats`/`fetchMessageStats`/`fetchMyProcesses`）、`TaskBoard`（`fetchMyTasks`）、`MessageBoard`（`fetchInbox`）、`ProcessBoard`。门户外壳改动一旦破坏 `tenantId`/`userId` 传递，页面不会白屏而是**静默显示"—"**（`workbench-overview.tsx:104` 的 `value === null ? '—' : value`）。**没有测试 = 这个静默故障会溜过 CI。**

#### E2.3 最小可行门户冒烟测试（设计，不写盘）

**成本：1 个文件 / 4 个用例 / 约 90 行。** 复用现有 mock 范式，成本很低。**建议在门户外壳归位同批次落地。**

```tsx
// @vitest-environment jsdom
/**
 * PortalPage 冒烟（P-门户）：
 * 1. 渲染成功不抛错，关键外壳元素存在
 * 2. 四个看板均挂载并发起真实取数
 * 3. 无登录态时不渲染看板（userId 为空的守卫）
 * 4. 接口失败时降级为「—」而非白屏
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PortalPage } from './portal-page';
import * as tasksApi from '@/lib/api/tasks';
import * as messagesApi from '@/lib/api/messages';
import * as workflowApi from '@/lib/api/workflow';
import * as platformApi from '@/lib/api/platform';
import { useAuthStore } from '@/stores/auth-store';

vi.mock('@/lib/api/tasks', () => ({
  fetchTaskStats: vi.fn(),
  fetchMyTasks: vi.fn(),
  handleTask: vi.fn(),
}));
vi.mock('@/lib/api/messages', () => ({
  fetchMessageStats: vi.fn(),
  fetchInbox: vi.fn(),
  markMessagesRead: vi.fn(),
}));
vi.mock('@/lib/api/workflow', () => ({ fetchMyProcesses: vi.fn() }));
vi.mock('@/lib/api/platform', () => ({ fetchApps: vi.fn() }));

const login = (id: string) =>
  useAuthStore.setState({
    user: { id, employeeId: 'E1', username: 'tester', realName: '测试员',
      avatarUrl: null, deptId: null, deptName: null, roles: [], mustChangePassword: false },
  });

describe('PortalPage 冒烟', () => {
  beforeEach(() => {
    login('700001');
    vi.mocked(platformApi.fetchApps).mockResolvedValue([]);
    vi.mocked(tasksApi.fetchTaskStats).mockResolvedValue({ pending: 3, urgent: 1, overdue: 2 });
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue({ page:1,size:5,total:0,list:[] });
    vi.mocked(messagesApi.fetchMessageStats).mockResolvedValue({ unread: 5, total: 9 });
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({ page:1,size:5,total:0,list:[] });
    vi.mocked(workflowApi.fetchMyProcesses).mockResolvedValue({ page:1,size:1,total:4,list:[] });
  });

  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  const renderPage = () => render(<MemoryRouter><PortalPage /></MemoryRouter>);

  it('渲染成功：问候语与四个概览指标均存在', async () => {
    renderPage();
    expect(await screen.findByText(/你好，测试员/)).toBeTruthy();
    for (const label of ['我的待办', '未读消息', '我发起的', '逾期']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('真实取数：概览数字来自接口而非占位符', async () => {
    renderPage();
    // 待办 3 / 未读 5 / 我发起的 4
    await waitFor(() => expect(screen.getAllByText('3').length).toBeGreaterThan(0));
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    await waitFor(() => expect(tasksApi.fetchTaskStats).toHaveBeenCalledWith('1', '700001'));
  });

  it('接口失败时降级为「—」，不白屏', async () => {
    vi.mocked(tasksApi.fetchTaskStats).mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByText(/你好，测试员/)).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('无登录态时不请求接口、不渲染看板', () => {
    login('');
    renderPage();
    expect(tasksApi.fetchTaskStats).not.toHaveBeenCalled();
    expect(messagesApi.fetchMessageStats).not.toHaveBeenCalled();
  });
});
```

**设计要点（避免踩坑）**：
- `PortalPage` 用了 `next-themes` 的 `useTheme`、以及 `useAiStore`、`fetchApps`、`logout`。上面 4 个用例**都不触发**这些路径（不点主题切换、不点用户菜单），因此**不需要 `ThemeProvider` 包裹**。若后续要测主题切换，必须加 `<ThemeProvider>`。
- 用例 2 是**唯一有真实断言价值**的——它能抓住 E2.2 提到的"静默显示 —"故障。
- 若门户外壳归位后 `HeaderToolkit` 只保留一份，可顺手在用例 1 加一条 `expect(screen.getAllByLabelText('通知')).toHaveLength(1)` 来防双顶栏。

---

### E3 · P0-3 的测试缺口（最重要）

#### E3.1 `advanceToNext` 从来没被测过吗？

**测过，但只测了一半。**

全仓 grep `advanceToNext` 在测试代码中**零命中**——因为它是 `private`，测试无法直接调用。但它**被间接覆盖**了：

| 已有测试 | 如何间接覆盖 `advanceToNext` |
|---|---|
| `ProcessServiceIntegrationTest.multiLevelAdvance`（`:146-166`） | **两级审批逐级推进**：一级通过后断言生成二级 `wf_task`、`nodeCode == "l2"`、处理人是 `a2`；二级通过后断言实例 `COMPLETED`。这条**完整穿过了 `advanceToNext` 的线性推进 + `assignNode`建任务** |
| `ProcessServiceIntegrationTest.approveCompletes`（`:115-128`） | 单级通过 → `advanceToNext` 走到 END → `completeInstance` → 断言 `COMPLETED` + `postProcessStatus=WAITING` |
| `TaskflowEndToEndTest.fullHappyPath`（`:53-100`） | E2E 全链路，含 `completeInstance` → `executionTaskService.enqueue` → `scanAndExecute` → 断言归档 `SUCCESS` |
| `WorkflowEdgeFlowIntegrationTest`（3 用例） | 覆盖 `wf_edge` **条件分支**路径（`resolveNextByEdges` + `ConditionEvaluator`） |
| `CountersignIntegrationTest`（4 用例） | 覆盖 `aggregationSatisfied` 会签分支 |

**所以：`advanceToNext` 本身不是完全没测。真正零覆盖的是「从 `sys_task` 入口推进流程」这条路。**

#### E3.2 真正的缺口

现有全部推进测试，**入口都是 `processService.completeTask(...)`（按 `wfTaskId` 处理）**。

而用户实际在门户/待办页点「同意」走的是：
```
POST /tasks/{id}/handle → TaskService.handleTask(sysTaskId)
```
这条路径**只改 `sys_task`，从不碰 `wf_task` / `wf_instance`** —— 流程不推进。

**这正是 P0-3 要接通的，也是完全未测的分支。**

#### E3.3 「处理待办后流程正确推进」测试设计

**方案 A（推荐）：集成测试，真实库**

新建 `backend/mis-taskflow/src/test/java/com/mis/taskflow/service/TaskHandleAdvancesProcessTest.java`

**为什么必须连真实库**：要证明"实例推进到下一节点"，必须验证 `wf_task` / `wf_instance` / `wf_history` 三张表的**真实持久化结果**与**事务边界**。这三张表有外键与`sort_order` 排序语义，H2 内存库无法忠实模拟 PostgreSQL 行为。而项目**已有成熟的范式**（`ProcessServiceIntegrationTest` 的类级 `@Transactional` 回滚），复用即可，**边际成本很低**。

前置条件：需要 `MIS_DB_TEST=true` + `DB_*` 变量。**这是它的唯一缺点：默认被门控跳过（见 §3.5）。**

```java
package com.mis.taskflow.service;

import com.mis.taskflow.domain.entity.SysMessageReceiver;
import com.mis.taskflow.domain.repository.*;
import com.mis.taskflow.dto.*;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * P0-3：从「用户视角待办」入口处理，流程必须正确推进。
 *
 * <p>补ProcessServiceIntegrationTest 的缺口：那里的推进测试入口都是
 * completeTask(wfTaskId)，而用户实际走的是 handleTask(sysTaskId)。
 */
@SpringBootTest
@Transactional
@EnabledIfEnvironmentVariable(named = "MIS_DB_TEST", matches = "true")
class TaskHandleAdvancesProcessTest {

    private static final long TENANT = 900003L;

    @Autowired private WfDefinitionService definitionService;
    @Autowired private ProcessService processService;
    @Autowired private TaskService taskService;
    @Autowired private WfInstanceRepository instanceRepository;
    @Autowired private WfTaskRepository wfTaskRepository;
    @Autowired private SysTaskRepository sysTaskRepository;
    @Autowired private SysMessageReceiverRepository receiverRepository;
    @Autowired private SysMessageRepository messageRepository;

    /** 两级审批：start -> l1(一级) -> l2(二级) -> end */
    private String twoLevelFlow(long a1, long a2) {
        String code = "P03_" + System.nanoTime();
        Long defId = definitionService.create(TENANT, 1L, new CreateDefinitionRequest(
                code, "P0-3 两级审批", "APPROVAL", null, List.of("F1"), "{}",
                List.of(
                        new WfNodeDTO("start", "提交", "START", 0, null, null, null, "{}", null, "{}"),
                        new WfNodeDTO("l1", "一级审批", "APPROVAL", 1, null, null, null,
                                "{\"type\":\"FIXED\",\"value\":" + a1 + "}", 24, "{}"),
                        new WfNodeDTO("l2", "二级审批", "APPROVAL", 2, null, null, null,
                                "{\"type\":\"FIXED\",\"value\":" + a2 + "}", 24, "{}"),
                        new WfNodeDTO("end", "归档", "END", 3, null, null, null, "{}", null, "{}"))));
        definitionService.activate(defId, TENANT);
        return code;
    }

    private Long start(String code) {
        return processService.startProcess(TENANT, new StartProcessRequest(
                code, "PURCHASE_ORDER", "PO-" + System.nanoTime(), "F1", "{}", 100L, "发起人"));
    }

    @Test
    @DisplayName("P0-3：处理 sys_task 待办后，wf_task 置COMPLETED 且实例推进到下一节点")
    void handleTaskAdvancesProcess() {
        long a1 = 900301L, a2 = 900302L;
        String code = twoLevelFlow(a1, a2);
        Long instId = start(code);

        // 前置：启动后应有一级 wf_task 及其 sys_task
        var l1 = wfTaskRepository.findPendingByInstance(instId);
        assertEquals(1, l1.size(), "应生成一级流程任务");
        Long sysTaskId = l1.get(0).getSysTaskId();
        assertNotNull(sysTaskId, "应生成用户视角待办");

        // Given：用户从待办列表点「同意」（走 handleTask，而不是 completeTask）
        taskService.handleTask(TENANT, sysTaskId,
                new HandleTaskRequest("APPROVE", "同意", null), a1);

        // Then1：sys_task 完成
        assertEquals("APPROVED", sysTaskRepository.findByIdAndDeleted(sysTaskId, 0).orElseThrow().getStatus());

        // Then2：对应 wf_task 必须置为 COMPLETED（这是当前缺失的行为）
        // 注意：WfTask 无 deleted 字段，用 findByIdAndTenantId
        assertEquals("COMPLETED", wfTaskRepository.findByIdAndTenantId(l1.get(0).getId(), TENANT)
                .orElseThrow().getStatus(), "处理待办后流程任务应同步完成");

        // Then3：实例推进到下一节点 l2，且当前节点已切换
        WfInstance inst = instanceRepository.findById(instId).orElseThrow();
        assertEquals("RUNNING", inst.getStatus(), "两级流程一级通过后仍在运行");
        assertEquals("l2", inst.getCurrentNodeCode(), "实例应推进到二级节点");

        // Then4：生成二级 wf_task + sys_task
        var l2 = wfTaskRepository.findPendingByInstance(instId);
        assertEquals(1, l2.size(), "应生成二级流程任务");
        assertEquals("l2", l2.get(0).getNodeCode());
        assertEquals(a2, l2.get(0).getAssigneeId());
        assertNotNull(l2.get(0).getSysTaskId());

        // Then5：写入 APPROVE 历史
        assertTrue(historyRepository.findByInstanceIdOrderByCreatedAtAsc(instId).stream()
                .anyMatch(h -> "APPROVE".equals(h.getOperation())), "应记录 APPROVE 历史");
    }

    @Test
    @DisplayName("P0-3：处理待办后关联消息接收者置为 HANDLED")
    void handleTaskMarksMessageHandled() {
        long a1 = 900303L, a2 = 900304L;
        String code = twoLevelFlow(a1, a2);
        Long instId = start(code);

        var l1 = wfTaskRepository.findPendingByInstance(instId);
        Long sysTaskId = l1.get(0).getSysTaskId();

        // 该待办应带一条关联通知消息
        var msgs = messageRepository.findByReferenceTaskIdAndDeleted(sysTaskId, 0);
        assertEquals(1, msgs.size(), "待办应关联一条通知消息");
        var rows = receiverRepository.findByMessageId(msgs.get(0).getId());
        assertEquals(1, rows.size());
        assertEquals("ACTIVE", rows.get(0).getStatus(), "初始应为 ACTIVE");

        taskService.handleTask(TENANT, sysTaskId,
                new HandleTaskRequest("APPROVE", "同意", null), a1);

        var after = receiverRepository.findByMessageId(msgs.get(0).getId());
        assertEquals("HANDLED", after.get(0).getStatus(),
                "处理待办后消息接收者应置为 HANDLED（syncLinkedMessagesToHandled 接通后）");
    }

    @Test
    @DisplayName("P0-3：驳回待办应终止实例")
    void rejectTaskTerminatesInstance() {
        long a1 = 900305L, a2 = 900306L;
        String code = twoLevelFlow(a1, a2);
        Long instId = start(code);
        var l1 = wfTaskRepository.findPendingByInstance(instId);

        taskService.handleTask(TENANT, l1.get(0).getSysTaskId(),
                new HandleTaskRequest("REJECT", "不同意", null), a1);

        assertEquals("TERMINATED", instanceRepository.findById(instId).orElseThrow().getStatus(),
                "驳回应终止实例");
    }
}
```

> 注：测试类需补`@Autowired private WfHistoryRepository historyRepository;`（上面 `Then5` 依赖它）。
> **`WfTask` 无 `deleted` 字段**，用 `wfTaskRepository.findByIdAndTenantId(id, TENANT)`；`SysTask` 有 `deleted`，用 `findByIdAndDeleted(id, 0)`。

#### E3.4 ⚠️ 头号设计风险：双向递归

**必须先定方案再写代码，否则会栈溢出。**

当前**已经存在**一条反向调用：
```java
// ProcessService.java:184-191
if (wfTask.getSysTaskId() != null) {
    try {
        taskService.handleTask(tenantId, wfTask.getSysTaskId(),
                new HandleTaskRequest("APPROVE", req.comment(), null), operatorId);
    } catch (BusinessException ignored) { }
}
```

P0-3 要加的是**正向**调用：`handleTask` → `completeTask`。

两者接上后形成：
```
handleTask(sysTaskId)
  → completeTask(wfTaskId)
      → handleTask(sysTaskId)      ← 又回来了
```
目前靠 `handleTask` 里的 `isOpen()` 检查 + `catch (BusinessException ignored)` 兜住（第二次进来时状态已是 APPROVED，抛异常被吞）。**这很脆弱**：
- 若将来 `handleTask` 的幂等检查被放宽，或catch 被移除，立刻无限递归。
- `syncLinkedMessagesToHandled` 被调用**两次**，若它有副作用（发通知）会重复。

**三个可选方案（建议团队明确选定）：**

| 方案 | 做法 | 评价 |
|---|---|---|
| **① 抽取内部方法（推荐）** | 把 `handleTask` 的"改 sys_task + 同步消息"抽成 `doHandleTask()`，`completeTask` 调`doHandleTask()` 而非 `handleTask`；`handleTask` = 改状态 + `doHandleTask` + 条件调 `completeTask` | 递归被结构性消除，行为最清晰 |
| ② 加递归深度守卫 | 在 `handleTask` 用 `TransactionSynchronizationManager` 标记或 ThreadLocal 深度计数 | 能work但增加状态复杂度 |
| ③ 只在 `handleTask` 侧接，删掉 `completeTask:186` 的反向调用 | 让流程推进**只**由 `completeTask` 触发，`handleTask` 不感知流程 | 最简单，但破坏 ProcessShell 现有行为，**不建议** |

**测试上的要求：无论选哪个方案，E3.3 的测试必须能跑通且不栈溢出——这本身就是对方案的验证。**

#### E3.5 纯 mock 方案（成本对比）

| 维度 | 方案 A：集成测试（推荐） | 方案 B：纯 mock 单测 |
|---|---|---|
| 能证明什么 | **真的推进了**：表落库、事务边界、外键、排序 | 只能证明"调用了 `completeTask`"，证明不了 `advanceToNext` 正确 |
| 成本 | 低。**范式已存在**，`ProcessServiceIntegrationTest` 照抄即可 | 中。需 `Mockito` 手工 mock 8 个 Repository + `AssignmentResolver` |
| 依赖 | 需 `MIS_DB_TEST=true` + DB（默认跳过，见下） | 无外部依赖，永远跑 |
| 风险 | mock 掉 `advanceToNext` 就等于没测；漏 mock 一个 Repository 就得iterate | 与实现耦合，`advanceToNext` 内部改一点就得改 mock |
| 本项目先例 | **有12 个集成测试** | **一个纯 service mock 测试都没有** |

**建议：方案 A 为主（唯一能证明"流程正确推进"的方式），方案 B 仅作为"无库环境下也能跑的冒烟"。**

**配套必须解决的门控问题：**

现状 `MIS_DB_TEST` 未设 → 59 个测试全跳过 → **后端 CI 是虚假绿灯**。
建议二选一（本轮只出方案，不改CI 配置）：
1. 在 CI 定义一个 `mis-taskflow-db` job，显式设 `MIS_DB_TEST=true` + `DB_*`，**并要求该job 必须通过**；
2. 或者引入 Testcontainers PostgreSQL，用 `@ServiceConnection` 替代环境变量门控（更彻底，但改动大）。

在此之前，**E3.3 的测试即使写好也不会执行** —— 这一点必须在交付评审时说清楚。

---

### E4 · 并发与幂等

#### E4.1 现有代码撑不住并发 approve —— 已核实

| 检查项 | 结果 |
|---|---|
| `TaskService.handleTask` 上有 `@Transactional` | 有（`:115`） |
| 实体乐观锁 `@Version` | **无**（`SysTask.java:23-25` 只有 `@Entity`/`@Table`） |
| Repository 悲观锁 `@Lock` | **无**（`SysTaskRepository` 只有 `findByIdAndDeleted` + 5 个 `@Query`） |
| `isOpen()` 检查 | 有（`:121-123`），但是 **check-then-act**，非原子 |

**结论：两个线程同时 approve 同一 task，双双通过 `isOpen()` 检查，双双写APPROVED —— 两个都"成功"。**

这是经典的 TOCTOU。**唯一挡住它的偶然因素**：Spring 的 `@Transactional` + JPA 一级缓存让第二次读可能拿到缓存中的旧值，但**这在并发下不成立**（两个事务各有独立持久化上下文），且如果外层有 `@Transactional` 传播（`batchHandle` 就是），**同线程内两次调用会共享持久化上下文，第二次 `save` 是无条件的 UPDATE，`isOpen` 检查会被绕过**。

**更要紧的是**：P0-3 接通后，`handleTask` → `completeTask` 的窗口**变长了**（多了落库、建下节点任务、发消息），并发重复推进的风险同步放大。

#### E4.2 并发测试设计

**测试目标**：两个线程并发 approve 同一 task，断言**只有一个成功、另一个抛"已处理"**。

**这个测试在当前代码下会失败（红）** —— 这正是它的价值：它是 P0-3 的**验收闸门**。

新建 `TaskConcurrencyTest.java`，同样用真实库 + `MIS_DB_TEST` 门控 + **不用类级 `@Transactional`**（并发测试必须在独立事务里跑）：

```java
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "MIS_DB_TEST", matches = "true")
class TaskConcurrencyTest {

    private static final long TENANT = 900004L;
    @Autowired private TaskService taskService;
    @Autowired private ProcessService processService;
    @Autowired private SysTaskRepository taskRepository;
    @Autowired private Cleanup cleanup;   // 或复用 TaskflowEndToEndTest 的 txTemplate 清理模式

    @Test
    @DisplayName("并发：两个线程同时 approve 同一待办，只应一个成功")
    void concurrentApproveOnlyOneWins() throws Exception {
        // 准备一个 PENDING 待办
        Long taskId = taskService.createTask(TENANT, 1L, new CreateTaskRequest(
                "PURCHASE_APPROVAL", "PURCHASE_ORDER", "PO-" + System.nanoTime(),
                "并发测试", "PURCHASE_ORDER", 900401L, "处理人", (short) 2, null, "{}", null, null));

        int threads = 2;
        var barrier = new CyclicBarrier(threads);
        var pool = Executors.newFixedThreadPool(threads);
        var results = new ConcurrentLinkedQueue<Object>();

        for (int i = 0; i < threads; i++) {
            pool.submit(() -> {
                try {
                    barrier.await();            // 确保真正并发
                    taskService.handleTask(TENANT, taskId,
                            new HandleTaskRequest("APPROVE", "同意", null), 900401L);
                    results.add("OK");
                } catch (BusinessException e) {
                    results.add(e.getMessage());// 期望 "该代办已处理，无法重复操作"
                } catch (Exception e) {
                    results.add(e);
                }
            });
        }
        pool.shutdown();
        assertTrue(pool.awaitTermination(30, TimeUnit.SECONDS));

        long ok = results.stream().filter("OK"::equals).count();
        assertEquals(1, ok, "并发下必须恰好一个成功，实际: " + results);
        assertTrue(results.stream().anyMatch(r -> String.valueOf(r).contains("已处理")),
                "另一个应抛「已处理」异常，实际: " + results);

        // 最终状态必须是APPROVED，且 completedAt 只写一次
        assertEquals("APPROVED", taskRepository.findByIdAndDeleted(taskId, 0).orElseThrow().getStatus());
    }
}
```

**成本**：中等偏高。需注意：
- **必须去掉类级 `@Transactional`**，否则两个线程看不到对方的数据，测不到真实竞争。
- 需自建清理逻辑（照抄 `TaskflowEndToEndTest.cleanup` 的 `txTemplate` 模式）。
- 若DB 是共享的，测试会**留下脏数据**（无回滚），必须依赖清理块。**更稳的做法：用独立 schema 或本地库。**

#### E4.3 修法建议（测试之外）

若P0-3 要真正保证幂等，二选一：
- **乐观锁**：`SysTask` 加 `@Version` 字段（需DDL 迁移），冲突抛 `OptimisticLockingFailureException` → 转成业务异常。
- **条件更新**：`UPDATE sys_task SET status=? WHERE id=? AND status IN ('PENDING','APPROVING')`，用 `affectedRows == 0` 判定已被处理。**改动最小、语义最准，推荐。**

---

## 第三部分：测试策略（按改造批次）

标记：**【必须】** = 阻断合并；**【加分】** = 有余力则补。

### 批次 0 · 地基（建议最先做，否则后续批次都是盲改）

| 测试文件 | 用例 | 级别 |
|---|---|---|
| `src/lib/chat/useChat.test.ts:570` | **不新增**，按 §4 标注为已知基线 | — |
| `src/features/portal/portal-page.smoke.test.tsx`（新建） | E2.3 的 4 个用例：渲染成功 / 真实取数 / 失败降级 / 无登录态守卫 | **【必须】** |
| `src/features/portal/portal-shell.test.tsx`（新建，门户外壳归位**之后**写） | Given `/portal` 已在 `AppLayout` 内，When 渲染，Then 只存在一个 `aria-label="通知"` 顶栏、无重复 logo | **【必须】** |
| 后端：CI 增加 `MIS_DB_TEST=true` 的 job | 无用例；只是让 59 个已有测试真的跑起来 | **【必须】** |

>批次 0 的门户测试**成本最低、收益最高**：门户外壳归位是本轮最容易造成静默回归（双顶栏、接口不传、看板变"—"）的改动，而现在完全裸奔。

### 批次 1 · `syncLinkedMessagesToHandled` 接通

> **前置**：先定 E1.1.1 的口径（①/ ② / ③）。若选①，「未读数减少」这条用例**不成立**，需删掉。

| 测试文件 | 用例 | 级别 |
|---|---|---|
| `TaskHandleAdvancesProcessTest`（新建，后端） | `handleTaskMarksMessageHandled`（E3.3）：receiver `ACTIVE` → `HANDLED` | **【必须】** |
| `MessageServiceIntegrationTest`（补 2 个用例到现有文件） | Given 已处理待办的关联消息，When 查询收件箱，Then **按选定口径**断言（选②则断言未读数减 1）<br>Given 多接收者群发，When 其中一个处理，Then 只置**该接收者**为 HANDLED、不影响其他人 | **【必须】**（第二条防"一刀切"误伤；第一条**依赖 E1.1.1 口径**） |

### 批次 2 · `handleTask` 接通流程推进（P0-3，风险最高）

| 测试文件 | 用例 | 级别 |
|---|---|---|
| `TaskHandleAdvancesProcessTest`（新建，后端） | `handleTaskAdvancesProcess`（E3.3，5 个 Then 断言）；`rejectTaskTerminatesInstance` | **【必须】** |
| `TaskConcurrencyTest`（新建，后端） | `concurrentApproveOnlyOneWins`（E4.2）。**修法未落地前会红，这是验收闸门** | **【必须】** |
| `TaskServiceIntegrationTest`（补 1 个用例） | Given 普通（非流程）待办，When handleTask，Then **不触发**流程推进、`wf_*` 表无任何变化 —— 防"所有待办都被当流程待办" | **【必须】** |
| `TaskHandleAdvancesProcessTest`（补 1 个用例） | Given 会签节点有 2 个处理人，When 其中一个 approve，Then **不推进**，等另一个 —— 防绕过 `aggregationSatisfied` | **【加分】**（但会签已有 4 个测试兜底，可降级） |
| 递归防护 | Given P0-3 已接通，When 处理流程待办，Then 调用链深度为 1，不栈溢出（方案①下自动成立） | **【必须】**（体现为 E3.3 能跑通） |

### 批次 3 · 前端待办/收件箱统一入口

| 测试文件 | 用例 | 级别 |
|---|---|---|
| `task-list-page.test.tsx`（**修改**） | ① 保留 `点击同意调用 handleTask(APPROVE)`（`metadata:'{}'`，行为不变）<br>② **新增**：`metadata:'{"wfInstanceId":123}'` 时点「同意」→断言调 `handleTask` 且 **未跳转**（锁住 P0-3 的前端修复）<br>③ **新增**：`metadata:'{"wfInstanceId":123}'` 时点「驳回」→ 断言调 `handleTask(..., 'REJECT', ...)` | **【必须】**（②③为新增，①不动） |
| `task-list-page.test.tsx`（**新增**） | Given 点「同意」返回错误，Then 展示错误文案且按钮恢复可用（现有测试零错误路径覆盖） | **【加分】** |
| `inbox-page.test.tsx`（**修改**） | ① 保留现有 4 个用例<br>② **新增**：点击消息行 → 断言打开详情抽屉而非跳 `/task/pending`（需 mock `useNavigate` 或断言抽屉元素）<br>③ **新增**：点击已读消息行 → 不调 `markMessagesRead`（`inbox-page.tsx:80` 的 `if (!item.read)` 分支） | **【必须】**（②③为新增） |
| `inbox-page.test.tsx`（**新增**） | Given `searchMessages` 抛错，Then 展示错误文案（`inbox-page.tsx:62`） | **【加分】** |

### 批次 4 · 铃铛真实未读数

| 测试文件 | 用例 | 级别 |
|---|---|---|
| `src/components/layout/header-toolkit.test.tsx`（新建） | ① Given `fetchMessageStats.unread=47`、待办 3，When 渲染，Then 铃铛显示 `9+` / 正确聚合值（**不再受 `slice(0,8)` 截断影响**）<br>② Given 打开铃铛，Then 列表仍只展示前 8 条但**计数是真实总数**<br>③ Given `fetchMyTasks` 成功但 `fetchInbox` 失败，Then 仍展示待办且不抛错（`Promise.allSettled` 分支）<br>④ Given `fetchInbox` 成功但 `fetchMyTasks` 失败，Then 仍展示消息 | **【必须】**（①②覆盖本次修复点，③④是 `allSettled` 的分支，值得锁） |
| `header-toolkit.test.tsx`（新增） | Given 未登录（`user.id` 为空），Then 不发请求、铃铛显示 0 | **【加分】** |

---

## 第四部分：`useChat.test.ts:570` 既存失败怎么处理

**用例**：`安全超时不被 delta 无限续期` —— 期望 `isGenerating` 为 `false`，实得 `true`。

### 实测

- 全量基线：`Test Files 1 failed | 53 passed`、`Tests 1 failed | 558 passed`
- **本次跑 `src/features/taskflow`（5 文件 14 用例）全绿**，确认该失败与 taskflow 无关
- `npm run typecheck` 全绿，说明**不是类型问题**

### 三个选项对比

| 选项 | 优点 | 缺点 |
|---|---|---|
| **① 先修它** | 基线全绿，后续回归一目了然 | **本轮不建议**。`useChat` 是 AI 对话核心（含SSE、generation cancel、硬上限计时），与"消息/通知/待办/已办"改造**完全正交**。修它要动`useChat` 实现，等于把无关变更混进本轮diff，增加评审负担与回归面 |
| **② 标注为已知基线（推荐）** | 不碰无关代码；基线数字明确；后续谁修谁认领 | 需要一个机制承载"已知失败" |
| **③ 删掉** | 假绿变真绿 | **最差**。删掉等于掩盖一个真实的安全超时缺陷（硬上限不生效 → 流式连接可能不被强制断开）。这是**安全相关的行为**，删测试是技术债 |

### 建议：② 标注为已知基线

具体做法（**低成本，不碰业务代码**）：

1. **本轮不动 `useChat.test.ts`**，让它继续红。
2. 在 CI/验收基线文档中**显式记录**：`Tests 1 failed | 558 passed (559)`，并注明唯一失败为 `src/lib/chat/useChat.test.ts:570`，与本轮改造无关。
3. 建议前端 `npm run test` 的判定标准改为 **"失败数 ≤ 1 且失败用例为上述基线"** 才算通过（脚本化断言，而非人工记忆）。
4. 在 `docs/architecture/msg-log-workflow/` 下留一条待办：**「useChat 安全超时硬上限不生效」**，注明根因是 `stream` delta 事件会重置首次计时，修复应落在 `useChat` 的计时起点不可续期逻辑上。

**理由**：本轮的核心风险是P0-3 流程推进接通（可能栈溢出、可能流程不推进），**变更面应尽量收窄**。混入一个与SSE 计时相关的修复，会让 code review 无法聚焦，也让"本轮改动是否引入回归"这一判断失真。而硬超时失效虽然真实，但它是**已存在的、独立于本轮的功能缺陷**，且是 chat 域的问题，不应让 taskflow 改造承担这个风险。

> 若团队决定 ①，**必须单独开一个 PR/commit**，且验收标准是"该用例转绿 + `useChat` 其余用例无回归"，绝不能与业务改造混在同一commit。

---

## 附录 A · 实测命令与结果汇总

| 命令 | 结果 |
|---|---|
| `cd frontend/mis-admin-web && npm run test -- src/features/taskflow` | **Test Files 5 passed (5)，Tests 14 passed (14)**，56.14s |
| `cd frontend/mis-admin-web && npm run typecheck` | **通过**（`tsc --noEmit` 无输出），约 3min |
| `cd backend; ./mvn.ps1 -pl mis-taskflow test "-Dsurefire.forkCount=0"` | **BUILD SUCCESS，Tests run: 82, Failures: 0, Errors: 0, Skipped: 59**（实际执行仅 23） |

> **PowerShell 注意**：`mvn.ps1` 是 PowerShell 脚本，必须用 PowerShell 执行；且 `-D` 参数**必须加引号**（`-Dsurefire.forkCount=0` 不加引号会被 PowerShell 解析成 `.forkCount=0` 并报 `Unknown lifecycle phase`）。

## 附录 B · 关键文件行号索引

| 位置 | 说明 |
|---|---|
| `TaskService.java:118-145` | `handleTask`，只改 `sys_task` |
| `TaskService.java:121-123` | `isOpen()` check-then-act，非原子 |
| `TaskService.java:206-208` | `syncLinkedMessagesToHandled` 空方法 |
| `ProcessService.java:141` | `completeTask` 入口 |
| `ProcessService.java:184-191` | **反向调 `handleTask`（P0-3 递归风险源）** |
| `ProcessService.java:208` | 调 `advanceToNext` |
| `ProcessService.java:262` | `advanceToNext` 定义（private） |
| `ProcessService.java:340-360` | `assignNode`，写 metadata `{"wfInstanceId":...}` |
| `SysTask.java:23-25` | 无 `@Version` |
| `SysMessageReceiver.java:20` | `STATUS_HANDLED = "HANDLED"` |
| `SysMessageReceiverRepository.java:20-24` | `countUnread` 只看 `read=false`，**不看 `status`** |
| `SysMessageRepository.java:21-40` | `findInbox` 按 `receiver_ids` 数组过滤，**不看 `status`** |
| `WfTaskRepository.java:13` |只有 `findByIdAndTenantId`，无 `findByIdAndDeleted` |
| `task-list-page.tsx:89-93` | wfInstanceId 分支 |
| `task-list-page.test.tsx:34` | fixture `metadata:'{}'` → 不进分支 |
| `inbox-page.tsx:79-85` | `handleOpen` → `navigate('/task/pending')` |
| `inbox-page.tsx:197` | `e.stopPropagation()`，导致测试从不触发 `handleOpen` |
| `header-toolkit.tsx:77` | `out.slice(0, 8)` 截断 |
| `header-toolkit.tsx:92` | 未读数被截断污染 |
| `router.tsx:51` | `/portal` 裸挂在 `ProtectedRoute` 下 |
| `router.tsx:54` | `AppLayout` 子路由 |
| `portal-page.tsx:88-136` | 自带 `<header>`（含 `HeaderToolkit`），归位后需删 |
| `vite.config.ts:51-54` | `environment: 'node'` + include 模式 |
| `ProcessServiceIntegrationTest.java:146-166` | `multiLevelAdvance`，现有唯一的多级推进覆盖 |
| `TaskflowEndToEndTest.java:97-135` | 无 `@Transactional` 的手动清理范式 |