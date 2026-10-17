# MIS 平台记忆（curated v5 — 2026-10-16）

> 只留跨会话黄金知识（「规则 + 为什么」，去掉考证出处）。详细日志见 `YYYY-MM-DD.md`。

## 端口 / 登录
前端 5174 · gateway 8080 · BFF 8081 · taskflow 8104 · iqd 8109 · iam 8102 · org 8103 · system 8105 · ai-platform 8000 · WrenAI 9100/9101。
🔴 登录链路**带 `/api/v1/auth` 前缀**：`GET /api/v1/auth/captcha?appCode=system`（`imageBase64` 是 SVG，正则 `<text>` 取 4 位码）→ `POST /api/v1/auth/login` `{appCode,username,password,captchaId,captchaCode}`（admin/Mis@123456）；**token 字段名 `accessToken`**。业务成败看 JSON `code` 字段（HTTP 永远 200）。
沙箱：长服务放单条前台命令(timeout≤600000)；禁 cmd.exe；PowerShell 走 PowerShell 工具。

## 门禁（🔴 OOM 极具误导）
前端只用 **pnpm**（npm 必崩）。`exit 1`+空输出=OOM kill≠代码错。
- 测试 `NODE_OPTIONS="--max-old-space-size=700" npx vitest run --pool=threads --poolOptions.threads.singleThread=true`
- 类型：`node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc --noEmit`（1400MB 高负载会假挂）
- 🔴 **串行跑 + `run_in_background` + 绝对路径日志**（`D:/code/mis-platform/tmp/x.log`）。前台会被工具超时/OOM 连带 SIGKILL，连 `echo EXIT` 都打不出；`| tail` 管道不关也会假性「永不返回」。日志勿用相对 `../tmp`。
- 🔴 700MB 跑**大目录会整组 OOM**（尤其 `biz/forms`）；改**精准子集 + 1536MB**（26 文件/305s 稳）。
Java：JDK17 `D:\software\jdk-17.0.2`；`backend/mvn.sh`；`-Dtest=Y` 加 `-Dsurefire.failIfNoSpecifiedTests=false`；JVM 被杀加 `-Dsurefire.forkCount=0`；集成测试须 `MIS_DB_TEST=true`（否则静默 skip → **假绿**）；Mockito 沙箱不稳加 `JAVA_TOOL_OPTIONS=-Djdk.attach.allowAttachSelf=true`。真实数看 `target/surefire-reports/*.txt`。

## 迁移（Flyway 只追加）
- 🔴 **checksum 覆盖整文件含注释；已落库迁移立刻被锁** → 改注释也 mismatch，阻塞全链含 CI。派工前必问是否已落库；已落库只能 `flyway:repair`（需授权）或把说明挪到实体/文档。
- 测试库直连：`cd backend/mis-migrator; ../mvn.sh flyway:migrate "-Ddb.host=10.254.16.6" "-Ddb.port=5432" "-Ddb.name=mis_platform" "-Ddb.user=mis" "-Ddb.password=mis123"`。真实 PG `10.254.16.6:5432`；alembic 宿主机跑须 `$env:POSTGRES_HOST=10.254.16.6`。
- 🔴 **Hibernate6 native query 禁 `NULL::bigint`**：解析器当成「空值 + 命名参数 `:bigint`」→ PG `syntax error at or near ":"`。统一用 **`CAST(NULL AS bigint)`**。
- 菜单授权真值源 = `sys_role_permission`（`perm_type='menu'`、`target_id=菜单id`），**无 `sys_role_menu` 表**。**新菜单必须迁移补授权给角色**，否则前端 `PermissionGate` 静默隐藏按钮（「页面没编辑功能」头号成因）。
- 技术债：`wf_task.sys_task_id` 无唯一约束/外键 → JOIN 多行 `UPDATE...FROM` 取任意行。

