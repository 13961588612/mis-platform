# MIS 平台记忆（curated v4 — 2026-10-12）

> 只留跨会话黄金知识。详细日志见各 `YYYY-MM-DD.md`。本文件尽量 ≤3k 字符。

## 端口 / 登录
前端 5174 · gateway 8080 · BFF 8081 · taskflow 8104 · iqd 8109 · iam 8102 · org 8103 · system 8105 · ai-platform 8000 · WrenAI 9100/9101。
🔴 登录链路**带 `/api/v1/auth` 前缀**：`GET /api/v1/auth/captcha?appCode=system`（`imageBase64` 是 SVG，正则 `<text>` 取 4 位码）→ `POST /api/v1/auth/login` `{appCode,username,password,captchaId,captchaCode}`（admin/Mis@123456）；**token 字段名 `accessToken`**。业务成败看 JSON `code` 字段（HTTP 永远 200）。脚本用 `C:/Users/13961/.workbuddy/binaries/python/versions/3.13.12/python.exe` + urllib 可行。
沙箱：长服务放单条前台命令(timeout≤600000)；禁 cmd.exe；PowerShell 走 PowerShell 工具。

## 门禁（🔴 OOM 极具误导）
前端只用 **pnpm**（npm 必崩）。`exit 1`+空输出=OOM kill≠代码错，重试。
- 测试 `NODE_OPTIONS="--max-old-space-size=700" npx vitest run --pool=threads --poolOptions.threads.singleThread=true`
- 类型 `node --max-old-space-size=1400 ./node_modules/typescript/bin/tsc --noEmit`；⚠️**高负载时 1400MB 会 OOM 抖动/假挂**，稳妥用 **4096MB**。
- 🔴 **门禁串行跑、输出重定向到文件再 tail**；并发互抢会假性「挂住」（进程其实已走完，但 `| tail` 管道不关 → 任务永不返回）。vitest 独占约 69s。
- 🔴 **门禁必须后台独立进程跑（`run_in_background`）+ 绝对路径日志**（`D:/code/mis-platform/tmp/x.log`）：前台会被工具超时/OOM 连带 SIGKILL 父 bash，连 `echo EXIT` 都打不出。判 OOM 特征 = **无 VITEST_EXIT 标记 + 日志停在中间**。
- 🔴 700MB 跑**大批量目录会整组 OOM kill**（尤其 `biz/forms` 重渲染）；改**精准子集 + 1536MB** 可稳跑（26 文件/305s）。日志路径勿用相对 `../tmp`（解析到 `frontend/tmp` 不存在）。
Java：JDK17 `D:\software\jdk-17.0.2`；`backend/mvn.sh`；`-Dtest=Y` 加 `-Dsurefire.failIfNoSpecifiedTests=false`；JVM 被杀加 `-Dsurefire.forkCount=0`（仅本机）；集成测试须 `MIS_DB_TEST=true`（否则静默 skip → **假绿**）；Mockito 沙箱不稳加 `JAVA_TOOL_OPTIONS=-Djdk.attach.allowAttachSelf=true`。真实 `Tests run:` 看 `target/surefire-reports/*.txt`。

