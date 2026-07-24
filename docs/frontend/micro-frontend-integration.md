# 微前端架构与 MIS 各子系统接入方案

> 形态：细化 `architecture-blueprint.md` §9「微前端演进路径」，给出**原理详解 + 各子系统接入方案**。
> 前提：`frontend/mis-admin-web`（React 18 + Vite 5 + TS + shadcn + Zustand + TanStack Query）。
> 结论先行：**当前仍单体，但已具备微前端拆分的天然 seams；现在守边界，体量到阈值再按本文拆子应用。**

---

## 0. 关键发现：当前架构已有微前端雏形

读 `2026-07-22` 代码，以下结构已经是「基座 + 子系统」的骨架，演进成本低于一般单体：

| 微前端概念 | 当前代码落点 | 说明 |
|-----------|--------------|------|
| 基座 Shell | `src/components/layout/app-layout.tsx` | 顶栏 + 可折叠 `SideNav` + `TabBar`(keep-alive) + 主题 + 用户菜单 + AI 入口 |
| 子系统入口 / 注册中心 | `src/features/portal/portal-page.tsx`（`fetchApps()`） | 门户按 `portalGroup` 展示子系统卡片；`AppItem` 含 `code/name/runtime/portalGroup/icon/enterable` |
| 子应用挂载容器 | `KeepAliveOutlet`（`app-layout.tsx` 内 `<KeepAliveOutlet />`） | 路由命中的子系统页面在此渲染并保活 |
| 路由 / 页面注册 | `src/features/system/page-defs.ts`（`SYSTEM_PAGE_DEFS`）+ `src/lib/nav/system-nav.ts`（`SYSTEM_NAV`） | **数据驱动**——路径 → 页面定义 / 菜单树，未来换成远程注册即可 |
| 共享基座能力 | `auth-store`(会话/权限) / `globals.css`(令牌) / `next-themes`(主题) / `lib/api`(请求) | 子应用将来直接复用，不必各带一份 |
| 远程应用清单 | `GET /platform/apps` → `AppItem[]` | **天然就是微前端的「远程注册源」雏形** |

> 一句话：门户返回的 `AppItem` 已经带着 `code/runtime/portalGroup`，只要再补 `entry` / `activeRule` / `routeManifest`，就直接能当微前端的子应用注册清单用。这是本项目最大的演进优势。

---

## 1. 微前端原理详解

### 1.1 本质与判断标准

微前端 = 把后端「微服务」思想搬到前端：把一个前端应用拆成多个**独立开发、独立部署、技术栈可选**的子应用，由**基座（Shell）在运行时**拼装成用户眼中的完整产品。

**判断标准只有一句**：各子应用能否**独立部署上线**，且由基座**在运行时集成**。两条都满足才是真微前端；只满足一条（如 Monorepo 统一构建、iframe 隔离但各管各的）都不算。

### 1.2 运行时集成四要素（基座必须提供）

1. **应用注册**：声明子应用 `name / entry / activeRule / container`。
2. **生命周期**：基座控制 `bootstrap / mount / unmount`（切走时卸载、切回时重建或保活）。
3. **隔离**：JS 沙箱（避免全局变量污染）+ 样式隔离（避免 CSS 冲突）。
4. **通信**：全局状态 / 事件总线 / props，替代直接函数调用。

### 1.3 与相近架构的区别

| 维度 | 单体 SPA | Monorepo | iframe 嵌入 | 微前端 |
|------|---------|----------|-------------|--------|
| 技术栈 | 单一 | 单一（共享） | 任意但割裂 | 任意且**集成** |
| 部署 | 一次整体 | 一次整体 | 各自独立 | 各自独立 |
| 集成时机 | 编译期 | 编译期 | 浏览器隔离 | **基座运行时** |
| 团队边界 | 弱 | 弱（同仓） | 强 | 强 |
| 跨应用通信 | 直接调用 | 直接调用 | postMessage | 基座 / 事件总线 |
| 适用规模 | 小中型 | 中大型 | 简单嵌入 | 大型多团队 |

