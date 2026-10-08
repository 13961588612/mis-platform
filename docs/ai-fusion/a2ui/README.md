# A2UI（Agent-to-UI）最终方案 — 文档集索引

> 规划交付 · 2026-08-21 · 团队：software-a2ui-final（产品经理 许清楚 / 架构师 高见远 / 工程师 寇豆码 / QA 严过关）
> 项目：mis-platform · 状态：**最终收敛完成（文档 Ready）**，待工程落地
> **权威声明**：本目录已**物理删除全部历史/中间方案文档**（一期 PRD 系列、二期双形态/资产化、三期合并方案、治理报告、旧编号文档），**以下 5 份文档为唯一事实来源**，全部自包含、不引用任何已删除文件。

## 一、方案一句话

**A2UI = 在 Gateway（TypeScript）中集成 `@ag-ui/a2ui-middleware` 完整中间件模式，让 AI Agent 通过结构化 UI 描述协议（A2UI v0.9）动态生成、增量更新、事件闭环的可交互界面** —— 最终形态：**mis-admin-web 为唯一前端（D13 单前端统一）**：自身业务（管理后台 + Copilot 面板）原生"对话 → 生成界面 → 交互"，对外嵌入收敛为 **iframe 唯一出口（D14，mis-admin-web `/embed/*` 路由）**；外部独立账号经 **BFF 身份兑换端点（D12）**映射为 MIS userId 并签发短时 RS256 MIS JWT；权限完全对接 MIS 现有角色体系（RBAC 权限码 + KB ACL 双层模型，fail-closed）；视觉统一 shadcn（D15）；废弃 agent/frontend 独立前端（T11 退役清理）。

## 二、需求基线（最终功能范围）

> 历史需求编号（R1-R52 / US-1~US-15）已随历史文档删除，此处为最终功能范围浓缩。

| # | 功能范围 | 说明 |
| --- | --- | --- |
| 1 | **对话 + A2UI 动态界面** | 用户在对话中，Agent 经 Gateway 中间件注入的 `render_a2ui` 工具动态生成可交互界面（A2UI v0.9 协议），支持流式渐进渲染、增量更新、用户操作事件闭环 |
| 2 | **5 个存量功能页** | 知识库问答 / 问数 / Skill 管理 / 审批中心 / 监控 全原生迁入 mis-admin-web（逻辑迁移而非新写，shadcn 统一），分批交付（T09/T10） |
| 3 | **外部系统嵌入** | 外部系统（CRM/供应链等，独立账号）经 BFF 身份兑换端点 + iframe `/embed/*` 出口接入；多宿主会话隔离 |
| 4 | **权限兼容 MIS** | 渲染权限（Gateway SurfacePermissionFilter）+ 操作权限（BFF ApiPermissionInterceptor）双层模型，权限码 = 现有 RBAC 权限码子集，共享 `mis:acl:skillperm:{userId}` 缓存，fail-closed |
| 5 | **性能要求** | 懒加载 + Vite 多页双入口：首屏主 bundle 增量 ≤ 80KB、Copilot 面板分包 ≤ 120KB、存量页单路由 ≤ 80KB/页、embed 入口 ≤ 150KB（gzip），Sheet 打开到可交互 ≤ 500ms |

## 三、文档索引表

| 文档 | 内容 | 角色 | 说明 |
| --- | --- | --- | --- |
| [`README.md`](./README.md) | **最终方案入口索引**：方案一句话、需求基线、文档索引、决策摘要、工程路径、口径基准、开发前置约束 | 索引 | ✅ 本文件 |
| [`01-architecture.md`](./01-architecture.md) | **最终架构设计**：目标架构图、核心组件（RedisStreamAgent / EventConverter / A2UIRuntime / SurfacePermissionFilter）、双 JWT 与身份链路、D12 兑换端点完整设计（三级映射 + R1-R6）、/embed 出口、渲染层设计、懒加载性能、决策摘要表 | 怎么建 | ✅ Ready（最终权威） |
| [`02-task-breakdown.md`](./02-task-breakdown.md) | **最终任务分解**：任务列表 T06'/T07'/T12/T09/T10/T11（含依赖/验收/懒加载阈值）、模块×功能×文件矩阵、依赖包列表、共享知识、数据结构、全链路时序图 | 在哪实现 | ✅ Ready（最终权威） |
| [`03-permission-design.md`](./03-permission-design.md) | **最终权限设计**：双层模型（渲染 + 操作）、D5 声明机制（Gateway 权威）、D12 兑换权限视角（手机号匹配规则 + R1-R6）、KB ACL 联动、权限测试要点 | 如何授权 | ✅ Ready（最终权威） |
| [`04-open-source-reuse.md`](./04-open-source-reuse.md) | **开源复用（收敛版）**：复用率结论（≈78% / ≥80%）、3 条 P1 采纳建议、8 项必须自研论证、CopilotKit 不采纳的准确理由、版本口径表 | 是否复用 | ✅ Ready（最终权威） |