## 🔴 BFF deny-unmapped（最大教训）
`application.yml deny-unmapped:true`：每端点须登记 `sys_api` + 绑授权菜单，否则 403 且**静默失效**，单测测不出（历史漏登记 5 批次）。BFF 包路径 `com/mis/adminbff/`。多表回填用 JOIN 防笛卡尔积。**给已有端点加可选 query 参数 path_pattern 不变 ⇒ 无需重新登记。**

## 🔴 构建/进程过期伪装成代码缺陷
接口缺新字段/值 null，常因跑的构建过期（源码对）。重建 `backend/build-dev.ps1 <svc>`；**进程跑 target/classes，重建后须 `start-dev.ps1 <svc> -Restart`**。判新代码看进程启动时间 + 接口实际返回，别信 jar 时间戳。`ApiPermissionRegistry` 异步灌 300s ⇒ 头 20s 任何 `/api/v1` 返 40300。

## 🔴 BFF 出站 URI 编码范式
病：`builder.toUriString()`（已预编码）喂 `WebClient.uri(String)` → 二次编码 `%E9→%25E9` → 非 ASCII 检索恒 0（单测全 ASCII 从不暴露）。
✅ 用 `uri(Function<UriBuilder,URI>)` + `{qN}` 占位 helper（`AbstractDownstreamClient.queryUri`/`TaskflowWebClient.uriOf`）；❌ 禁 `.build(true)`、禁 `.uri(URI)`（丢 baseUrl）。⚠️ `buildAndExpand(...).toUriString()` 走 `build(false)` 本就安全，勿误判为 bug。

## 前端坑
- 表格吸顶 `min-h-0 flex-1 overflow-auto` 单层；圆角 4px、表头/标签 13px、主色 `#4f46e5`；icon 须在 `icons.ts ICON_MAP` 登记（漏则静默回退）。
- 🔴 `cn()`=tailwind-merge **只同类组去重**：覆写 `TabsList` 必须显式 `h-auto`。jsdom 测不出，靠盒高手算 + 真浏览器。
- 🔴 路由：`keep-alive-outlet` 页面以 `<Comp/>` 渲染**不在 Route 上下文** ⇒ `useParams` 恒空；动态路径须登记 `DYNAMIC_PAGES`（prefix 以 `/` 结尾）。详情页 ID 用 `useState(()=>parse(pathname))` 冻结。
- 门户三 Tab 激活态在 `stores/portal-tab-store.ts`（不进 URL）；相关测试 `beforeEach` 复位 store。
- 🔴 **`auth-store` 是 zustand `persist`（含 permissions+menus）** ⇒ `SessionBootstrap` **绝不能 `if(menus.length>0) return` 早退**（否则权限永不刷新，F5 无效、只能重登）。后端 `/menus/permissions` 实时查 ⇒ 补授权即生效，无需重启。
- 🔴 **mock 残留让回归门假绿**：`afterEach` 只 `cleanup()` 不清 mock 时，残留 spy 调用让 `toHaveBeenCalled()` 永真。改断言后必须**跑变异**验证门有区分度。
- 测试：api 层 `vi.mock`；zustand 不 mock（`setState`）；`next-themes` 必须 mock。断 className 按精确 token（`split(/\s+/)`→Set），子串 `toContain` 会假命中。
- ⚠️ 凡「APP 分组名 == 菜单项名」（如 iqd「问数」）的测试文案不能用 `getByText`，须 `getByRole('button',{name})`。

