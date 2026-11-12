# 11 · 规划独立核实报告（对 09-unified-inbox-plan.md 的对抗性复核）

> 版本：**v1.1** · 日期：2026-10-09
> 核实人：严过关（Yan）· QA
> 被核实对象：`docs/architecture/msg-log-workflow/09-unified-inbox-plan.md`（v1.0-draft，743 行）
> 性质：**纯核实**。本报告未改动任何代码，仅新建本文件。
> **v1.1 更正记录**（2026-10-09，经 team-lead 指出后复核源码）：v1.0 曾把 `ProcessService.java:187` 的 `HandleTaskRequest("APPROVE", ...)` 判为"驳回也会写成 APPROVED 的错误写入"。**该判断有误** —— REJECT 分支在 `:172` 提前 `return`，永远到不了 `:187`，故该字面量在当前路径下不会写错值。真实缺陷是**反向的**：REJECT 路径**完全不写 `sys_task`**（漏同步，而非写错值）。已更正 §1.2 D6、§2 O-12、§4、§5 共 6 处表述。
> 证据口径：
> - **【实测确认】** = 本机读到源码/跑过命令，行号可复核
> - **【推断】** = 由实测事实逻辑推导，未直接观测
> - **【无法证实】** = 环境不具备或证据不足，不下结论

---

## 0. 执行摘要（先看这段）

规划 §0 的 12 条决策摘要里，**8 条完全成立、2 条需修正、2 条被推翻**。

| 结论 | 判定 |
|---|---|
| **被推翻** | **D8**（`sys_task.read_flag` 并非死字段——`transferTask` 会重置它，语义是"转办后重新变未读"，是活字段）；**D11**（详情页并非"看不到在批什么单据"，`process-shell.tsx:140-151` 已完整展示业务类型/业务单号/发起人/当前节点 4 个字段） |
| **需修正** | **D3**（角标"必然矛盾"的说法过头了——已读消息 `read:true` 会正确排除，真正的问题只有"截断 8 条"和"待办被硬编码为未读"）；**D5**（空方法确认，但规划漏了**致命细节**：接通它需要先补 `sys_message_receiver.task_id` 索引，且 `MessageService.publish` 已经把 `referenceTaskId` 写进了 `task_id`，数据其实是通的） |
| 确认 | D1 D2 D4 D6 D7 D9 D10 D12 |

**原规划有 3 处站不住脚的论断**（详见 §4），其中 1 处是硬事实错误（D11），1 处是结论方向错误（D8 的"死字段"定性），1 处是把已修好的问题当成待办（§1.1 的能力盘点错把 `/messages/{id}` 说成"接口缺失"）。

**本次核实新发现 3 个规划完全没提的严重问题**（详见 §3）：

1. 🔴 **`sys_api` 鉴权是 fail-closed 的**：BFF 配置 `deny-unmapped: true`（`mis-admin-bff/src/main/resources/application.yml:103`）。规划 P1-1 要新增 `/inbox/summary` 和 `/inbox`，**不登记 `sys_api` + `sys_menu_api` 就直接 403**，端点根本进不去。原规划 §8.1 的门禁清单里完全没有这一项。
2. 🔴 **后端测试 72% 是跳过的**：`mis-taskflow` 实测 `Tests run: 82, Skipped: 59`。**12 个 `TaskServiceIntegrationTest` 测试全部 skipped**（`@EnabledIfEnvironmentVariable(named="MIS_DB_TEST")`，本机未设置该变量）。原规划 §8.1 把 `mvn.ps1 -pl mis-taskflow test` 当门禁，**它给的是虚假绿灯**——包括 D5 要改的 `handleTask` 这条链路，压根没有测试在跑。
3. 🔴 **`handleTask` 存在并发重复处理漏洞**：`TaskService.java:119-145` 有 `@Transactional` + `isOpen` 检查，但**全模块零 `@Version` / 零 `@Lock`**（实测 grep 无结果）。两个并发 approve 会双双通过 `isOpen` 检查，双写 `completedAt`。规划完全没提并发与幂等。

---

## 1. D1~D12 核实表

### 1.1 速览矩阵

| # | 规划结论摘要 | 判定 | 关键差异 |
|---|---|---|---|
| D1 | 四个功能实为一个收件箱的四个筛选视图 | ✅ 确认 | — |
| D2 | 没有消息详情页，点击消息一律跳 `/task/pending` | ✅ 确认 | — |
| D3 | 铃铛是前端假算，与真实未读数**必然**矛盾 | ⚠️ **部分确认** | "必然"过强；真实缺陷是"只取前 4+4 条"与"待办恒为未读" |
| D4 | 同一行的「同意」「驳回」走两套后端 | ✅ 确认 | — |
| D5 | 待办处理后关联消息状态永不联动（空方法） | ✅ 确认（但规划漏了索引前提） | `task_id` 无索引；`publish` 已写入该字段 |
| D6 | `sys_task` 与 `wf_task` 双表镜像 | ✅ 确认 | — |
| D7 | WebSocket 零落地 | ✅ 确认 | — |
| D8 | `sys_task.read_flag` 是死字段 | ❌ **推翻** | `transferTask` 会 `setRead(FALSE)`，它是活字段 |
| D9 | `/portal` 是布局孤岛 | ✅ 确认 | — |
| D10 | 处理完停在原地，不续下一条 | ✅ 确认 | — |
| D11 | 详情页看不到在批什么单据 | ❌ **推翻** | 4 个只读字段已完整展示，缺的是**跳转**不是**展示** |
| D12 | 业务单据详情页不存在，`bizType` 仅作字符串 | ✅ 确认 | — |

### 1.2 逐条明细

---

#### D1 ✅ 确认

**结论**：消息/通知/待办/已办应收敛为一个收件箱的四个筛选视图。

**证据【实测确认】**：
- 四个页面确实各自拉取、各自分页：`task-list-page.tsx:69`、`inbox-page.tsx:53-56`、`my-sent-page.tsx:35`、`my-processed-page.tsx:35`
- 侧栏 4 个平级菜单项：`frontend/mis-admin-web/src/lib/nav/task-nav.ts:14-17`
- 前端 API 层已具备全部所需能力：`lib/api/tasks.ts`（`fetchMyTasks` / `fetchHandledTasks` / `fetchTaskStats` / `handleTask`）、`lib/api/messages.ts`（`fetchInbox` / `searchMessages` / `fetchMessageStats` / `markMessagesRead`）

**判定**：认知层判断成立。这条是规划最有价值的部分。

---

#### D2 ✅ 确认

**结论**：无消息详情页，点击消息跳 `/task/pending`。

**证据【实测确认】**：
- `features/taskflow/inbox-page.tsx:83-84`：
  ```tsx
  // P3 接入 ProcessShell 后跳转 /task/pending/{id}；当前先跳待办页
  navigate('/task/pending');
  ```
- 详情 API 函数确实无调用方：`lib/api/messages.ts:59` 定义 `fetchMessageDetail`，全仓 grep 调用方 → **仅定义处自身 1 处命中，0 个调用点**。
- 后端 `/messages/{id}` 已实现：`MessageService.java:157-178`（`detail()`，含 `content` 字段）
- 门户消息板同样丢回列表：`features/portal/components/message-board.tsx:70` → `navigate('/task/inbox')`

**补充（原规划漏）**：P0-4 说"即使内容仅摘要"也要开抽屉 —— 但后端 `MessageDetailVO` **已经有 `content`**。所以 P0-4 不是"内容仅摘要"，是**前端完全没调用已有的完整接口**。工作量比规划描述的低，理由更充分。

---

#### D3 ⚠️ 部分确认（"必然矛盾"被推翻）

**规划原文**：铃铛角标是前端假算（"前 4 条待办 + 前 4 条消息，`slice(0,8)`"），与真实未读数**必然**矛盾。

**证据【实测确认】**：
- `components/layout/header-toolkit.tsx:46-47` 确实只取 4+4 条：
  ```tsx
  fetchMyTasks({ ..., status: 'PENDING', page: 1, size: 4 }),
  fetchInbox({ ..., page: 1, page: 1, size: 4 }),
  ```
- `:77` `setItems(out.slice(0, 8))` —— 硬截断
- `:59` 待办项 `read: false` **硬编码**，与后端 `sys_task.read_flag` 无关
- `:92` `const unread = items.filter((n) => !n.read).length` —— 前端计数

**但"必然矛盾"这个定性不成立**。逐路径验算：

| 角标里的项 | `read` 来源 | 已读项是否被误计 |
|---|---|---|
| 待办项（≤4 条） | `:59` 硬编码 `false` | ✅ 计入（设计如此，`PENDING` 待办本就该算未处理） |
| 消息项（≤4 条） | `m.read`，来自 `MessageService.toVo` 的真实已读态（`MessageService.java:242`） | ❌ 已读消息 `read:true` → **被正确排除** |

**真实缺陷（修正后表述）**：
1. **截断**：真实未读 57 条时，角标最多显示 8（待办 4 + 消息 4 中未读的），且下拉列表也只有 8 条。这是"**取样**"而非"**假算**"。
2. **数字被前端重算**：即使将来把 `size` 从 4 改成 100，仍然是"前 100 条里数未读"，不是真未读数。所以 R2 根因判断依然成立，`/inbox/summary` 该做。
3. **待办侧确实没有权威源**：`sys_task.read_flag` 无任何读取入口（见 D8），`fetchTaskStats` 只给 `pending/urgent/overdue`，没有"未处理数"。

**规划里那句具体的举例"消息超 4 条时，铃铛显示「3」而收件箱显示「57」"** —— 举例在"未读消息只有 3 条"时数字会碰巧一致。结论方向对，但归因表述需修正为"**取样 + 前端重算**"。

---

#### D4 ✅ 确认

