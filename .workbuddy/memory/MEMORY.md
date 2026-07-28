# MIS 平台项目记忆

## 门户原型与系统管理单文件集成
- 门户原型：`docs/frontend/design-proposal/mis-portal-prototype.html`（登录→门户→子系统，含 Light/Dark、流程中心、系统管理）。
- 系统管理（14 页 CRUD）已**合并进**门户「系统管理」子系统（单文件，数据驱动引擎 `sa*` 命名空间 + `.sa-app` 作用域 CSS + `sa-` 前缀持久 overlay）。
- 改 SA 引擎后重做单文件集成：编辑 `.workbuddy/_sa_engine.js` 与 `.workbuddy/_sa_css.css`，再 `node .workbuddy/_splice.js`（会先 `git restore` 门户到干净态再注入，避免重复合并）；回归测试 `node .workbuddy/_smoke.js`（需 jsdom，装在 `node/workspace`）。
- 注意：`sa-` 前缀转换要同步改「查询选择器」与「HTML 字符串里的 id」；调用 `toast(` 改名 `saToast(` 时必须同时补 `saToast` 定义；overlay 必须放在 `#view-subsystem` 之外（门户 `buildChrome` 会重写内部 overlay）。详见 2026-07-20 日志。

## agent/ai-platform 融合部署约定（2026-07-24 锁定）
- **编排**：新增 `deploy/docker-compose.ai.yml` 作为叠加层（与 dev/stack 用 `-f` 叠加），并入 qdrant/embedding/outbound-proxy/gateway(TS 3100)/backend(Py 8000)/frontend(H5 静态)；复用主栈 postgres/redis/nacos。
- **共享基础设施**：PG 共享主实例，新增库 `ai_platform`（角色 `aiplatform`，Alembic 管 schema，与 Flyway 管的 mis_platform 隔离，init 脚本 `deploy/postgres/init/02-create-ai-platform.sql` 幂等）；Redis 共享主实例，**db index 2 + 键前缀 `aip:`**（MIS 维持 db0 + `mis:`），两端 config/compose 一致。
- **边缘入口**：去 agent 独立 nginx(:80)；新增 `deploy/nginx/edge.conf` 共享边缘 nginx（主栈 service），托管 H5 静态 + 反代 `/api`、`/ws` 到 `ai-platform-gateway:3100`（WS Upgrade 透传 + `proxy_buffering off` 保 SSE）+ `frame-ancestors` CSP + CORS `credentials`；独立入口 `agent.<域>`（H5 静态挂 nginx，无常驻容器）。
- **嵌入鉴权**：TS gateway `auth.ts` 双验签——agent 自有 HS256(iss=ai-platform) + MIS RS256(iss=mis-platform, 公钥 `backend/keys/public.pem` 挂 `/keys/public.pem`)；H5 `useAuth.ts` 监听父域 `postMessage({type:AUTH_TOKEN})` + `?token=` 兜底。
- **A2UI**：backend 事件流发 `ui.render{component,props}`，TS gateway 对 H5 渠道 1:1 透传、Bot 渠道降级 template_card；H5 `src/components/a2ui/` 组件注册表真实渲染（禁止 dangerouslySetInnerHTML）。
- **BFF**：`mis.ai-platform.base-url` 已迁入 Nacos（`http://ai-platform-backend:8000`），生产 `sse-enabled: true`。
- 待办：上线前填真实域名(mis.local 占位)、存量 PG 卷需 DBA 手跑 init SQL、两项既有技术债(前端13类型错误/网关20 tsc)单独排期、push 远端。

## 启动与测试（2026-07-25 核实）
- **一键集成栈**：`scripts/start-integration-stack.ps1`（项目根，非 deploy/ 下）。先用 `docker compose -f deploy/docker-compose.dev.yml up -d` 起基础设施（PG/Redis/Nacos/MinIO，dev compose 只含这四个，不含 mis 微服务），再跑该脚本起微服务。
- **主 MIS 前端** `frontend/mis-admin-web`：`npm run dev` → vite :5173，`server.proxy` 把 `/api` 转到 `http://localhost:8080`（**mis-gateway**，不是 BFF 8081）。代码里用相对 `/api/v1/**`，无 baseURL 环境变量。
- **BFF** `mis-admin-bff` 端口 **8081**，聚合 mis-iam:8102 / mis-org:8103 / mis-system:8105；本地 `.\mvn.ps1 spring-boot:run -pl mis-admin-bff`。请求经 mis-gateway 登录后透传 `X-User-Id/X-Tenant-Id/X-App-Id`。
- **测试约束**：① 主 MIS 前端 `mis-admin-web` **无 vitest/jest 运行器**，唯一自动门禁是 `npm run typecheck`（tsc --noEmit）；验证靠手动联调。② Java 微服务需 **JDK17**，沙箱 JDK8 编译受限，优先用 Docker 镜像起 / 内网 JDK17 跑 `mvn test`。③ Python 测试在 `agent/ai-platform/backend`（`.venv/Scripts/python.exe -m pytest`），与 Sprint2 主 MIS 无关。
- **`deploy/docker-compose.stack.yml`** 是混合联调稳定服务栈（含 mis-gateway/audit/auth 等微服务）；AI 融合用 `docker-compose.ai.yml` 叠加。