> **阅读顺序**：README → 01（架构）→ 02（任务）→ 03（权限）→ 04（开源复用）。

## 四、最终决策摘要（只列有效决策）

| # | 决策 | 内容 |
| --- | --- | --- |
| **D1** | 中间件运行位置 = Gateway | `agent/ai-platform/gateway` 集成 `@ag-ui/a2ui-middleware@0.0.10`——自动注入 render_a2ui 工具 + 组件 schema + LLM 指南 + 流式拦截 + 生成恢复循环 + 用户操作回传 |
| **D2** | Agent 适配 = RedisStreamAgent | Redis Streams 事件流 → AG-UI `AbstractAgent` + `Observable<BaseEvent>`（官方 Middleware Pattern 标准扩展点；AG-UI 无 Redis transport） |
| **D5** | 权限码声明 = 前端 registry + Gateway 权威过滤 | 单前端 registry 声明 requiredPermission（UX 层），Gateway `SHARED_CATALOG` 权威源（防伪造，下发以 Gateway 为准）；catalogId `mis-a2ui-catalog-v1` 协议版本锚点 |
| **D6** | 身份链路 = token → userId → BFF 反查 | `token → Gateway 验签 → userId → Redis mis:acl:skillperm:{userId}`（TTL 60s）→ 未命中 → BFF `/internal/permissions` 反查 → 回填；P4 身份不受信 |
| **D8 修订** | 共享内核归属 mis-admin-web 源码模块 | chat-core + A2UI 渲染层为共享内核，归属 mis-admin-web；"单前端双场景"（自身业务页 + `/embed/*` 嵌入页共用） |
| **D10 修订** | 渲染层 = mis-admin-web 源码模块 | **npm 资产包（`@mis/a2ui-renderer`）不再发布**；registry 单前端一份；catalogId 锚点保留 |
| **D11** | 存量页原生化优先级 | 知识库问答 → 问数 → 审批 → Skill → 监控；分批交付（T09/T10）；逻辑迁移而非新写（含 agentRole.ts 技能分发） |
| **D12** | 外部身份映射 = BFF 兑换端点 | 外部独立账号经 `POST /api/v1/embed/identity/exchange` 兑换短时 RS256 MIS JWT（TTL 30min）；三级回退（显式映射表 → 手机号匹配 → 影子账号）；安全红线 R1-R6；mappedBy 审计 |
| **D13** | 单前端统一 | agent/frontend 退役，mis-admin-web 为唯一前端 + 唯一对外出口（`/embed/*`）；双 JWT 收敛为 RS256 唯一生产通道（HS256 仅过渡期） |
| **D14** | iframe 为唯一外部嵌入形态 | 组件化封装搁置 P2；postMessage 协议（AUTH_READY/AUTH_TOKEN/PAGE_CONTEXT + A2UI_EVENT/A2UI_EVENT_RESULT）承载于 `/embed/*`；VITE_PARENT_ORIGINS 白名单；多宿主会话隔离（sessionId + hostId 广播） |

> **对外接入手册**（宿主联调）：[`docs/integration/embed-copilot.md`](../../integration/embed-copilot.md) · 示例页 `frontend/mis-admin-web/public/embed-host-demo.html`
| **D15** | 视觉基线统一 shadcn | 所有迁入组件统一 shadcn 视觉，废弃 agent/frontend Tailwind + surface-muted 自有设计 |
| **手机号匹配规则** | 用户已拍板 | MIS sys_user 允许"一手机号多账号"历史数据不清理；反查按正常状态账号计数：=1 映射 / >1 一律 40301 / =0 同样 40301；fail-closed 且不区分提示防枚举；**不进入影子账号回退** |

