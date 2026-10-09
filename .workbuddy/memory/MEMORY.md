# MIS 平台项目记忆

> 维护规则：追加式更新；发现与实测冲突时**先核实再改**。历史快照只保留仍有效的。本文件已去重精简（2026-10-10）。

## 端口与启动（黄金知识，实测优先）
- 端口：主前端 **5174** / gateway **8080** / BFF **8081** / ai-platform **8000** / ai-platform-gateway **3100** / mis-iqd **8109** / mis-iam 8102 / mis-org 8103 / mis-system 8105 / mis-taskflow **8104** / WrenAI 控制 9100+数据 9101。
- 集成栈 `scripts/start-integration-stack.ps1` ⚠️ 只做 infra+flyway+gateway:8080+audit，**不含** mis-iqd/BFF/ai-platform/前端；跑完 ≠ 可联调。
- 登录：`GET /api/v1/auth/captcha`(SVG 4位) → `POST /api/v1/auth/login`(admin/Mis@123456) → Bearer；需 appCode=system。
- **沙箱硬限制**：只回收脱离父命令的孤儿子进程（~13s），常驻 java/`Start-Process` 会被 SIGKILL → 长服务须放**单条前台命令**内（timeout≤600000）。禁 cmd.exe；.bat 纯 ASCII。

## 构建/测试门禁
- **前端必须 `pnpm install`/`pnpm add`**，`npm install` 必崩。测试：`npm run test`；类型：`npm run typecheck`(tsc strict+noUnusedLocals)。eslint 存量 `arch/no-cross-feature` 11 error 在 `features/ai/` + `features/system/`。
- ⚠️ **前端测试/类型 OOM 陷阱**（极具误导性）：`exit 1 + 零输出` = 被 OOM kill，**不等于代码错**（真类型错 tsc 必打印 `error TSxxxx`）。解法：
  - 测试：`NODE_OPTIONS="--max-old-space-size=700" npx vitest run --pool=threads --poolOptions.threads.singleThread=true`
  - 类型：`node --max-old-space-size=1400 ./node_modules/typescript/bin/tsc --noEmit`
  - ❌ 绝不给 8192（V8 放手增长反被 OS kill）。tsc 空输出+EXIT=1 约 1/3 概率，重试即过。
- Java：JDK17 `D:\software\jdk-17.0.2`；Maven 用 classworlds Launcher（Git Bash 解析 MAVEN_HOME 坏）。
  - 后端测试用 PowerShell：`.\mvn.ps1 -pl mis-taskflow test "-Dsurefire.forkCount=0"`，env `MIS_DB_TEST=true DB_HOST=10.254.16.6 DB_PORT=5432 DB_NAME=mis_platform DB_USER=mis DB_PASSWORD=mis123`。⚠️ `-pl X -am test -Dtest=Y` 必加 `-Dsurefire.failIfNoSpecifiedTests=false`；surefire forked JVM 被杀须 `-Dsurefire.forkCount=0`（**仅本机**）。
- git：提交前必看 `git diff --cached --name-only`（`git mv` 静默暂存 rename 污染分组）；分组用 `git reset --soft HEAD~1`+`git restore --staged`；用系统版 git `-C D:/...`。

## 数据库/迁移
- Flyway **只追加**：绝不改历史迁移（checksum 变更阻塞整条链）。ID 段位：① 一段一文件/按域分段 ② 冲突自检**须基于迁移源文件**（只查运行后库会漏检 `WHERE NOT EXISTS` 跳过的行）③ 派工前 grep `sys_api`+`sys_menu_api` 核实权限码真值，否则「前端放行后端 40300」。
- alembic `POSTGRES_HOST` 默认 `postgres`（仅 Docker 内网）；宿主机跑须 `$env:POSTGRES_HOST=10.254.16.6`。真实 PG 在 10.254.16.6:5432。
- **测试库直连 Flyway**：`cd backend/mis-migrator; ..\mvn.ps1 flyway:migrate "-Ddb.host=10.254.16.6" "-Ddb.port=5432" "-Ddb.name=mis_platform" "-Ddb.user=mis" "-Ddb.password=mis123"`。