## 迁移（Flyway 只追加）
- 🔴 **checksum 覆盖整文件含注释；已落库迁移立刻被锁** → 改注释也 mismatch，阻塞全链（含 CI）。派工写"只改注释"前必问：该迁移是否已落库？已落库只能 `flyway:repair`（需授权）或把说明挪到实体/文档。
- 测试库直连：`cd backend/mis-migrator; ../mvn.sh flyway:migrate "-Ddb.host=10.254.16.6" "-Ddb.port=5432" "-Ddb.name=mis_platform" "-Ddb.user=mis" "-Ddb.password=mis123"`。
- 🔴 `wf_task.sys_task_id` 无唯一约束/外键 → JOIN 多行 `UPDATE...FROM` 取任意行（错数据非损坏）；技术债。
- 真实 PG 10.254.16.6:5432；alembic 宿主机跑须 `$env:POSTGRES_HOST=10.254.16.6`。
- 🔴 **Hibernate6 native query 禁 `NULL::bigint`**：解析器会把它当成「空值 + 命名参数 `:bigint`」→ 下发 `NULL:bigint` → PG `syntax error at or near ":"`（`NULL AS col` 单独用没事）。统一用 **`CAST(NULL AS bigint)`**。
- 菜单授权真值源 = `mis_platform.sys_role_permission`（`perm_type='menu'::sys_perm_type`，`target_id=菜单id`），**无 `sys_role_menu` 表**；权限链 `listMenuIdsByUser` → 聚合 `sys_menu.permission`。**新菜单必须迁移补授权给角色**（先例 V7），否则前端 `PermissionGate` 静默隐藏按钮（「页面没编辑功能」的头号成因）。

## 🔴 BFF deny-unmapped（最大教训）
`application.yml deny-unmapped:true`：每端点须登记 `sys_api`+绑授权菜单，否则 403 且**静默失效**，单测测不出。历史漏登记 5 批次（漏登/漏 PUT/绑错菜单）。BFF 包路径 `com/mis/adminbff/`。多表回填用 JOIN 防笛卡尔积。**给已有端点加可选 query 参数 path_pattern 不变 ⇒ 无需重新登记。**

## 🔴 构建/进程过期伪装成代码缺陷
`/api/v1/**` 响应缺新字段/值 null，常因跑的构建过期（源码对）。重建 `backend/build-dev.ps1 <svc>`；**进程跑 target/classes，重建后须 `start-dev.ps1 <svc> -Restart`**；判新代码看运行进程启动时间+接口实际返回，别信 jar 时间戳。`ApiPermissionRegistry` 启动异步灌 300s ⇒ 头 20s 任何 /api/v1 返 40300。

## 🔴 BFF 出站 URI 编码范式（`72cfaa5` 已 live 验证）
病：`builder.toUriString()`（已预编码）喂 `WebClient.uri(String)` → 二次编码 `%E9→%25E9` → 非 ASCII 检索恒 0（单测全 ASCII 从不暴露）。
- ⚠️ `buildAndExpand(...).toUriString()` 走 `build(false)` **本就安全**（勿误判为 bug）。
- ✅ 用 `uri(Function<UriBuilder,URI>)` + `{qN}` 占位 helper（`AbstractDownstreamClient.queryUri`/`TaskflowWebClient.uriOf`）。
- ❌ 禁 `.build(true)`（中文抛 Invalid character）、禁 `.uri(URI)`（丢 baseUrl）。

## 前端坑
- 表格吸顶 `min-h-0 flex-1 overflow-auto` 单层；圆角 4px、表头/标签 13px、主色 `#4f46e5`；icon 须在 `icons.ts ICON_MAP` 登记（漏则静默回退 LayoutDashboard）。
- 🔴 `cn()`=tailwind-merge **只同类组去重**：覆写 `TabsList` 必须显式 `h-auto`（基类 `h-9` 压不掉 → 卡片上浮 8px）。jsdom 测不出，靠盒高手算+真浏览器。
- 🔴 路由：`keep-alive-outlet` 页面以 `<Comp/>` 渲染**不在 Route 上下文** ⇒ `useParams` 恒空；动态路径须登记 `DYNAMIC_PAGES`（prefix 以 `/` 结尾）。详情页 ID 用 `useState(()=>parse(pathname))` 冻结。
- 门户三 Tab 激活态在 `stores/portal-tab-store.ts`（**不进 URL**）；相关测试 `beforeEach` 复位 store。
- 🔴 **`auth-store` 是 zustand `persist`（含 permissions+menus）** ⇒ `app/router.tsx` 的 `SessionBootstrap` **绝不能 `if(menus.length>0) return` 早退**（否则权限永不刷新：改角色/补菜单授权后按钮一直不出现，且 **F5 无效、只有重新登录才好**）。已改 `bootedRef` 每页加载刷新一次。后端 `/menus/permissions` 是**实时**查（无缓存）⇒ 补授权即生效，无需重启。
- 🔴 **mock 残留让回归门假绿**：`afterEach` 只 `cleanup()` 不清 mock 时，前面用例残留的 spy 调用会把 `expect(fn).toHaveBeenCalled()` 喂成永真（整文件跑过、单跑才失败）。改断言后必须**跑变异**验证门真的有区分度。
- 测试：api 层 `vi.mock`；zustand 不 mock（`setState`）；`next-themes` 必须 mock。断 className 按精确 token（`split(/\s+/)`→Set），子串 `toContain` 会假命中；统计用例用 `\bit\(`。

