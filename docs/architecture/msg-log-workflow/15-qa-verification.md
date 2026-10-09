# 15 · 交叉验收报告（QA 严过关）

- **验收人**：严过关（QA）
- **委托方**：齐活林（交付总监）
- **仓库**：`D:\code\mis-platform`
- **验收时间**：2026-10-09
- **原则**：不信任何转述。所有结论均读源码 + 跑命令得出，命令输出原文贴附。
- **代码改动**：**零**。业务代码一行未改；复现用的临时测试已删除（见 §5）。

---

## 0. 智能路由判定

```
ROUTE: Engineer
```

**理由**：B-1 的越权修复在 `operatorId == null` 时误伤合法流程路径，直接把 B-2 的修复打成失效。已用复现用例实证，非理论推断。**1 个 P1 缺陷（安全相关）需源码修复**，位置与复现步骤见 §4.1。

其余 5 条前端声称与 B-2/B-3/B-4 的**主路径**均核实通过。

---

## 1. 验证结果总览

| 项 | 声称 | 实际 | 判定 |
|---|---|---|---|
| 前端全量 | 598 全绿 | **57 files / 598 passed / 1 todo / 0 failed** | 确认 |
| 前端 typecheck | 通过 | `TSC_EXIT=0`，零输出 | 确认 |
| 后端全量 | Skipped:0 Failures:0 | **Tests run: 92, Failures: 0, Errors: 0, Skipped: 0** | 确认 |
| B-1 越权 | 加 assignee 校验 | 校验已加，但**误杀 null operatorId 的合法流程路径** | **有问题（P1）** |
| B-2 REJECT 同步 | 传 action 变量 | 主路径确认；**被 B-1 反噬** | **有问题（衍生）** |
| B-3 并发 | 悲观行锁 | 锁在事务内、同一把锁、测试真实有效 | 确认 |
| B-4 审计 | 快照-恢复 | 无污染、diff 非空；**但单次动作产生 2 条记录** | 有问题（需裁决） |
| Flyway V120~V127 | 零改动 | 零改动 | 确认 |
| 敏感文件 | 无 | 无 `.env`/密钥 | 确认 |

---

## 2. 真实命令输出

### 2.1 前端全量（受控内存，规避坑 1）

```bash
cd frontend/mis-admin-web
NODE_OPTIONS="--max-old-space-size=700" npx vitest run --pool=threads --poolOptions.threads.singleThread=true
```

```
 Test Files  57 passed (57)
      Tests  598 passed | 1 todo (599)
   Start at  12:33:40
   Duration  210.76s (transform 62.66s, setup 0ms, collect 142.30s, tests 32.49s)
```

新增/关键用例真实通过（非todo）：

```
 ✓ src/components/layout/header-toolkit.test.tsx (10 tests) 1029ms
 ✓ src/features/portal/portal-page.smoke.test.tsx (7 tests) 999ms
 ✓ src/app/router.test.tsx (15 tests | 1 skipped) 306ms
 ✓ src/features/taskflow/inbox-page.test.tsx (7 tests) 1861ms
   ✓ InboxPage > 点消息开右侧抽屉并展示完整正文，不跳待办页 478ms
   ✓ InboxPage > 消息详情加载失败时抽屉内展示错误而不崩 302ms
   ✓ InboxPage > 搜索输入 300ms 防抖：打字过程中不请求，静默期后才请求一次 446ms
 ✓ src/features/taskflow/process-shell.test.tsx (6 tests) 599ms
 ✓ src/features/taskflow/task-list-page.test.tsx (5 tests) 444ms
```

> 基线 587 passed / 6 todo → 现 598 passed / 1 todo。净增 11 个真实用例、消除 5 个 todo。**无一条靠删测试或加 skip 换来的绿**（下见 §3.7）。

### 2.2 前端 typecheck

```bash
node --max-old-space-size=1400 ./node_modules/typescript/bin/tsc --noEmit > /tmp/tsc.log 2>&1
echo "TSC_EXIT=$?"
```

```
TSC_EXIT=0
--- 字节数: 0 ---
```

