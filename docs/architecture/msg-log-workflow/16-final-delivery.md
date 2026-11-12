# 消息 / 通知 / 待办 / 已办 —— 改造交付总结

> **交付日期**：2026-10-09
> **范围**：完整设计方案 + 实施 + 交叉验收
> **代码状态**：8 个 commit 全部落地，前后端测试全绿

---

## TL;DR

从「用户觉得乱」到「统一收件箱 + 4 个安全/一致性缺陷修复」：
规划 → 核实推翻 → 重新设计 → 实施 → 交叉验收 → 修复验收发现的缺陷。
**核实推翻原规划 5/12 条结论（3 条方向性错误），包括我自己写错的 2 条事实错误。**

---

## 一、交付概览

| 维度 | 结果 |
|---|---|
| 有效设计 | `12-complete-design.md`（1328 行，10 章 + 2 附录） |
| 前端测试 | **57 files / 598 passed / 1 todo / 0 failed**（基线 587 → +11） |
| 前端类型 | **typecheck EXIT=0** |
| 后端测试 | **Tests run: 95 / Failures: 0 / Errors: 0 / Skipped: 0**（原82 + 59跳过 → 95 零跳过）|
| Flyway | **V120~V127 零改动，无新迁移** |
| Commit | 8 个（前端 7 + 后端 1） |
| 修复缺陷 | 4 个（1 安全 / 2 数据一致性 / 1 审计） |
| QA 路由 | `ROUTE: Engineer` → 发现 P1 → 已修复 → 回归全绿 |

---

## 二、修复的 4 个缺陷

### B-1 越权漏洞（安全，最高优先）
`TaskService.handleTask:119-145` 的 `operatorId` 形参**全程未出现在方法体**，`requireTask` 只校验 `tenantId` **不校验 assignee**。
⇒ 同租户内**任何登录用户可处理任何人的待办**。`ProcessService:148` 有校验 ⇒ 属遗漏非设计。

**修法**：`requireTask` 加 assignee 校验 + `findByIdForUpdate` 悲观行锁。
```java
// TaskService.java:233
if (operatorId == null || !operatorId.equals(task.getAssigneeId())) {
    throw new BusinessException(ResultCode.FORBIDDEN, "无权处理该代办");
}
```

### B-2 REJECT 路径漏同步（数据一致性）
`ProcessService.completeTask` 的 REJECT 分支在 `:172` **提前 return**，`:184` 的 `sys_task` 同步块在 APPROVE 白名单之后 ⇒ **驳回时 `sys_task` 恒为 PENDING 完全不写**。
⇒ 流程已终止但待办列表仍显示"待处理"，点进去报「该代办已处理」。

**修法**（⚠️ 有陷阱）：`action` 变量已在 `:156` 就绪，同步块必须用变量而非硬编码字面量——否则前移后 REJECT 会把状态写成 APPROVED。
```java
// ProcessService.java:257
Long handlerId = operatorId != null ? operatorId : wfTask.getAssigneeId();
```

### B-3 并发无保护
实测 `@Version`/`@Lock` **零命中**，`isOpen()` 是 check-then-act ⇒ 双击同意**都返回 200**；`transfer` 竞态可致「已办但 assignee 是新人」且新人已收到 REMIND。

**修法**：`SysTaskRepository.findByIdForUpdate` 加 `PESSIMISTIC_WRITE` 行锁，`act` 与 `transfer` 同锁。**不需要新迁移**。
- 不用 `@Version`：要加列，冲突语义是"你失败了"而非"已被他人处理"
- 不用 `DistributedLockService`：Redis 轮询 `POLL_TIMEOUT=60s`，用户点「同意」等 60 秒不可接受

### B-4 审计挂在错误路径
`@BusinessOperation` 全后端仅 1 处且在 `handleTask`，而用户实际走的 `completeTask` **无注解** ⇒ **审批动作不留审计**。

**修法**：注解挂到 `completeTask`；**用 `AuditContext.snapshot()`/`restore()` 解决嵌套 ThreadLocal 污染**（比"只挂一处"更优——两处都能独立审计）；`transferTask` 补审计。

> 若只用"注解挂一处"，内层切面 `finally { AuditContext.clear(); }` 会清空 ThreadLocal，导致审计双份 + diff 为空。

---

## 三、QA 交叉验收发现的 P1（已修）

⚠️ **这个缺陷会重新引入刚修好的 B-2**，是本轮最惊险的一处。

**冲突的两个守卫**：