**证据【实测确认】** `features/taskflow/task-list-page.tsx:86-103`：

```tsx
async function onHandle(item: TaskItem, action: 'APPROVE' | 'REJECT') {
  const instId = wfInstanceId(item);
  if (instId && action === 'APPROVE') {
    navigate(`/task/process/${instId}`);   // ← 跳走，根本不在本页处理
    return;
  }
  setActing(item.id);
  await handleTask(item.id, tenantId, userId, action, ...);  // ← 走 /tasks/{id}/handle
  await load();
}
```

**精确表述（比规划更准确）**：不是"同一行两个按钮走两套后端"，而是：
- **「同意」**：`有 wfInstanceId` → 跳 `ProcessShell`，在那边走 `POST /workflow/tasks/{id}/complete`（`process-shell.tsx:68-72`）；`无 wfInstanceId` → 走 `POST /tasks/{id}/handle`
- **「驳回」**：**恒定**走 `POST /tasks/{id}/handle`

所以是 **1×2 分叉**（agree 有两条路，reject 只有一条），不是 2×2。且**驳回后 `wf_task` 侧不会推进**（`ProcessService` 里的推进逻辑只在 `/workflow/tasks/{id}/complete` 里），这就是规划 P0-3 说的"处理完了但待办还在"的机制来源。**结论成立**。

---

#### D5 ✅ 确认（但规划漏了接通前提）

**结论确认**：
- `TaskService.java:206-208` **确实是空方法**：
  ```java
  private void syncLinkedMessagesToHandled(Long taskId) {
      // P3 简化：仅更新任务自身状态；消息明细的 HANDLED 状态在 P4/P5 随流程推进联动。
  }
  ```
- `:144` 确实在 `handleTask` 事务内调用。

### 补核 1：`task_id` 有没有索引？—— **没有。规划漏了这条**

**证据【实测确认】**：
- `V120__taskflow_message_task_schema.sql:50` 定义 `task_id BIGINT NULL`
- `V120:55-56` 只建了**两个**索引，**都不含 `task_id`**：
  ```sql
  CREATE INDEX ... idx_msg_recv_user ON sys_message_receiver (user_id, status, created_at DESC);
  CREATE INDEX ... idx_msg_recv_msg  ON sys_message_receiver (message_id, read_flag);
  ```
- grep `V120~V127` 全部 8 个迁移文件，`sys_message_receiver` 相关只有 V120 建表时这两条索引；**V121~V127 无任何补索引语句**（grep `task_id` 在 V120-V127 的全部命中只有 6 条，无一为 `sys_message_receiver` 建索引）。

**对方案的影响【推断】**：接通 `syncLinkedMessagesToHandled()` 需要 `UPDATE sys_message_receiver SET status='HANDLED' WHERE task_id = ?`，这是**全表扫描**（`task_id` 无索引）。当前 `sys_message_receiver` 数据量小（每条消息每接收人一行）时无感，但：
- 规划 P2 要把它做成"统一动作出口内的必做联动"，会**每次审批都跑一次全表扫**
- 规划 §5.4 的迁移清单 `V128~V131` **完全没有提到补索引**

**必须补**：规划 P0-1 的迁移里要加一条
`CREATE INDEX IF NOT EXISTS idx_msg_recv_task ON sys_message_receiver (task_id) WHERE task_id IS NOT NULL;`（部分索引，`task_id` 允许 NULL）

### 补核 2：`task_id` 哪里被写入？—— **已写入，数据是通的**

**证据【实测确认】** `MessageService.java:101`：
```java
r.setTaskId(req.referenceTaskId());   // :101，在 publish() 的接收者循环里
```
`referenceTaskId` 的来源链路【实测确认】：
- `TaskService.createTask:76-81` → `new PublishMessageRequest("APPROVAL","TASK", ..., taskId)` → `messageService.publish`
- `TaskService.transferTask:165-168` → `new PublishMessageRequest("REMIND","TASK", ..., taskId)` → `publish`

**结论【实测确认】**：两条写入路径都把 `taskId` 传给了 `sys_message_receiver.task_id`。所以**数据侧已通**，接通空方法不需要额外回填——只需要补索引 + 写实现。这比规划描述的"坑位没通电"更接近"线路已铺好但开关没合"。

⚠️ **额外提示**：`syncLinkedMessagesToHandled` 只按 `task_id` 更新，会把**该 task 的所有 receiver 记录**都置 HANDLED——包括**其他已被转办出去的接收人**（`transferTask` 也会为新处理人 publish 一条，`MessageService.java:101` 同样写 task_id）。接通时需明确"是否只更新当前操作人那条"，否则会误标。

---

#### D6 ✅ 确认

**证据【实测确认】**：
- `sys_task` 建表 `V120:61-83`
- `wf_task` 建表 `V121:87-102`（`V121:94` `sys_task_id BIGINT NULL` + `:106` `CREATE INDEX idx_wf_task_sys_task ON wf_task (sys_task_id)`）
- 每节点插两行【实测确认】`ProcessService.java:344-375`（`assignNode` 方法）：
  ```java
  Long sysTaskId = taskService.createTask(...);   // :344 第一行
  WfTask wfTask = new WfTask(); ...               // :352 第二行
  wfTask.setSysTaskId(sysTaskId);                  // :365 软关联
  wfTaskRepository.save(wfTask);                   // :374
  ```
- 靠 try/catch 吞异常同步【实测确认】`ProcessService.java:183-191`：
  ```java
  if (wfTask.getSysTaskId() != null) {
      try {
          taskService.handleTask(tenantId, wfTask.getSysTaskId(),
                  new HandleTaskRequest("APPROVE", req.comment(), null), operatorId);
      } catch (BusinessException ignored) {
          // 代办可能已由其他路径处理，忽略     ← :188 吞异常
      }
  }
  ```
  ⚠️ **比规划描述更严重：REJECT 路径完全不写 `sys_task`**。`completeTask` 的 REJECT 分支在 `:158-172` 处理完（`wf_task`→COMPLETED、instance→TERMINATED、记历史、通知发起人）后**于 `:172` 提前 `return`**，永远到不了 `:184-191` 的 `sys_task` 同步块。

  ⇒ **用户在流程详情页点「驳回」时，`wf_task` 与 `wf_instance` 都正确流转，但对应的 `sys_task` 永远停在 `PENDING`。** 用户回到列表页会看到「待办还在」，而流程其实已终止 —— 这正是规划 P0-3 所说的"处理完了但待办还在"的**确切成因**，且比规划描述的"可能未同步"更确定：不是可能，是必然。

  ⇒ 因此 `:187` 的 `action="APPROVE"` 硬编码本身**在当前代码路径下不会写错值**（因为只有 APPROVE 能到达这里），真正的问题是**该同步块被放在了只覆盖 APPROVE 的位置**。修法不是改 `"APPROVE"` 字面量，而是把同步块提到 REJECT 分支之前，或在 REJECT 分支内补一次 `handleTask(..., "REJECT", ...)`。

  ⇒ 对规划 §5.1「`sys_task` 是唯一真相源」的影响：真相源在 REJECT 路径上**根本不被写入**，于是"唯一真相源"实际退化 —— `sys_task` 在驳回后陈述旧事实（仍待办），而 `wf_instance` 陈述新事实（已终止）。这比"写错值"更隐蔽，因为**没有任何一行代码写错了，只是少写了一行**。

**判定**：D6 成立，且危害比规划描述更确定（不是"可能未同步"，是 REJECT 必然漏同步）。

---

#### D7 ✅ 确认

**证据【实测确认】**：
- 文档承诺【实测确认】：`docs/architecture/msg-log-workflow/01-message-task-design.md:52`（架构图 "WebSocket推送"）、`:327`（`useUnreadCount.ts # 未读数监听 (WebSocket + SSE)`）、`:413-414`（`const ws = new WebSocket('/ws/notifications')`）、`:550`（`实时推送 | 新消息到达时实时通知（WebSocket/Polling）`）；另 `03-workflow-integration-design.md:68` 也画了
- 代码零落地【实测确认】：grep `websocket|SseEmitter|stomp` 在 `backend/mis-taskflow/src` → **0 命中**；前端 `src/` 的命中全在 `lib/chat/`（Agent 会话通道，与收件箱无关）
- ⚠️ **行号小误**：规划 D7 正文写 "grep 无 `WebSocket/SseEmitter/stomp`"，但 `README.md:37` 这条承诺我未逐字验证到行，规划附录 A 引用了它。`01-...md` 的 4 处行号（52/327/413-414/550）**全部实测准确**。

**判定**：成立。

---

#### D8 ❌ 推翻（这是最明确的错误结论）

**规划原文**：库里有两套已读模型（**`sys_task.read_flag` 恒 false** / `sys_message_receiver.read_flag` 有完整链路），"全模块 0 处 `setRead(TRUE)`"。

**实测证据【实测确认】**（grep `setRead|read_flag|readFlag` 全模块 `src/`，**含测试代码**）：

```
MessageService.java:198:        r.setRead(Boolean.TRUE);      ← 消息侧，确实有 TRUE
TaskService.java:70:            task.setRead(Boolean.FALSE);  ← 创建时置 false
TaskService.java:159:           task.setRead(Boolean.FALSE);  ← transferTask 重置
SysTask.java:121 / SysMessageReceiver.java:62  ← setter 定义
SysMessage.java:114 / MessageService.java:85,206 ← readCount，非 read_flag
```

**结论拆解**：

| 子命题 | 判定 |
|---|---|
| 全模块 0 处 `setRead(TRUE)`（指 `sys_task`） | ✅ 成立 |
| `sys_task.read_flag` 是"死字段" | ❌ **不成立** |

