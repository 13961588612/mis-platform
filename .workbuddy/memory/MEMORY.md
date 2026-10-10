# MIS 平台项目记忆（curated — 2026-10-10 精简）

> 维护规则：追加式；与实测冲突先核实再改。详细会话日志见各 `YYYY-MM-DD.md`；本文件只留跨会话黄金知识 + 当前状态，避免注入超限。

## 端口与启动
- 主前端 **5174** / gateway 8080 / BFF **8081** / ai-platform 8000 / ai-platform-gateway 3100 / mis-iqd 8109 / mis-iam 8102 / mis-org 8103 / mis-system 8105 / mis-taskflow **8104** / WrenAI 控制 9100+数据 9101。
- 集成栈 `scripts/start-integration-stack.ps1` 只做 infra+flyway+gateway:8080+audit，**不含** mis-iqd/BFF/ai-platform/前端。
- 登录：`GET /api/v1/auth/captcha`(SVG 4位) → `POST /api/v1/auth/login`(admin/Mis@123456) → Bearer；需 appCode=system。
- **沙箱硬限制**：只回收脱离父命令的孤儿进程(~13s)，常驻 java 会被 SIGKILL → 长服务放单条前台命令(timeout≤600000)。禁 cmd.exe。

## 构建/测试门禁（🔴 OOM 陷阱，极具误导性）
- 前端必须 `pnpm install`/`pnpm add`（npm 必崩）。测试 `npm run test`；类型 `npm run typecheck`。eslint 存量 `arch/no-cross-feature` 11 error 在 `features/ai/`+`features/system/`。
- `exit 1 + 零输出` = 被 OOM kill，**不等于代码错**（真类型错 tsc 必打印 `error TSxxxx`）。解法：
  - 测试：`NODE_OPTIONS="--max-old-space-size=700" npx vitest run --pool=threads --poolOptions.threads.singleThread=true`
  - 类型：`node --max-old-space-size=1400 ./node_modules/typescript/bin/tsc --noEmit`
  - ❌ 绝不给 8192。tsc 空输出+EXIT=1 约 1/3 概率，重试即过。
- Java：JDK17 `D:\software\jdk-17.0.2`。后端测试 PowerShell：`.\mvn.ps1 -pl mis-taskflow test "-Dsurefire.forkCount=0"`，env `MIS_DB_TEST=true DB_HOST=10.254.16.6 DB_PORT=5432 DB_NAME=mis_platform DB_USER=mis DB_PASSWORD=mis123`。⚠️ `-pl X -am test -Dtest=Y` 必加 `-Dsurefire.failIfNoSpecifiedTests=false`；forked JVM 被杀须 `-Dsurefire.forkCount=0`（仅本机）。
- git：提交前 `git diff --cached --name-only`（`git mv` 静默暂存 rename）；分组用 `git reset --soft HEAD~1`+`git restore --staged`；用系统版 git `-C D:/...`。

## 数据库/迁移
- Flyway **只追加**：绝不改历史迁移（checksum 变更阻塞整条链）。派工前 grep `sys_api`+`sys_menu_api` 核实权限码真值，否则「前端放行后端 40300」。
- 测试库直连 Flyway：`cd backend/mis-migrator; ..\mvn.ps1 flyway:migrate "-Ddb.host=10.254.16.6" "-Ddb.port=5432" "-Ddb.name=mis_platform" "-Ddb.user=mis" "-Ddb.password=mis123"`。
- 真实 PG 在 10.254.16.6:5432；alembic `POSTGRES_HOST` 默认 postgres（仅 Docker 内网），宿主机跑须 `$env:POSTGRES_HOST=10.254.16.6`。

## 🔴 BFF deny-unmapped：sys_api 五批次坑（最大教训）
`application.yml:103 deny-unmapped:true`：每个端点必须登记 `sys_api` 且绑定授权菜单，否则 403。共同特征：**不报错但功能静默失效**，单测测不出，只能端到端发现。
1. 漏登记 92158/V51 2. 漏登记 92586/V91 3. **PUT 端点从来没登记**(V128 补 95056) 4. **绑错菜单**(V130 补绑 95007) 5. BFF 包路径 `com/mis/adminbff/`（非 `com/mis/admin/bff/`）。
- 回填多表关联笛卡尔积陷阱：凡「按两个 IN 列表分别匹配」的多表 UPDATE，先停下手改成 JOIN（经 `wf_instance` 关联）。

