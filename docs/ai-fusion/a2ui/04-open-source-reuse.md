# A2UI 开源复用评估（收敛版）— 是否最大限度复用开源库

| 项目信息 | 内容 |
| --- | --- |
| 文档版本 | v2.0-final（最终收敛版，替代全部历史开源复用文档） |
| 作者 | 高见远（Gao，架构师） |
| 日期 | 2026-08-21 |
| 类型 | **纯评估文档**（不改动任何 package.json / 代码 / 其他文档） |
| 评估对象 | 最终收敛方案，权威基准 = `01-architecture.md` / `02-task-breakdown.md` / `03-permission-design.md`（单前端统一 + D12 BFF 身份兑换 + D14 iframe 唯一出口 + D15 shadcn + 懒加载） |
| 依赖现状 | 三个 package.json **实测**（主理人核实，直接采信）：Gateway / mis-admin-web / agent/frontend |
| 口径基准 | 组件名 `approval-card / data-table / form-sheet / entity-select`、错误码 40301/40303/40304/40305/4004/40101、Redis key `mis:acl:skillperm:{userId}`、catalogId `mis-a2ui-catalog-v1` 均不变 |

> **一句话结论**：
> **有，且已接近"领域内可复用的上限"。** 协议栈（AG-UI + A2UI）100% 采用开源实现、渲染核心 80% 开源 + 20% 自研薄封装、UI 组件层 100% 建立在 shadcn 开源体系上；需要自研的仅剩 **MIS 私有差异**（权限码体系、外部身份映射、Redis Streams 适配、对话事件协议）——这些是任何开源库都无法替代的领域约束，属于"必须自研"，而非"为复用而复用"的缺口。

---

## 1. 复用率结论

### 1.1 能力点加权（按层）