## 前端 UI 规范
- 表格吸顶：`min-h-0 flex-1 overflow-auto` 单层滚动；禁 `h-full overflow-auto` 嵌套；禁 sticky th `backdrop-blur`；用 `border-separate border-spacing-0`。
- 页面内**勿加内层 padding**（间距由 app-layout `p-4 md:p-6`）；列宽 `components/common/use-column-widths.ts`。
- 风格：圆角 4px、表头/标签 13px、列间竖线 `border-l border-border/60`、主色 `#4f46e5` 不动。
- **icon 必须真实登记**：`icons.ts:106 ICON_MAP` 漏登记不报错只静默回退 `LayoutDashboard`；改 icon 要断言 `ICON_MAP` 有该键。
- **整行可点规范 (R-1)**：行 `onClick`+`role="button"`+`tabIndex`+Enter/Space；行内按钮 `stopPropagation`；行内键盘事件用 `e.target !== e.currentTarget` 判定防误取消。

## 多 Agent 实施纪律
1. 单批 ≤2–4 新文件，无 >15KB 超大单文件（超量必跑满 150 轮，实测两次）。
2. 临时脚本/输出放系统临时目录，**不落仓库工作区**。
3. 测试真实性：禁删测试/skip/`as any`/改 fixture 迎合类型。
4. 主理人验证：不信转述，查磁盘+独立跑门禁；转述数据前先跑命令核实。
5. 派活前先 `git status`+`git log` 确认没人同区域动手（曾同分钟撞号 V129）。

## 任务流 mis-taskflow（2026-10-09 收口）
- 新模块 `backend/mis-taskflow`，端口 8104；BFF 走 `mis.bff.taskflow-*`（默认 `http://localhost:8104`），网关无需改（`/api/v1/**` 统一到 BFF）。
- Flyway 在 `mis-migrator`：V120 消息/代办、V121 流程+Outbox、V122 审计增强、V123 种子、V124 wf_edge、V125 审计、V126 /tasks/handled、V127 个人事务 permission 置 NULL（**非 bug**，但 sys_api 95020-95029 仍登记会误导排障）。**V128 表单机制 / V129 演示数据 / V130 权限补绑**（全新）。
- ⚠️ **已实测四个致命缺陷**（动这块必看 `09-unified-inbox-plan.md`）：① `TaskService.syncLinkedMessagesToHandled()` 空实现→待办消息永不变；② 铃铛未读前端假算；③ 同意/驳回走两套后端；④ 消息无详情。
- ⚠️ `sys_task` 与 `wf_task` **0..1:1 非镜像**：外键 `wf_task.sys_task_id`→`sys_task`，`sys_task` 无 wf 列。`ProcessService` 每节点插两行、靠 try/catch 吞异常同步**无对账**（幽灵待办制造者，须删）。`wf_task.status` 必须可独立流转（会签 ALL_PASS/或签 CANCELLED）。
- 语义病根：**「已读」被当「已处理」**（`countUnread` 只判 `read=false` 不看 status）→ 通联动后角标/列表都不动，须先定口径。

