# MIS 管理后台 · UI 设计方案（v1.0）

> 设计角色：**UI Designer**（界面设计专家）
> 输出类型：设计系统规格 + 高保真原型（见 `prototype.html`）
> 约束基线：[design-handoff-brief.md](./design-handoff-brief.md) · [admin-web-design.md](./admin-web-design.md)
> 画布硬约束：shadcn/ui + Tailwind 3.4 · 主题 `.dark` class · 图标 lucide-react · 布局壳 `AppLayout`
> **不可逾越的红线**：不另起色彩体系、不破坏 `--radius: 0.5rem`、不脱离 shadcn 组件词汇表。

---

## 0. 设计目标与用户习惯对齐

这是一个**面向内部运营/管理员的 MIS 后台**，用户每天高频使用，核心诉求是：信息密度高、操作路径短、状态清晰、错误可恢复。

因此本方案遵循成熟的后台 UX 惯例（符合用户已有习惯，降低学习成本）：

- **左固定导航 + 顶栏全局操作**：业内后台（Ant Design Pro / shadcn Admin 模板）主流范式，用户无需重新学习。
- **多 Tab 工作区**（已确认）：类 IDE/浏览器多标签，符合"开多个页面来回切"的工作习惯。
- **列表-详情-表单**三件套：所有管理页统一"筛选栏 + DataTable + 行内操作 + 弹窗"，降低认知负载。
- **即时反馈**：搜索防抖、提交进行中禁用、Toast 提示——前端已落实，设计补齐视觉。
- **空/错/无权限三态**：不让用户面对空白或裸报错。

> 设计取向：**克制而精确的极简（restrained precision）**——不是炫技，而是把"可靠、可读、可快速完成工作"做到位。这是后台工具最被低估的美。

---

## 1. 待品牌决策 — 已代拟方案（请产品/品牌拍板）

原 Brief §8 列出 6 项待决策。在不阻塞进度的前提下，我给出**可直接落地的默认方案**，可在原型里一键替换令牌验证。

### 1.1 品牌主色 `--primary` ✅ 已定：企业靛

| 方案 | HSL | 参考 Hex | 说明 |
|------|-----|----------|------|
| **✅ 选定：企业靛**（本轮采用） | `243 75% 59%` | `#4f46e5` | 靛蓝-600，白字对比度 ≈6.3:1（AA 通过），偏企业/稳重 |
| 浅一档（暗色/ hover） | `243 75% 66%` | `#6366f1` | indigo-500，用于 `.dark` 主色提亮 |
| 备选：校准蓝（旧默认） | `221.2 83.2% 53.3%` | `#2563eb` | 回退选项 |
| 备选：沉稳青 | `199 89% 48%` | `#0ea5e9` | 偏 SaaS 工具调性 |

> 已落地到 `prototype.html` 令牌（`--primary` 与 `--ring` 同步改为企业靛）。与原 Brief「登录页硬编码 #4f46e5」同色系——主色定为靛后，登录页*颜色*债自然消除；统一版再规范圆角/渐变即完全合规。
> 主色仅用于：主按钮、激活态导航、聚焦环、关键链接。背景/大面积**禁止**用主色铺满（避免"AI 蓝深底发光"反模式）。

### 1.2 语义色（✅ 已采用，原系统仅有 `--destructive`）

新增令牌，用于状态徽标（Badge）与提示；已在 `prototype.html` 启用（徽标、状态列、API method 标签均走 tint 方案）：

| 令牌 | Light HSL | Light Hex | Dark HSL | 用途 |
|------|-----------|-----------|----------|------|
| `--success` | `142 71% 45%` | `#16a34a` | `142 69% 58%` | 启用/成功/在线 |
| `--success-foreground` | `0 0% 100%` | `#fff` | `144 80% 10%` | 绿底白字 |
| `--warning` | `38 92% 50%` | `#f59e0b` | `38 92% 60%` | 待处理/警告 |
| `--warning-foreground` | `38 92% 12%` | `#422006` | `38 92% 12%` | 琥珀底深字（AA） |
| `--info` | `199 89% 48%` | `#0ea5e9` | `199 89% 58%` | 信息/进行中 |
| `--info-foreground` | `0 0% 100%` | `#fff` | `199 90% 10%` | 蓝底白字 |