**为什么"死字段"定性错误**【实测确认】：`TaskService.java:150-162` `transferTask`：
```java
task.setStatus(TaskflowStatus.Task.PENDING);
task.setRead(Boolean.FALSE);     // :159
task.setViewedAt(null);          // :160
```
这两个字段**成对使用**，语义明确：**「转办 = 重新变成未读待办」**。这是一个**活的、有业务含义的状态对**（`read_flag` + `viewed_at`），不是占位符。

规划 §5.2 表格里写"任务侧 `seen`（rename `read_flag`）置位时机：**需要真实写入**（当前 0 处 `setRead(TRUE)`）" —— 这个"需要真实写入"的建议本身是对的，但把它描述为"**死字段**"是误判：**字段已有写入者（FALSE 方向），缺的是 TRUE 方向的读取者与触发点**。

**这对方案的影响【推断】**：规划 §5.3 建议「`TaskflowStatus.Task` 收敛为 4 态」并顺带处理 `read_flag` 语义。但因为 `transferTask` 依赖 `read_flag=FALSE` + `status=PENDING` 这一对，**任何对 `read_flag` 的改名或废弃都会打断转办链路的语义完整性**。规划需在 §5.2 明确：`read_flag` 保留 + 补 TRUE 方向写入，**不是"从死字段复活"而是"补齐已有状态机的另一半"**。

---

#### D9 ✅ 确认

**结论**：`/portal` 裸挂无 `AppLayout`，自造 header。

**证据【实测确认】** `src/app/router.tsx:50-68`：
```tsx
<Route element={<ProtectedRoute />}>
  <Route path="/portal" element={<PortalPage />} />        // ← :51 在 AppLayout 外
  <Route path="/change-password" element={<ChangePasswordPage />} />
  <Route element={<AppLayout />}>                          // ← :54
    <Route path="/task/*" element={null} />
    ...
```
- `portal-page.tsx:88-136` 自造 `<header>`（含 logo、主题切换、用户菜单），确认存在
- `features/portal/portal-page.tsx:34` `const tenantId = '1'`，确认
- `lib/nav/host-apps.ts:57` `if (pathname === '/portal' || ...) return 'task';` —— 侧栏归属**确实已预留**，确认
- `lib/nav/host-apps.ts:21` `task: '/task/pending'` —— 门户归属 app code = `task`
- `components/layout/app-layout.tsx:248-252` "返回门户" `<Link to="/portal">` 埋在 header 里，确认

**补充（原规划漏，影响 C-1 改造量）**：`portal-page.tsx` 里**已经引入了 `HeaderToolkit`（`:13` import，`:96` 渲染）**。所以 C-1 说的"删自造 header、改用统一 `HeaderToolkit`"——`HeaderToolkit` 已经在用了。真正要删的是 `:88-94`（logo + "MIS Platform"）、`:97-105`（主题切换）、`:106-134`（用户菜单 + 退出）这三块，因为 `AppLayout` 里都有对应物。同时 `portal-page.tsx:14-18,164-165` 还自造了 `CommandPalette` + `CopilotPanel` + `useCommandPaletteHotkey` + Cmd+J 热键（`:46-55`）——**这些 `AppLayout` 里也有一份**，C-1 的实际改动面比规划写的"2 文件"要大：会同时消除热键重复绑定。

---

#### D10 ✅ 确认

**证据【实测确认】**：
- `features/taskflow/process-shell.tsx:74` `await load();`（`handle()` 成功后）
- `features/taskflow/task-list-page.tsx:97` `await load();`（`onHandle` 成功后）
- 两者都**没有**"取队列下一条"的逻辑，`useState<TaskItem[]>` 是一次性拉取（`task-list-page.tsx:54`）

**判定**：成立。

---

#### D11 ❌ 推翻（第二处明确错误）

**规划原文**：流程详情页展示 `definitionCode`/`startedFormCode`，**看不到在批什么单据**。

**实测证据【实测确认】** `features/taskflow/process-shell.tsx:136-152`：
```tsx
<h3 ...>业务数据（只读）</h3>
<div className="grid ...">
  <ReadOnlyField label="业务类型">
    <ReadOnlyText value={instance.businessType} />      {/* :140-142 */}
  </ReadOnlyField>
  <ReadOnlyField label="业务单号">
    <ReadOnlyText value={instance.businessId} />        {/* :143-145 */}
  </ReadOnlyField>
  <ReadOnlyField label="发起人">
    <ReadOnlyText value={instance.initiatorName ?? instance.initiatorId} />  {/* :146-148 */}
  </ReadOnlyField>
  <ReadOnlyField label="当前节点">
    <ReadOnlyText value={instance.currentNodeCode} />   {/* :149-151 */}
  </ReadOnlyField>
</div>
```

**且有测试在守这 4 个字段**【实测确认】`process-shell.test.tsx:97`：
```tsx
expect(await screen.findAllByText('PO-001')).length).toBeGreaterThan(0);
expect(screen.getByText('业务数据（只读）')).toBeTruthy();
expect(screen.getByText('PURCHASE_ORDER')).toBeTruthy();
```

**真实问题是什么**：
- ✅ 业务类型、业务单号、发起人、当前节点 **都已展示**（`instance.businessId` 甚至就是 PageHeader 的标题，`:97`）
- ❌ **没有 `bizTitle`**（`sys_task.biz_title` 有值且列表页在用：`task-list-page.tsx:163`），详情页拿不到
- ❌ **没有任何跳转/关联入口**（这才是 D12 的问题）
- ❌ 业务字段是**平铺 4 格**，没有 `wf_task` 的 `nodeName`/`assignee` 上下文关联展示（这些在顶部进度条 `:105-125`）

**所以正确表述是**：详情页**看得到在批什么单据**（单号 + 类型 + 发起人），但**看不出这是哪个单据的哪个环节**（无 bizTitle、无单据内关键字段如金额/申请人/明细行、无跳转）。规划 §8.3 度量表里写"详情页能看出在批什么单据 | 不能（只显示流程编码）"是**错误基线**——它把已有能力记为缺失，会导致排期虚高。

⚠️ **连带影响**：规划 §11.1 的 mermaid 图 `T -->|想知道在批什么| D["只显示 definitionCode"]` 和 §11.2 C-4 的定位都要重写。C-4 的**核心问题依然成立**（无业务详情路由，D12 确认），但**理由要换成"看到了单号但点不进去"**，而不是"看不到"。

---

#### D12 ✅ 确认

**结论**：业务单据详情页不存在，`bizType` 只作字符串显示。

**证据【实测确认】**：
- `router.tsx` 无任何业务详情路由【实测确认】：`src/app/router.tsx` 全文只有 `/login` `/portal` `/change-password` `/dashboard` `/system/*` `/monitor/*` `/task/*` `/kb/*` `/agent/*` `/iqd/*` `/finance/*` `/ai/*` `/iframe/:code` `/403`；业务页面在 `keep-alive-outlet.tsx:140-144` 的 `PAGE_MAP` 里登记（taskflow 5 条），grep `order|purchase` 在 `src/app/` → **0 命中**
- 前端无 `bizType` → 路由映射【实测确认】：grep `bizType` 主代码（非测试）仅 5 处，**全部是字符串渲染**：
  - `features/taskflow/task-list-page.tsx:174` `<span>{item.bizType} / {item.bizRefId}</span>`
  - `features/taskflow/my-processed-page.tsx:106` 同上
  - `features/system/exec-monitor/exec-monitor-page.tsx:137` `<span>{item.bizType ?? '-'} / {item.bizRefId ?? '-'}</span>`
  - `lib/api/tasks.ts:15` / `lib/api/exec-monitor.ts:15`（类型定义）
- `PURCHASE_ORDER` 只在测试 fixture【实测确认】：grep `PURCHASE_ORDER` 全部 9 处命中 —— `audit-op-page.test.tsx:30`、`exec-monitor-page.test.tsx:24`、`my-processed-page.test.tsx:20`、`my-sent-page.test.tsx:20,58`、`process-shell.test.tsx:25,98`、`task-list-page.test.tsx:25,28`。**主代码 0 处**
- ⚠️ **补正规划一处细节**：规划说"4 个 `.test.tsx` 文件"，实测是 **5 个**（`audit-op-page.test.tsx` 和 `exec-monitor-page.test.tsx` 在 `src/features/system/` 下，不在 taskflow）。此外 `task-list-page.test.tsx:28` 的 `targetEntity: 'PURCHASE_ORDER'` 是 Java 侧 `targetEntity` 字段（`CreateTaskRequest` 第 5 参），不是 `bizType`。

**判定**：D12 结论完全成立，§11.2 C-4 的「前置依赖业务子系统」定级正确。

---

## 2. 遗漏问题清单（按严重程度排）

> 每条给：证据 → 影响 → 对方案的建议。严重度：🔴 阻塞方案 / 🟠 影响工期或正确性 / 🟡 需在规范中定调

---

### 🔴 O-1 · 新增端点不登记 `sys_api` 直接 403 —— 规划的门禁清单漏了这条

**证据【实测确认】**：
- `mis-admin-bff/src/main/resources/application.yml:98-103`：
  ```yaml
  api-permission:
    enabled: true
    deny-unmapped: ${MIS_API_PERMISSION_DENY_UNMAPPED:true}   # ← 默认 true = fail-closed
  ```
  注释原文：「未登记 sys_api 的端点将 403「接口未授权映射」」
- `mis-common/.../ApiPermissionInterceptor.java:56-59`：
  ```java
  Optional<Match> match = registry.match(request.getMethod(), path);
  if (match.isEmpty()) {
      if (properties.isDenyUnmapped()) {
          throw new BusinessException(ResultCode.FORBIDDEN, "接口未授权映射");
      }
  ```
