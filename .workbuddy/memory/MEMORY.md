# MIS 平台项目记忆（curated — 2026-10-10 精简 v2）

> 维护规则：本文件只留跨会话黄金知识 + 当前状态；详细日志见各 `YYYY-MM-DD.md`。注入超限时优先精简本文件。

## 端口与启动
- 主前端 **5174** / gateway 8080 / BFF **8081** / ai-platform 8000 / ai-platform-gateway 3100 / mis-iqd 8109 / mis-iam 8102 / mis-org 8103 / mis-system 8105 / mis-taskflow **8104** / WrenAI 控制 9100+数据 9101。
- 集成栈 `scripts/start-integration-stack.ps1` 只做 infra+flyway+gateway:8080+audit，**不含** mis-iqd/BFF/ai-platform/前端。
- 登录：`GET /api/v1/auth/captcha?appCode=system`（SVG；解 imageBase64 → 取 `<text>` 内字符得 4 位码）→ `POST /api/v1/auth/login?appCode=system` body `{username,password,captchaId,captchaCode}`（admin/Mis@123456）→ Bearer。
- **沙箱硬限制**：只回收脱离父命令的孤儿进程(~13s)，常驻 java 被 SIGKILL → 长服务放单条前台命令(timeout≤600000)。**禁 cmd.exe、禁 bash 调 powershell**（用 PowerShell 工具）。

## 构建/测试门禁（🔴 OOM 陷阱，极具误导性）
- 前端必须 `pnpm install`/`pnpm add`（npm 必崩）。测试 `npm run test`；类型 `npm run typecheck`。eslint 存量 `arch/no-cross-feature` 11 error 在 `features/ai/`+`features/system/`。
- `exit 1 + 零输出` = 被 OOM kill，**不等于代码错**（真类型错 tsc 必打印 `error TSxxxx`）。解法：
  - 测试：`NODE_OPTIONS="--max-old-space-size=700" npx vitest run --pool=threads --poolOptions.threads.singleThread=true`
  - 类型：`node --max-old-space-size=1400 ./node_modules/typescript/bin/tsc --noEmit`
  - ❌ 绝不给 8192。tsc 空输出+EXIT=1 约 1/3 概率，重试即过。
- Java：JDK17 `D:\software\jdk-17.0.2`；bash 用仓库内 `backend/mvn.sh`。`-pl X -am test -Dtest=Y` 必加 `-Dsurefire.failIfNoSpecifiedTests=false`；forked JVM 被杀加 `-Dsurefire.forkCount=0`（仅本机）。`-q` 下看 `target/surefire-reports/*.txt` 取真实 `Tests run:`。
- git：提交前 `git diff --cached --name-only`（`git mv` 静默暂存 rename）；分组用 `git reset --soft HEAD~1`+`git restore --staged`；用系统版 git `-C D:/...`。

## 数据库/迁移
- Flyway **只追加**：绝不改历史迁移（checksum 变更阻塞整条链）。派工前 grep `sys_api`+`sys_menu_api` 核实权限码真值，否则「前端放行后端 40300」。
- 测试库直连 Flyway：`cd backend/mis-migrator; ..\mvn.ps1 flyway:migrate "-Ddb.host=10.254.16.6" "-Ddb.port=5432" "-Ddb.name=mis_platform" "-Ddb.user=mis" "-Ddb.password=mis123"`。
- 真实 PG 在 10.254.16.6:5432；alembic `POSTGRES_HOST` 默认 postgres（仅 Docker 内网），宿主机跑须 `$env:POSTGRES_HOST=10.254.16.6`。

## 🔴 BFF deny-unmapped：sys_api 五批次坑（最大教训）
`application.yml:103 deny-unmapped:true`：每个端点须登记 `sys_api` 且绑授权菜单，否则 403。特征：**不报错、功能静默失效**，单测测不出，只能端到端发现。
1. 漏登记 92158/V51 2. 漏登记 92586/V91 3. **PUT 从未登记**(V128 补 95056) 4. **绑错菜单**(V130 补绑 95007) 5. BFF 包路径 `com/mis/adminbff/`（非 `com/mis/admin/bff/`）。
- 回填多表关联笛卡尔积陷阱：凡「按两个 IN 列表分别匹配」的多表 UPDATE，改成 JOIN（经 `wf_instance` 关联）。

