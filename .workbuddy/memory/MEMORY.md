# MIS 平台记忆（curated v3 — 2026-10-11）

> 只留跨会话黄金知识。详细日志见各 `YYYY-MM-DD.md`。本文件尽量 ≤3k 字符。

## 端口 / 登录
前端 5174 · gateway 8080 · BFF 8081 · taskflow 8104 · iqd 8109 · iam 8102 · org 8103 · system 8105 · ai-platform 8000 · WrenAI 9100/9101。
登录：`captcha?appCode=system`（解 imageBase64 SVG 取 4 位码）→ `login?appCode=system` `{username,password,captchaId,captchaCode}`（admin/Mis@123456）→ Bearer。
沙箱：长服务放单条前台命令(timeout≤600000)；禁 cmd.exe；PowerShell 走 PowerShell 工具。

## 门禁（🔴 OOM 极具误导）
前端只用 **pnpm**（npm 必崩）。`exit 1`+空输出=OOM kill≠代码错，重试。
- 测试 `NODE_OPTIONS="--max-old-space-size=700" npx vitest run --pool=threads --poolOptions.threads.singleThread=true`
- 类型 `node --max-old-space-size=1400 ./node_modules/typescript/bin/tsc --noEmit`；⚠️**高负载时 1400MB 会 OOM 抖动/假挂**，稳妥用 **4096MB**。
- 🔴 **门禁串行跑、输出重定向到文件再 tail**；并发互抢会假性「挂住」（进程其实已走完，但 `| tail` 管道不关 → 任务永不返回）。vitest 独占约 69s。
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
- **最新（已实现 + QA IS_PASS，**未 commit**，工作区 57 项）**：①**门户「全部事项」三源聚合**：`GET /api/v1/tasks/matters`（`sys_task.assignee_id=我` 全状态 ∪ `wf_instance.initiator_id=我`，native `UNION ALL` 外层统一过滤/排序/分页 + 独立 COUNT；`wf_task` 只在 EXISTS/标量子查询，防多行膨胀）；子 Tab 新增「全部」并设**默认**；命令面板点「待办事项」落 `all`。②事项搜索加**发起人/参与人**（姓名模糊，作用**全部子 Tab**，缺省零回归）。③首页三板块改**表格** + 「平台/关联应用」「业务类型」两列。④`V140` 授权菜单 95012 给 role1（修复业务分类按钮被 `PermissionGate` 隐藏）；`V141` 登记 `sys_api 95100` 绑菜单 **95002**。**验证**：tsc EXIT=0；`PortalMattersIntegrationTest 7/7`；前端 `90 files/1107 passed`；变异 3/3 杀死。
- **上一轮（已整体提交 `01921f3b`）**：①**统一业务分类**（V138/V139）：`biz_category` 树（租户通用、无 APP 维度，**叶子 code=业务类型**），兜底节点固定 `991001/UNCATEGORIZED`，存量 `wf_definition`/`form_definition` 全部挂 991001（不迁移）；`wf_category`/`form_category` 表保留停读写、**代码全删**；旧分类端点 `95060-95071` status=0 休眠；新菜单 `95012`+端点 `95093-95098`。②**app_code 显式化**：`wf_instance.app_code`（`startProcess` 显式写入，`assignNode`/`notify` 继承实例值）、`sys_message.biz_type` 新增；**`sys_app_biz_binding` 已 DROP（V138）**——「靠业务类型找 APP」作废，`AppScopeResolver`→静态 `support/AppScope`。③P0 保留：`sys_message`/`sys_task`.`app_code`（V136）、`scope=ALL/APP/PLATFORM` 拆 3 查询、搜索遍历 6 份 `*_NAV`+APP 分组。**验证：`git status` 干净；分支 flow 未 push。**
- 门户 UI 精修 / 三 Tab 重构 / 消息抽屉（`e5bd412`/`e9869e8`/`262d13e`）；BFF 双编码修复 `72cfaa5`；表单分类独立成表 V133。
- 历史雷区先读 `2026-10-09.md`/`2026-10-10.md`。

## 遗留（非阻塞）
- 测试库 `wf_category.id=990001` 外部漂移（`WfCategoryMigrationIntegrationTest` 唯一失败源，**非代码**）。`scope=APP` 无 `appCode` 时降级 ALL（over-disclosure，当前无消费者，待收紧）。
- KB「中文 0 命中」根因不在 BFF → 查 chunk 匹配 / RAGFlow。