- 登记是**三张表联动**【实测确认】`mis-system/.../SysApiRepository.java:44-58` 的 `findRegistryRows`：
  ```sql
  FROM sys_api a
  JOIN sys_menu_api ma ON ma.api_id = a.id     -- ← 必须绑菜单
  JOIN sys_menu m ON ma.menu_id = m.id
  JOIN sys_module sm ON sm.id = a.module_id
  WHERE a.type='api' AND a.status=1 AND m.status=1
  ```
  **漏了 `sys_menu_api` 或 `sys_menu.status≠1`，规则就不进注册表 → 等同未登记 → 403**
- `V126__taskflow_handled_api.sql` 是**正面样板**：它新增唯一一个端点时，同步写了 `sys_api`(95048) + `sys_menu_api`(95048) 两段迁移，且都带 `WHERE NOT EXISTS` 幂等
- `sys_module` 95010（`taskflow`）已存在【实测确认】`V123:11-12`

**回答你的问题**：
- ❌ **V123 登记 95020-95029 与 V127 把 `permission` 置 NULL 不冲突** —— 两者是**协同**关系，不是矛盾。`mis-system/.../ApiService.java:37-38`：`boolean authOnly = !StringUtils.hasText(permission);`，`V127:16-18` 把菜单 `permission` 置 NULL 后，这些 API 的 `authOnly` 变为 true → 拦截器 `ApiPermissionInterceptor.java:75-77` `if (m.authOnly()) return true;` → **登录即通过**。这正是 V127 注释里写的「个人事务 permission 置 NULL，登录即可」的落地方式。**规划 §5.1 的这处判断是正确的**。
- ✅ **新增端点必须同步登记 `sys_api` + `sys_menu_api`**，且要走 V126 那样的幂等双写。不登记 = **fail-closed 403**，端点完全不可达（不是"权限码缺失"这么轻，是接口 403）。

**影响【推断】**：规划 P1-1「建 `GET /inbox/summary` + `GET /inbox`」若照 §5.4 只做 `V128`（视图/底座）而不补 `V129~V131` 里的 API 登记迁移，**P1 验收会直接 403**。§5.4 迁移清单和 §8.1 门禁都没提这一项。

**建议**：在 §5.4 加一条 `V132 · sys_api + sys_menu_api 登记 /inbox/summary 与 /inbox`；在 §8.1 门禁加「**新增 BFF 端点必须验证非 403**」，并把 `MIS_API_PERMISSION_DENY_UNMAPPED=false` 的本地用法写进开发手册（yml 注释里已有此逃生口，但规划没提）。

---

### 🔴 O-2 · 后端测试 72% 跳过，门禁是虚假绿灯

**证据【实测确认】** 实跑 `mvn.ps1 -pl mis-taskflow test -Dsurefire.forkCount=0`（2 分 35 秒）：

```
Tests run: 82, Failures: 0, Errors: 0, Skipped: 59     ← BUILD SUCCESS
```

**59/82 被跳过。** 逐类门控状态【实测确认】（脚本遍历 `src/test/**/*.java` 查 `@EnabledIfEnvironmentVariable`）：

| 状态 | 数量 | 文件 |
|---|---|---|
| **始终运行** | 5 | `AssignmentResolverTest`(8)、`ConditionEvaluatorTest`(5)、`AuditDiffUtilsTest`(6)、`IdGeneratorTest`(2)、`TaskflowStatusTest`(2) = **23 tests** |
| **条件跳过** | 10 | `TaskServiceIntegrationTest`(**12**)、`MessageServiceIntegrationTest`(10)、`ProcessServiceIntegrationTest`(10)、`AuditOpServiceIntegrationTest`(8)、`ExecutionTaskServiceIntegrationTest`(6)、`CountersignIntegrationTest`(4)、`DistributedLockServiceTest`(3)、`WorkflowEdgeFlowIntegrationTest`(3)、`TaskflowEndToEndTest`(1)、`TaskflowApplicationIntegrationTest`(2) = **59 tests** |
| ⚠️ `AuditProbeService.java` | — | **不是测试类**，是个 helper 被放在 `src/test` 下（无 `@Test`），被上面某个集成测试引用 |

- 门控条件：`@EnabledIfEnvironmentVariable(named = "MIS_DB_TEST", matches = "true")`（例：`TaskServiceIntegrationTest.java:33`）
- 【实测确认】本机 `MIS_DB_TEST` **为空**（未设置）
- 【实测确认】全仓 grep `MIS_DB_TEST` 在 `backend/**/*.{xml,ps1,sh,yml}` → **0 命中**，即没有任何 pom / CI 配置 / 脚本会设置它

**对你三个问题的直接回答**：
1. **后端测试是否全绿？** → 「绿」是真的（0 失败），但**只有 23 个测试真跑了**。含 `TaskServiceIntegrationTest` 的 **12 个测试全跳过**，而这正是 D5 要改的 `handleTask` 所在类。`handleTaskFlow()`（`:94-104`，验证 APPROVED + 幂等拒绝）、`transferTask()`（`:126-138`）、`handledTasks()`（`:167-183`）**一个都没执行**。
2. **前端 taskflow 测试 5 个 / portal 0 个**【实测确认】：`src/features/taskflow/` 有 `inbox-page.test.tsx`、`my-processed-page.test.tsx`、`my-sent-page.test.tsx`、`process-shell.test.tsx`、`task-list-page.test.tsx`（5 个）；`src/features/portal/` **0 个**（`portal-page.tsx` + `components/{app-rail,message-board,process-board,task-board,workbench-overview}.tsx` 全无测试）
3. **测试有没有锁死 bug？** → **没有**（详见 §2.2 单独说明，这是好消息）

**影响【推断】**：规划 §8.1 把 `mvn.ps1 -pl mis-taskflow test` 列为每期必跑门禁，并写「本机需 `-Dsurefire.forkCount=0`」（实测这条**是必要且正确的**，否则沙箱会杀 forked JVM）。但门禁通过 ≠ 逻辑被验证。**按当前配置，接通 D5 的空方法会改到零测试覆盖的代码**——规划却把它列为「P0 · 风险最低」。

**建议**：P0 动工前先做两件事——(a) 用 `MIS_DB_TEST=true` 在**独立测试库**上跑通那 59 个测试（尤其 `TaskServiceIntegrationTest` 的 12 个），把当前基线记下来；(b) 为 D5 的 `syncLinkedMessagesToHandled` **补集成测试**（`TaskServiceIntegrationTest` 里加一个：create → handle → 断言 `receiverRepository.findByMessageId(msgId).get(0).getStatus() == "HANDLED"`）。同时**前端补 `header-toolkit.test.tsx` 和 4 个 portal 组件测试**——规划 P0-2 要改的角标逻辑，目前**零测试**。

---

### 🔴 O-3 · `handleTask` 无乐观锁/悲观锁，并发重复处理会双写

**证据【实测确认】**：
- `TaskService.java:115-145` `handleTask`：`@Transactional` + `requireTask()`(`:120`) + `isOpen()` 检查(`:121`)
- 【实测确认】grep `@Version|@Lock|LockModeType` 在 `mis-taskflow/src/main/java` → **0 命中**
- `SysTask.java:24-25` 只有 `@Id private Long id;`，**无 `@Version` 字段**
- 【实测确认】`mis-taskflow` **有** `DistributedLockService`（测试里有 `DistributedLockServiceTest`，`BizExecLock.SUCCESS`），但只用于**流程执行业务锁**（`biz_type`/`biz_id` 粒度），**`handleTask` 没用它**

**并发场景推演【推断】**：
```
T1 和 T2 同时 handleTask(taskId, APPROVE)
  各自独立事务，各自 SELECT 到 status='PENDING'
  各自通过 isOpen() 检查            ← 检查与写入之间无锁
  各自 setStatus(APPROVED) + setCompletedAt(now)
  各自 save()                       ← 后写覆盖先写，completedAt 漂移
  两个请求都返回成功                 ← 前端无感知
```

**`transferTask` 与 `handleTask` 竞态**【推断】：
```
T1: handleTask  读到 status=PENDING
T2: transferTask 读到 status=PENDING → setAssigneeId(新人) + setStatus(PENDING) + save()
T1: handleTask  setStatus(APPROVED) + save()
结果：任务被 APPROVED，但 assigneeId 是新人；且 TaskService.java:164-168 已给新人发了条 REMIND 消息
     → 新人收到"待办"提醒，但点进去发现已办 —— 这是**用户可见的数据矛盾**
```
反向顺序则更糟：T1 handle 先提交 → T2 transfer 的 `isOpen` 检查**已经过了**（读到的是旧值）→ 转办成功把状态**改回 PENDING**，已办的任务复活成待办。

**影响【推断】**：规划 §4.3 说「统一动作出口，后端在**同一事务内**完成 `sys_task` 状态流转 → `wf_task` 同步 → 关联消息置 resolved」。**"同一事务"解决不了并发写**——两个事务各自都完整提交。规划 §9 风险登记 6 条，**无一条覆盖并发**。

**建议**：§9 加一条 R-7「并发重复处理」。最小可行方案：给 `SysTask` 加 `@Version` 乐观锁字段（需迁移，与 §5.4 的 `V129` 合并做），`handleTask`/`transferTask` 捕获 `OptimisticLockingFailureException` 转成友好提示"该待办已被他人处理"。或复用现成的 `DistributedLockService` 按 `biz_type:BIZ_TASK:{taskId}` 加锁（改动更小，且与流程执行共用一套机制）。

---

### 🟠 O-4 · 审计日志覆盖近乎为零 —— 14 个写端点只有 1 个有审计