## 🔴 开发机「构建/进程」过期会伪装成代码缺陷
BFF/mis-taskflow 的 `/api/v1/**` 响应缺字段/值为 null（新字段整个不存在），根因常是**跑的构建过期**（源码对）。两种形态：
1. **jar 过期**：验收前重建 `cd backend; .\build-dev.ps1 mis-taskflow`。
2. **进程过期（更隐蔽）**：服务由 `start-dev.ps1` 的 `mvn spring-boot:run` 跑 **`target/classes`**（不走 jar）⇒ **重建后不重启，运行 JVM 仍跑旧 classes**。⚠️ 判「是否新代码」**别信 jar/classes 时间戳**，看**运行进程启动时间**与**接口实际返回**。
- 重启：`cd backend; .\start-dev.ps1 <svc> -Restart`。单测全绿 ≠ 部署已生效。
- Redis 缺失让 `/actuator/health` 返 503 但业务正常 ⇒ 不能用 health 判就绪；`ApiPermissionRegistry` 启动后异步灌(300s) ⇒ BFF 头 20s 任何 `/api/v1/**` 返 40300，脚本需预热。

## 🔴 BFF 出站 URI 编码范式（2026-10-10 定稿，commit `72cfaa5`，live 已验证）
- 病：`UriComponentsBuilder...toUriString()`（**builder 级已预编码**）再喂 `WebClient.uri(String)`（默认 `TEMPLATE_AND_VALUES`）→ **二次编码** `%E9`→`%25E9`，下游解一次得字面量 → **非 ASCII 检索/筛选恒 0**（ASCII 无需编码故单测全 ASCII 从不暴露，只能 live 发现）。
- ⚠️ **易误判**：`buildAndExpand(...).toUriString()` 走 `build(false)`**不预编码、本就安全**（`KbWebClient` 曾被误判为活 Bug，实测旧码 3/0/0 绿）。真 Bug 只在 `builder.toUriString()` / `.build().encode().toUriString()` 这类**已编码串**配 `uri(String)`（`TaskflowWebClient`）。
- ✅ 正确范式：`WebClient.uri(Function<UriBuilder,URI>)` + helper（`{qN}` 占位 + `build(Map)`）→ **baseUrl 保留且单次编码**（基类 `AbstractDownstreamClient.queryUri` / `TaskflowWebClient.uriOf`）。
- ❌ 红线：**禁 `.build(true)`**（中文抛 `Invalid character`）；**禁 `.uri(URI)`**（相对 URI 不走 uriBuilderFactory → **丢 baseUrl/scheme/host**）。
- 单测验证法：真实 `HttpServer`/自定义 `ExchangeFunction` 捕获出站 `url()`，断言 `getRawQuery()` **无 `%25`** 且解码后==原文（用 `getRawQuery` 非 `getQuery`）。
- **live 端到端验证法**（Git Bash 下必用 **UTF-8 百分号编码**传中文，否则 GBK 干扰致误判）：登录取 token → 经网关 `GET /api/v1/messages/search?tenantId=1&userId=1&q=%E9%80%9A%E8%BF%87`（"通过"）应命中；阴性关键词应返 0。

## 前端 UI 规范
- 表格吸顶：`min-h-0 flex-1 overflow-auto` 单层滚动；禁 `h-full overflow-auto` 嵌套；禁 sticky th blur；用 `border-separate border-spacing-0`。
- 页面内勿加内层 padding（间距由 app-layout `p-4 md:p-6`）；列宽 `components/common/use-column-widths.ts`。
- 风格：圆角 4px、表头/标签 13px、列间竖线 `border-l border-border/60`、主色 `#4f46e5` 不动。
- icon 必须真实登记：`icons.ts:106 ICON_MAP` 漏登记静默回退 `LayoutDashboard`。
- 整行可点 (R-1)：行 onClick+role=button+tabIndex+Enter/Space；行内按钮 stopPropagation；键盘事件 `e.target!==e.currentTarget` 防误取消。
- 🔴 **覆写共享组件样式必查固定尺寸**：`cn()`=tailwind-merge **只在同类组内去重**、跨类不动。基类 `ui/tabs.tsx` 的 `TabsList` 带 `h-9`(36px 固定)，只覆写 `items-end`/`p-1.5` **压不掉它** → 须显式 `h-auto`（否则卡片式 tab 上浮 8px 探出 bar 顶边）。**此类缺陷 jsdom 测不出**（无布局引擎），只能盒高手算 + 真浏览器 `getBoundingClientRect`；验收用 twMerge 反证（去掉修复类看基类是否复活）。
- 门户三 Tab 激活态在 `stores/portal-tab-store.ts`（**不进 URL**：keep-alive 直挂、不在 Route 上下文，改 query 会踩「URL 变了但常驻实例不重渲染」）。**门户相关测试必须在 `beforeEach` 复位该 store**，否则串味且偶发难查。