## 🔴 消息待办改造：核实推翻原规划（动这块前必读）
**有效基线**：设计 `12-complete-design.md`｜核实 `11-verification-report.md`｜测试 `13`｜交付 `14`｜QA `15`。09 号规划已作废。
- **推翻 5/12 条**（3 条方向性错误）：`sys_task.read_flag` 非死字段；流程详情页 `:196-209` 有 4 字段（非看不到单据）；`wf_task` 不能降级（会签/或签靠其 status 聚合）；`sys_task` 非唯一真相（基数 0..1:1）；不能让 `handleTask` 调流程引擎（循环依赖 Boot 3.2.5 启动失败）。
- **🔴 越权漏洞**：`TaskService.handleTask:119-145` operatorId 全程未用，`requireTask` 只校验 tenant→任何登录用户可处理他人待办。
- **动作出口正解 = 新增门面 `InboxActionService`**（单向 门面→{ProcessService,TaskService}）；反向注入会循环依赖启动失败。
- **REJECT 漏同步（必然）**：`ProcessService.completeTask:158-172` REJECT 分支 `:172` 提前 return，`:184-191` 同步块在 APPROVE 白名单后→驳回时 `sys_task` 恒 PENDING。修法陷阱：同步块写死 `"APPROVE"` 字面量，前移会写错值，须用 `action` 变量或 REJECT 分支单独补 `handleTask(...,"REJECT",...)`。
- **并发无保护**：`@Version|@Lock|LockModeType` 零命中；`DistributedLockService` 只服务流程执行且 `POLL_TIMEOUT=60s`+`Thread.sleep(500)`（用户点同意等 60s 不可接受）。裁定：门面事务内对 `sys_task` 加 `PESSIMISTIC_WRITE` 行锁，`act`/`transfer` 同锁；不用 `@Version`（冲突语义是"你失败"非"已被处理"），不用分布式锁。
- **🔴 审计挂错路径**：`@BusinessOperation` 全后端仅 1 处（`TaskService.handleTask`），`ProcessService.completeTask` 无注解→流程页点同意不留审计。切面陷阱：`BusinessOperationAspect.finally{AuditContext.clear()}` 清空 ThreadLocal，`handleTask` 内部设值会被内层 finally 清掉→双份+diff空。裁定：注解只挂门面，`AuditContext` 设置点上移门面，`transfer` 补审计。
- 并发测试**不能用类级 `@Transactional`**（回滚→两线程看不到同一未提交事务，行锁阻塞超时）；须 `TransactionTemplate` 显式开两真实事务。
- **执行优先级**：A-2(越权)→C-9(行锁)→C-10(审计)→A-1+C-2(门面，必须同 MR，A-1 单独发布会致 sys_task 永不同步)。
- **测试基建假安全感**：后端曾 `Skipped:59`(72%跳过)，`MIS_DB_TEST` 未设时 `TaskServiceIntegrationTest` 全跳过仍 BUILD SUCCESS→改坏流程 `mvn test` 仍绿。前端基线曾红（`useChat.test.ts:570` 聊天安全超时，既存）。
- **最终基线**：前端 `924 passed/0 failed`；后端 `Tests run:120,0 fail,0 skip`（82→120）。V120~V127 零改动，无新迁移（表单机制走 V128+）。
- **4 缺陷已修**(commit `26530fba`)：B-1 越权(requireTask 加 assignee 校验+悲观行锁)、B-2 REJECT 回填 handlerId、B-3 行锁同锁、B-4 审计挂门面用 `AuditContext.snapshot()/restore()`。**踩坑**：`completeTask(null)`→handleTask 抛 FORBIDDEN 被 catch 吞→流程终止待办留着(B-2复发)；修法是回填 assignee 非放开 null。并发铁证 `pessimisticLockBlocksUntilCommit` 耗时 2.133s。

## 🔴 前端路由两大坑（同一根因，同一根因两次）
**根因**：`keep-alive-outlet.tsx:350` 页面以 `<Comp/>` 渲染，**不在任何 `<Route>` 上下文**；`router.tsx` 只登记通配（`/task/*` element=null）→ `useParams`/`useMatch` 恒空。
- **坑1 动态路径登错表** → 「页面不存在」+Tab 标题变「概览」：`PAGE_MAP` 精确匹配 `'/task/process/:id'`≠实际 `/task/process/128` miss；`matchDynamicPage` 只遍历 `DYNAMIC_PAGES`(前缀匹配)也无→null→「页面不存在」。`app-layout.tsx:120 resolveDynamicPageMeta` 同样返 null→回落「概览」。修法：从 `PAGE_MAP` 删，登记 `DYNAMIC_PAGES { prefix:'/task/process/', component:ProcessDetailPage, title:'流程详情', icon:'Workflow' }`。**自检规则**：`PAGE_MAP` key 不能含 `:` 或以 `/` 结尾；`DYNAMIC_PAGES.prefix` 必须以 `/` 结尾。⚠️ 无兜底自检（前缀漏斜杠仍只"页面不存在"），根治需 lint/启动断言，未做。7 个跳转点全挂过。
- **坑2 详情页用 `useParams` 取 ID** → 「缺少流程实例 ID」：`process-detail-page.tsx` 曾用 `useParams` 恒空。✅ 正确范式见 `kb-library-detail-page.tsx:310`/`agent-detail-route.tsx:97`，须 `useState(()=>parse(pathname))` 快照冻结 pathname（keep-alive 让 Tab 实例常驻，直读实时 location 切 Tab 串味）；返回 `{instanceId,reason}` 三态区分。
- ⚠️ **测这类 Bug 的坑**：测"页面能否拿参数"**不要给替身包 MemoryRouter 的 Route**（测的是有 Route 上下文，恰好漏掉 Bug）；要真抓须临时换回 `useParams` 验证失败。
- **门户外壳归位隐藏依赖**：`/portal` 挂进 `AppLayout` 只改 `router.tsx` 不够，须 `element={null}` 且在 `keep-alive-outlet.tsx` 的 `PAGE_MAP` 登记 `'/portal':PortalPage`。