**证据【实测确认】**：
- `@BusinessOperation` 在**全后端**（grep `*/src/main/java`，排除 mis-migrator）→ **仅 1 处**：`mis-taskflow/src/main/java/com/mis/taskflow/service/TaskService.java:116`（`handleTask`，type=APPROVE）
- `mis-audit` 里 grep `Pointcut|@Around|execution(` → **0 命中**，即**没有 AOP 兜底**，审计完全靠注解手写
- 【实测确认】`mis-taskflow` 的 14 个写端点：
  | 端点 | 位置 | 审计 |
  |---|---|---|
  | `POST /tasks/{id}/handle` | `TaskController.java:70` | ✅ 有 |
  | `POST /tasks` | `TaskController.java:37` | ❌ 无 |
  | `POST /tasks/{id}/transfer` | `TaskController.java:80` | ❌ 无 |
  | `POST /tasks/batch-handle` | `TaskController.java:90` | ❌ 无 |
  | `POST /messages` | `MessageController.java:36` | ❌ 无 |
  | `POST /messages/read` | `MessageController.java:69` | ❌ 无 |
  | `POST /workflow/instances/start` | `WfProcessController.java:33` | ❌ 无 |
  | `POST /workflow/tasks/{id}/complete` | `WfProcessController.java:55` | ❌ 无 |
  | `POST /workflow/definitions` | `WfDefinitionController.java:31` | ❌ 无 |
  | `PUT /workflow/definitions/{id}` | `WfDefinitionController.java:38` | ❌ 无 |
  | `POST /workflow/definitions/{id}/activate` | `WfDefinitionController.java:46` | ❌ 无 |
  | `POST /execution/{id}/retry` | `ExecutionMonitorController.java:43` | ❌ 无 |
  | `POST /execution/{id}/force-archive` | `ExecutionMonitorController.java:50` | ❌ 无 |
  | `POST /execution/scan` | `ExecutionMonitorController.java:57` | ❌ 无 |

**回答你的问题**：「无审计的写操作有哪些？」→ **上表 13 个**，其中最要命的是 **`POST /workflow/tasks/{id}/complete`**：它是**当前「同意」按钮的实际落点**（`process-shell.tsx:68-72`），也就是说**用户在详情页点"同意"这个动作，当前不留任何审计记录**。而它恰好又是 D4 分叉的另一条路。

**影响【推断】**：规划 §6.1 说要建 `useInboxQuery()` 等共享层，§4.3 要统一动作出口。**统一出口的最大附加收益恰好是审计收口**——把 `/workflow/tasks/{id}/complete` 废弃/降级后，所有审批动作都走带审计的 `handleTask`。规划 §4.3 只提了"消灭 P0-3"，**没提它顺带治好了审计缺口**。这是可以拿来推动 §4.3 立项的强论据。

**建议**：§5.1 真相源裁定里加一条「**动作出口收口 = 审计收口**」。§4.3 的 P2-2 验收加一条「`POST /workflow/tasks/{id}/complete` 退役后，`sys_audit_op` 能查到全部审批动作」。另：转办（`transferTask`）也应补审计——它是**改变责任归属**的动作，且当前无痕。

---

### 🟠 O-5 · 门户 0 测试覆盖，而 C-1 要改的就是它

**证据【实测确认】**：`src/features/portal/` 全目录**无任何 `.test.tsx`**（`portal-page.tsx` + `components/` 5 个 tsx 全部裸奔）

**影响【推断】**：规划 P0-5（C-1 门户外壳归位）要删 `portal-page.tsx:88-134` 的自造 header，并会遇到：重复的 `CommandPalette` 实例（`portal-page.tsx:164` vs `AppLayout` 内）、**重复的 Cmd/Ctrl+J 热键绑定**（`portal-page.tsx:46-55` 与 `AppLayout` 各自的 `useCommandPaletteHotkey`）、`CopilotPanel` 双实例（`:165`）。**删错会静默破坏快捷键**，而没有任何测试会发现。

**建议**：P0-5 之前先补一个 `portal-page.test.tsx` 冒烟测试（渲染不崩 + 关键卡片存在），并把「`⌘K` / `⌘J` 在 `/portal` 与 `/task/*` 上各触发一次」写成验收。§11.4 现有 6 条验收都是「目视」，建议补一条自动化。

---

### 🟠 O-6 · 前端测试**没有**锁死现有 bug（好消息），但有两处会成为改动障碍

**回答你的第 3 问**：grep 测试代码里断言 `sys_message_receiver.status` 保持 ACTIVE、或断言角标旧行为的测试 → **0 处**。

【实测确认】证据：
- grep `STATUS_ACTIVE|STATUS_HANDLED|STATUS_IGNORED|STATUS_ARCHIVED` 在 `mis-taskflow/src/test` → **0 命中**。`sys_message_receiver.status` 的**断言完全不存在**。
- grep `联动|linked|Linked` 在后端测试 → **0 命中**。没有任何测试断言「消息应该联动/不应该联动」。
- 前端：grep `slice(0, 8)|角标|badge` 在 `src/features/taskflow/*.test.tsx` → 只有 `inbox-page.test.tsx:71` 的用例**名字**叫"渲染收件箱列表与未读角标"，但它断言的是 `fetchMessageStats` 的返回（`inbox-page.test.tsx:62` mock `{unread:1,total:1}`），**不涉及 header-toolkit**。`header-toolkit.tsx` **无测试文件**（find 确认只有 `.tsx` 本身）。

**结论**：**接通 P0-1（`syncLinkedMessagesToHandled`）、改 P0-2（角标）、改 P0-3（删 wfInstanceId 分支），都不会挂现有测试。** 这是重要的正面结论——规划的三条 P0 动工风险比想象的低。

**但两处会成为障碍**【实测确认】：
1. **`task-list-page.test.tsx:87-101`** 用例 `'点击同意调用 handleTask(APPROVE)'`，断言：
   ```tsx
   expect(tasksApi.handleTask).toHaveBeenCalledWith('5001', '1', '700001', 'APPROVE', '同意');
   ```
   它的 fixture `sampleTask.metadata = '{}'`（`task-list-page.test.tsx:34`）—— **没有 `wfInstanceId`**，所以走的是"无 instId"分支。**P0-3 删掉 `wfInstanceId` 分支后这个测试仍会通过** ✅。但**反过来说**：现有测试**完全没有覆盖 `有 wfInstanceId` 的分支**（即 D4 的分叉点本身无测试）。改 P0-3 时必须补一个 `metadata: '{"wfInstanceId":"128"}'` 的用例，否则分叉删对了没人证明。
2. **`process-shell.test.tsx:97`** 断言 `screen.findAllByText('PO-001')` 和 `getByText('PURCHASE_ORDER')`—— 这**锁死了 D11 推翻结论所依赖的 4 个只读字段**。这意味着：如果你后续把 `ReadOnlyField` 换成 `bizTitle` 优先展示，这个测试要改。**建议保留这 4 个字段（规划 D11 修正后不需要动它）**，改的是**增补** `bizTitle` 与跳转入口，不是替换。

---

### 🟡 O-7 · a11y：行可点区域用 `<li onClick>`，键盘不可达

**证据【实测确认】**：
- `features/taskflow/inbox-page.tsx:156-162`：
  ```tsx
  <li key={item.id} className={cn('... cursor-pointer ...')} onClick={() => void handleOpen(item)}>
  ```
  `<li>` **无可聚焦属性**（无 `tabIndex`、无 `role="button"`、无 `onKeyDown`）。**纯鼠标可点，键盘 Tab 走不到**。
- 对比 `my-sent-page.tsx:70` 与 `my-processed-page.tsx:79` 用的是 `<li>` 套 `<button onClick>` —— **那两处是可达的**（`<button>` 天然可 Tab）。
- 即：**同一模块 4 个列表里，inbox 是唯一键盘不可达的**，这正好违反规划自己 R-1 规则（§3.2「整行可点」）却没配套 a11y 要求。
- `header-toolkit.tsx:169` 铃铛下拉的行也是 `<button>` ✅ 可达
- ✅ **aria 做得好的地方**：`header-toolkit.tsx:115,127,139,154` 都有 `aria-label`；`portal-page.tsx:102,111` 有 `aria-label`

**i18n**【实测确认】：`index.html:2` `<html lang="zh-CN">` ✅ **正确**，规划没提这项，但它是对的。页面文案全硬编码中文（无 i18n 框架），与规划"零新增概念"一致，不算问题。

**响应式**【实测确认】：**这是真问题**。grep `sm:|md:|lg:` 在 `task-list-page.tsx` → **0 命中**；`my-sent-page.tsx` → **0 命中**；`my-processed-page.tsx` → **0 命中**。对比 `portal-page.tsx:88,138`（`md:px-6`、`lg:grid-cols-3`）和 `workbench-overview.tsx:83`（`sm:grid-cols-4`）是有响应式的。

**推断**：`task-list-page.tsx:160` 的 `<li className="flex items-start gap-4 px-4 py-3">` 内含 `min-w-0 flex-1` 文本块 + `shrink-0` 按钮组，**窄屏（<640px）下按钮组会挤压文本**（文本有 `truncate` 兜底，不会溢出但会被压到极窄）。`inbox-page.tsx:130` 的搜索框 `className="h-8 w-56"` **固定 224px**，在 320px 宽屏 + padding 下会溢出（父容器 `:119` 是 `ml-auto flex`，无 `flex-wrap`）。**规划 R-6「统一骨架屏，行高固定，禁止高度跳动」只管了高度，完全没管宽度方向**。

**建议**：§3.2 的 R-1 补 a11y 条款（「整行可点必须用 `<button>`/`<a>` 或补 `tabIndex`+`role`+Enter/Space 键」）；§6.1 的共享层清单加 `ListRow`（同时解 a11y + 响应式 + R-1 三项）。

---

### 🟡 O-8 · 分页是 offset 分页；`size` 有 200 上限但前端不校验