## 多 Agent 纪律
单批 ≤2–4 新文件；临时脚本放系统临时目录；禁删测试/skip/`as any`/改 fixture；**主理人验证不信转述，查磁盘+独立跑门禁**；派活前 `git status`+`git log`。三脚本 build/start/stop-dev.ps1 有硬编码服务清单须同步；须 UTF-8 BOM。**成员报 completed≠有产出，必须查磁盘（本轮架构师首轮空转已证）**。
🔴 **方案类任务必须过"独立审查 + 仓库现状对齐"两关**（ext-flow 轮次实证）：架构师花 1000+ 行核实**外部世界**（致远 API），却只花 3 行 stub 对齐**本地仓库** ⇒ 6 个阻断里 4 个是「读代码 10 分钟就能发现」。派架构任务时**必须显式列出待核对的活代码位置**（文件:行号 + 当前行为），否则必漏。外部核实做得再好也不能替代本地对齐。
🔴 派"不要开发/只出方案"的任务时，**审查者要独立 grep 复核关键断言**（主理人也要），不能只读文档措辞——本轮 QA 报 6 项阻断，主理人抽查 3 项（B1 V149 已清空列 / B4 零唯一约束 / B2 REJECTED 归一）**全部为真**。

## 现状 / 里程碑（分支 flow）
- **进行中（分支 `ext-flow`，2026-10-16）**：本地表单对接**致远 Seeyon A8+ V9** 外部工作流（**仅方案评审，未开发**）。入口 `docs/architecture/msg-log-workflow/19-external-workflow-integration-plan.md` + `20-external-workflow-adapter-contract.md` + `docs/adr/ADR-022` + 三份审查报告 `21/22/23`。详见 `2026-10-16.md`。
  - ✅ **最终结论 PASS_WITH_ISSUES：Phase A + Phase B/C/D 全量放行**。历经 4 轮「架构→审查→修订→回归」，累计报出 6+3+3 项问题全部关闭。
  - 🔴 **`freeReplaceNode` 语义**（推翻原规划核心假设）：官方是「**替换**流程节点」（参数 `activityId` = 要替换的节点），**不是追加**。⇒ 「动态拼任意长度审批链」降级为「外部模板预置 N 个槽位 + 动态填人」，**蓝图节点数 ≤ 模板槽位数**。
  - 🔴 **致远已确证**：①「离开开始节点」**无独立 activate API** —— `param`/`draft`：`0=发送进入下一节点待办`、`1=保存待发`；②发起人**支持显式参数** `senderLoginName`（V5）/ `userCode`（V8），**无需用发起人令牌调用**；③`freeReplaceNode` 的 `userId` **是数组支持多人**，但会签语义由模板 `nodePolicy` 决定、**平台不可控**；④`addNode` **不能绕开槽位限制**（`workitemId` 对应 `ctp_affair.CASE_ID`，待发阶段不是待办）；⑤撤销/终止/流程数据/已结束流程批量查询接口均存在；⑥V8 OpenAPI 有 `notifyUrl`。⚠️ **仍未知：`status_mapping` 状态枚举、会签语义、手机号字段名、审批意见查询（REST 与 V8 均无查询接口 ⇒ 意见区已降级为深链跳致远）**。
  - 🔴 **产品拍板（2026-10-16，勿"顺手对齐"）**：**LOCAL 与 EXTERNAL 撤销语义有意不一致**。LOCAL 撤销后可再发起（`ProcessService.withdraw():447-463` 仅 `RUNNING`+本人+**无任何人审批通过**，实例→WITHDRAWN、单据→SAVED）；**EXTERNAL 不提供撤销入口、界面只能终止**，外部侧撤销**同步按 `TERMINATED` 处理、不可再提**。理由：EXTERNAL 撤销在外部侧无法可靠判定。撤销与终止**合并为 `TERMINATED`**，不新增 `CANCELLED`。
  - ✅ **`form_record` 加 `TERMINATED` 零 DDL**：`V150:16` 是裸 `VARCHAR(16) NOT NULL DEFAULT 'SAVED'`，**全仓无 CHECK、无 ALTER TABLE form_record** ⇒ 直接加状态值即可。且 `TERMINATED` **天然落在所有白名单外**（`requireMineEditable:164-167` 白名单 `{SAVED,REJECTED}`、`toVo:179-181` 三个 can*、`startProcess:119` 的 `!SAVED`）⇒ 三个防重复提交闸门零改动即位。前端只需改 `form-test-page.tsx:58`(RECORD_STATUS 映射，`:514` 有 `?? SAVED` **静默回落**陷阱) 与 `:446-450`(筛选下拉)。`process-shell.tsx` **不读** `form_record.status`，无需改。
  - 🔴 `FormRecordService:164-171` 让 REJECTED 可编辑并归一回 SAVED、`toVo:179-181 canEdit` 同放行 ⇒ 违反"REJECTED 终态"。但 **N6-2：全仓无任何代码写 `form_record.status=REJECTED`**（`syncFormRecordStatus` 3 个调用点只传 `SAVED`×2/`APPROVED`）⇒ **LOCAL 下是死代码**，属 **latent 缺陷、EXTERNAL 落地瞬间触发**（措辞必须准，否则开发者会去"顺手修"而踩坏 LOCAL）。
  - 🔴 **`biz_exec_lock` 是「一次性幂等账本」不是互斥量**（`DistributedLockService:65-66` 见 `SUCCESS` 直接 return、`:98` 写 SUCCESS、**全仓生产代码零处删 SUCCESS**）⇒ **严禁用于周期性动作**，轮询须用 `FOR UPDATE SKIP LOCKED` + `LIMIT`（`batch_size ≤ 20`，因行锁在领取事务提交时释放而 fetch 在事务外）+ **领取与 fetch 分离（绝不能持行锁跨外部 HTTP）**。
  - 🔴 **`uk_ext_inst_active` 谓词 `external_sent = 1`**（r3 写成 `=0` 与注释 180° 反转 ⇒ N1 白修）。`external_sent` 在 `start` 返回 caseId 那一刻置 1；`=0` 才自动让位（覆盖面仅 start 调用失败）；`=1` 恒占槽位、必须显式走 `ABANDONED`。⚠️ 残留缺口：**start 超时/网络中断**时外部可能已建流程但本地无 caseId ⇒ 同失败模式；缓解=让位前按 `command_id` 核对，**但 V5 REST 无 `commandId`（仅 V8 有）⇒ 走 V5 无法彻底消除**，这是建议 P0 走 V8 OpenAPI 的第四条理由。
  - 🔴 **幂等必须同时挡"重复"与"丢失"两个方向**：`ext_terminal_event` 与 `biz_execution_task` **同库同 schema** ⇒ 单事务即可；`process_state` 降两值（幂等靠 `ON CONFLICT...RETURNING id` 返回行数，**该列不参与判定**），**补偿 Job 已删**（单事务已消除丢失型）。
  - 🔴 `V149:85-88` 有 `SET supported_form_codes='{}'` **已清空全表** ⇒ `WfDefinitionService:299` 查询恒空 ⇒「一表单一流程」互斥校验**事实上已失效**（EXTERNAL 需一表单绑多蓝图，方向上帮了忙但属意外）。`WfDefinitionController:52 PUT /{id}/supported-forms` 仍暴露，调用会**复活**失效校验并让表单永久删不掉。
  - 🔴 **`biz_execution_task` 零唯一约束**（V121:130-147 仅两个普通索引）、`enqueue():64-81` 无条件 save 无查重 ⇒ LOCAL 靠状态机单线程不重复，EXTERNAL 轮询+回调+集群 Job 下会**重复执行**。修法见上方 `ext_terminal_event` 同事务方案。
  - 🔴 `EMBED_URL` **跨站鉴权 `SameSite=Lax` 会拦 Cookie**（C-12，Gate-1）⇒ 登录态与签名两条路均未验证，可能须从 P0 降级（B5 为 L 级）。`uk_form_def_embed_token` 谓词**不可带 `deleted=0`**（软删释放 token 可被另一表单复用 + URL 长期有效 = 越权串单），吊销用 `embed_token_revoked_at`。
  - **元教训（已写入 `20§8` 第 15 条）**：**凡引用仓库既有组件作为方案基石，必须核对语义与生命周期，不能只引用存在性**；**「方案基石」也包括方案自己产出的 DDL 草案与伪代码 —— 散文正确不等于代码可运行**（r4 的 D1/D2/D3 全是"散文全对、SQL 写错"）。建议提审时把 DDL 当代码审。
  - `V149` 已落库不可改正文（CHECK 互斥），演进须 **V153+ 追加**。外部字段实体/BFF/前端**零接入**（`FormDefinition` 13 字段零映射）。`ext_process_instance` 不存在。后置任务**复用** `BizExecutionTask`+`ExecutionTaskService`+`ExecutionTaskScheduler`，勿另造 Outbox。**待产品拍板两项**：P-1 `ABANDONED` 按钮可见性/文案（若要求一律不可重提则 P0「废弃并重建」失去意义、需重评 C3 范围）；P-2 `EMBED_URL` 是否从 P0 降级。