## 🔴 业务表单机制（2026-10-09 决策，动 workflow 表单前必读）
**用户已明确不做低代码表单设计器**（否决：组件库不够 / 设计器升级破坏存量 schema）。改为「代码写表单组件 + 后台管 formCode」。
- **后端地基已就绪（实测）**：`wf_definition.supported_form_codes TEXT[]`(WfDefinition.java:51)、`wf_instance.started_form_code`(ProcessService.java:55 供 ProcessShell 渲染)、`wf_instance.form_data JSONB` 已参与分支判断(`:380 ConditionEvaluator.matches(edge.getConditionExpr(), instance.getFormData())`)。⚠️ `wf_definition.form_schema JSONB` 全仓零消费。
- **9 项决策（用户确认）**：① 组件放 `features/biz/forms/` ② 建注册表+定义管理界面(树形) ③ 只有定义过 formCode 的表单才能被流程选中 ④ 审批套壳展示+只读 ⑤ 取消发布接口需新增(登记 sys_api) ⑥ 发布/取消发布补权限码 ⑦ 编排改全屏 Dialog(不用 navigate(-1)) ⑧ 新建 `form_definition` 表+独立分类树 ⑨ 暂不做低代码设计器。
- **`form_definition` 建表要点**（沿用 wf_definition 惯例：`tenant_id`+`deleted`+固定 ID+幂等）：关键字段 `code`(租户内唯一)/`name`/`category`/`parent_id`/`description`/`status`/`deleted`/`tenant_id`。⚠️ 迁移接 V128；新端点必同步登记 `sys_api`+`sys_menu_api`。
- **只读态实现（比方案更好）**：类型层面隔离——`read-only-form-view.tsx:42` props 只有 `formCode`+原始 `formData` 串，签名无 component/FormProps→只读路径类型层面渲染不出业务组件（优于"传 readOnly 让组件克制"，后者依赖每个作者都写对）。
- **注册表一致性防御**：formCode 定义了但前端组件未注册会运行时报错→双保险（保存时校验已注册 + 运行时找不到明确报"表单 XXX 未注册"非白屏）。
- **组件库现状**：`components/ui/` 仅 input/select/textarea，缺 date/datetime/number/checkbox/radio/multiselect/switch→印证"代码写组件"正确。可复用范式：`features/system/menu/menu-manage-page.tsx`(796行) 树形+Sheet+CRUD。