**证据【实测确认】**：
- 前端 offset 分页【实测确认】：`task-list-page.tsx:60-62,84`（`const [page,setPage] = useState(1); const size = 20;` → `Math.ceil(total/size)`），`inbox-page.tsx:44-46,71`、`my-sent-page.tsx:27-28`、`my-processed-page.tsx:26-28` 同构
- 后端也是 offset【实测确认】`TaskService.java:91`：
  ```java
  Pageable pageable = PageRequest.of(Math.max(page - 1, 0), clampSize(size));
  ```
- `clampSize` 有上限【实测确认】`TaskService.java:247-252`：
  ```java
  if (size <= 0) return 20;
  return Math.min(size, 200);          // ← 上限 200
  ```
  `MessageService.java:255-260` 同样有 200 上限 ✅
- **但前端从不校验**：`size` 全是模块内 `const size = 20` 常量，`:size` 未暴露为参数 → **当前无滥用风险**，但任何新增调用方传 `size=99999` 会被静默截到 200
- **深层性能问题**【推断】：`SysTaskRepository.findOpenByAssignee` 有 `order by t.priority desc, t.createdAt desc` + `Pageable`，而 `V120:85` 的索引是 `(assignee_id, tenant_id, status, created_at DESC)` —— **排序含 `priority desc` 但索引不含 `priority`** → 深翻页时 PostgreSQL 需额外排序，深 offset（`OFFSET 50000`）会扫后丢弃。

**回答你的第 7 问**：`fetchMyTasks` 传 `size` **有上限**（后端 200）。规划 §4.2 用 cursor 的判断【实测确认】成立且正确，但理由可以更强：不只是"offset 深翻页漂移"，还有"排序键与索引不匹配导致深 offset 扫描成本非线性"。

**建议**：§4.2 的 cursor 设计里把排序键固定为 `(priority DESC, created_at DESC, id DESC)` 并在 §5.4 补一条配套索引 `idx_task_assignee_open(assignee_id, tenant_id, priority DESC, created_at DESC) WHERE status IN ('PENDING','APPROVING') AND deleted = 0` —— 顺带替掉现有那个用不上的 `idx_task_due`（`V120:87`，该索引含 `WHERE due_date IS NOT NULL AND status IN (...)`，但 `countOverdue` 的 JPQL 条件写法是 `t.dueDate is not null and t.dueDate < :now` —— **部分条件匹配得上，但 `deleted = 0` 那部分对不上**，能否命中需 `EXPLAIN` 验证，标为待验）。

---

### 🟡 O-9 · 多租户：硬编码 7 处之外，实际是 **11 处**

**证据【实测确认】** grep `tenantId = '1'|TENANT_ID = '1'|tenantId: '1'`（含测试）→ **19 处命中 / 11 个文件**：

| 文件 | 行 | 是否被规划列出 |
|---|---|---|
| `features/taskflow/task-list-page.tsx` | `:39` | ✅ 列出 |
| `features/taskflow/inbox-page.tsx` | `:35` | ✅ 列出 |
| `features/taskflow/my-sent-page.tsx` | `:19` | ✅ 列出 |
| `features/taskflow/my-processed-page.tsx` | `:20` | ✅ 列出 |
| `features/taskflow/process-shell.tsx` | `:24` | ✅ 列出 |
| `components/layout/header-toolkit.tsx` | `:27` | ✅ 列出 |
| `features/portal/portal-page.tsx` | `:34` | ✅ 列出 |
| `features/system/audit/audit-op-page.tsx` | `:31` | ❌ **漏** |
| `features/system/exec-monitor/exec-monitor-page.tsx` | `:34` | ❌ **漏** |
| `features/system/workflow-designer/definitions-page.tsx` | `:22` | ❌ **漏** |
| `features/system/workflow-designer/designer-page.tsx` | `:23` | ❌ **漏** |
| （另 5 处 `.test.tsx` fixture） | — | 属测试，不算 |

**回答你的第 8 问「真实风险有多大」**：
- **服务端兜底【实测确认】** `mis-admin-bff/.../TaskflowIdentity.java:23-26`：
  ```java
  public static Long tenantId(Long fallback) {
      return SecurityContextHolder.getOptional().map(LoginUser::getTenantId)
              .orElseGet(() -> fallback != null ? fallback : DEFAULT_TENANT);  // DEFAULT_TENANT = 1L (:18)
  }
  ```
  **优先级：`LoginUser.tenantId`（网关透传）> 前端 query 参数 > 兜底 1**。
- **风险评估【推断】**：**登录用户路径上是安全的** —— 只要网关 `LoginUser` 正常透传，前端硬编码的 `tenantId='1'` query 参数**会被 BFF 忽略**。所以 P2-4 说的"多租户一开即串户"**过强**。真实风险有三档：
  1. **网关透传失效时**（如本地联调、某个未透传的路由）：`LoginUser` 为空 → 回退到前端传的 `'1'` → **看到租户 1 的数据**。这是真实风险，但触发条件是链路故障，不是常态。
  2. **测试/联调场景**：`MIS_DB_TEST` 未设时后端测试全跳过（O-2），本地用 H2/内存库跑可能出现租户不一致。
  3. **`tenantId` 与 `userId` 不配套**：`userId` 也走同一兜底（`TaskflowIdentity.java:28-31`，**无 DEFAULT 兜底，回退到 `fallback`，再 fallback 到 null**）。若 `userId` 为 null，`TaskService.myTasks` 会 `findByAssignee(tenantId, null, ...)` → 查不到数据（不是串户，是空列表）。
- **但服务端有硬隔离兜底**【实测确认】`TaskService.java:200-202`：
  ```java
  if (!task.getTenantId().equals(tenantId)) {
      throw new BusinessException(ResultCode.FORBIDDEN, "无权访问该代办");
  }
  ```
  且 `TaskServiceIntegrationTest.java:204-210` 有 `crossTenantForbidden` 测试断言跨租户被拒 —— **但该测试当前被跳过**（O-2）。
- **还有一处【实测确认】需注意**：`SysMessageReceiverRepository.countUnread` 的 JPQL **没有 `deleted` 条件也没有 tenant 一致性以外的过滤**，但它有 `r.tenantId = :tenantId` ✅。而 `messageRepository.findInbox` 走的是 `sys_message` 主表 —— `MessageService.inbox:114` 传了 tenantId，OK。

**建议**：P1-6「`tenantId` 从登录态取，删除 7 处硬编码」→ 改为「**11 处**」，且**理由要改**：不是"多租户一开即串户"，而是"**消除对 query 参数的依赖，让前端与租户概念解耦**"。真正的安全网是 `TaskflowIdentity` 的三级兜底 + `TaskService.requireTask` 的租户校验，而**前者依赖网关透传（单点）、后者的测试被跳过**。建议 P1-6 顺带把 `MIS_DB_TEST` 跑起来，让 `crossTenantForbidden` 真正执行。

---

### 🟡 O-10 · 通知渠道：零规划零代码 —— **确认，且比规划描述更彻底**

**回答你的第 9 问**：**确认零代码**。

**证据【实测确认】**：
- grep `-iE "channel|sms|email|mail|wechat|wecom|dingtalk|webhook"` 在 `mis-taskflow/src/main/java` → 命中 3 个文件，但**逐一查看后全是误报**：
  - `WfInstance.java:74,120,121` → 字段 `postProcessMsg`（"post-process message"，后处理提示**文本**，与渠道无关）
  - `ExecutionTaskService.java:150` → `"管理员强制归档"`（字符串字面量）
  - `ExecutionTaskStore.java:46,75` → `postProcessMsg` 赋值（同上）
  - **无任何 `NotificationChannel` / `SmsSender` / `MailSender` / `WebhookClient` 类型**
- 目录结构【实测确认】`mis-taskflow/src/main/java/com/mis/taskflow/` 只有 5 个包：`controller` / `domain`(`entity`,`repository`) / `dto` / `service` / `support` —— **没有 `channel` / `notify` / `push` 包**
- ⚠️ **补一条规划漏的**：`messageService.publish()` 是**唯一的消息出口**，被 `TaskService` 调用 2 次（`createTask:80`、`transferTask:168`）。**若未来加渠道抽象，收敛点就在 `MessageService.publish()`** —— 这是天然的扩展点，规划 §7 P3-2 可以直接指认。

**关于 `01-...md:473` 的占位**：【无法证实】—— 我未逐行核对 `01-message-task-design.md:473` 的具体措辞。规划 §10 引用它作为"仅一句占位"的依据，此处**不予背书也不否定**。

---

### ✅ O-11 · Python 侧第二套审批：与 `sys_task` **零同步** —— 确认，且存储是 Redis

**回答你的第 10 问**：**零同步，确认。**

**证据【实测确认】**：
- `agent/ai-platform/backend/src/hitl/approval.py:28` `class ApprovalManager`，`:60` `self._store: ApprovalStore = ApprovalStore()`
- `agent/ai-platform/backend/src/hitl/store.py:90` `class ApprovalStore`，`:1` 文档字符串原文：「**ApprovalStore — 审批请求存储（Redis 后端，跨副本共享）**」
- `store.py:25` `from src.hitl._redis import get_hitl_redis`，`:112-115` 惰性复用 Redis 客户端
- `store.py:3` 注明：「Phase 1 改造：原进程内 dict（每副本独立、故障接管即丢失）改为 Redis 持久化」
- 【实测确认】grep `sys_task|taskflow|mis_task|/api/v1/tasks` 在 `approval.py` + `store.py` → **0 命中**
- 【实测确认】`sys_task` 侧同样没有对 Python 的引用（`mis-taskflow/src` grep `hitl|approval|python` → 0 命中）