## 五、工程执行路径

```
T06'（chat-core + A2UI 渲染层迁入 mis-admin-web：shadcn 重写 + 懒加载落地 + tanstack/jose/@a2ui/react 验证）
  ↓
T07'（/embed/* 嵌入出口：EmbedAuthBridge 迁移 + A2UI_EVENT 事件桥 + embed 独立入口）
  ∥ T12（BFF 身份兑换端点：externalToken 验签 + 三级映射 + phone_hash + 限流审计 + 影子账号）
  ↓
T09（存量页第一批：知识库问答 + 问数）→ T10（第二批：审批 + Skill + 监控 + 多宿主同步 R47 + E2E）
  ↓
T11（agent/frontend 退役清理：~40 文件删除 + HS256 签发下线 + 引用清理）
```

> **口径**：任务编号 T06'/T07'/T12/T09/T10/T11 为最终编号（历史 T01-T05 / T06-T10 中间形态一律不使用）；懒加载性能验收（Copilot 面板分包 ≤ 120KB、embed 入口 ≤ 150KB 等）纳入 T06'/T07' 验收标准。

## 六、口径基准（工程强制）

| 口径 | 值 |
| --- | --- |
| **组件名** | `approval-card`（approval:view / approval:decide）、`data-table`（默认可见）、`form-sheet`（form:submit）、`entity-select`（默认可见） |
| **错误码** | 40301 FORBIDDEN / 40303 ACL_UNAVAILABLE / 40304 A2UI_RENDER_FORBIDDEN / 40305 A2UI_EVENT_FORBIDDEN / 4004 A2UI_POLICY_UNMAPPED / 40101 EMBED_TOKEN_INVALID |
| **Redis key** | `mis:acl:skillperm:{userId}`（TTL 60s，三端共享） |
| **catalogId** | `mis-a2ui-catalog-v1`（协议版本锚点；资产 major ↔ Gateway catalog major 必须匹配） |
| **BFF 端点** | `POST /api/v1/embed/identity/exchange`（D12 兑换）；`GET /internal/permissions`（D6 反查，X-Platform-Token 反向信任） |
| **事件协议** | AG-UI BaseEvent + ACTIVITY_SNAPSHOT（A2UI 渲染指令）+ dispatch.trace 自定义事件 |

## 七、开发前置约束

| # | 约束 | 说明 |
| --- | --- | --- |
| 1 | **mis-admin-web 当前零懒加载** | 无 `React.lazy`，全部静态 import，30+ agent 相关文件已进入主 bundle。合并 chat-core + A2UI 渲染层 + 5 存量页后若不干预，主 bundle 会显著膨胀——必须按 `01-architecture.md` §7 策略干预（Copilot 面板按需加载 + 存量页路由级懒加载 + Vite 多页双入口 + modulepreload 预热 + CI 体积断言） |
| 2 | **@ag-ui/* 待引入** | Gateway 实测 package.json 尚无 `@ag-ui/client@^0.0.57`、`@ag-ui/a2ui-middleware@^0.0.10`、`rxjs@^7.8.1`（一期设计已定、代码未落），工程阶段需补齐；P1 引入 jose（收敛 crypto-js——crypto-js 不支持 RSA） |
| 3 | **agent/frontend 僵尸依赖 CopilotKit** | `@copilotkit/*` 全量 grep 零 API 调用，从未接入；Vercel AI SDK 同理。**不迁移**，随 T11 退役下线（准确理由见 `04-open-source-reuse.md` §4） |
| 4 | **BFF 为存量 Java 系统** | 本次收敛不新增其依赖为结论；D12 兑换优先复用存量 JWT 库（缺失才引 JJWT 0.12.x）；phone_hash 用 Java 标准库 MessageDigest（sha256+salt） |
| 5 | **外部系统接入前置** | 外部系统需具备：① 自有认证（可签发 externalToken）；② 后端可调 BFF 兑换端点（内网/HTTPS）；③ 已获用户授权/告知手机号上报（PIPL，R5） |