## 🔴 开发机「构建/进程」过期会伪装成代码缺陷
BFF/mis-taskflow 的 `/api/v1/**` 响应缺字段/值为 null（新字段整个不存在），根因常是**跑的构建过期**（源码对）。两种形态：
1. **jar 过期**：验收前重建 `cd backend; .\build-dev.ps1 mis-taskflow`（或 `mvn -pl mis-taskflow,mis-admin-bff -am -DskipTests package`）。
2. **进程过期（更隐蔽，2026-10-10 踩坑）**：服务由 `start-dev.ps1` 的 `mvn spring-boot:run` 跑 **`target/classes`**（不走 jar）⇒ **重建后不重启进程，运行中的 JVM 仍跑旧 classes**。⚠️ 判「是否新代码」**别信 jar/classes 时间戳**（会误导），要看**运行进程启动时间**（`netstat -ano` 取 PID → 日志 `Started ...Application`）与**接口实际返回是否含新字段**。
- 单测全绿 ≠ 部署已生效；重启：`cd backend; .\start-dev.ps1 <svc> -Restart`。
- Redis 缺失让 `/actuator/health` 返 503 但业务正常 ⇒ 不能用 health 判就绪；`ApiPermissionRegistry` 启动后异步灌(300s) ⇒ BFF 头 20s 任何 `/api/v1/**` 返 40300，脚本需预热。

## 前端 UI 规范
- 表格吸顶：`min-h-0 flex-1 overflow-auto` 单层滚动；禁 `h-full overflow-auto` 嵌套；禁 sticky th blur；用 `border-separate border-spacing-0`。
- 页面内勿加内层 padding（间距由 app-layout `p-4 md:p-6`）；列宽 `components/common/use-column-widths.ts`。
- 风格：圆角 4px、表头/标签 13px、列间竖线 `border-l border-border/60`、主色 `#4f46e5` 不动。
- icon 必须真实登记：`icons.ts:106 ICON_MAP` 漏登记静默回退 `LayoutDashboard`；改 icon 要断言有该键。
- 整行可点 (R-1)：行 onClick+role=button+tabIndex+Enter/Space；行内按钮 stopPropagation；键盘事件用 `e.target!==e.currentTarget` 防误取消。

## 🔴 前端路由两大坑（同一根因）
`keep-alive-outlet.tsx:350` 页面以 `<Comp/>` 渲染，**不在任何 `<Route>` 上下文**；`router.tsx` 只登记通配 `/task/*` ⇒ `useParams`/`useMatch` 恒空。
- 动态路径须登记 `DYNAMIC_PAGES { prefix:'/task/process/', ... }`（prefix 必以 `/` 结尾）；`PAGE_MAP` key 不能含 `:` 或以 `/` 结尾。
- 详情页取 ID 须 `useState(()=>parse(pathname))` 冻结 pathname（keep-alive 让 Tab 常驻，直读实时 location 切 Tab 串味），返回三态 `{instanceId,reason}`。

## 前端 mock 范式（测试已确立）
- api 层：`vi.mock('@/lib/api/xxx', () => ({ 函数: vi.fn() }))` + `vi.mocked(...).mockResolvedValue(...)`。
- zustand **不 mock**：`useAuthStore.setState(...)`；`next-themes` **必须 mock**。
- `AppRail` 应用名渲染两次须 `getAllByText`；不能用 `queryByRole('banner')`。

## 多 Agent 实施纪律
1. 单批 ≤2–4 新文件，无 >15KB 超大单文件（超量必跑满 150 轮）。2. 临时脚本/输出放系统临时目录，不落仓库。3. 测试真实性：禁删测试/skip/`as any`/改 fixture。4. 主理人验证：不信转述，查磁盘+独立跑门禁。5. 派活前 `git status`+`git log` 确认无人同区域动手。

## 开发脚本模块清单（易漏）
`backend/build-dev.ps1`/`start-dev.ps1`/`stop-dev.ps1` 三处都有硬编码服务清单；新增后端模块须同时补三处。三脚本须 UTF-8 BOM，改写用 `encoding='utf-8-sig'`。

