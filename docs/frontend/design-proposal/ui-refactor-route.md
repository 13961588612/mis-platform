# MIS 管理后台 UI 改造路线与首屏方案（v2 · 架构变更后）

> 状态：**Phase A / B / C 已实施并 typecheck 通过**（2026-07-18）
> 范围：真实前端 `frontend/mis-admin-web`，非独立原型
> 约束：守 shadcn 令牌（企业靛 `--primary` / 语义色 / `--radius`）与 Light/Dark

## 0. 背景：架构已变，设计需对齐真实前端

已核实（代码证据）：
- `sys_api` 改为**纯 module 归属**（实体 `SysApi` 仅 `module_id`，无 `app_id`）；后端 `ApiController.tree(moduleId)` 按 module 取树。
- `schema-design.md` 文档仍写「`sys_api` 带 `app_id`+`module_id`」并画 `SYS_APP ||--o{ SYS_API`，**文档滞后，需回写**。
- 真实前端已落地：`AdminListPage` 通用引擎 + 多个专用范式页；`page-defs.ts` 的 `/system/module` def 已被 `ModuleManagePage` 架空（陈旧，待清理）。

用户确认：改造对象 = **真实前端页面**；首个 = **通用 CRUD 引擎（AdminListPage）**。

## 1. 页面范式分类与改造目标（全量清单）

| 路由 | 当前渲染 | 范式 | 改造动作 |
|------|----------|------|----------|
| `/dashboard` | DashboardPage | E 复合仪表盘 | 已达标，不动 |
| `/system/user` | UserListPage | A 扁平 CRUD | 享引擎提升（若内部复用引擎） |
| `/system/org` | OrgListPage | A 扁平 CRUD | 同上 |
| `/system/employee` | AdminListPage | A | 引擎提升直接受益 |
| `/system/post` | AdminListPage | A | 引擎提升直接受益 |
| `/system/config` | AdminListPage | A | 引擎提升直接受益 |
| `/system/app` | AdminListPage | A→需转**卡片网格** | Phase B 抽卡片视图 |
| `/system/dept` | DeptTreePage | B 树 | 已差异化，打磨 |
| `/system/module` | ModuleManagePage | B+（模块+API） | 清理 def 漂移 + 打磨 |
| `/system/menu` | MenuManagePage | B 树 | 已差异化，打磨 |
| `/system/role` | RoleListPage | C 授权矩阵 | Phase C 加权限矩阵抽屉 |
| `/system/dict` | DictManagePage | A 主从 | 已差异化，打磨 |
| `/monitor/login-log` `/monitor/oper-log` | *LogListPage | D 只读日志 | Phase C 加详情抽屉 |

**核心原则：不 fork 引擎。** A 类页共享 `AdminListPage`；引擎支持可选的 `view` 模式（`table` / `cards`）与范式增强；仅 B/C/D 类抽专用页。"界面都不一样"靠**范式分流**实现，而非每页重画。

## 2. 第一个界面修改方案 = 通用 CRUD 引擎（AdminListPage）

文件：`frontend/mis-admin-web/src/features/system/admin-list-page.tsx`
目标：让 4 个通用页（employee / post / config，以及暂留表格的 app）共享一套更精致、更一致的基线，并为 app 卡片网格预留扩展点。

### 2.1 具体改造点（精确到代码位置）

1. **筛选卡可折叠 + 计数**（约 L331–403）
   - 顶部加 header 行：左侧 `filter` 图标 + 「筛选」+ 动态「已设置 N 项条件」chip（`bg-primary/10 text-primary`）；右侧折叠箭头（收起时 rotate -90°）。
   - 计数 = `Object.values(applied).filter(v => v!=='' && v!=null).length`。
   - 收起时仅留 header；展开显示现有 12 栅格字段 + 重置/查询。
   - 规范来源：`design-system.md` §3.2 FilterCard。

2. **富空态**（替换 L424–432 的「暂无数据」纯文本）
   - 无数据：`Inbox` 图标 + 「暂无 {title} 数据」+ 副文案 + 「新建」主按钮（非 readonly）。
   - 无搜索结果：不同图标/文案（「没有符合条件的记录，试试调整筛选」+ 重置按钮）。
   - 规范来源：`design-system.md` §3.2 EmptyState。

3. **操作列：删除入 DropdownMenu（更多 ▾）**（L448–479）
   - 详情/编辑保持行内主色文字链接；删除移入 shadcn `DropdownMenu`（更多 ▾），菜单项红字 + 二次确认（替代裸 `window.confirm`，统一确认风格）。
   - 降低行内视觉噪声，窄列更紧凑。依赖：`components/ui/dropdown-menu.tsx`（需确认已存在，否则用轻量 popover 兜底）。

4. **状态列统一圆点徽标**（L438–442）
   - 现状已用 `StatusBadge` + `statusTone`（启用=success / 禁用=destructive / 锁定=warning）。确认覆盖全部语义，并统一为「淡底 + 圆点 + 文字」dot 风格（`design-system.md` §3.2 Badge）。