**规划漏的关键点【实测确认】**：规划 §1.2 P1-1 和 §9 R-5 把两套审批的关系描述为「无交叉查询入口」，但**没说 Python 侧是 Redis 存储**。这个差异有实际后果：
- Redis 存储 → **有 TTL**（`store.py:139` 注释：「timeout_seconds（默认 300 = 5 分钟）。同时作为 Redis 键 TTL」）
- 所以 Agent HITL 审批**默认 5 分钟过期消失**，而 `sys_task` 是 PostgreSQL 永久留存
- ⇒ 若规划 §3.1 决定「短期在收件箱内以 `kind=TASK` 呈现」，**Agent 审批会表现为"点进去就没了"**，且无过期提示。这是「短期合流」方案的**硬伤**，规划完全没提。

**另**：【实测确认】`approval.py:257` `_send_notification(record)` 存在 → **Python 侧已经有通知发送逻辑**。查 `_send_notification` 实现需看具体内容，但**它的存在说明 Python 侧有独立的通知通道**，这与「`mis-taskflow` 零渠道抽象」是两个世界的两套通知机制。规划 P3-2/P3-3 的边界应该把这条画进去。

**建议**：§3.1 表格里 `/agent/approvals` 的处置从「短期在收件箱内以 `kind=TASK` 呈现」改为「**暂不合流**」，理由写清两点——(a) Redis + 5 分钟 TTL 与 PostgreSQL 永久语义冲突；(b) 两套通知通道并存会加剧混乱。P3-3 需要单独 ADR，且**必须先回答"Python 侧的 5 分钟 TTL 是产品要求还是临时实现"**。

---

### 🟡 O-12 · `ProcessService` 的 REJECT 分支不写 `sys_task`，且 catch 吞掉真实错误

**证据【实测确认】** `ProcessService.java:158-191`：
- REJECT 分支 `:158-172`：置 `wf_task`=COMPLETED、`instance`=TERMINATED、记历史、通知发起人，然后 **`:172 return`**
- APPROVE 分支 `:175-191`：`:175` 白名单校验后，`:184-191` 才是 `sys_task` 同步块

**影响 A（确定性 bug，高于原报告的判断）**：`sys_task` 同步块**只在 APPROVE 路径可达**。驳回后 `sys_task` 恒为 `PENDING`，产生规划 P1-2 的"幽灵待办"。**修法是把同步块提到 `:158` 之前，或在 REJECT 分支补一次 `action="REJECT"` 的 `handleTask`** —— 不是改 `:187` 的字面量。

**影响 B【推断】**：即便在 APPROVE 路径，`catch (BusinessException ignored)`（`:188-190`）吞掉的异常**不只包含"已被处理"这一种 benign 情况**。`handleTask` 抛 `BusinessException` 的路径有 3 条（`TaskService.java:122` 已处理 / `:129` 不支持的操作 / `:199` 代办不存在），后两条是**真错误**。被吞掉后流程照常推进，`sys_task` 却停在旧状态，**且无对账任务发现**（规划 §9 R-2 提到要对账，但没识别出这是产生来源之一）。

**建议**：catch 收窄为「仅捕获消息已处理」，其余重新抛出或至少 `log.warn` 留痕；与上面的 REJECT 同步缺失一并修，两者都落在 P2-2「统一动作出口落库事务内联动」的范围内。

**建议**：catch 收窄为「仅捕获消息已处理」，其余重新抛出或至少 `log.warn` 留痕；与上面的 REJECT 同步缺失一并修，两者都落在 P2-2「统一动作出口落库事务内联动」的范围内。

---

## 3. 原规划中站不住脚的论断（最重要产出）

按「错得有多严重」排。每条给：原话 → 实测反证 → 应改为。

---

### ❌ 站不住脚 #1（最严重）：D8「`sys_task.read_flag` 是死字段」

- **原话**（§0 D8 + §1.1 坑位表 + §5.2 + 附录 A）：
  > 「`sys_task.read_flag` 死字段 | 全模块 0 处 `setRead(TRUE)` | 任务级"已读"从未存在过」
  > 「任务侧 `seen`（rename `read_flag`）| 看过 | **需要真实写入**（当前 0 处 `setRead(TRUE)`）」

- **实测反证**【实测确认】：
  `TaskService.java:150-162` `transferTask`：
  ```java
  task.setStatus(TaskflowStatus.Task.PENDING);   // :158
  task.setRead(Boolean.FALSE);                  // :159
  task.setViewedAt(null);                       // :160
  ```
  grep 全模块（含测试）确认：`sys_task.read_flag` **有 2 处写入**（`:70` createTask、`:159` transferTask），**0 处读取**（`toVo:238` 只读出 VO 不算业务读取）。

- **错在哪**：
  1. **「死字段」定性错误** —— 它有写入者，与 `viewed_at` 成对构成「未读/已看过」状态对，语义是"**转办后重置为未读**"。这是活字段。
  2. **真正的问题被说小了** —— 不是"从未存在过"，而是"**只有 FALSE 方向，没有 TRUE 方向**"。缺的是 `markRead` 触发点（对照 `MessageService.markRead:186-212` 有完整实现，`TaskService` 无对应方法）。
  3. **会误导 §5.2 的迁移决策** —— 若按"死字段"处理，很可能被规划者归入"可清理的冗余列"，而实际上它**承载转办语义**。`V129` 若把它删掉或改名不慎，转办链路就丢了"重置未读"这个 UX。

- **应改为**：
  > `sys_task.read_flag` + `viewed_at` 是**已成对使用但只单向的状态对**：`createTask:70` 与 `transferTask:159` 写 FALSE，**全模块 0 处写 TRUE、0 处业务读取**。§5.2 的结论（补 seen 写入）成立，但性质是「**补齐状态机的另一半**」，不是「复活死字段」。迁移必须保留这两个列的成对语义。

---

### ❌ 站不住脚 #2：D11「详情页看不到在批什么单据」

- **原话**（§0 D11 + §1.2 B-2 + §8.3 度量表基线 + §11.1 mermaid）：
  > 「流程详情页展示 `definitionCode`/`startedFormCode`，**看不到在批什么单据**」
  > §8.3：「详情页能看出在批什么单据 | 不能（只显示流程编码）| 能（`bizTitle` + 关键字段）」

- **实测反证**【实测确认】`process-shell.tsx:136-152` 已展示 **4 个字段**：
  | 标签 | 值 | 行号 |
  |---|---|---|
  | 业务类型 | `instance.businessType` | `:140-142` |
  | 业务单号 | `instance.businessId` | `:143-145` |
  | 发起人 | `instance.initiatorName ?? initiatorId` | `:146-148` |
  | 当前节点 | `instance.currentNodeCode` | `:149-151` |

  且 `instance.businessId` **就是 PageHeader 的标题**（`:97` `title={instance.businessId}`），并有测试守护（`process-shell.test.tsx:97`）。

- **错在哪**：
  1. 把**已有能力记为缺失** → §8.3 的"现状基线"失真 → 排期虚高，会以为要做 4 个字段，实际只需**增补 `bizTitle` + 跳转入口**。
  2. **§11.1 的 mermaid 图** `T -->|想知道在批什么| D["只显示 definitionCode"]` 是错误建模，会让读者以为详情页只有一行编码。
  3. **连带影响 §11.2 C-4 的定位理由** —— C-4 的结论（前置依赖业务子系统）**仍然正确**，但理由要改成「**看到了单号但点不进去**」。

- **应改为**：
  > 详情页**已展示**业务类型/业务单号/发起人/当前节点（`process-shell.tsx:136-152`，有测试守护）。真实缺口是：① 无 `bizTitle`（`sys_task.biz_title` 有值，列表页在用）；② 无业务单据跳转入口（见 D12）；③ 业务字段平铺，无「单据的哪个环节」上下文。§8.3 基线改为「**看得到单号但点不进去**」。

---

### ⚠️ 站不住脚 #3：§1.1 能力盘点把 `/messages/{id}` 说成"接口缺失"

- **原话**（§1.1 坑位表）：
  > 「`/messages/{id}` 详情接口 | `messages.ts:60` 无调用方 | **消息没有详情** ← 体验差的头号原因」

- **实测反证**【实测确认】：
  - 前端函数**存在**：`lib/api/messages.ts:59-63` `fetchMessageDetail(id, userId)` → `GET /messages/${id}`
  - sys_api **已登记**：`V123:68` `(95022, ..., '消息详情', 'GET', '/api/v1/messages/{id:[0-9]+}', ...)`
  - 后端**完整实现**：`MessageService.java:156-178` `detail(messageId, userId)`，**带可见性校验**（`:159-160` 非接收者抛 FORBIDDEN）
  - DTO `MessageDetailVO` **含 `content` 字段**（`MessageService.java:171`）
  - 真正缺的是 **Repository 查询方法**：`SysMessageReceiverRepository` 只有 `findByMessageId` / `findByMessageIdAndUserId` / `findByMessageIdInAndUserId` —— **有 `findByMessageIdAndUserId(messageId, userId)`（`:13`）**，够用。

- **错在哪**：把"**前端未接**"表述成"**后端没有**"（「无调用方」被当成「接口不存在」的证据）。这让 P0-4「消息行点击改为打开右侧详情抽屉」看起来需要写后端，实际上**只需要前端调一个已存在且已鉴权的接口**。

- **应改为**：
  > `/messages/{id}` **后端已完整实现并已登记 sys_api（95022）**，含 `content` 与接收者可见性校验；前端 `fetchMessageDetail` 已封装但**零调用方**。P0-4 是**纯前端接线**，不是「先建接口」。

---

### ⚠️ 站不住脚 #4（次要）：D3「与真实未读数**必然**矛盾」

已在 §1.2 D3 详述。核心：已读消息的 `read` 来自真实数据（`MessageService.toVo:242`），会被正确排除。真实缺陷是「**只取 4+4 条然后前端重算**」，是**取样**问题不是**假算**问题。