## 多 Agent 纪律
单批 ≤2–4 新文件；临时脚本放系统临时目录；禁删测试/skip/`as any`/改 fixture；**主理人验证不信转述，查磁盘+独立跑门禁**；派活前 `git status`+`git log`。三脚本 build/start/stop-dev.ps1 有硬编码服务清单须同步；须 UTF-8 BOM。**成员报 completed≠有产出，必须查磁盘（本轮架构师首轮空转已证）**。

## 现状 / 里程碑（分支 flow）
- **最新（已提交 `24ef5f6`，工作区干净）**：门户「全部事项」三源聚合 + 三项增量整体入库（71 文件，+5578/-693）。①`GET /api/v1/tasks/matters`（native `UNION ALL`：`sys_task`(assignee=我,全状态) ∪ `wf_instance`(initiator=我)，外层统一过滤/排序/分页 + 独立 COUNT，`wf_task` 只在 EXISTS/标量子查询防膨胀）；子 Tab 新增「全部」并设**默认**；命令面板点「待办事项」落 `all`。②事项搜索加发起人/参与人（作用全部子 Tab）。③首页三板块改表格 + 「平台/关联应用」「业务类型」列。④**三项增量**：流程/表单「业务分类」改下拉树单选（新增 `CategorySingleTreeSelect`）；待办/消息「全部」Tab 缺省不过滤；命令面板恢复各 APP 菜单（`search-registry` 含 system/agent/kb/iqd/finance，排除工作台 task）+ 按 appCode 分组。⑤`V140` 授权菜单 95012 给 role1；`V141` 登记 `sys_api 95100` 绑菜单 95002。**门禁**：tsc EXIT=0；前端精准子集 `26 files / 260 passed +1 todo` 零失败（1536MB/305s）；接口实测 200/`code:0`/`total:12`。
  - ⚠️ **踩坑：iqd 分组头与菜单项同名「问数」**（`APP_NAME.iqd==='问数'` 且 `IQD_NAV` 有同名项）→ 老测试 `getByText('问数')` 多匹配报错；已改 `getByRole('button',{name:'问数'})`。**新增分组 UI 后，凡「APP 名 == 菜单项名」的（如 iqd）断文案不能用 `getByText`，须按 role 精确命中。**
- **上一轮（已提交 `01921f3b`）**：统一业务分类（V138/V139）+ app_code 显式化，详见 `2026-10-11.md`。
- 门户 UI 精修 / 三 Tab 重构 / 消息抽屉（`e5bd412`/`e9869e8`/`262d13e`）；BFF 双编码修复 `72cfaa5`；表单分类独立成表 V133。
- **分支 `flow` 领先 origin 3 个 commit，未 push。**
- 历史雷区先读 `2026-10-09.md`/`2026-10-10.md`。

## 遗留（非阻塞）
- 测试库 `wf_category.id=990001` 外部漂移（`WfCategoryMigrationIntegrationTest` 唯一失败源，**非代码**）。`scope=APP` 无 `appCode` 时降级 ALL（over-disclosure，当前无消费者，待收紧）。
- KB「中文 0 命中」根因不在 BFF → 查 chunk 匹配 / RAGFlow。
