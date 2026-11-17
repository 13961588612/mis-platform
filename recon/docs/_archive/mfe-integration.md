# recon 嵌入 mis-platform 微前端方案

> 状态：**方案 C（micro-app）已实施**；JWT 认证（阶段 1）/ 用户信息下发（阶段 2）/ 按钮级权限 + 401 联动（阶段 3）已于 2026-08-26 全部闭环。
> 2026-08-27 更新：**方案 A′（BFF 统一转发）已实施**——recon 前端统一走 平台 Gateway(8080) → BFF(8081) → recon-service(8110)，不再直连 8110；recon-service 自建 `JwtAuthFilter` 认证体系已删除，认证/鉴权由平台 BFF 统一收敛（详见 §9）。
> 日期：2026-08-14（实施：2026-08-14）
> 结论先行：**方案 C（micro-app 框架级）已按本文件 §5 落地**；方案 A（iframe）的通用件（JWT 认证、embed 模式）亦已完成（2026-08-26，见 §5.1/§5.3）。方案 B（宿主代码级）放弃独立部署，仅在 recon 完全并入平台节奏时才选。
> 框架决策：**方案 C 的落地框架唯一确定为 micro-app，不实施 qiankun**（Vite 原生友好 + 内置 keep-alive，契合平台 Vite 栈与多 Tab 保活；qiankun 需插件适配且 keep-alive 自实现，成本更高，recon 无存量包袱）。npm 包名为 `@micro-zoe/micro-app`（非 `@micro-zeta`）。

---

## 1. 背景与目标

recon 是 mis-platform 仓库下的新子项目，自包含前后端：

- `recon/recon-admin-web`：React 18 + Vite 5 + TS + Tailwind + shadcn 风格管理后台（端口 5176，API 前缀 `/api/v1/recon`，经平台 BFF 透传，见 §9）
- `recon/recon-service`：Spring Boot 对账引擎（端口 8110，JPA + JdbcTemplate + Quartz + Nacos）

目标：以微前端形态嵌入 mis-platform 管理后台（`frontend/mis-admin-web`），用户从平台门户/菜单进入对账平台，体验上如同平台内建子系统，同时保持 recon **独立开发、独立部署、独立发布节奏**。

---

## 2. 现状盘点

### 2.1 平台侧已具备的微前端基建（可直接复用）

mis-admin-web 的门户与壳子已内置「基座 + 子系统」骨架，`sys_app.runtime` 三态：

| runtime | 含义 | 平台落地 |
|---|---|---|
| `host` | 单体托管（页面代码在壳子内） | system / kb / agent，见 `PAGE_MAP` |
| `iframe` | 远程页面直嵌 | `/iframe/{code}` 路由 + `<iframe src={basePath}>` |
| `remote` | 未来微前端（预留） | `AppItem` 字段已注释预留 |

关键设施：

- **iframe 通道**：`registerIframeApps()`（`src/lib/nav/iframe-apps.ts`）+ `KeepAliveOutlet` 的 `IframePage` 渲染 + `portal-page` 的 `runtime === 'iframe'` 跳转逻辑。**壳子零改动**即可嵌入。
- **数据驱动注册**：门户/顶栏切换器由 `sys_app`（`code / runtime / base_path / portal_group / icon / enterable`）+ `sys_menu` 驱动，插入数据即完成注册。
- **令牌下发协议**：`src/lib/ai-h5.ts` 已定义 `postMessage { AUTH_TOKEN / PAGE_CONTEXT / AUTH_READY }` 协议（Agent H5 在用），iframe 子应用取父页 JWT 的现成范式。
- **API 约定**：recon 对外统一走 `/api/v1/recon/**`（Gateway → BFF 透传，方案 A′ §9）；recon-service 内部端点仍为 `/internal/v1/recon/**`。
- **注册发现**：recon-service `bootstrap.yml` 已接入 Nacos config + discovery，可直接注册为平台微服务。