**判别说明**：首次后台执行时返回 `failed` 且**零输出**——按坑 1 的判别标准（`exit 1 + 无输出` =被 OOM kill，非类型错误），我做了对照实验：显式重跑并把 stdout/stderr 落盘再读文件，得`TSC_EXIT=0`、日志 0 字节。**结论：tsc 真实通过，无 `error TSxxxx:` 输出。** 这也再次验证坑 1 的判别法有效。

### 2.3 后端全量（PowerShell + `forkCount=0`）

```powershell
Set-Location D:\code\mis-platform\backend
$env:MIS_DB_TEST="true"; $env:DB_HOST="10.254.16.6"; $env:DB_PORT="5432"
$env:DB_NAME="mis_platform"; $env:DB_USER="mis"; $env:DB_PASSWORD="mis123"
.\mvn.ps1 -pl mis-taskflow test "-Dsurefire.forkCount=0"
```

```
[INFO] Results:
[INFO]
[INFO] Tests run: 92, Failures: 0, Errors: 0, Skipped: 0
[INFO]
[INFO] BUILD SUCCESS
[INFO] Total time:  03:19 min
```

**`Skipped: 0` 确认** —— 此前被 `MIS_DB_TEST` 跳过的 59 个用例确实真跑了。基线 82 → 现 92，净增 10 个，与我在 diff 中数到的 `@Test` 增量吻合（`ProcessServiceIntegrationTest` +4、`TaskServiceIntegrationTest` +3、`TaskConcurrencyIntegrationTest` +3）。

### 2.4 git 审查

```
$ git log --oneline -8
9a1b5b8 feat(web): 批完自动续下一条，队列耗尽给出去向
e5cdad1 feat(web): 详情页按来源渲染面包屑（return path 的接收侧）
8b6e166 refactor(web): 门户外壳归位，/portal 并入 AppLayout
56de16a feat(web): 跳转流程详情时携带来源（return path 的跳转侧）
896dc9e feat(web): 消息点开右侧详情抽屉+ 搜索 300ms 防抖
4c57211 fix(web): 顶栏铃铛改用后端 stats 权威未读数（零前端计算）
e40590b refactor(web): 抽取收件箱改造所需的共享抽象
f407b2d chore(taskflow): dev 脚本纳入 mis-taskflow 并记录踩坑
```

7 个前端 commit 与声称**逐条对得上**，无夹带。

**未提交部分（后端 5 个源文件 + 3 个测试文件）**：

```
 M backend/.../domain/repository/SysTaskRepository.java      | 20 ++  (findByIdForUpdate)
 M backend/.../service/ProcessService.java                   | 60 ++
 M backend/.../service/TaskService.java                      | 41 ++
 M backend/.../support/AuditContext.java                     | 20 ++
 M backend/.../support/BusinessOperationAspect.java          |  7 +-
 M backend/.../service/ProcessServiceIntegrationTest.java    | 110 ++
 M backend/.../service/TaskServiceIntegrationTest.java       |  44 ++
?? backend/.../service/TaskConcurrencyIntegrationTest.java
```

**无意外文件**（`.workbuddy/memory/MEMORY.md` 与 4 个 docs 属正常记录）。**无 `.env`/密钥/证书**：

```
$ git status --short | grep -iE "\.env|secret|credential|\.pem|\.key"
无敏感文件
```

**Flyway V120~V127 零改动**：

```
$ git diff HEAD --stat -- backend/mis-migrator/
(空)
$ git log --oneline -8 --name-only -- backend/mis-migrator/
c8dc87f ...V120...V127     ← 仅创建时的那个历史 commit
69548e9 ...V119
8c2a326 ...V118
```

7 个前端 commit 均未触碰 `mis-migrator`。V120~V127 自创建后**零改动**，未篡改历史迁移。**确认。**

---

## 3. 前端 6 条逐条核实

### 3.1 铃铛改用后端 stats（`4c57211`）— 确认

`header-toolkit.tsx:60-61` 取权威值，`:97` 合成为展示值：

```ts
const statsMsg = fetchMessageStats(TENANT_ID, userId).catch(() => null);
// ...
const [st, sm] = await Promise.all([statsTask, statsMsg]);
setPendingCount(st?.pending ?? 0);
setUnreadCount(sm?.unread ?? 0);
// ...
const unread = pendingCount + unreadCount;
```