## AI 平台现状（备查）
- `agent/ai-platform/backend/src` = 223 py/64k 行；两个 Worker `mis_iqd`/`mis_rag`；gateway Node/TS。
- BFF 走 Nacos `lb://mis-admin-bff`；启动须 `MIS_REMOTE=true`+Nacos 三项+DB/Redis 指向 10.254.16.6+JWT 绝对路径+显式 `SERVER_PORT=8081`。缺 sys_api/sys_menu_api/sys_role_permission→40300。
- mis-iqd：表前缀 `iqd_*`，API `/api/v1/iqd/**`，Worker 经 `/internal/v1/iqd/**` 不直连库(fail-closed 45204)。

## 历史雷区指针（动此域先读 `2026-10-09.md`/`2026-10-10.md`）
- 消息待办 4 缺陷已修(commit `26530fba`)：越权/REJECT漏同步/并发无锁/审计挂错路径；核心门面 `InboxActionService`（单向，反向注入会循环依赖启动失败）。`sys_task`↔`wf_task` 为 0..1:1 非镜像。
- 流程编排改造 6 commit(`1bf02b6`→`0209aa7`) 已完成：表单白名单下拉/定义弹窗/发布门控/designer-body 抽离/全屏 Dialog/编辑态还原。
- 门户 `/portal` 是布局孤岛（无 AppLayout），业务单据页尚不存在(P3-4)。

## 当前状态：表单/分类已「双表拆分」（2026-10-10 最新）
需求演进：先做双Tab+`kind`(CATEGORY/FORM 复用单表, commit `ff4c86c`/V131) → 用户改要求**拆两表**：分类独立 `form_category`、分类成为**表单的属性**（非父级），但**保留分类层级树**。（流程分类 `wf_category` 独立链已在 V131/V132 跑通，本轮不动。）
- 本轮（team `software-form-split`，**未 commit**）：**V133** 新建 `form_category` 邻接树（逐列镜像 `wf_category`）；`form_definition` 仅存表单 + 新增 `category_id BIGINT NULL` 软引用（无外键）；旧 `kind`/`parent_id` **保留但代码停读写（软废弃，不 DROP）**——因两个迁移验收测试(`FormDefinitionMigration`/`WfCategoryMigration`)断言这两列/索引存在，DROP 会触红线。BFF 新端点 `/api/v1/form-categories`(tree/list/{id}/POST/PUT/DELETE) 登记 `sys_api 95066–95071` 全绑菜单 **95011**(`biz:form:list`)；`95050–95056` 仍 7 行(95051 休眠保留)、`form-definitions/tree` 端点已移除。
- 前端：新 `form-category.ts`/`form-category-tree.tsx`；`form-definition-manage-page.tsx` 双TAB(表单管理=表格+分类列+分类筛选 / 分类管理=form_category树)；`form-definition-dialog.tsx`「分类」下拉写 `categoryId`(可空=未分类)；删 `form-definition-tree.tsx`。保留 `hasFormLoader` 标红；必须保留 `fetchEnabledFormDefinitions`(流程编排 `form-catalog.ts` 在用)。
- 验收：后端 5 类集成测试 **48/0/0/0**、前端 tsc EXIT=0 + **949 passed(1 todo)**；红线(V120–V132 零改动、HEAD 仍 `ff4c86c`)；QA **IS_PASS=YES / NoOne**。
- ⚠️ **live 待重启**：运行中 8104/8081 仍是拆分前旧进程（`form-definitions` 返旧 `kind`/`parentId`、`/form-categories/*` 路由未映射；判据：请求不存在路径也返 500）。新端点须 `rebuild+restart` 后才有 live 意义。
- ✅ 更正（实测）：上一会话「V132 残留 95057/95058 孤儿行」为**误判**——`sys_api`/`sys_menu_api` 的 95057–95059 均 0 行（空闲段），无 menu 95007 引用。
- 未提交文件（待用户决定统一提交）：本轮代码/迁移 `V133`+taskflow+BFF+前端 + `docs/design/form-category-split-*`；更早的 `docs/system_design.md`/`class-diagram.mermaid`/`sequence-diagram.mermaid`；`.workbuddy/memory/MEMORY.md`。