### 2.2 recon 侧现状与差距

| 项 | 现状 | 差距 |
|---|---|---|
| 认证 | recon-admin-web 无登录页；recon-service 不自验 JWT（自建 JwtAuthFilter 体系已删，2026-08-27），认证与鉴权由平台 BFF 统一收敛（authOnly） | ✅ 已闭环：token 注入 / 401 联动 / 用户信息下发 / 按钮级权限 |
| 布局 | recon 自带 `AppLayout`（侧栏 + 顶栏） | 嵌入后与壳子导航重复，需「嵌入模式隐藏自身布局」 |
| 路由 | `createBrowserRouter` 根路径 `/` | 嵌入/独立运行双模式需路由 basename 适配 |
| 令牌存储 | axios 无 Authorization | 需从父页取 token 注入请求头 |
| 样式 | 独立 `globals.css` 设计令牌（indigo） | 与壳子令牌一致，禁止漂移 |

---

## 3. 候选方案对比

| 维度 | A. iframe 嵌入（复用现成通道） | B. 宿主代码级（runtime='host'） | C. micro-app 框架级（框架已定） |
|---|---|---|---|
| 壳子改动 | 零 | 迁代码进 `PAGE_MAP` | 引入框架 + 子应用注册 + 容器路由 |
| recon 独立部署 | ✅ | ❌（随平台发版） | ✅ |
| 壳内融合（共享顶栏/多Tab/主题） | ❌ 双层导航 | ✅ | ✅ |
| 令牌/认证 | postMessage 下发 | 直接共享壳子 auth | actions / setData 下发 |
| 接入成本 | 低 | 中（代码搬运 + 双仓同步） | 中高（保活融合最绕） |
| 回退难度 | 低（可随时切回） | 中 | 中 |
| 适用 | 快速上线、域边界清晰 | recon 并入平台节奏 | 需要壳内深度融合体验 |

平台既有文档《微前端架构与 MIS 各子系统接入方案》（`docs/frontend/micro-frontend-integration.md`）对整页子系统推荐 qiankun / micro-app，但明确「体量未到阈值，现在守边界」。对 recon 这类**全新独立子项目**，A 是成本最低、可回退的起点；交互密度上来再升 C。C 框架二选一时选 **micro-app**（理由见文首「框架决策」），qiankun 仅作对比记录。

---

## 4. 方案 A：iframe 嵌入（推荐起步）

### 4.1 改造点

**① recon-admin-web：嵌入模式（`embed=1`）**

- 检测 query `embed=1`（与 ai-h5 同款约定）：
  - 隐藏自身 `AppLayout`，Router 只渲染页面区（消除双层导航）；
  - 通过 `postMessage` 向父页声明 `AUTH_READY`，等待父页下发 `AUTH_TOKEN` / `PAGE_CONTEXT`；
  - axios 请求头注入 `Authorization: Bearer <token>`；
- 独立运行时（无 embed）照旧走自带布局。

**② recon-service：认证（方案 A′ 现行，2026-08-27）**

- recon-service **不再自建 JWT 认证**（原自写 `JwtAuthFilter` 体系已删除，见 §9.3）；
- 统一走平台链路：Gateway(8080) → BFF(8081) 的 `/api/v1/recon/**` 透传 → recon-service(8110) `/internal/v1/recon/**`；
- BFF 侧认证由 `ApiPermissionInterceptor` 统一收敛（已登记 `/api/v1/recon/**` authOnly 通配，仅校验「已登录」，按钮级权限由前端 PermissionGate 控制）；
- CORS 配置保持（`mis.recon.cors.allowed-origins`）。

**③ 平台 DB 注册**

```sql
INSERT INTO sys_app (tenant_id, code, name, icon, base_path, sort, status,
                     kind, runtime, description, portal_group, created_at, updated_at)
VALUES (1, 'recon', '对账平台', 'Scale', 'https://<recon-host>/', 4, 1,
        'subsystem', 'iframe', '数据对账与差异处理', 'operations', NOW(), NOW());
```