- **不再有前端假算**：全仓已无 `items.filter(!read).length` 式的未读推算。
- **已读表达**：消息项仍带 `read: m.read`（`header-toolkit.tsx:88`），下拉用共享 `UnreadDot` 渲染圆点。待办项**显式不参与**未读计算，代码注释写明理由（待办列表接口 `read` 语义不可靠）。**下拉能正确区分消息已读/未读；待办不假装有已读语义——这是正确取舍，不是漏做。**
- **容错**：两个 stats 请求均带 `.catch(() => null)`，任一失败回落 0，铃铛仍可用。

### 3.2 消息抽屉 480px（`896dc9e`）— 确认

`inbox-page.tsx:268`：

```tsx
<SheetContent side="right" className="w-full max-w-[480px]">
```

- **宽度 480px 确认**（`max-w-[480px]` + `w-full`，窄屏自适应）。
- **正文不截断**：`:315` 用 `whitespace-pre-wrap break-words`，无 `line-clamp`/`truncate`。三级兜底 `detail.content || detail.summary || '（无正文）'`。
- **消息没详情会不会白屏/报错**：不会。三态齐备（`:279-320`）：`detailLoading` → 加载态；`detailError` → `<ListError>`；`detail` → 正常渲染；**全为空时回落 `null`，不崩**。已有用例 `消息详情加载失败时抽屉内展示错误而不崩` 覆盖（302ms 通过）。
- **300ms 防抖**：确认（用例 `搜索输入 300ms 防抖` 通过），且「搜索」按钮跳过防抖立即生效、关键词变化自动回第 1 页。

### 3.3 门户外壳归位（`8b6e166`）— 确认（含一处测试盲区）

**你点名的两处都改了**——这是本次核实的关键，因为 `AppLayout` 渲染的是 `KeepAliveOutlet` 而非 `<Outlet/>`：

1. `router.tsx:56`：`<Route path="/portal" element={null} />` 已移入 AppLayout 子路由。
2. `keep-alive-outlet.tsx:124`：`PAGE_MAP` 首行即 `'/portal': PortalPage,` 已登记。

**顺序正确**：先改 `PAGE_MAP` 再移路由，不会出现中间态白屏。

- **自造 header 残留**：无。`portal-page.tsx` 现在只剩工作台四卡片 + `AppRail`，文件头注释明确记录了删掉的内容（M logo、标题、主题切换、用户菜单、退出登录、`HeaderToolkit`）。
- **Ctrl+J 双注册**：**已消除**。全仓热键扫描仅剩一处注册：

```
src/components/layout/app-layout.tsx:143:  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
```

`portal-page.tsx` 已无任何热键注册。

- ⚠️ **测试盲区（非缺陷，供改进）**：`router.test.tsx:37` 把 `AppLayout` 替换成了自带 `FakeKeepAliveOutlet` 的替身，且 `FakeKeepAliveOutlet` 里**硬编码**了 `if (pathname === '/portal') return <div data-testid="portal-page" />`。这意味着「/portal 命中 PortalPage」这条断言**实际验证的是替身自己，而非真实 `PAGE_MAP`**。若有人误删 `keep-alive-outlet.tsx` 的 `'/portal'` 条目，`router.test.tsx` 仍会全绿。
  现有 `nav-registration.test.ts:18` 导入了真实的 `resolvePageComponent`，是验证 `PAGE_MAP` 的正确位置——建议把 `/portal` 一并纳入该用例。**不影响本次交付判定**（源码两处均正确），记为测试改进项。

### 3.4 Return Path（`56de16a` + `e5cdad1`）— 确认

`src/lib/nav/return-path.ts:38-48` 有真正的**运行时校验**，不是裸取：

```ts
const state = location.state as { from?: unknown; fromLabel?: unknown } | null | undefined;
if (state && typeof state === 'object' && typeof state.from === 'string' && state.from.startsWith('/')) {
  return { from: state.from, fromLabel: typeof state.fromLabel === 'string' && state.fromLabel
    ? state.fromLabel : DEFAULT_RETURN_PATH.fromLabel };
}
return DEFAULT_RETURN_PATH;
```