| 位置 | 对 `operatorId == null` |
|---|---|
| `ProcessService.java:162` | `operatorId != null && ...` → **放行 null** |
| `TaskService.java:233`（新增） | `operatorId == null || ...` → **拒绝 null** |

**后果链**：`completeTask(null)` → 放行 → `syncLinkedSysTask(..., null)` → `handleTask` 抛 FORBIDDEN → 被 `:250` catch 吞掉 ⇒ **流程已终止但待办永远留着**。
QA 实证输出：`instance=TERMINATED sys_task=PENDING`。

**修法**：在 `syncLinkedSysTask` 用 `wfTask.getAssigneeId()` **回填**，而非放开 null。
依据（工程师核实）：`assignNode` 里 `wf_task.assignee_id` 与关联 `sys_task.assignee_id` 由**同一个 assignee 变量**写入，两者本就一致 ⇒ 回填是补全缺失信息，不是编造身份。

**测试有效性证明**：工程师做了负向对照——把回填改成 `null`，两个新测试立刻失败并复现原始症状（`expected: <APPROVED> but was: <PENDING>`）。

---

## 四、前端 6 条 P0

| # | 内容 | commit |
|---|---|---|
| P0-2 | 铃铛改用 `/messages/stats` + `/tasks/stats` 权威值，删掉前端聚合 | `4c57211` |
| P0-4 | 消息点开右侧 480px 抽屉 + 搜索 300ms 防抖 | `896dc9e` |
| P0-5 | 门户外壳归位（`/portal` 并入 `AppLayout`） | `8b6e166` |
| P0-6 | Return Path：跳转带 `state.from` + 面包屑渲染 | `56de16a`+`e5cdad1` |
| P0-7 | 批完自动续下一条 + 队列耗尽给去向 | `9a1b5b8` |
| — | 6 个共享抽象（**真接入非只建不用**） | `e40590b` |

### 两个关键发现

**① 门户外壳归位的隐藏依赖**（工程师发现，我派活时漏了）
只改 `router.tsx` **不够**。`AppLayout` 渲染的是 `KeepAliveOutlet` 而非 `<Outlet/>`，子路由须 `element={null}` **且**在 `keep-alive-outlet.tsx:123-124` 的 `PAGE_MAP` 登记 `'/portal': PortalPage`，否则渲染成"页面不存在"。

**② OOM 纠正了我的错误诊断**
我原判"单文件跑 vitest 是沙箱限制"——**错了，根因是内存不足**（16GB 总内存当时仅剩 721MB）。
判别方法：**真有类型错误时 tsc 一定打印 `error TSxxxx:`；「exit 1 + 无输出」= 被 OOM kill。**
解法：`--max-old-space-size` **必须给小值**（700/1400），给 8192 会加剧失败（V8 放手增长被 OS kill）。

### 工程师改了我三处做法（都认可）

| 我说的 | 他改成 | 理由 |
|---|---|---|
| 抽屉加"查看关联待办" | **砍掉** | 跳列表页带详情页 returnPath 语义混乱；需要后端 `message → wfInstanceId` 映射 |
| `header-toolkit.tsx:180` 加 return path | **不加** | 它跳列表页不是详情页，returnPath 无意义 |
| P0-7 本地乐观移除 | `await load()` 拿服务端权威列表 | 本地推算**测试直接挂**，且违反"单一权威源"原则 |

第三条尤其对——他不是把测试改绿迁就实现，而是发现实现自相矛盾后改实现。

---

## 五、测试基建修复（开工前的前置）

| 项 | 之前 | 之后 |
|---|---|---|
| 后端集成测试 | `Tests run: 82, Skipped: 59`（**72% 跳过，假绿灯**）| `Tests run: 95, Skipped: 0`（**真全绿**）|
| `features/portal/` | **0 个测试** | 8 用例（含双顶栏防护）|
| `header-toolkit` | **0 个测试** | 10 用例（含假算行为锁定）|
| 路由嵌套 | **0 个测试** | 14 用例（锁死门户孤岛现状）|
| 前端基线 | `1 failed \| 558 passed`（`useChat.test.ts:570` 过期用例）| `598 passed / 0 failed` |

**`useChat.test.ts:570` 根因**：测试硬编码过期（推进 265s vs 上限 1860s），**不是代码 bug**。铁证是 `useChat.ts:259` 注释还留着「140s」——上限从 140s 提到 1860s 时测试没跟着改。改 2 行修复，且新写法（推进到 97% 处发 delta）比原来更贴合用例意图。

---

## 六、已知遗留与待决