**影响**：归因错了会影响修复方案 —— 若以为是"前端算错"，会想把计数搬到后端（规划确实这么做了，结果是对的），但**同时会忽略"4+4 截断"这个更直接的问题**。规划 P0-2 只说「改用真实值，去掉前端聚合」，**没说要把 `size: 4` 改掉**；如果只换成 `/messages/stats` + `/tasks/stats` 但保留 `slice(0,8)` 的下拉列表，角标准了但下拉仍只有 8 条 —— **问题只解决一半**。

**应改为**：
> 铃铛与下拉列表取的是「**前 4 条待办 + 前 4 条消息**」并在前端重算未读数（`header-toolkit.tsx:46,47,59,77,92`）。已读消息能正确排除（`read` 来自真实数据），故"必然矛盾"过强；真实缺陷是 ①**取样截断**（下拉最多 8 条）、②**待办侧无权威未处理数**（`sys_task.read_flag` 无 TRUE 写入，`/tasks/stats` 只给 pending/urgent/overdue）。P0-2 需同时处理下拉列表的"更多"入口。

---

### ⚠️ 站不住脚 #5（细节）：§1.1 把 `/tasks/{id}/transfer`、`/tasks/batch-handle` 列为"能力已备，UI 未开"

- **原话**：
  > 「`/tasks/{id}/transfer`、`/tasks/batch-handle` | `tasks.ts:84,99` 无调用方 | 能力已备，UI 未开」

- **实测反证**【实测确认】：这句话本身**是对的**（确认无调用方，sys_api 95028/95029 已登记）。但**它漏了一个后果**：`transferTask` 是 `sys_task.read_flag` 的唯一活跃写入者（见 D8）。当 UI 不开转办时，`read_flag` 的 FALSE 写入路径**在生产环境从不执行** —— 这反过来印证了 D8 的字段在**当前 UI 下确实是死的**，但在**后端 API 层面是活的**。

**应改为**：标注「UI 未开；注意该端点是 `sys_task.read_flag` 的唯一活跃写入者，开 UI 会激活该字段语义（见 D8）」。

---

## 4. 规划条目里**成立**的部分（明确背书）

为免这份报告看起来全盘否定，以下核实通过、可直接依赖：

| 规划条目 | 核实结果 |
|---|---|
| **D1** 收件箱收敛判断 | ✅ 成立，是规划最有价值的部分 |
| **D2** 无消息详情页 | ✅ 成立（但原因需修正，见站不住脚 #3） |
| **D4** 同意/驳回分叉 | ✅ 成立（精确表述是 1×2 分叉，非 2×2） |
| **D5** 空方法 | ✅ 成立（**但漏了索引前提**，见 O-2 补核 1） |
| **D6** 双表镜像 | ✅ 成立，**且危害被低估**（REJECT 分支 `:172` 提前 return，`sys_task` 必然漏同步，见 D6/O-12） |
| **D7** WebSocket 零落地 | ✅ 成立，行号全准 |
| **D9** 门户布局孤岛 | ✅ 成立（但 C-1 改造面比"2 文件"大，见 D9 补充） |
| **D10** 处理完停原地 | ✅ 成立 |
| **D12** 业务详情页不存在 | ✅ 成立，`PURCHASE_ORDER` 确认只在测试 fixture（5 个文件，非 4 个） |
| §5.1 真相源裁定（`sys_task` 为唯一真相源） | ✅ 方向成立（但需一并修 REJECT 路径不写 `sys_task` 的问题，否则真相源在驳回后陈述旧事实） |
| §5.1「V127 置 NULL 与 sys_api 登记不冲突」 | ✅ **判断正确**（`ApiService.java:38` 的 `authOnly` 推导已证实二者是协同） |
| §6.1 `useQuery` 0 次 / `toast` 0 次 | ✅ 成立（grep taskflow+portal 双向 0 命中；`sonner` 已在 `app/providers.tsx:4,14` 全局挂载，切换成本低） |
| §2.4 P2-2 JSON.parse 重复 3 处 | ✅ 成立（`task-list-page.tsx:44-52`、`task-board.tsx:20-28`、`my-processed-page.tsx:80-90`） |
| §2.4 P2-4 tenantId 硬编码 | ⚠️ 成立但**数量错**：7 处 → **11 处**（见 O-9） |
| §4.2 cursor 而非 offset | ✅ 判断正确，理由可加强（见 O-8） |
| §7 P3-2「零规划零代码」 | ✅ 成立（见 O-10） |
| §8.1 门禁含 `mvn.ps1 -Dsurefire.forkCount=0` | ⚠️ 命令正确，但**门禁是虚假绿灯**（见 O-2） |

---

## 5. 给方案的行动建议（按优先级）

### 动工前必须解决（阻塞）

| # | 事项 | 对应条目 |
|---|---|---|
| 1 | **补 `sys_message_receiver.task_id` 索引**，否则 D5 接通 = 每次审批全表扫 | O-2 补核 1 / D5 |
| 2 | **让后端测试真跑起来**（配 `MIS_DB_TEST=true` + 独立测试库），记录基线 | O-2 |
| 3 | **为 `handleTask` 加乐观锁**（`@Version`）或复用 `DistributedLockService` | O-3 |
| 4 | **§5.4 迁移清单补 API 登记条目**（`sys_api` + `sys_menu_api` 双写，仿 V126），否则 P1 新端点 403 | O-1 |

### 规划文本需要修订

| # | 修订点 |
|---|---|
| 1 | D8 整条重写（死字段 → 单向状态对） |
| 2 | D11 整条重写 + §8.3 基线改 + §11.1 mermaid 改 |
| 3 | D3 定性改为「取样 + 前端重算」，P0-2 补「下拉列表更多入口」 |
| 4 | §1.1 `/messages/{id}` 从"接口缺失"改为"前端未接"，P0-4 标注为纯前端 |
| 5 | §1.2 P2-4 硬编码 7 处 → 11 处，风险理由重写（见 O-9） |
| 6 | §9 加 2 条风险：R-7 并发重复处理、R-8 `sys_api` fail-closed |
| 7 | §3.1 `/agent/approvals` 处置从"短期合流"改为"暂不合流"（Redis 5 分钟 TTL 冲突，见 O-11） |
| 8 | §3.2 R-1 补 a11y 条款；R-6 补窄屏条款 |
| 9 | §6.1 共享层清单加 `ListRow`（同时解 a11y + 响应式 + R-1） |
| 10 | §11.2 C-1 标注改动面大于「2 文件」（热键重复绑定需处理，见 D9 补充） |

### 建议加入方案的新条目

| # | 新条目 | 理由 |
|---|---|---|
| 1 | **P0-0：建立真实测试基线**（后端 59 个跳过测试 + 前端 portal 0 测试 + header-toolkit 0 测试） | 现有门禁给的是虚假绿灯，动工前必须知道真实状态 |
| 2 | **P0 增补：为 D5 补集成测试**（create → handle → 断言 receiver.status == HANDLED） | D5 是 P0 但零测试覆盖 |
| 3 | **P0-3 增补：补 `wfInstanceId` 分支的测试用例** | 现有 fixture `metadata:'{}'` 完全没覆盖 D4 的分叉点 |
| 4 | **P2 增补：修 REJECT 分支不写 `sys_task`（`ProcessService:158-172` 提前 return）+ `:188` 的 catch 收窄** | 这两条是"幽灵待办"的主要产生源（D6/O-12） |
| 5 | **§4.3 增补收益说明：动作出口收口 = 审计收口** | 13/14 写端点无审计，「同意」当前无审计记录（O-4），这是推动统一出口的强论据 |

---

## 附录 A · 本次核实未覆盖 / 无法证实的项

| 项 | 原因 |
|---|---|
| `01-message-task-design.md:473` 的具体措辞 | 未逐行核对，规划 §10 引用它作为「渠道仅一句占位」的依据，**不予背书也不否定** |
| `README.md:37` 的 WebSocket 承诺原文 | 未逐字验证（D7 的 4 处 `01-...md` 行号已全部实测准确） |
| `docs/frontend/admin-web-design.md:369 / :420-433 / :95-105 / :220-310` | 未逐行核对，规划关于「违反规范」的 4 处引用未独立验证 |
| `08-taskflow-tryout-guide.md:40, :85-92` | 未核对（文档债清单 §6.3 的依据） |
| `sys_task` 上 `idx_task_due` 部分索引能否被 `countOverdue` 命中 | 需 `EXPLAIN`，本机无测试库连接，标为**待验**（见 O-8） |
| `MIS_DB_TEST=true` 下那 59 个测试是否真能全绿 | 本机无独立测试库，**未验证**。这是 O-2 的关键未知：**它们可能本身就有失败** |
| 前端 `npm run test` 全量 | 采信既有基线（1 failed / 558 passed，失败项属聊天模块），本次**未重跑**（耗时 3.5 分钟，且与本任务无关） |
| 门户侧栏「工作台」是否真的在 `/portal` 渲染时高亮 | `host-apps.ts:57` 已预留归属，但 `/portal` 不在 `AppLayout` 内，**侧栏本身不渲染** → 此预留当前**无法生效**。这是 C-1「补完既定设计」说法的一个反讽点 |

---

## 附录 B · 核实方法说明

- **D1~D12**：逐条读源码比对行号。凡行号与规划不符者在该条下明确标出差异。
- **遗漏项**：对 team-lead 列出的 10 项逐项 grep/读文件核实；`mvn test` 实跑 2 分 35 秒（`-Dsurefire.forkCount=0` 必要，未加则沙箱杀 forked JVM —— **规划 §8.1 这条备注准确**）。
- **未改动任何文件**，本报告为本次唯一新建文件。
- 后端测试基线：`Tests run: 82, Failures: 0, Errors: 0, Skipped: 59` → BUILD SUCCESS（总耗时 02:03 min）。
