# MIS 管理后台 · 前端架构蓝图（v1.0）

> 形态：**单体 SPA 起步，预留微前端演进**。
> 适用：`frontend/mis-admin-web`（React 18 + Vite 5 + TS + Zustand）。
> 目标：分层清晰、按域组织、可测试、可独立部署演进。
> 原则：约定优于配置 · 单一职责 · 依赖单向向下 · 显式边界。

---

## 0. 现状基线（Sprint 1 完成后）

| 项 | 状态 | 备注 |
|----|------|------|
| 框架 / 构建 | React 18.3 + Vite 5.2 | 已就绪 |
| 语言 | TypeScript 5.4，`strict` 已开 | `noUnusedLocals/Parameters` 已开，良好 |
| 路由 | react-router-dom 6.22 | 已做 Guest/Protected 守卫 |
| 全局状态 | Zustand 4.5 + `persist` | 仅 auth-store（token/user/app） |
| 请求层 | axios + 拦截器 + Refresh 单飞 | 已较完整 |
| 别名 | `@/` → `src` | vite + tsconfig 均已配 |
| 组件库 | 无 | 仅 globals.css |
| 数据层 | 无服务端状态管理 | 无 TanStack Query |
| 规范 / 测试 / CI | 无 | 无 ESLint / Prettier / Husky / 测试 |

结论：**骨架健康（TS strict + 分层雏形），但工程化与数据层几乎是空白**，正好是补蓝图的最佳窗口。

---

## 1. 技术选型决策

| 维度 | 选型 | 理由 | 当前 |
|------|------|------|------|
| UI 框架 | React 18 | 已定，沿用 | ✅ |
| 构建 | Vite 5 | 已定，HMR 快 | ✅ |
| 语言 | TypeScript（strict） | 已定 | ✅ |
| 路由 | react-router 6（Data Router） | 已定，启用 `lazy` 路由 | ✅ |
| 全局状态 | Zustand | 仅放**客户端状态**（会话、UI 偏好） | ✅ |
| 服务端状态 | **TanStack Query v5** | 缓存 / 失效 / 重试 / 并发，替代手写 loading | ❌ 待引入 |
| 请求 | axios（沿用 + 封装） | 拦截器已较完整，包一层 `api/*` | ✅ |
| 组件库 | **shadcn/ui**（Radix + Tailwind） | 代码归你所有、可深度定制、无黑盒 | ❌ 待引入 |
| 样式 | Tailwind CSS + CSS 变量（设计令牌） | 与 shadcn 配套，主题化方便 | ❌ 待引入 |
| 表单 | react-hook-form + zod | 高性能、类型安全校验 | ❌ 待引入 |
| 表格 | TanStack Table | 与 Query 同生态 | ❌ 待引入 |
| 规范 | ESLint(flat) + Prettier + Husky + lint-staged | 质量门禁 | ❌ 待引入 |
| 测试 | Vitest + RTL（单元）/ Playwright（E2E） | 关键流防护 | ❌ 待引入 |
| 包管理 | pnpm | 已有 lockfile | ✅ |

---

## 2. 目标目录结构

```
src/
├─ app/                      # 应用层：组装，不放业务
│  ├─ App.tsx                # 根组件
│  ├─ router.tsx             # 路由表（配置化，未来可远程注册）
│  ├─ providers.tsx          # QueryClient / Theme / ErrorBoundary
│  └─ layout/                # AppShell / Sidebar / Header（布局壳）
├─ features/                 # 特性层：按业务域，禁止跨域直接 import
│  ├─ auth/                  # 现有：login / change-password
│  ├─ user/
│  ├─ order/
│  └─ report/
├─ shared/                   # 共享层：与业务无关的通用件
│  ├─ ui/                    # shadcn 组件（button/input/dialog...）
│  ├─ hooks/                 # 跨域 hooks
│  ├─ utils/                 # 工具函数
│  └─ types/                 # 公共类型
├─ lib/                      # 基础设施层
│  ├─ api/                   # axios 实例 + 各域 api（现有 client.ts/auth.ts）
│  ├─ query/                 # QueryClient + queryKeys 工厂
│  ├─ store/                 # Zustand stores（现有 auth-store）
│  ├─ auth/                  # 鉴权/权限判定
│  └─ config/                # 环境配置（import.meta.env 封装）
├─ styles/                   # 全局样式 + 设计令牌
├─ test/                     # 测试工具（render、mock server）
└─ main.tsx
```

**跨层依赖规则（强制）**
- `features` → 可依赖 `shared` / `lib`；**`features` 之间禁止直接 import**。
- `shared` → 可依赖 `lib`；禁止反向依赖 `features`。
- `lib` → 不依赖 `app` / `features` / `shared`。
- 跨域通信走：路由跳转 / 事件总线 / 全局 store，绝不 import 对方组件。

---

## 3. 状态管理策略（关键）

区分两类状态，避免"所有东西塞 Zustand"的反模式：

- **服务端状态**（接口数据、列表、详情）→ **TanStack Query**
  - 缓存、自动失效、后台刷新、请求去重、错误重试。
  - 不进 Zustand，不手动维护 `loading/error`。
- **客户端状态**（登录会话、主题、侧栏折叠、表单草稿）→ **Zustand**
  - `auth-store` 继续用 `persist` 存 token；其余 UI 状态新建独立 store。
- **跨域共享状态**（如当前租户、权限码）→ 放在 `lib/store` 或事件总线，不塞进某个 feature。

---

## 4. 数据层设计

- `lib/api/client.ts`：沿用现有 axios 实例（拦截器 + Refresh 单飞），仅做必要收敛。
- `lib/query/queryClient.ts`：统一 `QueryClient`（staleTime / retry / 错误统一提示）。
- `lib/query/queryKeys.ts`：集中式 `queryKeys` 工厂，保证失效精准。
- 组件内只写 `useQuery({ queryKey: qk.orders.list(p), queryFn })`，**不出现裸 axios**。