> 徽标实现采用 **tint 方案**（浅底深字）而非满色块：如成功 = `bg-success/10 text-success`，对比度更稳、更克制。

### 1.3 暗色模式配色

沿用现有 `globals.css` `.dark` 值（已验证可运行），仅微调两处提升层次感：

- 侧栏 `--sidebar` 用比主背景**略亮一档**（`222.2 47.4% 11.2%` ≈ `#171f33`），让导航从内容区"浮"出来。
- 卡片与背景同色，靠 `--border` 描边 + 极淡阴影区分，而非用不同底色（暗色下更干净）。

### 1.4 字体层级（原系统只给了字体栈，未定义字阶）

后台信息密度高，**基准字号定为 14px**（非 16px），更易在一屏容纳更多数据，且 14px 仍满足可读性。

| 角色 | 字号 | 行高 | 字重 | 用途 |
|------|------|------|------|------|
| 页面标题 H1 | 20px (`1.25rem`) | 1.4 | 600 | PageHeader 标题 |
| 区块标题 H2 | 16px (`1rem`) | 1.5 | 600 | 卡片/分区标题 |
| 表格头 | 12px (`0.75rem`) | 1.4 | 600 / `uppercase tracking-wide` | 列名（弱化，降噪） |
| 正文/单元格 | 14px (`0.875rem`) | 1.6 | 400 | 默认 |
| 辅助/说明 | 12px (`0.75rem`) | 1.5 | 400 | 副文案、`muted-foreground` |

> 字体栈保持：`Inter, "PingFang SC", "Microsoft YaHei", sans-serif`（中英文混排友好）。

### 1.5 Logo 与侧栏品牌区

- 不引入图片资源依赖：用**纯 CSS 文字标**——方块标记 `▦` + 字距收紧的 `MIS Platform`。
- 折叠态仅显示标记 `M`（与现有 `app.name` 首字母逻辑一致）。
- 标记底色用 `bg-primary` 白字，圆角 `rounded-md`，尺寸 28×28。

### 1.6 登录页：统一 vs 未统一（原型已并排展示）

主色定为**企业靛**后，登录页颜色债已消除（与令牌同色系）。`prototype.html` 登录视图**左右并排**展示两版，差异一目了然：

- **① 令牌统一版（推荐）**：主色走 `primary` 令牌、圆角 `0.5rem`、中性背景、带 `border` 描边、跟随 Light/Dark。
- **② 遗留硬编码版（当前代码）**：硬编码 `#4f46e5`、卡片圆角 `16px`、输入圆角 `8px`、蓝调渐变 `#eef2ff`、仅亮色、无描边。

> 建议：**采用统一版**。圆角/渐变/描边/主题四项规范后，登录页与全站视觉完全统一，且无需改色即合规。

---

## 2. 设计令牌总表（与代码 1:1）

> HSL 为代码真值；Hex 仅供设计/走查参考。所有颜色经 `hsl(var(--x))` 引用。

### 2.1 中性与基础（Light / Dark）

| 令牌 | Light HSL | Light Hex | Dark HSL | Dark Hex |
|------|-----------|-----------|----------|----------|
| `--background` | `0 0% 100%` | `#ffffff` | `222.2 84% 4.9%` | `#0b0f1a` |
| `--foreground` | `222.2 84% 4.9%` | `#0f172a` | `210 40% 98%` | `#f8fafc` |
| `--card` | `0 0% 100%` | `#ffffff` | `222.2 84% 4.9%` | `#0b0f1a` |
| `--card-foreground` | `222.2 84% 4.9%` | `#0f172a` | `210 40% 98%` | `#f8fafc` |
| `--popover` | `0 0% 100%` | `#ffffff` | `222.2 84% 4.9%` | `#0b0f1a` |
| `--muted` | `210 40% 96.1%` | `#f1f5f9` | `217.2 32.6% 17.5%` | `#1e293b` |
| `--muted-foreground` | `215.4 16.3% 46.9%` | `#64748b` | `215 20.2% 65.1%` | `#94a3b8` |
| `--border` | `214.3 31.8% 91.4%` | `#e2e8f0` | `217.2 32.6% 17.5%` | `#1e293b` |
| `--input` | `214.3 31.8% 91.4%` | `#e2e8f0` | `217.2 32.6% 17.5%` | `#1e293b` |
| `--ring` | `243 75% 59%` | `#4f46e5` | `243 75% 66%` | `#6366f1` |
| `--sidebar` | `210 40% 98%` | `#f8fafc` | `222.2 47.4% 11.2%` | `#171f33` |
| `--sidebar-foreground` | `222.2 47.4% 11.2%` | `#1e293b` | `210 40% 98%` | `#f8fafc` |