- **手输 URL 会不会崩**：不会。四类脏state 全覆盖 —— `null`/`undefined`（`state &&` 短路）、非对象（`typeof !== 'object'`）、字段缺失（`typeof state.from === 'string'`）、`from` 非绝对路径（`startsWith('/')`，同时挡住 `javascript:` 之类的注入）。全部回落 `/task/pending`。
- **面包屑渲染**：`process-shell.tsx` 用 `useReturnPath()` 驱动。
- 三个用例覆盖「无 state 回落」「state.from 生效」「非法 state 不抛错」。

### 3.5 批完自动续下一条（`9a1b5b8`）— 确认

**你特别提示的「mock 返回同一条数据」问题，我查了：测试用 `mockResolvedValueOnce` 做了差异化，没有这个问题。**

`task-list-page.test.tsx:116-121`：

```ts
.mockResolvedValueOnce({ page: 1, size: 20, total: 2, list: two })
.mockResolvedValue({ page: 1, size: 20, total: 1, list: [two[1]] });   // 处理后剩一条
```

`task-list-page.test.tsx:141-145`：

```ts
.mockResolvedValueOnce({ page: 1, size: 20, total: 1, list: [sampleTask] })
.mockResolvedValue({ page: 1, size: 20, total: 0, list: [] });          // 处理后清空 → 耗尽
```

**队列耗尽态可达**：
- `task-list-page.tsx:135` `const queueDrained = doneCount > 0 && items.length === 0 && !loading && !error;` → `:183` 渲染完成态，给出「返回工作台」「查看已办」两个出口（`:191`/`:194`）。
- `process-shell.tsx:50` 独立维护 `queue` 数组，`:246` `doneCount > 0 && queue.length === 0` →给出去向（`:256` 查看已办）。跳转时带 return path（依赖 P0-6），闭环。
- **注意（非缺陷）**：队列范围限于当前页 / 前 20 条，代码注释已写明，避免误认为全局队列。

### 3.6 6 个共享抽象（`e40590b`）— 确认，全部真实接入

逐个 grep 非测试文件，**全部有真实消费方，无「建而不用」**：

| 抽象 | 消费方（非测试） |
|---|---|
| `EmptyState` | `inbox-page` / `my-processed-page` / `my-sent-page` / `task-list-page` / `agent-page-shell` |
| `PaginationFooter` | `inbox-page` / `my-processed-page` / `my-sent-page` / `task-list-page` |
| `UnreadDot` | `header-toolkit` / `message-board` / `inbox-page` |
| `PriorityBadge` | `task-board` / `task-list-page` |
| `wfInstanceId` | `task-board` / `my-processed-page` / `process-shell` / `task-list-page`（消掉 3 处重复 `JSON.parse`） |
| `return-path` | `task-board` / `my-processed-page` / `my-sent-page` / `process-shell` / `task-list-page` |

### 3.7 「有没有把用例改绿来迁就实现」— 审查结论：没有

重点复查了从 `it.todo` 转成`it` 的用例，**改得对**：

- `router.test.tsx`：「不在 AppLayout 内」→ 断言祖先链含 `app-layout`。**方向正确**（把"缺席"改成"在场"，锁住了归位结果）。同时诚实地保留了 1 条 `it.todo`（`/change-password` 是否也移入 AppLayout 需产品确认）——**没有为了凑绿把待确认项硬转成断言**。
- `portal-page.smoke.test.tsx`：顶栏唯一性从「至多一个」改为逐个断言不存在。**这个改法尤其正确**——旧写法 `expect(headerCount).toBeLessThanOrEqual(1)` 在归位前（两套壳）也能通过，锁不住回归；逐个断言才真正锁住。
- `header-toolkit.test.tsx`：新增「57 条未读不被 `size:4` 截断」的核心回归用例，正对准原缺陷。

**唯一的可疑改动，我查了，判定为正当**：`useChat.test.ts`（未提交）把 `advanceTimersByTimeAsync(200_000)` 改为 `GENERATE_SAFETY_TIMEOUT_MS - 60_000`。核对了 `useChat.ts:38` 的常量值为 **1_860_000**（31 分钟）：

