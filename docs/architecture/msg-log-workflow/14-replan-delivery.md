# 消息 / 通知 / 待办 / 已办 —— 重做规划交付说明

> **交付日期**：2026-10-09
> **有效设计基线**：[`12-complete-design.md`](./12-complete-design.md)
> **代码状态**：**未改动任何业务代码**（仅新增/更新文档与 memory）

---

## TL;DR

原规划 09 号被核实推翻（1 个安全漏洞 + 3 处方向性错误 + 2 处事实错误），
重做后给出完整设计方案 12 号（1328 行，10 章 + 2 附录）。
**最紧急项不是 UI，而是一个越权漏洞**。

---

## 文件清单

| 文件 | 行数 | 状态 | 内容 |
|---|---:|---|---|
| [`12-complete-design.md`](./12-complete-design.md) | 1328 | 🆕 **唯一有效基线** | 完整设计：IA、数据裁定、接口契约、组件设计、5 批任务、测试策略、风险登记 |
| [`11-verification-report.md`](./11-verification-report.md) | 853 | 🆕 新增 | 逐条核实 D1~D12（8 确认 / 2 修正 / 2 推翻）+ 12 项遗漏清单 |
| [`13-test-strategy.md`](./13-test-strategy.md) | 871 | 🆕 新增 | 测试基建评估、哪些测试会锁死 bug、流程推进测试设计 |
| [`09-unified-inbox-plan.md`](./09-unified-inbox-plan.md) | 790 | ✏️ 加作废横幅 | **已被推翻**，全文保留供追溯，顶部列出全部失效裁定 |
| [`README.md`](./README.md) | — | ✏️ 改索引 | 文档清单更新 + 动手前必读块 |
| `.workbuddy/memory/{MEMORY.md,2026-10-09.md}` | — | ✏️ 更新 | 跨会话记忆 |

---

## 一、必须先修的安全漏洞

**`TaskService.handleTask:119-145` 的 `operatorId` 形参全程未出现在方法体中。**
`requireTask:197-203` 只校验 `tenantId`，**不校验 assignee**。

```java
public void handleTask(Long tenantId, Long taskId, HandleTaskRequest req, Long operatorId) {
    SysTask task = requireTask(taskId, tenantId);   // ← operatorId 传进来就没再用过
```

对比 `ProcessService.java:148` **有** assignee 校验 ⇒ 属遗漏，非设计。

**后果**：同租户内任何登录用户可处理任何人的待办。
**优先级高于全部 UI 任务。**

---

## 二、原规划被推翻的内容

| 原文 | 实际情况（已实测） |
|---|---|
| `wf_task` 降级为身份表、禁止流转 status | `ProcessService.aggregationSatisfied:222-244` **靠 `wf_task.status` 聚合判会签**（或签靠置 `CANCELLED`）。禁止流转 ⇒ **ALL_PASS 永不推进** |
| `sys_task` 为唯一真相源 | 外键方向相反：`wf_task.sys_task_id`（`V121:94`，有索引）指向 `sys_task`，而 `sys_task` 无任何 wf/instance 列；基数 **0..1:1 不是镜像** |
| 动作出口：让 `handleTask` 反向调 `ProcessService` | `ProcessService:62` 已注入 `TaskService`，反向注入 = **循环依赖，Boot 3.2.5 启动失败** |
| 接通 `syncLinkedMessagesToHandled()` | 手段选错。该空方法应保留；要删的是 `ProcessService:184-191` 的 `catch(BusinessException ignored)`（幽灵待办制造者） |
| D8：`sys_task.read_flag` 是死字段 | **错**。`TaskService:159` `transferTask` 的 `setRead(FALSE)` 语义是「转办后重置未读」。按"死字段"清理会**打断转办语义** |
| D11：详情页看不到单据 | **错**。`process-shell.tsx:140-152` 已展示四字段且有测试守护。真缺口是「**看得到单号点不进去**」 |
| 统一 480px 抽屉 | 会让待办降级（`process-shell.tsx:136` 是 `lg:grid-cols-3`）。正解：**知会抽屉 + 待办独立页** |
| `read_flag` 改名 `seen` | 锁表风险大于收益，中文歧义用文案解决 |
| 迁移清单只写 `inbox_item_view` | **漏 `sys_api` 登记**。`application.yml:103` `deny-unmapped: true`，不登记直接 403 |

---

## 三、真正��根因

> 「待办」在代码里**没有实体**，被拆成 `sys_task.status` / `wf_task.status` / `sys_message_receiver.status`
> **三个互不同步、各自独立流转的字段**。于是每个界面都能挑一个当真相
> （铃铛挑前端硬编码、列表挑 `sys_task`、流程页挑 `wf_task`、角标挑 receiver）。
>
> **界面乱是症状，三个 status 各自为政是病因。**

---

## 四、正确解法要点

**动作出口 = 新增门面 `InboxActionService`**
- 依赖单向 `门面 → {ProcessService, TaskService}`，两者现有方向不动 ⇒ 隔离循环依赖
- 一个 `@Transactional` 包全部写入：查 `wf_task` 有无 → 有则 `completeTask`、无则 `handleTask`
- 之后**显式**调 `resolveTask` + `resolveLinkedNotices`
- 批量**刻意用 `REQUIRES_NEW` 逐条事务**（部分成功优于原子性）
- 补存量脏数据清理通道：`wf_task` COMPLETED 但 `sys_task` PENDING → **只补写不推流程**