## 🔴 流程编排改造（第 4 批，6 commit `1bf02b6`→`0209aa7`）
执行顺序 **T4.6 最先**（它是 T4.4 保存校验前提）。
- **T4.6** 表单白名单下拉多选：`lib/api/form-definition.ts`+`workflow-designer/form-catalog.ts`(`useFormCatalog`/`parseFormCodes`/`serializeFormCodes`/`missingFormCodes`)+`property-panel.tsx FormWhitelistField`；分类收敛枚举 `WF_CATEGORIES`。
- **T4.4** 新增定义弹窗：`definition-dialog.tsx`(253行)+`save-error.ts`(编码校验/查重/友好错误)。**弹窗不能自己 POST**（`CreateDefinitionRequest.nodes` @NotEmpty 且要求恰好 1 START+≥1 END）。
- **T4.3** 发布/取消发布 `workflow:definition:edit` 门控(`definitions-page.tsx:222-241`)，**无权限隐藏**。权限码来自 V123:44 菜单 95007（现成别新造）。
- **T4.1** 抽 `designer-body.tsx`(374行)，`designer-page.tsx` 246→27 行壳。
- **T4.2** `designer-dialog.tsx`(136行)：`max-w-none`+`w-[calc(100vw-4rem)] h-[calc(100vh-4rem)]`+`left-4 top-4`+`translate-x-0 translate-y-0`（4 类缺一错位）；高度链 3 处 `min-h-0` 缺一不可(DialogContent/dialog.tsx:45 / designer-body.tsx:236 / :294)。
- **T4.5** `navigate(replace)`；`keep-alive-outlet.tsx:149` 与 `system-nav.ts:67` **必须保留**（删了 V128 挂 95007 的 95050/95056 全 403）。顺带做**编辑态还原**(`GET /workflow/definitions/{id}` 还原 nodes/edges + 保存走 PUT V128 95056)；**ACTIVE 行「编排」禁用 + tooltip「已发布流程不可编辑，请先取消发布」**。
- **工程师揪出 5 处方案错误**：① 🔴 `isFormRegistered()` 过滤错——表单按需动态 import，编排页从没渲染过⇒注册表恒空⇒下拉永远空；正确问"有没有代码"`hasFormLoader()`。② 我给的 `GET /api/v1/form-definitions/list` 路径写错(实际无 `/list`)。③ **权限绑错菜单**(第 5 次 sys_api 坑变体)⇒ V130 补绑 95007(95030/95031/95052→95007)。④ 后端不翻译唯一索引冲突→500，前端双路兜底。
- Radix **Popover 嵌 Dialog 里 `fireEvent.click` 打不开**⇒弹窗内改用可搜索 Checkbox 组；属性面板用 MultiSelect。`data-[state=open]:animate-none` 禁 Radix zoom 动画(ReactFlow ResizeObserver 量到变化尺寸)。
- 前端测试：`tsc --noEmit` EXIT=0；4 批 **71 files/924 passed/0 failed**（新增 28 断言）。曾 1 红灯 `contract-verification.test.tsx` 已改正向对照→53 passed/0 failed。

## 🔴🔴 开发机 jar 过期会伪装成代码缺陷（2026-10-09 踩坑）
**症状**：BFF/mis-taskflow 的 `/api/v1/**` 响应里 `formData` key 整个不存在，或 key 存在但 value=null。
**根因**：跑的两个 jar 都是旧构建（mis-taskflow 8104、BFF 8081 建于 10-08 22:24，而 formData 提交于 10-09 17:07）。**代码对，jar 过期**。⇒ **验收前必须重建**：`cd backend; mvn -pl mis-taskflow, mis-admin-bff -am -DskipTests package`。**单测全绿 ≠ 服务已部署**；旧服务上验前端得假阴性。

## ⚠️ 五批次 sys_api 坑（本轮最大教训）
| 次 | 形态 | 出处 |
|---|---|---|
| 1 | 漏登记 | 92158/V51 |
| 2 | 漏登记 | 92586/V91 |
| 3 | **PUT 端点从来没登记**(且 BFF 也从来没这个方法) | V128 补 95056 |
| 4 | **绑错菜单** | V130 补绑 95007 |
| — | 根因 | `application.yml:103 deny-unmapped:true` |
共同特征：**不报错但功能静默失效**，单测测不出，只能端到端或人肉点击发现。BFF 实际包路径 `com/mis/adminbff/`（非 `com/mis/admin/bff/`）。

## ⚠️ 回填多表关联的笛卡尔积陷阱（单测测不出）
`wf_task.sys_task_id` 回填 `s.biz_ref_id IN (...) + s.id IN (...)` 是 4×4 组合，一个 UPDATE 绑错。正确：经 `wf_instance` 关联 `JOIN i ON i.id=t.instance_id AND s.biz_ref_id=i.business_id`。**凡"按两个 IN 列表分别匹配"的多表 UPDATE，先停下手改成 JOIN**。