门户/顶栏切换器自动出现入口，点击进入 `/iframe/recon`。

**④ 部署与转发**

- recon-admin-web 构建为静态资源，独立域名或子路径（同域最佳，令牌走 localStorage/cookie 最简单）；
- nginx/edge 将 `/api/v1/recon` 转发到平台 Gateway(8080)，由 Gateway → BFF → recon-service 统一转发（方案 A′，见 §9）；
- recon-service 注册 Nacos，后续可纳入 mis-gateway/BFF 统一入口。

### 4.2 已知局限（A 方案的代价）

- 双层导航（嵌入模式隐藏 recon 自身布局后仅剩壳子导航，体验可接受）；
- iframe 与壳子多 Tab keep-alive 语义隔离（recon 内部状态在切 Tab 时不保留，需靠重建）；
- 通信仅 postMessage 级，跨应用状态同步有限。

---

## 5. 方案 C：micro-app 框架级（已实施）

> 本节为 micro-app 落地清单与**实施状态**（qiankun 弃选，不展开）。✅=已实现，⬜=待办。npm 包：`@micro-zoe/micro-app`（v1.0.0-rc.32）。
> 关键约束：Vite 子应用必须走 **iframe 沙箱**（`<micro-app iframe>`），ESM 无法被 Proxy 沙箱拦截；子应用入口需放行 CORS。

### 5.1 子应用（recon-admin-web）改造 ✅

**① `src/main.tsx`：接收壳子令牌** ✅
micro-app 环境（`window.__MICRO_APP_ENVIRONMENT__`）下 `getData()` 拉初始令牌 + `addDataListener` 订阅后续更新，写入 `lib/api/client.ts` 的 `setAuthToken`；独立运行无此全局，跳过。默认模式无需导出生生命周期，`createRoot().render` 照常。

**② `src/app/router.tsx`：basename + 嵌入模式** ✅
- `BASENAME = window.__MICRO_APP_BASE_ROUTE__ ?? '/'`，传给 `createBrowserRouter(..., { basename })`；
- 嵌入模式下根路由 element 用 `<Outlet />`（只渲染页面区），独立运行仍包 `AppLayout`；
- 首页 `Navigate to="connections"` 用相对路径，避免 basename 下跳回壳子根。

**③ 去掉自带 AppLayout（embed 化）** ✅
micro 模式不渲染 `components/layout/AppLayout.tsx`，导航由壳子侧栏接管（见 5.2-⑥）。`reports`/`monitor` 占位页保持原样。

**④ 样式隔离** ✅
壳子 `microApp.start({ shadowDOM: false, disableScopecss: false })` 关闭 Shadow DOM，`--primary` 等 CSS 变量可继承（子应用自带 globals.css 令牌兜底）。

**⑤ 开发服务器 CORS** ✅
`vite.config.ts` 的 `server.headers['Access-Control-Allow-Origin']='*'`（壳子跨源 fetch HTML/资源必需）。

### 5.2 壳子（mis-admin-web）改造 —— 6 处

**① 引入并初始化** ✅
```bash
pnpm add @micro-zoe/micro-app
```
`src/main.tsx`：`microApp.start({ shadowDOM: false, disableScopecss: false })`；`src/types/micro-app.d.ts` 声明 `<micro-app>` JSX 元素。

**② 子应用注册：`runtime='remote'`** ✅（入口走前端兜底）
- `src/types/api.ts` 的 `AppItem` 补 `entry?` 字段；
- 新增 `src/lib/nav/remote-apps.ts`：`registerRemoteApps(apps)` 从 `sys_app` 拉清单，`getRemoteApp(code)` 查注册表，`DEV_ENTRY`（`VITE_RECON_ENTRY`，默认 `http://localhost:5176`）作联调兜底；
- ⬜ 后端 `AppVO/AppView`（mis-iam + mis-admin-bff）未暴露 `mfe_remote`，entry 暂无法随 `sys_app` 下发，需补字段映射后去掉兜底。

