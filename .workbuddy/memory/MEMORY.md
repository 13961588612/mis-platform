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
- 待办：上线前填真实域名(mis.local 占位)、存量 PG 卷需 DBA 手跑 init SQL、两项既有技术债单独排期、push 远端。
- ⚠️ 技术债归属（易串，2026-08-04 实测澄清）：上述「前端 13 类型错误 / 网关 20 tsc」**属 agent/ai-platform**（H5 前端 + TS gateway），**与 `frontend/mis-admin-web` 无关**。别把这笔账安到主 MIS 前端头上。

## 启动与测试（2026-07-25 核实）
- **一键集成栈**：`scripts/start-integration-stack.ps1`（项目根，非 deploy/ 下）。先用 `docker compose -f deploy/docker-compose.dev.yml up -d` 起基础设施（PG/Redis/Nacos/MinIO，dev compose 只含这四个，不含 mis 微服务），再跑该脚本起微服务。
- **主 MIS 前端** `frontend/mis-admin-web`：`npm run dev` → vite :5173，`server.proxy` 把 `/api` 转到 `http://localhost:8080`（**mis-gateway**，不是 BFF 8081）。代码里用相对 `/api/v1/**`，无 baseURL 环境变量。
- **BFF** `mis-admin-bff` 端口 **8081**，聚合 mis-iam:8102 / mis-org:8103 / mis-system:8105；本地 `.\mvn.ps1 spring-boot:run -pl mis-admin-bff`。请求经 mis-gateway 登录后透传 `X-User-Id/X-Tenant-Id/X-App-Id`。
- **测试约束**：① 主 MIS 前端 `mis-admin-web` **无 vitest/jest 运行器**，唯一自动门禁是 `npm run typecheck`（tsc --noEmit）；验证靠手动联调。**实测基线（2026-08-04）**：typecheck **exit 0、零类型错误**（tsconfig 确为 strict + noUnusedLocals/Parameters，非空跑，耗时约 65s）；存量债在 **eslint** 侧——`npx eslint .` 报 11 error + 14 warning，11 个 error 全是 `arch/no-cross-feature`，集中在 `features/ai/context/form-fill-bridge.tsx` 与 `features/system/` 两处，`features/kb/` 零问题。查前端存量债请跑 eslint，别对着 typecheck 找。② Java 微服务需 **JDK17**；**沙箱实测 JDK17.0.2 可用**（`D:\software\jdk-17.0.2`，已注册 `~/.m2/toolchains.xml`），可直跑测试。`mvn` 命令因 MAVEN_HOME/JAVA_HOME 损坏直接调用失败，须用 JDK17 直启 classworlds launcher 绕过（命令见 2026-08-04 日志）；mis-kb/mis-admin-bff **零 @SpringBootTest/@DataJpaTest**，仅 Mockito 单测，JPA 映射层需 dev 栈 PG 启动自检方可验证（沙箱不可达）。③ Python 测试在 `agent/ai-platform/backend`（`.venv/Scripts/python.exe -m pytest`），与 Sprint2 主 MIS 无关。
- **`deploy/docker-compose.stack.yml`** 是混合联调稳定服务栈（含 mis-gateway/audit/auth 等微服务）；AI 融合用 `docker-compose.ai.yml` 叠加。

## FormFill × Agent 平台整合（2026-07-30 锁定 P0）
- **目标**：把 mis-admin-bff 的 AI Skill 表单填充引擎暴露为 agent 平台（企微/H5）可调能力，打通「对话→填充→HITL→写回」端到端。
- **反向信任（关键，新建链路）**：ai-platform→BFF 镜像 identity-jwt 双因子——平台凭证 `X-Platform-Token` + 委托用户 MIS JWT `X-Mis-Upstream-Jwt`(RS256,iss=mis-platform) + 信任域(来源 IP CIDR)；BFF `ReverseTrustInterceptor`(@Order HIGHEST_PRECEDENCE) 校验，失败写 401+Result JSON。与既有 BFF→ai-platform(MIS JWT) 方向相反。
- **status 枚举实际值（大写是设计文档笔误）**：Java 用小写 `success|hitl_required|manual_required|error`。
- **契约要点**：Python `FormFillClient.execute_skill` 必须发**顶层 `pageContext`**（含 docType/docId + 内层表单上下文），Java `SkillExecuteRequest` 无 `context`/`sessionId`；响应 `Result{code,message,data}` 需解 `.data` 层。success 路径在 Python 侧自动调 `submit_formfill_apply` 写回。
- **A2UI entity-select**：单一事件双通道同构降级（H5 表单 / 企微 button_interaction 卡片），resumeToken 绑定 conversationId。
- **文件分布**：批次1 mis-admin-bff(Java 12 文件) + 批次2 ai-platform(Py/TS 29 文件)；整合层依赖 FormFill 引擎地基(SkillExecutionEngine/DagBuilder/ParameterResolver/SkillLoader + DTO)。
- **提交状态（2026-07-31）**：全部已提交。拆为两提交——`ccf1ec2`(引擎地基 15 文件) + `cae4a60`(整合层 43 文件)；O1 修复 `5da8ad1`(formfill_client.py)；交付报告 `b03eaf5`(`deliverables/software-company/formfill-agent-integration-delivery-2026-07-31.md`)。提交时**刻意排除**并行改动：mis-org MCP、adminbff 独立 MCP 模块(McpConfig/McpClient/...)、AiCapabilityTranslator、frontend/mis-admin-web 的 AI 表单 UI、记忆文件。详见 2026-07-31 日志。