| 层 | 开源覆盖 | 自研/存量 | 开源占比 | 说明 |
| --- | --- | --- | --- | --- |
| Gateway 运行时 | fastify/ioredis/zod/pino/@fastify/* | 路由/权限编排 | 90% | 基础设施全开源 |
| A2UI 协议（Gateway） | @ag-ui/client + @ag-ui/a2ui-middleware + rxjs | RedisStreamAgent 适配 + EventConverter | 85% | 核心逻辑开源，适配薄 |
| 前端渲染核心 | @a2ui/web_core + @preact/signals-core | registry/SurfaceRenderer/权限门控薄封装 | 80% | （若 P1 引入 @a2ui/react → 90%+） |
| UI 组件 | shadcn/radix/tailwind/lucide（+tanstack table P1） | 4 业务组件组合封装 | 90% | 原子件全开源 |
| 前端基建 | React/Vite/React Query/zustand/sonner/react-markdown/fetch-event-source/next-themes | 应用壳 | 90% | 全开源 |
| 对话内核 | fetch-event-source（SSE 底层）+ zustand | useChat/sse-client 协议与状态 | 40% | 自研最重的一层（合理自研） |
| 权限层 | — | MIS 私有权限码 + BFF 拦截器（**存量复用**） | 0%（存量） | 非开源、非自研新增 |
| 身份兑换 D12 | jose/JJWT/node:crypto | 映射逻辑/影子账号/手机号匹配 | 70% | 签名标准库，映射业务自研 |
| **合计（能力点加权）** | | | **≈ 75-80%** | 其中存量复用贡献 ≈ 3-5%（权限层/BFF） |

### 1.2 前端代码量口径

- 合并后 mis-admin-web 中，**对话 + A2UI + 存量页的代码量占比**最高；其中：
  - 直接来自开源库的**声明式/复用代码**（import shadcn 组件、调 web_core API、fetch-event-source、react-query）≈ 60-70%；
  - **自研薄封装**（registry、4 组件组合、chat-core 协议层、bff-actions）≈ 25-30%；
  - **纯 MIS 业务**（权限码语义、身份映射、技能分发对齐）≈ 5-10%。
- 按"自研薄封装"中又有 50%+ 是"站在开源 API 上的胶水"，前端侧综合开源受益 **≈ 80-85%**。

### 1.3 总结论

> **A2UI 最终方案已最大限度复用开源库**：协议层 ~100% 开源、渲染/UI/基建 ~80-90% 开源、权限层 0% 开源但属"存量复用"（非缺口）；整体能力点加权开源复用率 **≈ 78%**（前端代码量口径 ≥80%）。剩余自研集中在 MIS 私有领域约束（§3），是"开源覆盖边界之外的必然"，而非可复用未复用。

---

## 2. 采纳建议清单（3 条 P1，均标注落点任务）

| # | 建议 | 优先级 | 落点任务 | 预期收益 |
| --- | --- | --- | --- | --- |
| 1 | **引入 `@tanstack/react-table` 实现 data-table 组件**（shadcn 官方 data-table 模式，headless：列模型/排序/分页/行选择） | **P1** | T06'（A2UI 渲染层迁入时直接引入，避免 T09 问数页返工） | 免自研分页/排序/列模型（约 300-500 行 + 测试）；与 shadcn 生态一致；体积随懒加载 chunk，阈值内（headless 无视觉冲突，D15 安全，包体积 ~40KB gzip） |
| 2 | **Gateway JWT 统一用 `jose`**（RS256 验签 + HS256 过渡验签一套 API），收敛 crypto-js 散落实现 | **P1** | 前置（T06' 依赖阶段 / T12 兑换端点联调前完成） | 消除 crypto-js 不支持 RSA 的隐性分叉（crypto-js 仅覆盖 HS256/哈希）；类型安全；支撑 D12 双通道验签 |
| 3 | **T06' 实施前评估 `@a2ui/react@0.9.1` 替换自研 SurfaceRenderer 骨架**（A2uiSurface + Generic Binder + basicCatalog） | **P1** | T06'（1 页技术验证，P0 不阻塞） | 减自研渲染逻辑 ~300-500 行；双向绑定能力与 v0.9 协议对齐更彻底；**4 组件 catalog + 权限门控不变** |

> 建议 1/2/3 合计可在不改变任何口径（组件名/错误码/Redis key/catalogId/权限语义）的前提下，把前端渲染层开源占比从 ~80% 提升至 ~90%。

**为什么 3 条是 P1 而非 P0**：
- ① 最终方案已锁定"渲染层 = mis-admin-web 源码模块 + shadcn 一处实现"，业务 catalog 与渲染骨架解耦，P0 换不换不影响 4 组件与权限门控；需在 T06' 实施前验证 `@a2ui/react@0.9.1` 与 mis-admin-web React 18、`@a2ui/web_core@^0.9.0` 的 peer 兼容性（官方 scaffold 基于 Next.js）。
- ② 若存量 RS256 验签已用 node:crypto 实现且稳定，可评估"只把 HS256 过渡验签迁 jose"，最小回归面。

---

## 3. 必须自研清单（8 项）

> 原则：**避免"为复用而复用"**——开源库解决的是通用问题，MIS 私有的权限语义、存量协议、业务映射是开源替代不了的；强行抽象成开源形态只会引入适配层、增加安全面。

| # | 自研项 | 归属 | 为什么不能/不值得开源替代 |
| --- | --- | --- | --- |
| 1 | **RedisStreamAgent**（Redis Streams → Observable\<BaseEvent\> 适配） | Gateway 前置 | AG-UI 官方无 Redis transport（HttpAgent 仅有 HTTP/SSE，面向"Agent 作为 HTTP 服务"的 Server Pattern）；MIS 私有 Redis Streams 协议（`aip:inbound` / `aip:outbound`）是存量基础设施，Python Agent 侧不可改；已建立在官方 `AbstractAgent` 扩展点上，属"薄适配"而非"造轮子" |
| 2 | **EventConverter**（AgentEvent ↔ BaseEvent 双向转换） | Gateway 前置 | MIS 私有事件类型（`dispatch.trace`、`approval.request` 兼容、`ui.render` 迁移期映射）与字段命名（snake_case→camelCase）是存量协议；开源无此转换器，强行通用化只会增加 8 种事件映射的维护成本 |
| 3 | **SurfacePermissionFilter**（渲染权限过滤） | Gateway 前置 | MIS 私有权限码体系（`mis:acl:skillperm:{userId}` + BFF `/internal/permissions` 反向信任 + fail-closed）；任何开源权限库（casbin 等）都映射不了"组件 requiredPermission ↔ RBAC 码"这一 MIS 语义，且引入新权限引擎会破坏存量 BFF 拦截器权威 |
| 4 | **D12 身份映射**（BFF 兑换端点：三级回退 + 手机号红线） | BFF T12 | 显式映射表 / 手机号匹配 / 影子账号 + 40301 fail-closed + R1-R6 红线（弱标识防枚举、歧义兜底、脱敏存储）是**业务规则**；JWT 库只解决"签名/验签"，不解决"外部 CRM 用户 → MIS userId 该映射到谁"。这是 MIS 平台独有的多租户边界问题 |
| 5 | **BFF ApiPermissionInterceptor 对接**（bff-actions + sys_api 映射） | mis-admin-web T06' | 写操作权限判定在**存量 Java 拦截器**（sys_api 表映射），前端 `bff-actions.ts` 只是"把 A2UI 操作翻译成 BFF REST 调用 + 403 结构化错误内联展示"的薄壳——存量资产复用而非自研权限判定；开源无"拦截器 ↔ A2UI action"直接对应物 |
| 6 | **chat-core 会话管理**（useChat + sse-client） | mis-admin-web T06' | 私有 AG-UI 事件协议（BaseEvent + ACTIVITY_SNAPSHOT + 自定义事件）+ RS256 认证注入 + 重连 + A2UI 操作分发；SSE 底层已复用 fetch-event-source、状态复用 zustand，自研的只是"协议处理层"（§4-4 详述） |
| 7 | **A2UI 4 业务组件**（approval-card/data-table/form-sheet/entity-select） | mis-admin-web T06' | catalog 注册表模式决定"组件 = 协议 schema + 你的实现"；4 组件需要 MIS 私有元数据（requiredPermission + actionApiMap）与 shadcn 视觉（D15），官方 basicCatalog 无权限语义且视觉不符（§4-3）。shadcn 已提供原子件，自研的是"组合 + 业务语义"薄层 |
| 8 | **Surface 快照/广播与重连重放**（R47 多宿主同步） | Gateway T10 | 同一 sessionId 多端广播 A2UI operations + 离线重放（Redis List）是 MIS 会话协议扩展；开源（含 AG-UI）只定义单端渲染协议，不定义"多宿主广播 + 快照恢复"的会话语义（hostId/embedMode 审计维度） |

> **反证检查**：以上 8 项若强行"开源化"会怎样？
> - 项 1/2/6：把 Python Agent 改造成 AG-UI HTTP 服务 + 前端换 AI SDK useChat → 需改存量 Python 运行时、新增 HTTP 服务运维、适配协议 → **净增成本，不减少自研**。
> - 项 3/4/5：引入 casbin/Keycloak 等 → 与 MIS RBAC 码、BFF 拦截器、影子账号体系冲突 → **安全面扩大、权限语义漂移**。
> - 项 7：用官方 basicCatalog → 视觉违反 D15、无权限元数据 → **协议与视觉双失配**。
> 结论：当前自研边界是"开源库能做到的能力边界"与"MIS 私有领域约束"的自然分界线，**不存在明显可消化的自研冗余**。

---

## 4. CopilotKit 不采纳的准确理由（实证）

| # | 理由 | 说明 |
| --- | --- | --- |
| ① | **agent/frontend 中零调用僵尸依赖** | 实证：`@copilotkit/*`（react-core/react-ui/runtime）在 agent/frontend 中**全量 grep 零 API 调用**，从未接入对话流；它只是 package.json 里的声明，无实际消费方。随 agent/frontend 退役一起下线，不存在"迁移"问题 |
| ② | **A2UI 是 Google 主导开放规范，CopilotKit 只是 launch/design partner** | A2UI 协议本体（SurfaceModel/DataModel/MessageProcessor/ACTIVITY_SNAPSHOT）由 Google 主导的开放规范定义，由 `@ag-ui/*` + `@a2ui/*` 官方包实现；CopilotKit 只是生态 partner，其支持**绑定 CopilotRuntime 宿主**——不绑定则享受不到其价值 |
| ③ | **前端绑定 `@copilotkit/react-*` 与 D15 shadcn / 单前端冲突** | CopilotKit react-ui 自带聊天 UI 视觉，与 D15（全量 shadcn 视觉基线）冲突；迁入后仍需 shadcn 重写 UI 壳，等于只留下其 runtime，价值归零；且 agent/frontend 退役后无存量消费诉求 |
| ④ | **接 CopilotRuntime 仍需自写 Redis Streams → AG-UI 桥接 + MIS 私有逻辑不提供** | 本项目事件流是 AG-UI BaseEvent + ACTIVITY_SNAPSHOT（A2UI operations）+ dispatch.trace 自定义事件，经 SSE/WS 直连 Gateway——CopilotKit runtime 有自家消息协议，适配成本 ≈ 重写 chat-core；CopilotRuntime 也不提供 MIS 私有逻辑（权限码体系 / D6 反查 / D12 身份映射 / BFF 拦截器对接） |

> **精确表述**：不采纳 CopilotKit 的原因是 **"运行时体系不同"而非"协议不兼容"**——CopilotKit 面向 CopilotRuntime 宿主生态，本项目面向 AG-UI 开放协议 + MIS 私有平台；两者都基于 A2UI 规范，但承载运行时不同，接 CopilotRuntime 仍需自写全部 MIS 私有逻辑，收益不成比例。

**同类的 Vercel AI SDK（`ai@4` useChat）同样不采纳**：
- `useChat` 强绑定 AI SDK 自己的消息结构（messages 数组 + Data Stream Protocol），而我们的流包含 tool.call 流式 JSON（中间件拦截）、ACTIVITY_SNAPSHOT（A2UI 渲染指令，非文本消息）——需要把私有事件适配进 useChat 的消息模型，**适配成本 ≈ 重写**，且丢掉了 MessageProcessor 直接消费 A2UI operations 的简洁性。
- AI SDK 的底层 fetch/stream 工具不提供比 `@microsoft/fetch-event-source`（已有）更多的价值。

**保留的自研 chat-core**：SSE 底层复用 `@microsoft/fetch-event-source`（POST + Last-Event-ID + 自动重连 + 自定义 headers），状态复用 zustand，真正自研的是"事件协议处理"这一层——**这是"合理自研"而非缺口**。

---

## 5. 版本口径表

| 包名 | 版本 | 归属 | 状态 | 落点任务 |
| --- | --- | --- | --- | --- |
| `@ag-ui/client` | ^0.0.57 | Gateway | ✅ 采纳（直接复用） | 前置平台能力（一期已定） |
| `@ag-ui/a2ui-middleware` | ^0.0.10 | Gateway | ✅ 采纳（直接复用） | 前置平台能力（一期已定） |
| `@ag-ui/a2ui-toolkit` | ^0.0.4 | Gateway | ✅ 采纳（直接复用；validateA2UIComponents + runA2UIGenerationWithRecovery） | 前置平台能力（一期已定） |
| `rxjs` | ^7.8.1 | Gateway | ✅ 采纳（直接复用，AG-UI 内生依赖） | 前置平台能力（一期已定） |
| `@a2ui/web_core` | ^0.9.0 | mis-admin-web | ✅ 采纳（直接复用） | T06' |
| `@preact/signals-core` | ^1.5.0 | mis-admin-web | ✅ 采纳（直接复用，web_core 依赖） | T06' |
| `@a2ui/react` | 0.9.1 | mis-admin-web | 🟡 P1 验证（评估替换自研 SurfaceRenderer 骨架） | T06' |
| `@tanstack/react-table` | P1 引入 | mis-admin-web | 🟡 P1 采纳（data-table 分页/排序） | T06' |
| `jose` | P1 引入 | Gateway | 🟡 P1 采纳（收敛 crypto-js，RS256/HS256 一套 API） | 前置 / T12 |
| fastify@4 / ioredis / zod@3 / pino | 现有 | Gateway | ✅ 存量保留 | — |
| shadcn 全家桶 / zustand / @microsoft/fetch-event-source / react-query / react-markdown / sonner / next-themes | 现有 | mis-admin-web | ✅ 存量保留 | — |
| BFF Java 存量 JWT 库（JJWT 或 spring-security-oauth2-jose） | 以实测为准 | mis-admin-bff | ✅ 优先复用存量；缺失才引 JJWT 0.12.x | T12 |
| Java 标准库 MessageDigest（sha256+salt） | — | mis-admin-bff | ✅ 零新增依赖（phone_hash，R5） | T12 |
| `@copilotkit/*`、Vercel AI SDK | — | agent/frontend | ❌ 不采纳（僵尸依赖，随 T11 下线） | T11 |

**版本口径说明**：
- `@ag-ui/client@^0.0.57` 为 Gateway 一期设计已定、代码未落的缺口（实测 package.json 尚无），非本次新增建议。
- `@a2ui/web_core@^0.9.0` 与 `@a2ui/react@0.9.1` 的 peer 兼容需 T06' 实施前 1 页验证；不兼容则维持自研 SurfaceRenderer（方案不变）。
- BFF 为存量 Java 系统，本次评估不新增其依赖为结论；仅建议"优先复用存量 JWT 库，缺失才引标准开源（JJWT 0.12.x）"。
- phone_hash 是"匹配键 + 脱敏"而非口令哈希，sha256+salt 已满足（R5 口径）；argon2/bcrypt 不采纳（过重 KDF 徒增成本）。

---

## 6. Anything UNCLEAR / 假设

| # | 不确定点 | 假设 |
| --- | --- | --- |
| 1 | BFF（Java）现有 JWT 库实现未实测 | 假设存量已有 RS256 签发/验签能力（mis-admin-web 登录链路），D12 直接复用；缺失才引 JJWT |
| 2 | `@a2ui/react@0.9.1` 与 `@a2ui/web_core@^0.9.0` / React 18 的 peer 兼容未实测 | 假设兼容（官方稳定线）；T06' 实施前需 1 页验证，不兼容则维持自研 SurfaceRenderer（方案不变） |
| 3 | mis-admin-web 测试栈是否已有 msw 未实测 | 假设缺失；若已有则 msw 项降为"确认即可" |
| 4 | Gateway 存量 RS256 验签实现方式未实测 | 假设散落于 auth 中间件（crypto-js 仅覆盖 HS256/哈希）；jose 迁移按"收敛而非重写"推进，最小回归面 |