### 2.2 品牌与语义

| 令牌 | Light | Dark | 说明 |
|------|-------|------|------|
| `--primary` | `243 75% 59%` (#4f46e5) | `243 75% 66%` (#6366f1) | 主色（企业靛） |
| `--primary-foreground` | `210 40% 98%` (#f8fafc) | `222.2 47.4% 11.2%` (#1e293b) | 主色上的字 |
| `--secondary` | `210 40% 96.1%` (#f1f5f9) | `217.2 32.6% 17.5%` (#1e293b) | 次按钮底 |
| `--secondary-foreground` | `222.2 47.4% 11.2%` | `210 40% 98%` | 次按钮字 |
| `--accent` | `210 40% 96.1%` | `217.2 32.6% 17.5%` | 悬浮/选中底 |
| `--accent-foreground` | `222.2 47.4% 11.2%` | `210 40% 98%` | 悬浮/选中字 |
| `--destructive` | `0 84.2% 60.2%` (#ef4444) | `0 62.8% 30.6%` (#991b1b) | 危险/删除 |
| `--destructive-foreground` | `210 40% 98%` | `210 40% 98%` | 危险上的字 |
| `--success` / `-foreground` | `142 71% 45%` / `0 0% 100%` | `142 69% 58%` / `144 80% 10%` | 成功 |
| `--warning` / `-foreground` | `38 92% 50%` / `38 92% 12%` | `38 92% 60%` / `38 92% 12%` | 警告 |
| `--info` / `-foreground` | `199 89% 48%` / `0 0% 100%` | `199 89% 58%` / `199 90% 10%` | 信息 |

### 2.3 几何令牌

| 令牌 | 值 | 用途 |
|------|----|------|
| `--radius` | `0.5rem` | **全局圆角，禁止破坏**；卡片 `rounded-lg`、按钮/输入 `rounded-md` |
| 侧栏展开宽 | `16rem` (`w-64`) | ≥1024px 常驻 |
| 侧栏折叠宽 | `4rem` (`w-16`) | 折叠态仅图标 |
| 顶栏高 | `3.5rem` (`h-14`) | Header |
| 间距基准 | `4px` | Tailwind 默认（`p-4`=16px）；保持 4 的倍数节奏 |

---

## 3. 组件库与映射（设计师只许用这些）

### 3.1 shadcn 基础组件（按需 CLI 添加，不手写）

`button, input, label, form, table, dialog, dropdown-menu, select, checkbox, switch, badge, avatar, separator, sheet, tabs, card, breadcrumb, pagination, popover, command, skeleton, alert, tooltip, scroll-area, sidebar`

### 3.2 业务组合组件视觉规格

| 组件 | 位置 | 视觉规格 |
|------|------|----------|
| `PageHeader` | 每页顶部 | 左：面包屑(`muted-foreground`) + H1 标题；右：`flex gap-2` 操作区（主按钮 + 次按钮/更多Dropdown）。底部 `mt-4 mb-6` 分隔。 |
| `DataTable` | 列表页 | 表头 `bg-muted/50 text-muted-foreground text-xs uppercase tracking-wide`；行 `hover:bg-muted/40`；单元格 `py-3 px-4`；隔行**不**用斑马纹（更干净）；选中行 `bg-primary/5`。 |
| `TabBar` | 主区顶部 | 类浏览器标签：`h-9 rounded-md px-3 text-sm`，激活 `bg-background shadow-sm border` + 关闭 `x` 悬停显红；固定标签显示图钉。 |
| `Sidebar/NavMenu` | 侧栏 | 展开 `w-64`，项 `rounded-md px-3 py-2 text-sm`；激活 `bg-primary text-primary-foreground`；悬停 `hover:bg-accent`。折叠 `w-16` 仅图标，tooltip 显示名。 |
| `SubmitButton` | 所有保存/删除 | 包 Button：`loading` → `disabled` + `Loader2` 旋转（`animate-spin`）。主操作用 `btn--primary`。 |
| `CopilotPanel` | 右侧 Sheet | 占位：标题"AI 助手" + 静态欢迎文案 + 禁用/禁用态输入框（`placeholder` 灰、不可点）。 |
| `StatCard` | 仪表盘/列表概览 | **截图风格（v1.1 起）**：`card p-5`；左列 = 指标名(`muted-foreground text-sm`) + 大数(`text-3xl font-semibold leading-none`、`mt-3`) + 同比小标(`text-xs` 绿涨红跌)；右上 = `rounded-full bg-primary/10 text-primary h-10 w-10` 圆标。悬停 `hover:shadow-md`。 |
| `FilterCard` | 列表页顶部 | 可折叠筛选卡：`rounded-lg border`；首行 `filter` 图标 + 标题 + 计数徽标(`rounded-full bg-primary/10 text-primary` 「已设置 N 项条件」) + 折叠箭头(chevron，旋转 `-90deg` 收起)。展开区 `grid sm:grid-cols-3 gap-3`：若干字段 + 行尾 `btn--primary` 搜索 + `border` 重置。 |
| `StatusTabs` | 列表页表头上方 | 状态快速过滤：`flex border-b`；每个 `user-tab` = `border-b-2` 下划线制；激活 `border-primary font-medium`（文字 `foreground`），非激活 `text-muted-foreground`。与搜索/导出工具栏分离。 |
| `Badge`(状态) | 表格状态列 | **v1.1 起统一为圆点徽标**：`inline-flex items-center gap-1.5 rounded-full bg-{sem}/10 px-2.5 py-0.5 text-xs font-medium text-{sem}` + 前置 `<span class="h-1.5 w-1.5 rounded-full bg-{sem}">` 圆点。语义色：success/warning/info/destructive/muted。 |

### 3.3 关键页面视觉要点

**登录页 `/login`（令牌统一版）**
- 居中卡片 `max-w-sm rounded-lg border bg-card p-8 shadow-sm`；标题 `MIS Platform` + 副标题 `muted`。
- 字段：用户名 / 密码（`type=password`）/ 验证码（输入 + 右侧验证码图 `h-10` 可点刷新）。
- 提交 `btn--primary w-full`（`#4f46e5` → 改 `bg-primary`）。错误用 `alert` 红底。
- 回车提交；失败刷新验证码。

**仪表盘 `/dashboard`**
- 顶部 4 张统计卡（`StatCard` v1.1）：`grid md:grid-cols-2 lg:grid-cols-4 gap-4`；每张 = 左列「指标名(`muted-foreground`) + 大数(`text-3xl font-semibold leading-none`) + 同比小标(`text-xs` 绿涨红跌)」+ 右上 `rounded-full bg-primary/10 h-10 w-10` 圆标。悬停提阴影。
- 快捷入口：3 个 `card` 链接（用户/组织/角色管理），图标 + 名 + 箭头。
- 最近操作日志：标准 `DataTable` Top10，列 = 操作人/操作/时间/状态（圆点徽标 v1.1）。

**用户管理 `/system/user`**（v1.1 列表页范式，参考企业微信中台）
- 左 `w-60` 组织树（`bg-muted/30 rounded-lg p-3` 内嵌 `ScrollArea`）；右主区 = `FilterCard`（可折叠，含「已设置 N 项条件」计数 + 搜索/重置）+ `StatusTabs`（全部/启用/禁用/锁定）+ `DataTable`。
- 表头上方：状态标签页（`StatusTabs`，激活 `border-primary` 下划线）与搜索/导出工具栏分离。
- 状态列用圆点徽标（v1.1）：`启用`=`success圆点`、`禁用`=`muted圆点`、`锁定`=`warning圆点`。
- 3 弹窗：`UserFormDialog`（新增/编辑，RHF+Zod 字段）、`AssignRoleDialog`（多选 `badge`/checkbox）、`ResetPasswordDialog`（确认告警 `alert`）。
- 行内操作：编辑 / 重置密码 / 禁用 / 分配角色 / 删除，放 `DropdownMenu`（更多）或行内 `ghost` 按钮。

**角色管理 `/system/role`**
- 列表 `DataTable`；编辑开 `Sheet`(右侧抽屉) 含 3 个 `Tabs`：①基本信息 ②菜单权限（`Tree` 复选，支持半选 `indeterminate`）③数据权限（`data_scope=5` 显组织多选）。

**菜单管理 `/system/menu`**
- 三栏 `grid grid-cols-[260px_1fr_360px]`：左菜单树、中选中节点表单（名称/类型/路径/组件/permission/排序/状态）、右 API 列表（method 徽标 + path + 说明 + 操作）。
- 类型标签：目录/菜单/按钮，用不同色 Badge 区分。

---

## 4. 交互与状态设计规范（补齐 Brief §6 未细化部分）

| 状态 | 视觉规格 | 令牌 |
|------|----------|------|
| **加载中（列表）** | `Skeleton` 行：`<div class="h-4 rounded bg-muted animate-pulse">`，8–10 行；表头保留 | `animate-pulse` + `bg-muted` |
| **加载中（搜索防抖）** | 输入旁微 `Loader2 spin`；不阻塞整页 | `text-muted-foreground` |
| **提交中** | `SubmitButton`：`disabled` + `Loader2 animate-spin`；遮罩可选 | — |
| **空态** | 居中插画（lucide `Inbox` 48px `text-muted-foreground`）+ 文案「暂无数据」+ 引导按钮（如「新增」） | `flex-col items-center gap-3 py-16` |
| **错误态** | `alert` 红边 + `CircleAlert` 图标 + 「加载失败」+ 「重试」按钮 | `--destructive` |
| **无权限静默态（403）** | **不弹错**：显示空态占位「无权限查看该页面」+ 返回仪表盘；行内无权限按钮直接 `disabled`+`tooltip` | `muted` |
| **Toast（sonner）** | 成功=`check` 绿；失败=`x` 红；警告=`!` 琥珀；位置=右下；2.5s 自动消失；可堆叠 | sonner 默认样式 + 令牌色 |

> **纪律（配合前端已落实）**：搜索/筛选不实时打接口（防抖 300ms）；写操作按钮进行中不可再点；GET 走 Query 缓存。

---

## 5. 响应式行为

| 断点 | 行为 |
|------|------|
| ≥1024px (`lg`) | 侧栏常驻 `w-64`，可折叠 `w-16`；主区三栏/四栏网格展开 |
| 640–1023px (`sm`–`md`) | 侧栏变 `Sheet` 抽屉（汉堡触发）；统计卡 2 列；三栏布局退为上下堆叠 |
| <640px | 单列；表格横向滚动（`overflow-x-auto`）；操作收进 `DropdownMenu`；不隐藏关键功能 |

> 全局：`container` 居中 + 内边距随断点递增；触摸目标 ≥`44px`（`min-h-11` 主操作）。

---

## 6. 可访问性（WCAG AA，默认达标）

- **对比度**：正文 `foreground` vs `background` ≥ 7:1；`muted-foreground` vs 背景 ≥ 4.5:1；主色白字按钮 ≥ 4.5:1（已核）。
- **键盘**：全功能可 Tab 操作；`focus-visible` 显式 `ring-2 ring-ring`（2px）；对话框打开自动聚焦首输入、Esc 关闭、`focus` 陷阱。
- **屏幕阅读器**：语义 `nav/main/header/table`；图标按钮带 `aria-label`；Badge 状态附 `sr-only` 文本（如「状态：启用」）。
- **动效偏好**：所有过渡包 `motion-safe:`；用户 `prefers-reduced-motion` 时禁用非必要动画。
- **文本缩放**：布局用 `rem`/相对单位，支持浏览器 200% 缩放不破版。
- **触摸目标**：交互元素 `min-h-11`（44px）。

---

## 7. 交付与落地说明

- **本方案交付物**：
  1. 本文档（设计系统规格）
  2. `prototype.html`（高保真可交互原型，含 Light/Dark 切换，覆盖 P0+P1 页面）
- **原型 = 走查稿，非生产代码**：用 Tailwind Play CDN 渲染，1:1 映射真实令牌与 `AppLayout` 壳；前端按 `admin-web-design.md` 用 shadcn CLI 落地时，类名可直接平移。
- **需产品/品牌确认**（§1）：主色是否沿用默认蓝、语义色是否采用本方案、登录页是否统一令牌。确认后把 §2 令牌并入 `src/styles/globals.css`，原型即成为像素基准。

---

*UI Designer · 2026-07-18 · 方案遵循 shadcn 令牌体系，未引入新色彩系统，未破坏 `--radius`。*