5. **加载骨架接入**
   - 引擎当前用本地 `sample`、无 loading 态。增加 `loading` 态：初次加载展示 `ListPageSkeleton`（组件已存在于 `components/common/list-page-skeleton.tsx`，直接复用）。

6. **响应式细节**
   - 表头 sticky、表格 `overflow-x-auto`、筛选 `grid-cols-1 → md:grid-cols-12` 已具备。补：操作列在窄屏保持可见（不参与横向压缩）；确认 `<640px` 筛选单列堆叠。

### 2.2 明确不做（边界）

- 不拆分/重写引擎；不动 AI（form-fill / extract / rag）能力。
- 不动 Sheet 表单结构（创建/编辑/详情 + AI 工具栏保持）。
- app 卡片网格**不在此首屏**（见 Phase B），但引擎预留 `view:'cards'` 扩展点。

### 2.3 设计令牌与规范来源

全部复用 `design-system.md`：企业靛 `--primary`、语义色、圆角 `--radius`、FilterCard / EmptyState / StatusBadge(dot) / DropdownMenu 视觉规格。不引入新令牌，守 shadcn 红线。

### 2.4 验收标准

- employee / post / config（及暂留表格的 app）四页：筛选卡可折叠+计数、空态分两种、删除走下拉+确认、状态为圆点徽标、首屏有骨架。
- 视觉一致性 ≥95%（同一引擎）；暗色全可用；键盘可达（DropdownMenu / 折叠按钮可聚焦，focus-visible 清晰）。

## 3. 后续路线（确认后分批）

- **Phase B — app 卡片网格**：`def.view:'cards'`：tile = icon + name + base_path + kind + runtime + status 徽标，与所有表格拉开差异。**已实施（2026-07-28）。**
- **Phase C — 范式页升级**：role 授权矩阵抽屉（选角色 → 勾菜单树 + 数据范围 radio）；日志详情抽屉（参数 / 耗时 / IP）。**已实施（2026-07-18）。**
- **Phase D — 文档回写**：`schema-design.md` 修正 `sys_api`（去 app_id、修 ER，已核实）；清理 `page-defs.ts` 陈旧 `/system/module` def；`design-system.md` §3.2 映射到真实组件（AdminListPage / ModuleManagePage / MenuManagePage）与 A/B/C/D 范式。**已实施（2026-07-28）。**

## 4. 待用户拍板的两个小决策

1. 删除操作：入「更多 ▾」下拉（推荐，降噪） vs 保持行内三连。**已按推荐实施。**
2. 首屏范围：仅引擎提升（4 页统一基线） vs 引擎提升 + app 卡片网格一并做。**已按推荐实施（仅引擎）。**

## 5. 首屏实施记录（2026-07-18）

文件：`frontend/mis-admin-web/src/features/system/admin-list-page.tsx`（通用 CRUD 引擎）

已落地（对照 §2.1）：
1. **筛选卡可折叠 + 计数** — 顶部 header 行：搜索图标 + 「筛选」+ 动态「已设置 N 项条件」chip（`bg-primary/10 text-primary`）；右侧查询/重置/折叠箭头（展开 rotate 180°）。计数 = `Object.values(applied).filter(v => v !== '' && v != null).length`。收起时仅留 header，字段 12 栅格折叠隐藏。模式移植自 `list-page-skeleton.tsx` 的已有 FilterCard。
2. **富空态（两种）** — 无数据：`Inbox` + 「暂无{title}数据」+ 副文案 + 「新建」主按钮（非 readonly）；无搜索结果：`SearchX` + 「没有符合条件的记录」+ 「清除筛选」按钮。替换原纯文本「暂无数据」。
3. **删除入「更多 ▾」下拉** — 详情/编辑保持行内主色文字链接；删除移入自研轻量 `RowMoreMenu`（无 Radix 依赖，支持点击外部 / Esc 关闭、ARIA menu）。二次确认沿用 `window.confirm`（原生、键盘可达），未引入新弹窗组件。
4. **状态列圆点徽标** — 已用 `StatusBadge` + `statusTone`（success/warning/destructive），dot 风格，无需改动，§2.1 第 4 点已满足。
5. **加载骨架 + loader 扩展点** — 新增 `loading` 态与 `useEffect`：当 `def.loader` 提供时首屏展示 `animate-pulse` 骨架行并异步加载，否则用 `sample` 无加载态。`AdminPageDef.loader` 字段已加（`types.ts`）。当前无 def 接入 loader，属真实扩展点（接入 API 即生效），非死代码。
6. **响应式** — 表头 sticky、表格 `overflow-auto`、筛选 `grid-cols-1 → md:grid-cols-12` 沿用；操作列不参与横向压缩、窄屏保持可见。