---

## 5. 路由与权限

- 路由全部 `lazy` 加载（代码分割），基座只加载当前路由子模块。
- 守卫沿用现有 `ProtectedRoute` / `GuestRoute`。
- 权限粒度：
  - **路由级**：无权限 → 跳 403 / 重定向。
  - **按钮/菜单级**：基于权限码（`auth-store` 中的 `user.roles/permissions`）做 `usePermission()` 封装。
- 路由表**配置化**（数组描述），为微前端"远程路由注册"留接口。

---

## 6. 组件与样式体系

- 引入 `shadcn/ui`：组件源码落入 `shared/ui`，完全可控、可改。
- 设计令牌用 CSS 变量（`--color-*`），支持浅/深主题与品牌色切换。
- 通用业务组件（表格页、抽屉表单、搜索栏）沉淀在 `shared/ui` 或各 feature 内**对外只暴露容器**。

---

## 7. 构建与性能

- **路由懒加载**：`React.lazy` + `Suspense`，首屏只载基座。
- **分包（manualChunks）**：`react/react-dom/router` 与 `vendor` 拆独立 chunk，利用长缓存。
- **产物分析**：`rollup-plugin-visualizer` 定期审计体积。
- **环境配置**：`.env` / `.env.[mode]` + `lib/config` 统一读取，禁硬编码地址。
- **严格 TS**：保持 `strict` + `noUnused*`（现有已开）。

---

## 8. 测试与质量门禁

- **单测**：Vitest + React Testing Library，覆盖 store、api 封装、关键组件。
  - 设 coverage 阈值（如 lines ≥ 60%，逐步提升）。
- **E2E**：Playwright，守护关键流（登录 → 进入 dashboard）。
- **提交门禁**：Husky `pre-commit` 跑 `lint-staged`（ESLint + Prettier）；`pre-push` 跑 typecheck + 单测。
- **CI**：lint → typecheck → test → build 四段流水线，任一失败阻断合并。

---

## 9. 微前端演进路线（何时 / 如何）

**触发条件（满足任一即评估拆分）**
1. 团队 > 3 个、各域迭代节奏差异大；
2. 需多技术栈共存（如老 Angular 模块要保留）；
3. 某子域要求独立部署、独立发版不阻塞主干。

**现在就预留的边界（低成本，现在做）**
- features 严格按域、**零跨域直接依赖**（最重要的一条）。
- 基座能力（路由、鉴权、菜单、布局壳）沉到 `app/`，未来直接变 Shell。
- 共享依赖（UI、utils、config）收敛到 `shared/lib`，未来可作 Module Federation `shared`（singleton）。
- 路由配置化，未来改为远程路由注册（`registerMicroApps` / `remotes`）。
- 跨域通信现在就走事件总线 / 全局 store，避免直接耦合。

**演进方式（未来选一）**
- 整页子应用：qiankun（`registerMicroApps` + 生命周期），适合异构遗留。
- 模块级共享：Module Federation（Webpack5 / Rspack / Vite），粒度更细、包体更优。
- **反模式**：现在就过度拆子应用 —— 基建成本 > 收益，单体更划算。

---

## 10. 现状成熟度评分

> 评分基于静态评估与经验规则，仅供参考。

| 维度 | 当前 | 目标 | 主要差距 |
|------|------|------|----------|
| 技术栈健康度 | 7/10 | 9/10 | 缺 lint/format/test 工具链 |
| 架构分层 | 5/10 | 9/10 | 无 shared/lib 分层、无拆包 |
| 状态 / 数据 | 4/10 | 9/10 | 无服务端状态层 |
| 工程化 | 3/10 | 9/10 | 无 lint/测试/CI |
| 性能 | 4/10 | 8/10 | 无懒加载 / 分包 |
| 可演进性 | 6/10 | 9/10 | features 雏形利于未来 |

**综合：约 4.8 / 10 → 评级 ⭐⭐（起步良好，工程化待补）**

---

## 11. 落地路线图

| 阶段 | 目标 | 关键动作 |
|------|------|----------|
| **Phase 1（已完成）** | 登录闭环 | login + captcha + auth-store + 路由守卫 |
| **Phase 2** | 工程化基座 | ESLint(flat)+Prettier+Husky+lint-staged；引入 Tailwind+shadcn；搭 AppShell 布局壳；ErrorBoundary |
| **Phase 3** | 数据层 + 首业务域 | 引入 TanStack Query；`lib/query` 封装；落地一个业务域（如 user/order）跑通"列表-详情-表单" |
| **Phase 4** | 质量与性能 | Vitest+RTL 单测；Playwright E2E；CI 流水线；路由懒加载 + 分包 + visualizer |
| **Phase 5（条件触发）** | 微前端拆分 | 满足第 9 节触发条件后，按域拆子应用（qiankun / MF） |

---

## 12. 架构军规（必须遵循）

1. `features` 内聚，**跨域零直接依赖**，通信走路由/事件/全局 store。
2. 服务端状态走 Query，**不进 Zustand**。
3. 全局类型 / 工具放 `shared`，不放业务代码。
4. 所有路由 `lazy` 加载，禁止首屏打包业务域。
5. 提交前 `lint` + `typecheck` 必须过（Husky 强制）。
6. 不做现在用不上的微前端拆分；边界预留即可。

---

*本蓝图基于 `mis-admin-web` 当前代码（Sprint 1）与 `AGENTS.md` 约定生成，为可执行规划，实际落地请结合团队节奏调整。架构没有银弹，合适的才是最好的。*