## 🔴 前端路由两大坑（同一根因）
`keep-alive-outlet.tsx:350` 页面以 `<Comp/>` 渲染，**不在任何 `<Route>` 上下文**；`router.tsx` 只登记通配 `/task/*` ⇒ `useParams`/`useMatch` 恒空。
- 动态路径须登记 `DYNAMIC_PAGES { prefix:'/task/process/', ... }`（prefix 必以 `/` 结尾）；`PAGE_MAP` key 不能含 `:` 或以 `/` 结尾。
- 详情页取 ID 须 `useState(()=>parse(pathname))` 冻结 pathname（keep-alive 让 Tab 常驻），返回三态 `{instanceId,reason}`。

## 前端 mock 范式（测试已确立）
- api 层：`vi.mock('@/lib/api/xxx', () => ({ 函数: vi.fn() }))` + `vi.mocked(...).mockResolvedValue(...)`。
- zustand **不 mock**：`useAuthStore.setState(...)`；`next-themes` **必须 mock**。
- `AppRail` 应用名渲染两次须 `getAllByText`；不能用 `queryByRole('banner')`。

## 多 Agent 实施纪律
1. 单批 ≤2–4 新文件，无 >15KB 超大单文件。2. 临时脚本/输出放系统临时目录。3. 测试真实性：禁删测试/skip/`as any`/改 fixture。4. 主理人验证：不信转述，查磁盘+独立跑门禁。5. 派活前 `git status`+`git log`。
- 三脚本 `build-dev.ps1`/`start-dev.ps1`/`stop-dev.ps1` 均有硬编码服务清单，新增后端模块须同补三处；须 UTF-8 BOM（`encoding='utf-8-sig'`）。

## AI 平台现状（备查）
- `agent/ai-platform/backend/src` = 223 py/64k 行；Worker `mis_iqd`/`mis_rag`；gateway Node/TS。
- BFF 走 Nacos `lb://mis-admin-bff`；启动须 `MIS_REMOTE=true`+Nacos 三项+DB/Redis 10.254.16.6+JWT 绝对路径+`SERVER_PORT=8081`。缺 sys_api/sys_menu_api/sys_role_permission→40300。
- mis-iqd：表前缀 `iqd_*`，API `/api/v1/iqd/**`，Worker 经 `/internal/v1/iqd/**` 不直连库(fail-closed 45204)。

## 历史雷区指针（动此域先读 `2026-10-09.md`/`2026-10-10.md`）
- 消息待办 4 缺陷已修(`26530fba`)：越权/REJECT漏同步/并发无锁/审计挂错路径；核心门面 `InboxActionService`（单向注入，反向会循环依赖启动失败）。`sys_task`↔`wf_task` 为 0..1:1 非镜像。
- 流程编排改造 6 commit(`1bf02b6`→`0209aa7`) 已完成。
- 门户 `/portal` 布局孤岛（无 AppLayout，`app-layout.tsx` 仅 `hideSidebar = pathname==='/portal'` 包 `<aside>`），业务单据页尚不存在(P3-4)。

## 已交付里程碑（分支 `flow`，最新在上）
- `2dd0600` feat(portal) 门户 UI 精修：Tab 卡片式风格(图标+文字、不可关闭) + 首页三板点行改抽屉滑出 + 铃铛下拉「待办+消息合计最近 20 条」+「打开消息中心」真正切 Tab。纯前端，`ui/tabs.tsx` 零改动。
- `c51a14b` chore(memory) 精简 MEMORY.md 至注入限额内。
- `72cfaa5` fix(bff) 下游 URI 双重编码（真 Bug=TaskflowWebClient；Kb/System 防御性统一）→ **live 已验证中文检索恢复**。
- `e5c3adf`/`9753325`/`68561fb`/`62ac401` 门户三 Tab 重构 + 消息↔实例关联 + 回复回写审批意见。
- `498f476`/`e1f8632`/`f3b3a3f` 分类筛选下拉树多选 + 表单表格高度修复 + 流程定义分类过滤。
- `988bd91`/`b30b8fc` 表单分类独立成表（V133 `form_category`；`form_definition.category_id` 软引用；旧 `kind`/`parent_id` 停读写不 DROP；BFF `/form-categories` sys_api 95066–95071 绑菜单 95011）。

## 待办/遗留（非阻塞）
- 测试库 `wf_category.id=990001` 外部漂移（集成测试唯一失败源）；`app-layout-portal.test.tsx` 建议改 `data-testid`。
- 「查看文档切分效果中文 0 命中」若仍在，根因**不在 BFF** → 查 mis-kb chunk 匹配 / RAGFlow 检索语义。
- `uriOf` null 值产出 `q=`（旧为 `q`，语义等价）；`listEngineOrphans`/`BankReceiptClient` 字符串拼接（含 `&`/`=` 有截断风险，当前参数安全）。