```ts
- await vi.advanceTimersByTimeAsync(200_000);   // 旧的：只推进 200s，远不到 1_860s 上限
+ await vi.advanceTimersByTimeAsync(GENERATE_SAFETY_TIMEOUT_MS - 60_000);
```

旧写法推进 200s + 65s = 265s，**根本触不到 1_860s 的硬上限**，这个用例其实一直在空跑、什么都没断言。改成引用常量后真正推到上限边界，断言 `isGenerating === false` 才有效。**这是修好了一个假绿用例，不是把红改绿。** 判定：正当。

---

## 4. 后端 4 个缺陷逐条核实

### 4.1 B-1 越权修复 — ⚠️ 有问题（P1，安全）

**校验本身是对的**，`TaskService.java:233`：

```java
if (operatorId == null || !operatorId.equals(task.getAssigneeId())) {
    throw new BusinessException(ResultCode.FORBIDDEN, "无权处理该代办");
}
```

关联用例 3 条全过：`nonAssigneeHandleForbidden`、`nonAssigneeTransferForbidden`、`nullOperatorForbidden`，且都断言了「状态/处理人未被改动」。

**合法系统自动流转路径误杀排查（你要求的重点）**——我把所有 `handleTask(` 调用点全查了：

| 调用点 | 传入的 operatorId | 是否合法 | 结论 |
|---|---|---|---|
| `TaskController.java:75` | `@RequestParam(required=false)` | 登录用户 | 正常 |
| `ProcessService.java:248` | `completeTask` 的 `operatorId` 参数 | **可为 null** | **⚠️ 误杀** |
| `TaskService.java:194`（`batchHandle`） | `@RequestParam(required=false)` | 登录用户 | 正常 |

**不存在 `@Scheduled`/`@Async` 自动流转调用 `handleTask`**——唯一的 `@Scheduled` 在 `ExecutionTaskScheduler.java:26`，它不碰 `handleTask`。所以「系统自动流转误杀」这个具体担心不成立。

**但发现了另一个更隐蔽的误杀**——`ProcessService.java:162` 的守卫是：

```java
if (operatorId != null && !operatorId.equals(wfTask.getAssigneeId())) {
    throw new BusinessException(ResultCode.FORBIDDEN, "无权处理该流程任务");
}
```

`operatorId != null` 前置条件意味着**流程审批显式放行 null 操作人**（`WfProcessController.java:57` 的 `operatorId` 同样是 `required = false`）。于是 `completeTask` 放行 → 走到 `syncLinkedSysTask(..., operatorId=null)` → `handleTask` 撞上 `:233` 的 `operatorId == null` → 抛 FORBIDDEN。

**这个 FORBIDDEN 被 `ProcessService.java:250` 的 `catch (BusinessException e)` 吞掉，只打一条 warn 日志**——所以流程审批照样返回 200，但**关联代办永远同步不上，B-2 的修复被 B-1 静默废掉**。

#### 复现步骤（我已实证，非推断）

临时新建 `QaReproNullOperatorRejectTest`（照抄 `ProcessServiceIntegrationTest` 的建流程写法以保证 DTO 签名正确），跑：

```powershell
.\mvn.ps1 -pl mis-taskflow test "-Dsurefire.forkCount=0" "-Dtest=QaReproNullOperatorRejectTest"
```

真实输出：

```
>>> QA REPRO RESULT: instance=TERMINATED sys_task=PENDING
[ERROR] Tests run: 1, Failures: 1, Errors: 0, Skipped: 0
org.opentest4j.AssertionFailedError: BUG：operatorId=null 时驳回未同步代办，代办停留在 PENDING
  ==> expected: <REJECTED> but was: <PENDING>
```

`instance=TERMINATED` 但 `sys_task=PENDING`——**流程已终止，用户却在「我的待办」里永远看到一条待办**，正是 B-2 要消灭的现象。**复现文件已删除，业务代码零改动。**