### 1.4 三种主流方案详述

**A. qiankun（基于 single-spa）** — 国内中后台最常用
- 机制：基座按 `activeRule` 匹配路由 → 加载子应用 HTML entry → 执行其导出的 `bootstrap/mount/unmount`。
- 优点：整页子应用、心智简单、HTML entry 对老系统（jQuery/Angular）友好、JS 沙箱 + 样式隔离开箱即用。
- 缺点：子应用需改打包为 `umd` + 配跨域；整页加载粒度偏粗；Vite 需 `vite-plugin-qiankun` 适配。
- 适用：多团队、整域拆分、遗留渐进重构。

**B. micro-app（京东，类 Web Components）** — Vite 友好、轻量
- 机制：用类 Web Component 的自定义元素承载子应用，基座更像「拼组件」。
- 优点：对 Vite/React 友好、接入成本低、样式隔离基于 Shadow DOM、子应用改动小。
- 缺点：生态比 qiankun 新；极复杂场景文档略少。
- 适用：React/Vite 中后台、想低侵入接入。

**C. Module Federation（Webpack5 / Rspack / Vite）** — 模块级共享
- 机制：子应用 `exposes` 组件、基座 `remotes` 引用，运行时共享模块；`react` 可设 `singleton` 共享一份。
- 优点：粒度最细（可共享单个图表/表单组件）、包体最优、无整页加载开销。
- 缺点：要求构建工具支持、配置复杂、跨框架共享受限。
- 适用：组件级复用、同技术栈多团队、追求极致包体。

**选型矩阵**

| 维度 | qiankun | micro-app | Module Federation |
|------|---------|-----------|------------------|
| 集成粒度 | 整页子应用 | 整页/组件 | 组件级 |
| Vite 友好度 | 需适配插件 | 原生友好 | 原生友好(Rspack/Vite) |
| 老系统兼容 | ★★★ | ★★ | ★ |
| 包体优化 | ★★ | ★★ | ★★★ |
| 接入成本 | 中 | 低 | 高 |
| 中后台推荐 | ✅ 首选 | ✅ 轻量首选 | 共享组件时 |

> 本项目建议：**整页子系统用 qiankun 或 micro-app 托管；跨子系统共用业务组件（如 `AdminListPage`、图表）用 Module Federation 的 `shared` 暴露**。可混合。

### 1.5 关键设计点

- **基座职责**：路由、菜单生成、登录态下发、主题、通信总线、错误边界、子应用加载态。对应本项目 = Portal + AppLayout 抽取为独立 Shell 包。
- **样式隔离**：本项目 shadcn 用 CSS 变量 + 类前缀，冲突风险本就低；若某子应用用不同 UI 库，用 Shadow DOM 或 scoped 前缀兜底。
- **JS 沙箱**：qiankun/micro-app 自带 Proxy 沙箱，子应用全局变量不污染基座。
- **共享依赖单例**：`react/react-dom`、shadcn 令牌、`auth-store`、`QueryClient`、`lib/api` 必须基座单例提供，禁止子应用各打包一份（否则多份运行时、体积爆炸）。
- **通信**：基座事件总线 + 全局 store（auth/菜单/权限/租户），对应军规——跨域通信走全局，绝不 import 对方组件。

### 1.6 何时**不该**用

- 团队 < 3、单仓单构建、各域迭代节奏接近 → 单体更划算。
- 追求极致首屏性能、包体敏感 → 多份运行时有开销。
- 强实时跨域状态同步 → 不如单体共享 store。

---

## 2. 各子系统接入方案（核心）

基于真实 `SYSTEM_PAGE_DEFS` / 门户分组，把子系统归为 5 类，给出接入 spec。

### 2.0 基座（不拆）