| # | 项 | 说明 |
|---|---|---|
| 1 | **门户页双重导航** | 归位后侧栏显示"工作台"菜单，页面内还有 `AppRail`。功能没问题但视觉重复，待产品决策 |
| 2 | **队列范围有限** | 队列来自 `size:5`/`size:20`/当前页，"续下一条"只在此范围内有效（划定范围：不加后端接口）。代码注释已写明防止后人误判 |
| 3 | **审计双份** | 一次 `completeTask` 产生 2 条（`WF_INSTANCE` + `SYS_TASK`），`businessType` 不同、diff 均非空无污染。**QA 判不是缺陷**（保留代办维度可追溯性），待确认 |
| 4 | `:250` 吞异常 | `catch (BusinessException) log.warn` **有意保留**（代办可能已被用户直接处理过）。但静默有害，后续应把 FORBIDDEN 这类不该发生的失败单独告警 |
| 5 | `/change-password` 仍裸挂 | 工程师判现状合理（改密页更像门户层），待确认 |
| 6 | `sys_message_receiver.task_id` 无索引 | 后续接通消息联动前需补索引，否则全表扫描 |

---

## 七、文件清单

### 新增文档
| 文件 | 内容 |
|---|---|
| `docs/architecture/msg-log-workflow/11-verification-report.md` | 核实报告（853 行）：D1~D12 逐条验证 + 12 项遗漏 |
| `docs/architecture/msg-log-workflow/12-complete-design.md` | **完整设计方案（1328 行，唯一有效基线）** |
| `docs/architecture/msg-log-workflow/13-test-strategy.md` | 测试基建评估与策略（871 行）|
| `docs/architecture/msg-log-workflow/14-replan-delivery.md` | 规划交付说明 |
| `docs/architecture/msg-log-workflow/15-qa-verification.md` | QA 交叉验收报告 |

### 修改文档
- `09-unified-inbox-plan.md` — **加作废横幅**，顶部列全失效裁定
- `README.md` — 索引更新 + 动手前必读块

### 前端改动（7 commit）
新增 6 个共享抽象 + 3 个测试文件；改动 `header-toolkit.tsx`、`portal-page.tsx`、`router.tsx`、`keep-alive-outlet.tsx`、`process-shell.tsx`、`task-list-page.tsx`、`inbox-page.tsx`、4 个跳转点、`lib/nav/return-path.ts`。

### 后端改动（1 commit，`26530fba`）
8 个文件：`SysTaskRepository`、`ProcessService`、`TaskService`、`AuditContext`、`BusinessOperationAspect`、`TaskServiceIntegrationTest`、`ProcessServiceIntegrationTest`、`TaskConcurrencyIntegrationTest`（新增）。

---

## 八、下一步建议

1. **前端目视验证**：跑 `pnpm dev` 看门户归位后的双导航问题、消息抽屉、批完续下一条的真实体感
2. **决策遗留项**：优先定"门户双重导航"和"审计是否该双份"
3. **下一批（P1 数据地基）**：补 `task_id` 索引、统一未读口径（`countUnread` 不看 status）、状态机收敛至 4 态
4. **补实时性**：按设计 §4.4 用轮询→SSE 替代零落地的 WebSocket 承诺
5. **ADR 固化**：三条核心裁定（真相源 / seen-resolved 正交 / 推送选型判死 WebSocket）落 ADR，防止下轮又翻出来

---

## 九、复盘

**核实推翻率 5/12**，其中 3 条方向性错误。这轮的方法论教训：

1. **标证据 ≠ 核实证据**。我给 D11 标了 `process-shell.tsx` 的证据，但只读了 `:96-99` 就断言"看不到单据"，实际 `:140-152` 有四个字段且有测试守护
2. **判定"死字段"前要读上下文**。D8 只 grep 了 `setRead`，没读它在 `transferTask` 里的成对使用
3. **排期前必做技术可行性验证**。原规划自称"P0 纯逻辑修复不碰契约"，实际要动流程引擎、会循环依赖、漏 `sys_api` 登记
4. **引入外部依赖先查框架默认行为**。Boot 3.x 默认禁循环依赖，不查就会设计出启动失败的方案
5. **安全校验要考虑内部调用路径**。加守卫时容易只看外部入口，忽略内部透传 null 的路径——本轮 P1 就是这么来的

**多智能体协作的实际价值**：3/4 的发现来自成员交叉核对（架构师发现自己的设计漏并发与审计、工程师发现门户外壳隐藏依赖、QA 发现守卫冲突），这些如果只靠我一个人推演，大概率会漏。