（附带确认一个隐患：`AUDIT_TENANT` 注释说切面无 `LoginUser` 时 tenantId兜底为 1，恰好与测试常量 1 相同。这意味着这些审计用例的 `tenantId` 过滤**没有真正起到隔离作用**，断言偏弱。不影响本次判定，记为改进项。）

### 4.2 B-2 REJECT 同步 — 主路径确认，衍生失效

**传 `action` 变量的改动确认**（`ProcessService.java:248-249`）：

```java
taskService.handleTask(tenantId, wfTask.getSysTaskId(),
        new HandleTaskRequest(action, comment, null), operatorId);
```

**REJECT 路径确实能走到**：`:176` 的 REJECT 分支内明确调用了 `syncLinkedSysTask(...)`（不再是只在 APPROVE 分支）。用例 `rejectSyncsLinkedSysTask` 通过（0.14s）。

**状态是否置对 REJECTED（而非 APPROVED）**：确认。`TaskService.java:127-130`：

```java
case "APPROVE", "COMPLETE" -> TaskflowStatus.Task.APPROVED;
case "REJECT" -> TaskflowStatus.Task.REJECTED;
```

用例断言 `"REJECTED"` 且通过（携带合法 operatorId 时）。

**但**：如 §4.1 所证，`operatorId == null` 时该修复失效。**B-2 本身逻辑正确，与 B-1 组合后产生缺陷。**

### 4.3 B-3 并发悲观行锁 — 确认，测试真实有效

逐条回答你的四个重点：

**① 行锁是否在同一事务内** — 是。`handleTask`（`:118`）与 `transferTask`（`:156`）都是 `@Transactional`，`requireTask` 在其内调用 `findByIdForUpdate`。锁持有到事务提交/回滚。

**② `transfer` 与 `act` 是否同一把锁** — 是。两者都走同一个 `requireTask(...)` → 同一个 `findByIdForUpdate(taskId)`。这是修复的关键：只有共用锁才能避免「任务已办但 assignee 是新人」的错配。

**③ `TaskConcurrencyIntegrationTest` 是否用了类级 `@Transactional`** — **没有，正确**。类上只有：

```java
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "MIS_DB_TEST", matches = "true")
class TaskConcurrencyIntegrationTest {
```

全部改用 `TransactionTemplate` 显式开真实事务（`:87`、`:141`、`:179`、`:192`）。类注释还专门解释了为什么不能用类级事务。**这个坑避开了。**

**④ 测试是否真有效（不是假绿）** — **真有效，三重证据**：

1. **耗时证明**：`pessimisticLockBlocksUntilCommit` 耗时 **2.133s**。该用例主体是 `Thread.sleep(2000)` + 断言「锁未释放时他线程不应完成」。若行锁没生效，线程 B 会立刻完成、断言在2s 前就失败，耗时会掉到 0.2s 量级。2.133s 说明 B **确实被阻塞了整整 2 秒**才放行。这是「锁真的生效」的硬证据，不靠线程交错运气。
2. **用例设计确定性**：该用例不依赖两线程谁先跑——线程 A 显式 `findByIdForUpdate` 并 `await(30s)` 持锁，线程 B 必然阻塞。
3. **另两个用例覆盖语义**：`concurrentHandleExactlyOnce`（恰好一个成功）、`concurrentHandleVsTransferNoMismatch`（处理 vs 转办不错配，且断言 `unexpected == 0` 即不得出现行锁超时/死锁）。

`concurrentHandleExactlyOnce` / `concurrentHandleVsTransferNoMismatch` 耗时 0.269s / 0.211s 属正常——它们靠「后到者必然看到已提交终态而被拒」判定，不依赖 sleep。

### 4.4 B-4 审计 — 无污染、diff 非空，但**单次动作 2 条记录**

**`AuditContext.snapshot()` / `restore()` 机制正确**。切面 `BusinessOperationAspect.java:42` 拍快照，`:56` 恢复（而非无条件 `clear()`）。嵌套场景 `completeTask → handleTask` 的隔离经`nestedAuditContextsAreIsolated` 验证通过（0.175s）：

- 外层 `WF_INSTANCE` 的 `before` 含 `RUNNING`（未被内层覆盖成代办状态）✅
- 外层 `diff` 非空 ✅
- 内层 `SYS_TASK` 的 `before` = `PENDING`、`after` = `APPROVED` ✅