**信息架构：2 页 + 1 铃铛**
- `/task/inbox`（待办 / 知会 / 已办 三 Tab）
- `/task/instances`（我发起的，不割裂既有命名空间）
- 旧 3 页 **301 重定向**（`sys_menu` 已入库，删路由会让存量用户 404）
- 明确**反对** Agent/AI 审批合流（跨运行时 + 语义不同）

**只需 2 个新迁移文件**：V128（数据地基）、V129（契约 + `sys_api` 登记）

---

## 五、任务分 5 批

| 批 | 内容 | 数量 | 备注 |
|---|---|---:|---|
| **A** | 止血 | 7 | 可当天发。**A-1（删吞异常）与 C-2（建门面）必须同 MR** |
| **B** | 数据地基（V128） | 8 | 补 `task_id` 索引、状态机收敛、脏数据清理 |
| **C** | 契约与出口（V129 + 门面） | 8 | 须同步登记 `sys_api` |
| **D** | 前端 | 12 | 门户外壳归位、详情分载体、批完续下一条 |
| **E** | 文档 | 7 | 可并行 |

---

## 六、测试基建现状（重要）

| 项 | 状态 |
|---|---|
| 前端全量 | `Tests 1 failed \| 558 passed` — **基线即红** |
| 唯一失败 | `src/lib/chat/useChat.test.ts:570`（聊天模块安全超时，与本轮正交，**既存**） |
| 后端 | `Tests run: 82, Skipped: 59` — **72% 跳过** |
| 被跳过的关键测试 | `TaskServiceIntegrationTest` **12 个全跳过**（`MIS_DB_TEST` 未设时） |
| `features/portal/` 测试 | **0 个** |
| `header-toolkit` 测试 | **0 个** |

**⇒ 改坏流程推进，`mvn test` 依然 BUILD SUCCESS。** 这是假安全感，必须先补集成测试门禁。

**好消息**：测试没锁死任何 bug。`task-list-page.test.tsx:34` fixture 是 `metadata:'{}'` → `wfInstanceId()` 返回 null → **从未进入 `task-list-page.tsx:89-93` 的分叉点**。这个分支从未被测过，正是 bug 活到今天的原因。

---

## 七、其他发现

| # | 发现 | 证据 |
|---|---|---|
| 1 | **REJECT 路径漏同步**：流程驳回终止了但 `sys_task.status` 仍留 `PENDING`，待办列表继续显示"待处理"，点进去报「该代办已处理」 | `ProcessService.java:158-171` 在 `:172` 提前 return，`:184-189` 同步只在 APPROVE 路径 |
| 2 | **未读口径不一致**：`countUnread` 只判 `read=false` **不看 `status`** ⇒ 即使接通联动置 HANDLED，**角标和列表一个都不会变** | `SysMessageReceiverRepository.java:20-23`、`:32` |
| 3 | **并发无保护**：`SysTask` 零 `@Version`、Repository 零 `@Lock`，`isOpen()` 是 check-then-act ⇒ 双击同意可能双成功；`transferTask` 竞态**可让已办任务复活成待办** | — |
| 4 | **转办消息误伤**：转办消息与原消息**共用同一 `task_id`** ⇒ 联动必须按 `(task_id, user_id)` 关联 | `MessageService:101` + `TaskService:171` |
| 5 | **流程通知无上下文**：通知点不出详情 | `ProcessService.notify:408-410` 传 `referenceTaskId=null` |
| 6 | **`task_id` 无索引**：接通联动后按 task_id 反查会全表扫描 | `V120:50` 有列，V121~V127 未补索引 |

---

## 八、待你拍板

| # | 问题 | 选项 |
|---|---|---|
| 1 | 既存失败 `useChat.test.ts:570` 怎么处理 | 架构师主张**先修**（本期要加大量前端测试，红基线会让 CI 门禁失效）／测试策略主张**标注基线**（与本轮正交，混进来会让"是否引入回归"失真）。**倾向：先修** |
| 2 | A-1 与 C-2 是否接受**同 MR** | 同 MR = 中间期不会出现 `sys_task` 永不同步，但发布粒度变粗。分开发 = 可快速验证但有脏数据窗口 |
| 3 | 越权漏洞是否**脱离 UI 改造单独热修** | 建议单独热修（可立即上线，不必等 5 批排期） |

---

## 九、复盘：这次核实的价值

原规划 09 号是**我在没有充分核实的情况下**写完的（我逐条标注了证据，但多处证据是"我读了这一段"而非"我读完了相关逻辑"）。这次三路独立核实推翻的比例是 **5/12 条结论**，其中 3 条是方向性错误。

**教训**：
1. 判定「某功能缺失」前必须读完整个文件的相关段落（D11 只读 `:96-99` 就说"看不到单据"，实际 `:140-152` 有四字段）
2. 判定「某字段是死字段」前必须读它出现的上下文（D8 只 grep `setRead`，没读 `transferTask` 里的成对使用）
3. 排期前必须做技术可行性验证，**不能凭规划自称的"低风险"定价**（原规划自称"P0 纯逻辑修复不碰契约"，实际要动流程引擎、循环依赖、漏 `sys_api` 登记）
4. 引入外部依赖关系时，必须先查 `pom.xml` 的框架版本与默认行为（Boot 3.x 默认禁循环依赖）