## 验证脚本与迁移幂等坑
- `formData` 在响应里是被转义的 JSON 串⇒`grep -o '"formData":"[^"]*'` 在第一个 `\"` 截断；须 `grep -o '"formData":.*'`。
- **幂等验证**：`flyway:migrate` 跑两次是**假验证**（`schema_version` 让同版本 only-once）。真验证：读迁移文件→剥注释→按分号切句→**逐条 execute 两遍**→断言行数快照不变（`MigrationIdempotencyIntegrationTest`）。可复跑：`docs/architecture/msg-log-workflow/verify-demo-data-e2e.sh`（14 断言，14 全 PASS）。
- Redis 缺失让 `/actuator/health` 返 503 但业务端点正常⇒**不能用 health 判就绪**；`ApiPermissionRegistry` 启动后异步灌(300s 刷新)⇒ BFF 头 20s 任何 `/api/v1/**` 返 40300，脚本需预热等待。

## 门户/上下文断裂（2026-10-09 核实）
- `/portal` 是布局孤岛：`router.tsx:51` 裸挂无 AppLayout，`:54 /task/*` 套 AppLayout；`portal-page.tsx:82` 自造整套 header→进出门户等于换框架，侧栏/铃铛凭空出现消失。「返回门户」埋 `app-layout.tsx:248`。有利前提：`host-apps.ts:57` 已预留 `if(pathname==='/portal') return 'task'`→挂进 AppLayout 是补完既定设计。
- 处理完待办停在原地：`process-shell.tsx:74`/`task-list-page.tsx:97` 只 `await load()` 不续下一条；`process-shell.tsx:99` 面包屑写死 `工作台→/task/pending`，门户进来回不去。
- ⚠️ `bizType`/`bizRefId` 完全闲置（唯一取值 `PURCHASE_ORDER` 只在 4 测试 fixture）；`router.tsx` 无业务详情路由→**业务单据页尚不存在**（已定 P3-4）。

## 前端 mock 范式（现有测试已确立）
- api 层：`vi.mock('@/lib/api/xxx', () => ({ 函数: vi.fn() }))`；测试 `import * as xxxApi` + `vi.mocked(...).mockResolvedValue(...)`。
- zustand **不 mock**：`useAuthStore.setState({user:{...}})`。`next-themes` **必须 mock**：`useTheme:()=>({setTheme:vi.fn(),resolvedTheme:'light'})`。
- `PortalPage` 三子组件必 mock：`HeaderToolkit`/`CommandPalette`+`useCommandPaletteHotkey`/`CopilotPanel`。
- ⚠️ `AppRail` 应用名在「我的应用」「最近访问」各渲染一次→须 `getAllByText`；概览条/板块标题同理各两次。⚠️ 不能用 `queryByRole('banner')`（各卡片 `<header>` 也有隐式 banner role）。

## 开发脚本模块清单（易漏）
- `backend/build-dev.ps1`/`start-dev.ps1`/`stop-dev.ps1` 三处都有硬编码服务清单；新增后端模块须同时补三处，否则 `build/start/stop <模块>` 报「未知服务」。三脚本须保留 UTF-8 BOM（PowerShell 5.1 中文乱码）；改写用 `encoding='utf-8-sig'`。

## AI 平台现状（备查）
- `agent/ai-platform/backend/src` = 223 py/64k 行，25 子包；两个 Worker `mis_iqd`/`mis_rag`。gateway Node/TS。
- BFF `mis-admin-bff` 走 Nacos `lb://mis-admin-bff`(ns=integration,group=MIS_GROUP)；启动须 `MIS_REMOTE=true`+Nacos 三项+DB/Redis 指向 10.254.16.6+JWT 绝对路径+显式 `SERVER_PORT=8081`（`SERVER__PORT=20231` 覆盖导致失败）。缺 sys_api/sys_menu_api/sys_role_permission→40300。
- KB 权限：三层两套（分类管辖 `kb_category_admin` + 库 ACL `kb_acl`）；`hasLibraryManage = 节点管辖 ∨ kb_acl.manage`；检索只认 read。缺口：服务层不校验数据范围（仅 BFF）→须补 `assertNodeManage`/`hasLibraryManage` 贯通 userId。
- mis-iqd：表前缀 `iqd_*`，API `/api/v1/iqd/**`，权限码 `iqd:*`，Worker 经 `/internal/v1/iqd/**` 不直连库(fail-closed 45204)。核心不变量：catalog 真值→派生 MDL→wren context build→memory index→MCP 门禁（单向）。⚠️ architecture.md 有双 v1.10（line6 不可改号）；M-G1~M-G6 六条黄金用例全未真机执行。