| 项 | 内容 |
|----|------|
| 组成 | `PortalPage`（门户/入口）+ `AppLayout`（工作台壳）+ `KeepAliveOutlet` + `SideNav` + `TabBar` |
| 职责 | 路由匹配、登录态、主题、菜单生成、通信总线、错误边界、加载态 |
| 演进 | 抽成独立 `shell` 包/子应用，对外暴露 `registerSubApp(manifest)` 与 `ShellProps` |

### 2.1 子系统注册契约（未来基座接口）

门户 `fetchApps()` 返回的 `AppItem` 已含 `code/name/runtime/portalGroup/icon/enterable`，未来补成：

```ts
interface SubAppManifest {
  code: string;                 // 'system' | 'monitor' | 'dashboard'
  name: string;
  entry: string;                // 独立部署地址，如 //subapp-system.mis.com
  activeRule: string;           // '/system/*'
  runtime: 'qiankun' | 'micro-app' | 'host';
  routeManifest: RouteDef[];    // 路由 + 菜单 + 权限码，供基座生成导航
  mount: (container: HTMLElement, props: ShellProps) => Promise<void>;
  unmount: () => Promise<void>;
}
interface ShellProps {          // 基座下发给子应用
  auth: AuthState;              // 登录态/权限
  theme: 'light' | 'dark';
  eventBus: EventBus;           // 跨子应用通信
  apiBase: string;
}
```

### 2.2 系统管理子系统 `system`

| 项 | 内容 |
|----|------|
| 子应用名 | `system` |
| activeRule | `/system/*` |
| 当前代码 | `features/system/*`（`admin-list-page.tsx` + `page-defs.ts` + `types.ts`），含 12 个页面：`user/org/dept/employee/post/app/api/module/role/menu/dict/config` |
| 打包产物 | `umd`/`esm`，独立部署于 `//subapp-system.mis.com` |
| 共享依赖 | react、shadcn 令牌、`auth-store`、`QueryClient`、`lib/api`、`SYSTEM_NAV`(基座下发) |
| 注册内容 | 把 `SYSTEM_PAGE_DEFS` + `AdminListPage` + 相关 `lib/api/system/*` 整体迁入子应用；`routeManifest` 来自 `SYSTEM_PAGE_DEFS` 的 keys |
| 拆分粒度建议 | **先整域拆一个 `system` 子应用**（12 页同域，团队边界清晰、依赖一致）；待团队再大，可把 `role/menu` 等进一步拆细子应用 |
| 灰度共存 | 路由级开关：`/system/*` 走子应用 or 仍用单体 `features/system`（KeepAliveOutlet 渲染），可逐页切换 |

### 2.3 监控子系统 `monitor`

| 项 | 内容 |
|----|------|
| 子应用名 | `monitor` |
| activeRule | `/monitor/*` |
| 当前代码 | `features/system/admin-list-page.tsx` 中 `LoginLogPage` / `OperLogPage`（走 `SYSTEM_PAGE_DEFS['/monitor/login-log' | '/monitor/oper-log']`） |
| 说明 | 页面最独立、依赖最少 → **最适合做第一个拆分试点**（M2） |
| 共享依赖 | 同 2.2 |
| 注册内容 | 日志查询 CRUD 页 + 详情 Dialog；权限码 `monitor:loginlog:list` / `monitor:operlog:list` |

### 2.4 仪表盘子系统 `dashboard`

| 项 | 内容 |
|----|------|
| 子应用名 | `dashboard` |
| activeRule | `/dashboard` |
| 当前代码 | `features/dashboard/dashboard-page.tsx`（统计卡 + 快捷入口 + 最近日志 Top10） |
| 说明 | 首页/工作台性质，独立部署价值中；可放 M4 |
| 共享依赖 | 同 2.2；统计组件未来可经 Module Federation `shared` 暴露给其它子系统复用 |

### 2.5 未来业务子系统（operations / platform 组）

| 项 | 内容 |
|----|------|
| 来源 | 门户 `portalGroup: operations / platform` 组（当前多为「即将上线」占位） |
| 示例 | `order`（订单）、`report`（报表）等 |
| 接入方式 | 从一开始就按子应用建（独立仓/独立部署），直接走 `registerSubApp`；天然契合微前端，无需从单体迁 |
| 多技术栈 | 若某业务子系统用 Vue/Angular，经 qiankun/micro-app 接入，验证隔离 |