**③ 容器路由 + RemotePage** ✅
- `src/app/router.tsx` 加 `<Route path="/remote/:code/*" element={null} />`；
- `keep-alive-outlet.tsx` 新增 `RemotePage`：
```tsx
<micro-app
  name={code}
  url={meta.entry}
  baseroute={`/remote/${code}`}   // 注入子应用 __MICRO_APP_BASE_ROUTE__
  keep-alive
  iframe                            // Vite 子应用必须 iframe 沙箱
  className="block h-full w-full"
/>
```
- 令牌与会话：`RemotePage` 挂载后 `microApp.setData(code, { type:'AUTH_TOKEN', token, user, permissions })`（user/permissions 为阶段 2 增发），子应用 `getData`/`addDataListener` 接收（✅ recon-service 认证已落地，生效）。

**④ 多 Tab keep-alive 融合** ✅（单 Tab 归一方案）
平台 `KeepAliveOutlet` 是 React 组件缓存，micro-app 是独立运行时且**不允许同名多实例**。方案：**一个 remote 应用 = 一个 Tab = 一个 `<micro-app>` 实例**——
- `normalizeRemotePath()` 把 `/remote/recon/connections` 归一为 `/remote/recon`；
- 壳子侧栏切换 recon 子页面只改 URL（micro-app 内部路由同步），不新增 Tab。

**⑤ 门户/顶栏跳转 + activeAppCode** ✅
- `portal-page.tsx` `enterApp`、`app-layout.tsx` 顶栏切换器加 `runtime==='remote'` → `navigate('/remote/{code}')`；
- `host-apps.ts` `resolveActiveHostAppCode` 识别 `/remote/:code` → activeAppCode。

**⑥ recon 侧栏菜单** ✅
- 新增 `src/lib/nav/recon-nav.ts`：6 个菜单项（连接/数据源/场景/差异/报告/监控），路径挂在 `/remote/recon/*` 下；
- `app-layout.tsx` `navNodes` fallback 加 `activeAppCode==='recon' ? RECON_NAV`，sectionLabel「对账平台」；
- 页签标题优先级：iframe/动态元信息 → navItem（页名）→ remote 应用名 → KEEP_ALIVE_META。

### 5.3 后端与平台

- ✅ **recon-service 认证**（2026-08-27 改为方案 A′）：原阶段 1 自写 `JwtAuthFilter` 认证体系（`com.mis.recon.security` 包 + `SecurityConfig` + nimbus 依赖 + `mis.security.jwt` 配置）**已整体删除**；recon-service 不再校验 JWT，认证由平台 BFF 统一收敛（§9）。
- ✅ **sys_app 注册**：新增迁移 `mis-migrator/.../V40__sys_app_recon_remote.sql`，`code='recon'`、`runtime='remote'`、portal_group=`operations`；`mfe_remote` 为部署地址占位（`http://localhost:5176/`），上线前替换为实际地址。

### 5.4 部署

- ⬜ recon-admin-web 独立构建部署；壳子跨域加载其 `entry`，nginx/CORS 放行子应用资源请求（需带 CORS 头）。
- recon 前端固定 **5176**（与壳子 5174 错开，见 recon-admin-web/README.md），本地联调无端口冲突；`VITE_RECON_ENTRY` 按实际地址覆盖。

### 5.5 改造依赖关系

- ✅ 5.1-③（embed 化）已与方案 C 一并完成，方案 A 复用；
- ✅ 5.3 recon-service 认证（2026-08-27 改为方案 A′，自建 JWT 已删）与 5.1-① 前端令牌管道均已完成（阶段 1~3：认证 / 用户信息 / 权限 + 401 联动）；
- ✅ 5.2-④（keep-alive 融合）已用单 Tab 归一方案落地（规避多实例冲突，代价是 recon 内部 6 页共用一个 Tab）。

