# MIS 平台项目记忆

## agent/ai-platform 融合部署约定（2026-07-24 锁定）
- **编排**：`deploy/docker-compose.ai.yml` 叠加层（与 dev/stack 用 `-f` 叠加），并入 qdrant/embedding/outbound-proxy/gateway(TS 3100)/backend(Py 8000)/frontend(H5 静态)；复用主栈 postgres/redis/nacos。
- **共享基础设施**：PG 共享主实例，新增库 `ai_platform`（角色 `aiplatform`，Alembic 管 schema，与 Flyway 管的 mis_platform 隔离，init 脚本 `deploy/postgres/init/02-create-ai-platform.sql` 幂等）；Redis 共享主实例，**db index 2 + 键前缀 `aip:`**（MIS 维持 db0 + `mis:`）。
- **边缘入口**：去 agent 独立 nginx；`deploy/nginx/edge.conf` 共享边缘 nginx，反代 `/api`、`/ws` 到 `ai-platform-gateway:3100`（WS Upgrade 透传 + `proxy_buffering off` 保 SSE）；独立入口 `agent.<域>`。
- **嵌入鉴权**：TS gateway `auth.ts` 双验签——agent 自有 HS256(iss=ai-platform) + MIS RS256(iss=mis-platform, 公钥 `backend/keys/public.pem`)；H5 `useAuth.ts` 监听父域 `postMessage({type:AUTH_TOKEN})` + `?token=` 兜底。
- **A2UI**：backend 事件流 `ui.render{component,props}`；TS gateway 对 H5 1:1 透传、Bot 降级 template_card；H5 组件注册表真实渲染（禁 dangerouslySetInnerHTML）。
- **BFF**：`mis.ai-platform.base-url` 迁入 Nacos（`http://ai-platform-backend:8000`），生产 `sse-enabled: true`。
- ⚠️ 技术债归属（易串）：前端 13 类型错误 / 网关 20 tsc 属 **agent/ai-platform**（H5+TS gateway），**与 `frontend/mis-admin-web` 无关**。

## 启动与测试（2026-07-25 核实，仍有效）
- **一键集成栈**：`scripts/start-integration-stack.ps1`。先 `docker compose -f deploy/docker-compose.dev.yml up -d`（PG/Redis/Nacos/MinIO），再跑脚本起微服务。
- **主 MIS 前端** `frontend/mis-admin-web`：`npm run dev` → vite :5173，proxy 把 `/api` 转 `http://localhost:8080`（**mis-gateway**，非 BFF 8081）；代码用相对 `/api/v1/**`，无 baseURL 变量。
- **BFF** `mis-admin-bff` 端口 **8081**，聚合 mis-iam:8102 / mis-org:8103 / mis-system:8105；本地 `.\mvn.ps1 spring-boot:run -pl mis-admin-bff`。请求经 mis-gateway 登录后透传 `X-User-Id/X-Tenant-Id/X-App-Id`。
- **测试约束**：① 主 MIS 前端 **无 vitest/jest**，唯一门禁 `npm run typecheck`（tsc --noEmit，strict+noUnusedLocals）；**存量债在 eslint 侧**（`npx eslint .` 报 `arch/no-cross-feature` 11 error，集中在 `features/ai/context/form-fill-bridge.tsx` 与 `features/system/`，`features/kb/` 零问题；master 另有 `features/kb/operations/kb-qa-record-tab.tsx` TS6133 噪声，非本次引入）。② Java 需 **JDK17**（`D:\software\jdk-17.0.2`）；`mvn` 直调损坏，须 JDK17 直启 classworlds launcher；mis-admin-bff **零 @SpringBootTest**，仅 Mockito 单测。③ Python 测试在 `agent/ai-platform/backend`（pytest）。
- `deploy/docker-compose.stack.yml` 混合联调稳定栈；AI 融合用 `docker-compose.ai.yml` 叠加。

## 表格吸顶/列宽/间距 全站规范（2026-08-06 收口，高频踩坑）
- **KeepAlive 布局**：每页被包 `flex min-h-0 flex-1 overflow-auto` 外层（`keep-alive-outlet.tsx`）。内部表格吸顶必须 `min-h-0 flex-1 overflow-auto` 单层滚动；**禁止** `h-full overflow-auto` 嵌套（sticky 参照错乱）。
- **禁用**：sticky `th` 上 `backdrop-blur`（抖）；`border-collapse` + sticky 表头（Chrome/Safari 失效，用 `border-separate border-spacing-0`）。全局已在 `styles/globals.css` 的 `thead th` 统一加 `position:sticky;top:0;z-index:10` 并关 `backdrop-filter`。
- **列宽拖拽**走 `components/common/use-column-widths.ts`；**面包屑**由 PageHeader 统一传；**间距**由 app-layout 外层 `p-4 md:p-6` 控制，页面内别再写内层 padding；**sidenav 分组 label** 由 app-layout 按 activeAppCode 传 `sectionLabel`，别硬编码。