### 2.6 接入总览

```
门户 PortalPage(fetchApps)
   └─ 列出子系统卡片（AppItem: code/name/runtime/portalGroup）
        ├─ 点 system   → 基座按 /system/* 挂载 system 子应用
        ├─ 点 monitor  → 基座按 /monitor/* 挂载 monitor 子应用
        ├─ 点 dashboard→ 基座按 /dashboard 挂载 dashboard 子应用
        └─ 点 operations/platform 某子系统 → 挂载对应子应用
基座 Shell 统一提供：登录态 / 令牌 / 主题 / 通信总线 / 导航 / 多 Tab
```

---

## 3. 平滑演进路线（里程碑）

| 里程碑 | 目标 | 关键动作 | 可回退 |
|--------|------|----------|--------|
| **M0（现在）** | 单体，seams 就位 | `features` 严格分域（军规1）、服务端状态走 Query（军规2）、路由配置化、页面数据驱动(`SYSTEM_PAGE_DEFS`) | — |
| **M1 基座标准化** | 定义子应用契约 | 抽 `shell`；定义 `SubAppManifest`/`ShellProps`；门户 `AppItem` 补 `entry/activeRule/routeManifest` | 仍是单体，零风险 |
| **M2 试点 monitor** | 跑通全链路 | 把 `monitor` 拆成第一个子应用（qiankun/micro-app），验证沙箱/样式隔离/通信/独立部署 | 路由开关切回单体 feature |
| **M3 拆 system** | 最大域独立 | 迁 `SYSTEM_PAGE_DEFS`+`AdminListPage`+`api/system` 为 `system` 子应用 | 逐页路由开关回退 |
| **M4 dashboard + 业务子系统** | 全面子应用化 | `dashboard` 子应用；`operations/platform` 新子系统直接以子应用形态建 | — |
| **M5 多技术栈验证** | 异构接入 | 某子系统用 Vue/Angular 接入，验证隔离与通信 | 切回 React 子系统 |

> 每一步都**可回退**：路由级 flag 控制某域走「子应用」还是「单体 feature」。这是「单体起步 + 预留演进」能成立的关键——现在做的边界预留，将来零改造切换。

---

## 4. 关键决策与风险

- **选型**：中后台整页子系统 → qiankun 或 micro-app（Vite 友好）；跨子系统共用业务组件 → Module Federation `shared`。可混合。
- **共享依赖漂移**：`react/shadcn/auth-store/QueryClient/lib/api` 必须基座单例，子应用 `package.json` 标 `peer` 不打包。
- **样式隔离**：shadcn + CSS 变量已降低冲突；异 UI 库子应用用 Shadow DOM。
- **通信**：基座事件总线（如 `mitt`）+ 全局 store；子应用通过 `ShellProps.eventBus` 发事件，绝不互 import。
- **包体**：多份运行时是头号风险，靠 `shared` singleton 压制。
- **不建议现在做**：当前团队/体量未到阈值（见 §1.6），基建成本 > 收益。**现在只守边界**。

---

## 5. 与现有文档关系

- `architecture-blueprint.md` §9 — 微前端触发条件与演进方式（本文为其细化）
- `admin-web-design.md` — 页面/路由/组件规格（子应用内容来源）
- `design-handoff-brief.md` — 设计令牌（子应用必须复用基座令牌，禁止各带一套）
- `AGENTS.md` — 角色与编码约定（拆子应用时仍遵循 `features` 分域、禁止跨域依赖）

---

*本文基于 `mis-admin-web` 2026-07-22 代码实际结构（Portal + AppLayout + KeepAliveOutlet + SYSTEM_PAGE_DEFS + fetchApps）撰写，为可执行演进方案。架构没有银弹，合适的才是最好的。*