---

## 6. 方案 B：宿主代码级（runtime='host'）

把 recon 的 `features/*` 迁入 mis-admin-web `PAGE_MAP` + `sys_menu`，完全复用壳子登录/主题/多 Tab：

- 优点：无双重导航、无令牌管道、体验与平台完全一致；
- 缺点：**放弃独立部署**，recon 任何改动都要动平台仓库、随平台发布节奏；双仓代码漂移风险；
- 适用：仅当 recon 本质是平台子模块、开发与发布节奏必须同步时。

---

## 7. 决策建议与演进路径

| 阶段 | 目标 | 动作 | 可回退 |
|---|---|---|---|
| 现在 | 方案 A′ 统一入口 | recon-admin-web baseURL 改 `/api/v1/recon` + vite proxy 指向 Gateway + BFF 透传路由 + V48 登记 authOnly + 删 recon-service 自建 JWT | 随时删 sys_app 记录 |
| 之后 | 体验升级评估 | 若 iframe 的交互/保活不满足 → 升方案 C（micro-app） | 路由级开关切换 remote/iframe |
| 长期 | 深度融合 | 跨应用组件共享（如对账结果图表）→ Module Federation 补充 | — |

**优先落地项（原清单均已于 2026-08-26 完成；2026-08-27 按方案 A′ 调整）**：

1. ✅ recon-service 认证（安全底线）——2026-08-27 改为方案 A′：删除自建 `JwtAuthFilter` 体系，认证收敛到平台 BFF（§9）；
2. ✅ recon-admin-web embed 模式（iframe 与 micro-app 都需要的形态）——micro 模式不渲染自身 AppLayout；
3. ✅ `sys_app` 注册 + 部署脚本——`V40__sys_app_recon_remote.sql` 已落（§5.3）；
4. ✅（2026-08-27）前端 baseURL `/internal/v1/recon` → `/api/v1/recon`，vite proxy 指向 Gateway 8080；BFF 新增 `/api/v1/recon/**` 通用透传（ReconProxyController + V48 登记 authOnly）。

### 5.6 平台侧剩余配置（待办，非代码）

- ⬜ `sys_menu` 按 recon 前端 `src/lib/permissions.ts` 清单配置 `recon:*` 权限码并授予角色（`recon:connection:*` / `recon:datasource:*` / `recon:scenario:*` / `recon:diff:confirm` / `recon:report:send`）。配置前壳内相关按钮按「未授权」隐藏属预期（与平台 `agent:*` 同机制）；
- ✅（2026-08-27）`sys_api` 已登记 `/api/v1/recon/**` 四条 GET/POST/PUT/DELETE **authOnly** 通配（迁移 `V48__recon_api_registry.sql`），BFF 对 recon 端点不再 403；
- ✅（2026-08-27）recon-service 自建 JWT 认证已删，无需再置 `RECON_SECURITY_ENABLED` / `JWT_PUBLIC_KEY_PATH`；
- ⬜ BFF 的 `mis.recon.base-url` 指向 recon-service 实际地址（默认 `http://localhost:8110`，环境变量 `RECON_BASE_URL` 覆盖，见 §9.1）；
- ⬜ `sys_app.mfe_remote` 替换为实际部署地址（当前占位 `http://localhost:5176/`）。

---

## 9. 方案 A′：BFF 统一转发（现行链路，2026-08-27）

> 背景：阶段 1~3 中 recon-service 自建了 `JwtAuthFilter`（RS256 公钥验签）独立认证，recon 前端经 Vite proxy 直连 8110，绕开平台 Gateway/BFF，违反 ADR-003（BFF 层）/ ADR-008（BFF 集中鉴权）。2026-08-27 收口为方案 A′。

### 9.1 链路