- **flow 分支最新（已提交 `24ef5f6`）**：门户「全部事项」三源聚合 + 三项增量整体入库（71 文件，+5578/-693）。①`GET /api/v1/tasks/matters`（native `UNION ALL`：`sys_task`(assignee=我,全状态) ∪ `wf_instance`(initiator=我)，外层统一过滤/排序/分页 + 独立 COUNT，`wf_task` 只在 EXISTS/标量子查询防膨胀）；子 Tab 新增「全部」并设**默认**；命令面板点「待办事项」落 `all`。②事项搜索加发起人/参与人（作用全部子 Tab）。③首页三板块改表格 + 「平台/关联应用」「业务类型」列。④**三项增量**：流程/表单「业务分类」改下拉树单选（新增 `CategorySingleTreeSelect`）；待办/消息「全部」Tab 缺省不过滤；命令面板恢复各 APP 菜单（`search-registry` 含 system/agent/kb/iqd/finance，排除工作台 task）+ 按 appCode 分组。⑤`V140` 授权菜单 95012 给 role1；`V141` 登记 `sys_api 95100` 绑菜单 95002。**门禁**：tsc EXIT=0；前端精准子集 `26 files / 260 passed +1 todo` 零失败（1536MB/305s）；接口实测 200/`code:0`/`total:12`。
  - ⚠️ **踩坑：iqd 分组头与菜单项同名「问数」**（`APP_NAME.iqd==='问数'` 且 `IQD_NAV` 有同名项）→ 老测试 `getByText('问数')` 多匹配报错；已改 `getByRole('button',{name:'问数'})`。**新增分组 UI 后，凡「APP 名 == 菜单项名」的（如 iqd）断文案不能用 `getByText`，须按 role 精确命中。**
- **上一轮（已提交 `01921f3b`）**：统一业务分类（V138/V139）+ app_code 显式化，详见 `2026-10-11.md`。
- 门户 UI 精修 / 三 Tab 重构 / 消息抽屉（`e5bd412`/`e9869e8`/`262d13e`）；BFF 双编码修复 `72cfaa5`；表单分类独立成表 V133。
- **分支 `flow` 领先 origin 3 个 commit，未 push。**
- 历史雷区先读 `2026-10-09.md`/`2026-10-10.md`。

## 遗留（非阻塞）
- 测试库 `wf_category.id=990001` 外部漂移（`WfCategoryMigrationIntegrationTest` 唯一失败源，**非代码**）。`scope=APP` 无 `appCode` 时降级 ALL（over-disclosure，待收紧）。
- KB「中文 0 命中」根因不在 BFF → 查 chunk 匹配 / RAGFlow。
- **表单 EXTERNAL 工作流形态：仅落了元数据字段**（`V149__form_workflow_binding.sql` → `external_workflow_system` / `external_workflow_ref`，实体 `FormDefinition`），**运行时对接无规划文档、无代码**。真要做需新建规划文档。
