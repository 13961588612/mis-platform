# MIS 平台记忆（curated v3 — 2026-10-11）

> 只留跨会话黄金知识。详细日志见各 `YYYY-MM-DD.md`。本文件尽量 ≤3k 字符。

## 端口 / 登录
前端 5174 · gateway 8080 · BFF 8081 · taskflow 8104 · iqd 8109 · iam 8102 · org 8103 · system 8105 · ai-platform 8000 · WrenAI 9100/9101。
登录：`captcha?appCode=system`（解 imageBase64 SVG 取 4 位码）→ `login?appCode=system` `{username,password,captchaId,captchaCode}`（admin/Mis@123456）→ Bearer。
沙箱：长服务放单条前台命令(timeout≤600000)；禁 cmd.exe；PowerShell 走 PowerShell 工具。

## 门禁（🔴 OOM 极具误导）
前端只用 **pnpm**（npm 必崩）。`exit 1`+空输出=OOM kill≠代码错，重试。
- 测试 `NODE_OPTIONS="--max-old-space-size=700" npx vitest run --pool=threads --poolOptions.threads.singleThread=true`
- 类型 `node --max-old-space-size=1400 ./node_modules/typescript/bin/tsc --noEmit`
Java：JDK17 `D:\software\jdk-17.0.2`；`backend/mvn.sh`；`-Dtest=Y` 加 `-Dsurefire.failIfNoSpecifiedTests=false`；JVM 被杀加 `-Dsurefire.forkCount=0`（仅本机）；集成测试须 `MIS_DB_TEST=true`（否则静默 skip → **假绿**）；Mockito 沙箱不稳加 `JAVA_TOOL_OPTIONS=-Djdk.attach.allowAttachSelf=true`。真实 `Tests run:` 看 `target/surefire-reports/*.txt`。

## 迁移（Flyway 只追加）
- 🔴 **checksum 覆盖整文件含注释；已落库迁移立刻被锁** → 改注释也 mismatch，阻塞全链（含 CI）。派工写"只改注释"前必问：该迁移是否已落库？已落库只能 `flyway:repair`（需授权）或把说明挪到实体/文档。
- 测试库直连：`cd backend/mis-migrator; ../mvn.sh flyway:migrate "-Ddb.host=10.254.16.6" "-Ddb.port=5432" "-Ddb.name=mis_platform" "-Ddb.user=mis" "-Ddb.password=mis123"`。
- 🔴 `wf_task.sys_task_id` 无唯一约束/外键 → JOIN 多行 `UPDATE...FROM` 取任意行（错数据非损坏）；技术债。
- 真实 PG 10.254.16.6:5432；alembic 宿主机跑须 `$env:POSTGRES_HOST=10.254.16.6`。

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
- 测试：api 层 `vi.mock`；zustand 不 mock（`setState`）；`next-themes` 必须 mock。断 className 按精确 token（`split(/\s+/)`→Set），子串 `toContain` 会假命中；统计用例用 `\bit\(`。

## 多 Agent 纪律
单批 ≤2–4 新文件；临时脚本放系统临时目录；禁删测试/skip/`as any`/改 fixture；**主理人验证不信转述，查磁盘+独立跑门禁**；派活前 `git status`+`git log`。三脚本 build/start/stop-dev.ps1 有硬编码服务清单须同步；须 UTF-8 BOM。**成员报 completed≠有产出，必须查磁盘（本轮架构师首轮空转已证）**。

## 现状 / 里程碑（分支 flow）
- **最新（已实现+QA通过，均待 commit）**：①**统一业务分类**（V138/V139）：`biz_category` 树（租户通用、无 APP 维度，**叶子 code=业务类型**），兜底节点固定 `991001/UNCATEGORIZED`，存量 `wf_definition`/`form_definition` 全部挂 991001（不迁移）；`wf_category`/`form_category` 表保留停读写、**代码全删**；旧分类端点 `95060-95071` status=0 休眠；新菜单 `95012`+端点 `95093-95098`。②**app_code 显式化**：`wf_instance.app_code`（`startProcess` 显式写入，`assignNode`/`notify` 继承实例值）、`sys_message.biz_type` 新增；**`sys_app_biz_binding` 已 DROP（V138）**——「靠业务类型找 APP」作废，`AppScopeResolver`→静态 `support/AppScope`。③P0 保留：`sys_message`/`sys_task`.`app_code`（V136）、`scope=ALL/APP/PLATFORM` 拆 3 查询、搜索遍历 6 份 `*_NAV`+APP 分组。
- 门户 UI 精修 / 三 Tab 重构 / 消息抽屉（`e5bd412`/`e9869e8`/`262d13e`）；BFF 双编码修复 `72cfaa5`；表单分类独立成表 V133。
- 历史雷区先读 `2026-10-09.md`/`2026-10-10.md`。

## 遗留（非阻塞）
- 测试库 `wf_category.id=990001` 外部漂移（`WfCategoryMigrationIntegrationTest` 唯一失败源，**非代码**）。`scope=APP` 无 `appCode` 时降级 ALL（over-disclosure，当前无消费者，待收紧）。
- KB「中文 0 命中」根因不在 BFF → 查 chunk 匹配 / RAGFlow。