**`transferTask` 补审计了吗** — **补了**。`TaskService.java:158-160` 新增 `@BusinessOperation(type = "ASSIGN")`，并在 `:162`/`:175` 设置 before/after（含 assigneeId 变更）。用例 `transferWritesAuditWithAssigneeDiff` 通过（0.048s），断言 `ASSIGN` 类型 + before 含原处理人 + after 含新处理人 + diff 含 `assigneeId`。

#### ⚠️ 需要你裁决：审计是**双份**

你说「我要求单份，如果是双份这是 bug」。实测**确实是 2 条**：`nestedAuditContextsAreIsolated` 自己就断言了 `outer.size() == 1` **且** `inner.size() == 1` —— 一次 `completeTask` 产生 2 条 `sys_audit_op`（`WF_INSTANCE` 1 条 + `SYS_TASK` 1 条）。

**但我倾向认为这不是缺陷，理由如下，请你确认**：

- 两条记录的 `businessType` 不同（`WF_INSTANCE` vs `SYS_TASK`），业务语义是**两个不同对象**的状态变更，不是同一事件的重复落库。
- 两条 `diff` 都非空且各自正确，不存在空壳/污染记录。
- 若强行合并成一条，必然丢失「关联代办也被同步关闭」这一事实——反而降低可追溯性。

**若你仍要求严格单份**，修法是给内层 `handleTask` 上下文打个「已被外层覆盖」的标记让切面跳过内层记录，但请一并确认：合并后是否接受丢失代办维度的审计。我按你的裁决执行，**未擅自改动**。

---

## 5. 我做过的破坏性动作

仅两处，均已回滚/清理：
1. 新建临时复现测试 `QaReproNullOperatorRejectTest.java` → 验证后 `rm` 删除。
2. 新建日志 `qa-repro.log` → 已删除。

**业务代码、测试代码（交付物）、配置文件：零改动。** 工作区未提交部分与验收前完全一致。

---

## 6. 移交 Engineer 的待办（唯一阻断项）

| # | 位置 | 问题 | 建议方向 |
|---|---|---|---|
| 1 | `TaskService.java:233` + `ProcessService.java:162`/`:248` | `handleTask` 拒绝 `operatorId == null`，但 `completeTask` 放行 null 并把它传给 `syncLinkedSysTask`，FORBIDDEN 被 `catch` 吞掉 → **驳回时代办停在 PENDING** | 三选一，建议第1：<br>① `syncLinkedSysTask` 在 `operatorId == null` 时改用 `wfTask.getAssigneeId()` 回填（流程任务已有真实审批人，比 null 更可信）<br>② `completeTask` 守卫去掉 `operatorId != null` 前置，与 `handleTask` 对齐<br>③ 至少让 `catch` 块区分 FORBIDDEN 并告警，避免静默不一致 |

**强烈建议同时补一条回归用例**（当前 10 条新测试无一覆盖此组合）：
`operatorId == null` 时 `completeTask("REJECT")` →断言 `sys_task.status == REJECTED`。

附带两个**测试改进项**（不阻断交付）：
- `router.test.tsx:37` 的 `FakeKeepAliveOutlet` 硬编码了 `/portal`，建议把真实 `PAGE_MAP` 校验并入 `nav-registration.test.ts`（它已正确导入 `resolvePageComponent`）。
- 审计用例的 `AUDIT_TENANT = 1` 与切面兜底值相同，tenant 过滤未真正隔离断言。

---

## 7. 一句话总结

前端 6 条**全部确认通过**（含你担心的抽屉空详情、门户双注册、脏 state、队列耗尽四个点，均已实证）；后端 92/0/0、**Skipped 确认为 0**、Flyway 零改动、无敏感文件；B-3 并发测试**真实有效**（2.133s 阻塞耗时是硬证据，非假绿），B-4 审计**无污染且 diff 非空**、转办已补审计。唯一阻断项是 **B-1 与 B-2 的组合缺陷**：null operatorId 下驳回不同步代办，已用复现用例实证 `instance=TERMINATED` 而 `sys_task=PENDING`。