```
recon-admin-web ── /api/v1/recon/** ──▶ 平台 Gateway(8080) ──▶ BFF(8081) ── /internal/v1/recon/** ──▶ recon-service(8110)
       │                                                                                                 │
       └──── 壳子经 microApp.setData 下发 token/user/permissions（前端会话用；后端由 Gateway 透传登录上下文给 BFF）
```

- 前端 `baseURL` 由 `/internal/v1/recon` 改为 `/api/v1/recon`（`recon-admin-web/src/lib/api/client.ts`）；
- Vite dev proxy 由 `/internal → 8110` 改为 `/api → 8080`（Gateway）（`recon-admin-web/vite.config.ts`）；
- BFF 新增 `ReconProxyController`（`/api/v1/recon/**`）原样透传到 recon-service `/internal/v1/recon/**`：不包 Result 信封，`ResponseEntity<String>` 原样回传（recon 自带 ApiResponse 信封，HTTP 恒 200）；
- 透传时经 `AbstractDownstreamClient.loginContextHeadersStatic()` 携带 X-User-Id / X-Tenant-Id 等上下文头；BFF 的 `GatewayContextFilter` 从 Gateway 透传头解析 LoginUser，供 `ApiPermissionInterceptor` 判权；
- 下游地址：`mis.recon.base-url`（默认 `http://localhost:8110`，环境变量 `RECON_BASE_URL` 覆盖），超时 `mis.recon.timeout-ms`（默认 15000）。

### 9.2 鉴权模型（fail-closed + authOnly）

- BFF `ApiPermissionInterceptor` 对 `/api/v1/**` 拦截，未登记路径一律 403「接口未授权映射」；
- recon 端点按 GET/POST/PUT/DELETE 四条 `**` 通配登记为 **authOnly**（permission 为空 → 仅校验「已登录」），迁移 `V48__recon_api_registry.sql`（sys_module `recon-service` + sys_menu + sys_api + sys_menu_api 幂等登记）；
- 按钮级权限由前端 `PermissionGate` 基于壳子下发的 `permissions`（`recon:*`）控制，不再由后端逐端点判权。

### 9.3 删除的自建认证（2026-08-27）

- `com.mis.recon.security` 包：JwtTokenVerifier / JwtAuthFilter / UserContext / JwtProperties / JwtClaims / AuthException；
- `config/SecurityConfig.java`（FilterRegistrationBean）；
- `pom.xml` 的 nimbus-jose-jwt 依赖；`application.yml` 的 `mis.recon.security.enabled` 与 `mis.security.jwt`；
- `ErrorCode` 的 40100/40101/40104 三个错误码（recon 不再签发/校验 JWT，401 由平台统一返回）；
- 测试：JwtTokenVerifierTest / JwtAuthFilterTest / RsaKeys；资源 `keys/dev-public.pem`。
- **保留**：前端 `auth-store` / `PermissionGate` / 401 联动（AUTH_CODES=[40100,40101,40104]）——按钮权限仍依赖壳子下发的 permissions，401 跳转仍由前端处理。

---

## 8. 参考文档

- `docs/frontend/micro-frontend-integration.md`：平台微前端演进总方案（原理 + 接入契约 + 里程碑）
- `docs/architecture/04-app-module-mfe.md`：应用模块化与微前端架构
- `frontend/mis-admin-web/src/lib/nav/iframe-apps.ts`、`keep-alive-outlet.tsx`：iframe 通道实现
- `frontend/mis-admin-web/src/lib/ai-h5.ts`：iframe postMessage 令牌协议
- micro-app 官方文档：https://jd-opensource.github.io/micro-app/docs.html#/zh-cn/start（Vite 适配：https://jd-opensource.github.io/micro-app/docs.html#/zh-cn/framework/vite）
- `recon/docs/T09-spec.md`：recon-admin-web 前端规格
- `docs/frontend/admin-web-design.md`：管理后台设计规范（嵌入时样式令牌对齐）