验收：employee / post / config（及暂留表格的 app）四页共享同一引擎，上述 5 项统一生效；`npm run typecheck` 通过（0 错误）。暗色令牌复用（bg-popover / bg-muted / text-primary 等）已覆盖。

未做（边界，见 §2.2）：未拆分引擎、未动 AI 表单/抽取/问答、未动 Sheet 结构、app 卡片网格推迟 Phase B。

## 6. Phase B 实施记录（2026-07-28）

目标：让 `/system/app` 由标准表格切到**卡片网格**视图，与 employee/post/config 三个表格范式拉开差异（解决"界面都一样"）。**不 fork 引擎**，沿用统一的头部 / 筛选卡（可折叠+计数）/ 新建按钮 / Sheet / AI 工具栏，仅替换结果区渲染。

改动：
1. **类型扩展** — `AdminPageDef` 新增 `view?: 'table' | 'cards'`（默认 `table`），作为引擎结果区视图开关。
2. **app 数据定义** — `page-defs.ts` 的 `/system/app` def 标注 `view: 'cards'`。
3. **引擎注入卡片视图** — `admin-list-page.tsx`：
   - 新增 `AppCardGrid`（结果区组件，接收 `pageRows/loading/filterCount/def/...`）+ `AppTile`（单卡片）+ `AppTileIcon`（按 `row.icon` 字符串名映射 lucide 图标，兜底 `LayoutGrid`）+ `labelOf`（复用 `optionLabel` 从 `def.form` 取 kind/runtime 中文标签）。
   - 结果区 `def.view === 'cards'` 时渲染 `<AppCardGrid .../>`，否则渲染原 `<table>`；分页器（pager）在两种视图下共用。
   - 卡片网格复用 Phase A 的同套状态：loading 骨架（8 张 `animate-pulse` 骨架卡）、双空态（`SearchX` 无结果 / `Inbox` 无数据，按钮回调一致）、`StatusBadge` 圆点徽标、`RowMoreMenu`（更多 ▾ → 删除，含二次确认）。
   - 卡片栅格响应式：`grid-cols-1 → sm:2 → lg:3 → xl:4`；hover `border-primary/40 + shadow-md` 轻抬升。
   - 视觉令牌全复用 shadcn（bg-card / bg-muted / text-primary / bg-primary/10 / shadow-card），暗色自动适配；未引入新令牌。

验收：`/system/app` 现为卡片网格，其余 A 类页仍为表格；`npm run typecheck` 通过（0 错误）。app 样本图标 `layoutDashboard / shieldCheck / activity` 均映射成功。

Phase D 已实施（2026-07-28）：见 §9。

## 7. Phase C 实施记录（2026-07-18）