## UI 风格对齐（2026-08-06 决策）
- 按外部发票截图对齐字体/表格：圆角 6→4px（`--radius:0.25rem`）、表头 14→13px、表单标签 14→13px、列表/树表列间竖线 `border-l border-border/60`。
- 改动集中在 `styles/globals.css` + `components/ui/label.tsx` + `features/system/admin-list-page.tsx` + `components/common/tree-table.tsx`。**主色暂不动**（保留 `#4f46e5`）。门户原型 `mis-portal-prototype.html` 独立 HTML 不读 globals.css，不随变。

## FormFill × Agent 平台整合（2026-07-30 锁定 P0，2026-07-31 已提交）
- 反向信任：ai-platform→BFF 用 `X-Platform-Token` + `X-Mis-Upstream-Jwt`(RS256) + 信任域 CIDR；BFF `ReverseTrustInterceptor` 校验。status 枚举小写 `success|hitl_required|manual_required|error`。
- 提交：`ccf1ec2`(引擎地基) + `cae4a60`(整合层) + `5da8ad1`(O1) + `b03eaf5`(交付报告)。

## Agent 控制台前端 + BFF 近期关键事实（2026-08-06，务必看）
- **已交付**：T03 fail-closed 权限闸门（Python `640294a` + `f0754b6`）、T05 前端 12 页（运维控制台占位→真实页，`b619f255`）。
- **重大债已修（P0/P1）**：`frontend/mis-admin-web/src/features/agent/types.ts` 原 **6 类 DTO 按设计文档臆造、与 ai-platform 真实 wire 不符**（`Skill` 把分页对象当数组、`AgentSummary.id` 实为 `agent_id`、`RouteStat` 实为聚合对象、`Approval`/`Session`/`SessionMessage` 字段 camelCase 错配、#33 回包结构不同）。已按 ai-platform 源码逐一对齐：`skill_id` / `agent_id` / 聚合 `RouteStats` / `session_id`+`response` / camelCase `Approval`+5 状态 / `metadata`+`timestamp`。proxy_status 崩溃 + 7 高危 + 中危全消，`features/agent` typecheck 0 错。
- **BFF→ai-platform 401 已修**：`AgentOpsTransport.exchange()` 只透传 `X-User-Id` 等、未转发 MIS JWT → ai-platform `get_current_user` 强制 `Authorization: Bearer` 故 401。新增 `MisJwtCaptureFilter`(入站捕获 JWT 入 ThreadLocal) + `DownstreamAuthContext` + `AgentOpsTransport.agentOpsHeaders()` 补头。`exchange()` 用 `.block()` 同步发请求，servlet 线程 ThreadLocal 可见，修复生效。回归测试 `AgentOpsTransportAuthHeaderTest`/`MisJwtCaptureFilterTest`。**改动均未提交 git**。
- **T04 尚未交付的端点（设计内、非故障，联调返回 501/404）**：`/api/v1/admin/worker-catalog`、`/api/v1/sessions`、`/api/v1/admin/channels/wecom/bots`、`/api/v1/admin/approvals`（⚠️ BFF 路径写错，应为 `/push/approvals`）、`/api/v1/agents/{id}/config-files`。这些回来前 Agent 控制台部分页为占位/空态属正常。
- **P2 已知遗留（等 T04 后端定型后统一收）**：① `MonitorOverview` 整块虚构（真实 wire 是 `{proxy,llm,admin}` 三路聚合），`agents_running/agents_total` 不在 wire → 概览页「运行中 / 已登记 Agent」显示 `undefined / undefined`（非崩溃，模板字面量）；② MCP 四字段 `state/tool_count/enabled/updated_at` 恒 0；③ `enabled_skill_count` 恒 0。
- ⚠️ 主理人角色铁律：走 SOP 时严禁自己下场写码，须 TeamCreate + 派 `software-engineer`/`software-qa-engineer` 等子 Agent（name 与 subagent_type 同传 Agent ID）；BugFix/快速模式可跳过 PRD/架构。