### 7.1 系统管理左侧菜单「不全」根因与修复
用户观察到系统管理左侧菜单缺项。核查结论：
- 前端 `SYSTEM_NAV` 静态导航**完整**（覆盖所有真实路由）；但侧边栏在后端返回菜单时**完全覆盖**静态导航（`routerMenusToSystemNav(menus) ?? SYSTEM_NAV`）。
- 后端 seed（V2）漏建 4 个菜单页（employee / post / app / config），且全部 system/monitor 叶子 `path` 写的是**相对路径**（如 `'user'`），经 `joinPath('/', node.path)` 生成 `/user` 而非 `/system/user`，会 404。
- 修复在数据源层（无需改前端导航代码）：新增迁移 `backend/mis-migrator/.../V9__add_missing_system_menus.sql`，幂等插入 4 个缺失页 + 12 个按钮权限 + 授予 TENANT_ADMIN(role=1)；并将所有 type=2 相对 path 归一化为完整路由（/dashboard、/system/*、/monitor/*）。

### 7.2 角色授权矩阵抽屉（RoleListPage）
文件：`frontend/mis-admin-web/src/features/system/role/role-list-page.tsx`
- 用可展开**复选框树**（`MenuTreeNode` + `MenuTree`）替换原扁平 checkbox 列表：父级带展开箭头（ChevronRight rotate）、父子联动勾选、半选 indeterminate（`ref.current.indeterminate`）。
- 关键正确性：勾选叶节点时**同时把祖先目录加入权限集合**（`buildParentMap` + `toggleMenus` 向上传播），否则后端按 `sys_role_menu` 构建路由树时无法触达叶子；取消勾选只移除节点及其子树。
- 数据范围由 `<select>` 改为**单选 radio 组**（6 项，选中态 `border-primary bg-primary/5`），视觉与交互更清晰。
- 复用 shadcn 令牌（`accent-primary` / `border-primary` / `bg-primary/5`），暗色自动适配。

### 7.3 日志详情抽屉（LogListPage）
文件：`frontend/mis-admin-web/src/features/monitor/log-pages.tsx` + 类型 `types/api.ts`
- 操作/登录日志表格行点击打开 **Sheet 详情抽屉**，只读展示明细。
- 操作日志：时间 / 用户 / 模块 / 操作 / 方法 / URI / 状态码 / 耗时 / IP / **请求参数**（`requestParams`）。
- 登录日志：时间 / 用户 / IP / 状态徽标 / 消息 / 客户端 UserAgent。
- 后端配合：为能展示请求参数，给 `mis-audit` 的 `OperLogVO` 增加 `requestParams` 字段并在 `OperLogService.toVo` 映射（前端 `OperLogItem` 同步加字段）。前端经 `/audit/oper-logs` 直读，VO 透传，无需 BFF 改动。
- 新增 `DetailField` 统一「标签 / 值」栅格排版，长值 `break-all` 防溢出；参数/URI/UA 用 `font-mono text-xs` 等宽展示。

验收：`npm run typecheck` 通过（0 错误）。Phase C 三项（菜单补全 + 角色矩阵 + 日志详情）均落地。

Phase D 已实施（2026-07-28）：见 §9。

## 8. 侧栏完整性加固（2026-07-28）

现象：系统管理侧栏仍缺菜单（员工/岗位/应用/系统参数等）。

根因：侧栏结构来自后端 `/menus/router`，而 `routerMenusToSystemNav(menus) ?? SYSTEM_NAV` 在**后端返回任意非空集合时整体覆盖**完整的静态 `SYSTEM_NAV`。后端菜单是否完整取决于 seed + 角色权限（`sys_role_permission` perm_type=menu）。补齐数据需迁移 `V9__add_missing_system_menus.sql`（补 4 页 + 12 按钮 + 授权 + path 归一化）；该迁移若未在目标库执行，后端仍返回残缺集合 → 侧栏「不全」。

加固（前端，与数据修复互补，互不排斥）：
- `menus-to-nav.ts` 新增 `mergeNavWithFallback(fallback, dyn)`：以 `SYSTEM_NAV`（权威完整清单）为骨架，用动态菜单中**同路径叶**做标题/图标增强；fallback 的叶始终保留。
- `app-layout.tsx`：`navNodes` 在 `app.code === 'system'` 时改用 `mergeNavWithFallback(SYSTEM_NAV, dyn)`，使后端 seed/权限偶发缺漏时侧栏结构仍完整（原本仅在后端完全返回空才回退静态导航）。后端数据正确后，动态叶会覆盖同名叶的标题/图标，无回归。
- 说明：此加固默认显示全部已知路由（与既有 `?? SYSTEM_NAV` 空态回退语义一致）；细粒度 RBAC 隐藏仍依赖正确执行 V9。

验收：`npm run typecheck` 通过（0 错误）。无论 V9 是否执行，系统管理子系统侧栏均展示全部 13 个已知路由。

## 9. Phase D 实施记录（2026-07-28）

目标：文档回写收尾——消除设计与代码漂移，使设计文档 1:1 反映前端真实落地（Phase A/B/C 后的状态）。

改动：
1. **`schema-design.md` 修正 `sys_api`（已核实）**：ER 图已删 `SYS_APP ||--o{ SYS_API`，改 `SYS_API ||--o{ SYS_MODULE : provides`；§3.15 字段表删 `tenant_id/app_id`、`module_id` 标 FK NOT NULL；索引 `uk_api_app_code`→`uk_api_module_code`。其余 `app_id`（sys_user/sys_role/sys_menu/sys_token/sys_login_log）为合法字段，保留。关联 ADR-017（sys_api 改纯 module 归属）。
2. **清理 `page-defs.ts` 陈旧 `/system/module` def（前端代码）**：`SYSTEM_PAGE_DEFS['/system/module']` 是死元数据——`/system/module` 实际由 `keep-alive-outlet.tsx` 的 `PAGE_MAP` 路由到 `ModulePage`（即 `ModuleManagePage`），从不经过读取 `SYSTEM_PAGE_DEFS[path]` 的通用 `AdminListPage`。删除该 entry 不影响任何渲染（`Record` 缺键与 `/dashboard` 等未登记路由同态）。
3. **`design-system.md` §3.2 映射到真实组件 + A/B/C/D 范式**：新增 §3.2.1「真实组件实现映射」表，将四类范式 1:1 对齐到真实组件文件（AdminListPage / AppCardGrid / MenuManagePage / ModuleManagePage / RoleListPage / LoginLogListPage+OperLogListPage），标注 Phase A/B/C 落地状态与关键增强；§3.3 补录此前缺失的「模块管理」范式 spec，并为「角色管理」「日志」两条补 Phase C 增强（授权矩阵抽屉 / 详情 Sheet 抽屉）。

验收：`npm run typecheck` 通过（0 错误，page-defs.ts 删键后 `SYSTEM_PAGE_DEFS` 仍为合法 `Record<string, AdminPageDef>`）。设计文档与代码现状对齐，无遗留漂移。

## 10. 菜单管理完整还原（设计稿对齐，2026-07-28）

用户要求把 `prototype.html` 设计稿的菜单管理**完整还原**（此前骨架已落地，缺精修层）。结论：此前已实现左树+详情+编辑抽屉主流程；本次补齐设计稿的全部精修特性。

前端改动：`frontend/mis-admin-web/src/features/system/menu/menu-manage-page.tsx` 重写，补齐：
- 顶部节点总数统计（共 N 个节点）。
- 左侧树：搜索框（按名称实时过滤）+ 类型筛选 chips（全部/目录/菜单/按钮，选中态高亮）+ 树节点彩色类型图标圆点（目录=muted / 菜单=primary / 按钮=success）+ 隐藏 eye-off 指示 + 状态圆点（禁用灰/启用绿）+ 行内 hover 增/编/删操作（stopPropagation）+ 无匹配空态。
- 右侧属性面板：类型彩色徽章 + 名称 + code + 图标预览；基础信息卡片（图标/名称/类型/path/component/permission/排序/可见/状态，success 徽标）；**直接子节点列表**（类型图标 + permission + 类型徽章，可点击切换）；**关联 API 区**（GET/POST/PUT/DELETE 彩色徽章 + 端点 + "经 sys_menu_api 绑定"标注 + 空态"该节点未绑定 API"）。
- 新增/编辑抽屉：类型下拉（仅新增）、**按 type 动态显隐 path/component**（按钮 type=3 隐藏）、图标名实时预览（lucide 动态图标）。
- 删除确认：**样式化对话框**（overlay + 卡片 + 警告图标 + 子节点数量警告文案 + 取消/删除按钮）替换原生 `window.confirm`。

后端改动（让关联 API 区有真实数据，非 mock）：
- `MenuVO` 新增 `apiList: List<MenuApiItem>` 字段（内部 record `MenuApiItem(method, path)`）。
- `SysMenuApiRepository` 新增 `findApisByMenuIds(menuIds)` 原生 SQL，JOIN `sys_api` 返回 (menuId, method, path)。
- `MenuService.tree()` 预加载 `menuId → apiList` 映射并填充 `toVo`；`router()/getById/create/update` 传空 map（路由/单条不需 apiList，保持轻量）。
- 走现有 `/menus/tree` 端点，前端零额外请求、BFF/gateway 无需改。

验收：前端 `npm run typecheck` 0 错误。后端三处 Java 改动逻辑正确、对齐现有风格，但沙箱受 JDK8 限制无法本地编译，需 JDK17 起服后验证（`GET /menus/tree` 现返回每个节点的 `apiList`）。

## 11. 菜单管理导航归位 + 所属应用标注（2026-07-28）

用户反馈两点：① 系统里「菜单」属于「应用」，但菜单管理被放在「权限中心」分组，与应用管理（应用/模块）割裂；② 界面上看不到菜单与应用的从属关系如何设定。

### 11.1 导航归位（system-nav.ts）
- 将 `/system/menu` 叶子从「权限中心」分支**移到「应用与接口」分支**，与 `应用管理`/`模块管理` 并列（icon 沿用 `ListTree`）。
- 路径不变（`/system/menu`），`app-layout` 的 `mergeNavWithFallback` 按 path 匹配动态菜单，故归位不受后端动态菜单影响。

### 11.2 界面显式标注所属应用（menu-manage-page.tsx）
- `PageHeader` 加面包屑 `应用与接口 / 菜单管理`，把「菜单管理 ∈ 应用与接口」的层级可视化。
- 右上角加「所属应用：{应用名}」徽标：用既有 `fetchApps()` 加载应用列表，从树节点 `appId`（`MenuNode.appId` 已存在）推导当前应用并映射成名称。
- 菜单按应用隔离：当前整棵树同属一个应用（appId 由 BFF 注入），故取任一节点 appId 即可。

### 11.3 架构说明（为何没有「应用选择器」）
- 菜单↔应用的从属由 **BFF 强绑定**：`mis-admin-bff` 的 `MenuAggregateService.tree()/create()` 调 `systemWebClient` 时 `appId = RequestContext.requireAppId()`（= 当前登录用户所属应用），前端不传 appId。所以菜单树天然就是「当前登录用户所属应用」的菜单。
- 因此本次只做**显式标注**（让从属关系可见），未擅自增加跨应用编辑的「应用下拉」——那需 BFF 接受 appId 覆盖 + 跨应用权限校验，属后端权限范畴，如需再议。

验收：`npm run typecheck` 通过（0 错误）。菜单管理现位于「应用与接口」下，且页面顶部可见其归属应用。

## 12. 菜单管理支持「全部应用」+ 基础信息横排对齐（2026-07-28）

用户两点要求：① 菜单管理要能设置**所有应用**的菜单，而非只改当前登录用户所属应用（即系统管理 app）的菜单；② 选中菜单后右侧「基础信息」改为**横排、默认一行两列**的（属性名 | 属性值）对，窄屏退回一行一列，属性名靠右、属性值靠左，且同一列属性名上下对齐。

### 12.1 后端：tree/create 接受 appId 覆盖（mis-admin-bff）
- `MenuController.tree`：`@RequestParam(required = false) Long appId`，透传给聚合层。
- `MenuAggregateService.tree(Long appId)`：`appId != null ? appId : RequestContext.requireAppId()`（缺省回落当前用户 app，向后兼容）。
- `MenuCreateRequest` 新增可选 `Long appId`；`MenuAggregateService.create` 改用 `request.appId() ?? requireAppId()`，使新建菜单归属到所选应用。
- `update` 不改 appId（编辑保持原属主）。`router()` 仍走当前用户 app（侧栏/权限不受影响）。

### 12.2 前端：应用切换下拉（menu-manage-page.tsx）
- 顶部「应用与接口」页头的 actions 区，将原先静态「所属应用」徽标**替换为应用下拉 `select`**（`<AppWindow/>` + 文案「应用」+ 下拉）。数据源复用既有 `fetchApps()`。
- 新增 `appId` state；`load(targetAppId?)`：首次加载不带 appId → BFF 回落当前用户 app → 取树首节点 appId 回填下拉默认值；切换应用时 `onAppChange(id)` 即时 `load(id)` 重载对应树。
- `fetchMenuTree(appId?)` 与 `createMenu` body 增加 `appId`，向后端传递所选应用。
- 切换后原来选中的节点可能不在新树中 → 详情面板自然回空态，用户重新点选即可。
- 跨应用编辑权限由后端 `systemWebClient.tree(appId)` 直接按 appId 查询支持；BFF 未加额外校验（系统管理员场景）。

### 12.3 前端：基础信息横排两列对齐（menu-manage-page.tsx）
- 容器由 `div.grid sm:grid-cols-2`（标签在上/值在左）改为 `<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 sm:grid-cols-[auto_1fr_auto_1fr] sm:gap-x-8">`。
- `InfoRow` 由「竖向块」改为返回 `<dt>`（属性名，右对齐 `text-right`）+ `<dd>`（属性值，左对齐 `text-left`）的 fragment，作为 `<dl>` 的直接子网格项。
- 布局行为：默认（≥640px）一行两列（标签列1 | 值列1 | 标签列2 | 值列2）；窄屏（<640px）退回一列（标签 | 值）。标签列 `auto` 宽度 + 右对齐 → **同一列属性名在右边缘对齐、上下一致**。
- 属性顺序：图标 / 名称 / 类型 / 路由 path / 组件 component / 权限码 permission / 排序 / 可见 / 状态（9 项，末行单列自然留白）。

验收：`npm run typecheck` 通过（0 错误）。后端 BFF 两处 Java 改动逻辑正确、对齐现有风格，沙箱受 JDK8 限制无法本地编译，需 JDK17 起服后验证（`GET /api/v1/menus/tree?appId=X` 与 `POST /api/v1/menus` 带 `appId`）。

## 13. 模块管理：属性横排对齐 + 接口列表树表 + 去重 + 编辑授权（2026-07-28）

用户四点反馈：① 模块详情的属性名/属性值应**参考菜单页**改为横排对齐；② 右侧「接口树」与中间「接口列表」是**同一份 API 数据的重复呈现**；③ 中间表格应显示为**树表**以看出 catalog→api 层级；④ 模块管理**整个没有编辑功能**。

### 13.1 属性区横排对齐（module-manage-page.tsx）
- `Item` 由「竖向块」改为 `<div className="flex items-baseline gap-3"><dt className="w-20 shrink-0 text-right ...">`（属性名靠右）+ `<dd className="flex-1 ...">`（属性值靠左）。容器 `<dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">`：默认一行两列、窄屏一列；`dt` 固定 `w-20` 右对齐 → 同列属性名右边缘上下对齐。属性：编码/服务名/排序/状态/创建时间/更新时间。

### 13.2 接口列表改树表 + 删除冗余右侧树
- **删除**原右侧「接口树」面板（`ApiTreeNode` 组件一并移除，`selectedApi` state 清理）。
- 中间「接口列表」Tab 渲染为**树表**：复用既有 `flattenApis` 的 `depth`，`<td>` 名称列按 `paddingLeft: depth*16` 缩进 + 目录用 `Folder` 图标、接口用 `MethodBadge`，行内 hover 显示编辑/删除按钮（受 `system:module:edit/delete` 门控）。层级一目了然，且与右侧树不再重复。
- 「新增接口」按钮从被删的右面板**移入** Tab 栏右上（受 `system:module:add` 门控）。

### 13.3 编辑功能根因（RBAC，非前端缺实现）
- 前端**已有**编辑：头部「编辑/删除」按钮 + `openEditModule/saveModule` + Sheet 表单（updateModule 走 `PUT /modules/:id`）；接口行内编辑/删除也有。
- 用户看不到，根因在**权限未授权**：V2 的「全量授权」`SELECT id,1,'menu',id FROM sys_menu`（V2__seed_data.sql:109-110）在 V8 之前执行；V8 仅 INSERT 了模块按钮菜单节点（id 271/272/273，`system:module:add/edit/delete`，V8:42-44）却未写 `sys_role_permission` 授权 → TENANT_ADMIN(role_id=1) 缺这三个权限 → PermissionGate 把按钮全隐藏。
- **修复**：新增迁移 `V10__grant_module_button_perms.sql`，把 `parent_id=207 AND type=3` 的按钮授权给 `role_id=1`（与 V9 菜单页授权口径一致），`NOT EXISTS` + `ON CONFLICT(id) DO NOTHING` 防御式可重复执行。需 JDK17 起服后由 Flyway 应用。

验收：前端 `npm run typecheck` 0 错误（module-manage-page.tsx 改动：属性横排、树表、删 ApiTreeNode/selectedApi）。V10 为纯 SQL 迁移，沙箱无法跑 Flyway，需起服验证授权生效。

## 14. 抽取可复用通用组件 DetailDefList + TreeTable（2026-07-28）

用户要求：把菜单管理（基础信息横排）与模块管理（接口树表）这两套已落地的范式沉淀为可复用组件，方便后续角色/字典/部门等详情页直接套用，消除"同一布局各处写一遍"的设计债。

### 14.1 新建通用组件
- `src/components/common/detail-def-list.tsx` → `DetailDefList`：`<dl>` 网格，属性名靠右 / 值靠左；默认（≥sm）`grid-cols-[auto_1fr_auto_1fr]` 一行两对，窄屏 `grid-cols-[auto_1fr]` 一行一对；标签列 `auto` 宽 + 右对齐 → 同列属性名右边缘上下严格对齐；空值渲染 `—`。Props：`items: { label, value, key? }[]`、`className?`。
- `src/components/common/tree-table.tsx` → `TreeTable<T extends TreeTableNode>`：泛型树表。数据约定：调用方先 `flatten(nodes)` 成 `{ id, depth, ...node }[]`，组件按 `depth * indentSize`（默认 16）给 `treeColumnKey` 列加左缩进并渲染 `rowIcon`。Props：`rows` / `columns` / `treeColumnKey` / `rowIcon?` / `rowActions?`（hover 显隐）/ `rowClassName?` / `onRowClick?` / `emptyText?` / `indentSize?`；空态占满 `colSpan`。

### 14.2 回改两页消费通用组件（验证范式可用）
- `menu-manage-page.tsx`：基础信息 `<dl>+InfoRow` 替换为 `<DetailDefList items={...}/>`；删除本地 `InfoRow`（网格行为完全一致，零视觉回归）。
- `module-manage-page.tsx`：① 基础信息 `<dl>+Item` 替换为 `DetailDefList`；② 接口列表内联 `<table>` 替换为 `<TreeTable<ApiRow>>`（`flattenApis` 改为产出 `ApiRow{id, depth, node}`，新增 `apiRows` memo，删除冗余 `flatApis` memo）；③ 删除本地 `Item` 与 `ApiTreeNode` 残留。

### 14.3 文档同步
- `design-system.md` 新增 §3.4「通用布局组件（可复用）」：`DetailDefList` / `TreeTable` 的用途、Props、对齐规范、用法示例、已消费页面；并将 §3.3 模块管理「接口树」措辞修正为「接口树表（TreeTable）」。

验收：前端 `npm run typecheck` 0 错误（两个新组件 + 两页回改）。设计系统文档与代码现状对齐：横排定义列表与树表现为平台级可复用范式，后续详情页无需再手写对齐布局。

## 15. 剩余系统管理页面统一改造（2026-07-28）

用户要求：将剩余所有系统管理页面按已建立的 DetailDefList + TreeTable 范式重新规划和设计，设计完成即修改代码。

### 15.1 通用引擎 AdminListPage：详情视图 → DetailDefList
- `admin-list-page.tsx` Sheet view 模式：原 `grid grid-cols-[9rem_1fr]` 逐行手写 → 替换为 `<DetailDefList items={def.form.map(...)}>`。
- 影响范围：员工管理、岗位管理、系统参数、登录日志、操作日志等所有走 `AdminListPage` 引擎的页面详情视图统一升级。

### 15.2 组织管理：新增详情视图 + 按钮统一
- `org-list-page.tsx`：新增 `viewing` 状态 + `openView()` 函数 + "详情" 按钮；Sheet detail 模式用 `DetailDefList` 展示编码/名称/排序/状态/备注。
- 表格操作按钮从 icon-only `Button variant="ghost"` 改为文字+图标（详情/编辑/删除），Sheet 改为 `flex w-full flex-col` 布局。

### 15.3 部门管理：手写树表 → TreeTable 组件
- `dept-tree-page.tsx`：删除手写 `flatten` + `paddingLeft: depth*16` + `expanded` 展开/折叠状态 + `ChevronDown/ChevronRight` 图标。
- 改用 `<TreeTable>` 全展开模式渲染：`DeptRow = TreeTableNode & { node: DeptNode }`，`flatten()` 产出 `{ id, depth, node }[]`，`rowIcon` 按 `hasChildren` 显示 `Folder` 图标或空位。
- 列定义：部门名称（treeColumn）/ 编码 / 排序 / 状态（StatusBadge）。`rowActions` hover 显示"子部门/编辑/删除"文字按钮。
- 加载态从纯文字"加载中…"改为骨架行。

### 15.4 用户管理：DetailRow → DetailDefList
- `user-list-page.tsx`：`UserDetail` 组件内 10 个 `<DetailRow>` 替换为单个 `<DetailDefList items={...}>`。
- 删除本地 `DetailRow` 组件（`grid grid-cols-[9rem_1fr]` 手写行）。
- 状态字段从纯文字改为 `<StatusBadge>` 徽章。

### 15.5 角色管理：新增详情视图 + 按钮统一
- `role-list-page.tsx`：mode 类型扩展为 `'edit' | 'menus' | 'detail'`，新增 `viewing` 状态 + `openView()` + "详情" 按钮。
- Sheet detail 模式用 `DetailDefList` 展示编码/名称/数据范围/状态/备注。
- 表格操作按钮从 icon-only `Button variant="ghost"` 改为文字+图标（详情/编辑/权限/删除）。

### 15.6 字典管理：按钮统一 + 加载态 + 空状态优化
- `dict-manage-page.tsx`：字典项表格操作按钮从 icon-only `Button` 改为文字+图标（编辑/删除）。
- 提取 `onDeleteType` / `onDeleteItem` 函数，消除内联 async IIFE。
- 新增 `loadingItems` 状态，字典项表格加载时显示"加载中…"。
- Sheet 改为 `flex w-full flex-col` 布局 + `flex-1 overflow-auto` 内容区。

验收：前端 `npm run typecheck` 0 错误（6 个文件改动：admin-list-page / org-list-page / dept-tree-page / user-list-page / role-list-page / dict-manage-page）。全部系统管理页面的详情视图统一使用 DetailDefList，层级数据统一使用 TreeTable，操作按钮统一为文字+图标风格。

## 16. 员工/部门/角色/用户 四项交互补全（2026-07-29）

针对系统管理四个高频页面的交互缺口做补全，均通过 `npm run typecheck` 0 错误验收。

### 16.1 员工管理：多岗位标签簇（一眼可见任职岗位）
- 通用引擎 `AdminColumn` 新增 `tags?: boolean` 渲染模式：值为 `string[]` 时渲染为标签簇，首项填充色（主岗）、其余描边色（兼职）。
- `admin-list-page` 表格单元格新增 `c.tags` 分支 + `TagCluster` 组件（`flex-wrap` 自动换行）。
- `page-defs` 员工定义新增「任职岗位」列（`tags: true`），样例数据为每个员工补 `posts` 数组（如王磊：`['研发总监','架构师','技术委员会']`）。
- 表格列即满足"一眼看出在哪些岗位任职"；详情 Sheet 仍由 DetailDefList 展示原字段。

### 16.2 部门管理：行内操作 hover 显隐
- 已确认 `TreeTable` 组件天然支持：`rowActions` 包裹于 `opacity-0 group-hover:opacity-100`，`<tr>` 带 `group` 类。编辑/删除/子部门按钮默认隐藏，鼠标移入整行即显隐。无需改动。

### 16.3 角色管理：应用 + 菜单权限闭环
- `RoleItem.appId` 已存在，补齐前端闭环：`load()` 并行拉取 `fetchApps()`。
- 表格新增「所属应用」列（`apps.find(a => a.id === row.appId)?.name`）。
- 编辑表单新增「所属应用」下拉（`createRole` / `updateRole` body 扩展 `appId`）。
- 菜单权限 Sheet 顶部新增「菜单所属应用」下拉，切换时 `reloadMenus(appId)` 重载对应应用菜单树（默认取角色 `appId`）。保存仍走 `assignRoleMenus`。

### 16.4 用户管理：统一"权限"模式（组织 / 部门 / 角色）
- 原仅角色的 `openRoles` 升级为统一 `openPerms`（mode `'perms'`），Sheet 内一次性设置 组织 + 部门 + 角色。
- 权限 Sheet 内独立的「组织 → 部门」联动：选组织后 `loadPermsDepts(orgId)` 拉取该组织部门树（`permsFlatDepts`），与左侧页面级部门树解耦。
- `updateUser` 扩展 `orgId` / `deptId`；保存时先 `updateUser` 再 `assignUserRoles`。
- 列表新增「组织」列（colSpan 8→9）；表格操作按钮"分配角色"改为"权限"（图标不变）。

文件改动：`types.ts` / `admin-list-page.tsx` / `page-defs.ts`（员工 posts）/ `role-list-page.tsx` / `roles.ts` / `user-list-page.tsx` / `users.ts`。
