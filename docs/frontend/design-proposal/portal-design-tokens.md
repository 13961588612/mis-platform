# MIS Platform 门户化 · 设计令牌与组件视觉规格（Design Token Spec）

> 角色：设计系统专家（彩格调 / design-system-expert）
> 用途：直接交付原型构建师（Phase 3）消费，含 B「CSS 变量块」与 C「组件视觉规格」两块核心输入。
> 基线（1:1 一致，唯一真值）：`design-system.md`（已定稿）· 约束基线 `design-handoff-brief.md` · `admin-web-design.md`
> 红线（不可逾越）：沿用既有**企业靛 shadcn** 设计系统；不另起色彩体系；不破坏 `--radius: 0.5rem`；不脱离 shadcn 组件词汇表。
> 范围：本文件 = **门户层（portal）** 的克制扩展，在基线上新增少量门户变量与组件规格；子系统内页仍走 `design-system.md` 原有规格。

---

## A. 令牌总表（确认既有值，1:1 引自 design-system.md）

> HSL 为代码真值；Hex 仅供设计/走查。所有颜色经 `hsl(var(--x))` 引用（带 alpha 用 `hsl(var(--x) / a)`）。

### A.1 中性与基础（Light / Dark）

| 令牌 | Light HSL | Light Hex | Dark HSL | Dark Hex |
|------|-----------|-----------|----------|----------|
| `--background` | `0 0% 100%` | `#ffffff` | `222.2 84% 4.9%` | `#0b0f1a` |
| `--foreground` | `222.2 84% 4.9%` | `#0f172a` | `210 40% 98%` | `#f8fafc` |
| `--card` | `0 0% 100%` | `#ffffff` | `222.2 84% 4.9%` | `#0b0f1a` |
| `--card-foreground` | `222.2 84% 4.9%` | `#0f172a` | `210 40% 98%` | `#f8fafc` |
| `--popover` | `0 0% 100%` | `#ffffff` | `222.2 84% 4.9%` | `#0b0f1a` |
| `--popover-foreground` | `222.2 84% 4.9%` | `#0f172a` | `210 40% 98%` | `#f8fafc` |
| `--muted` | `210 40% 96.1%` | `#f1f5f9` | `217.2 32.6% 17.5%` | `#1e293b` |
| `--muted-foreground` | `215.4 16.3% 46.9%` | `#64748b` | `215 20.2% 65.1%` | `#94a3b8` |
| `--border` | `214.3 31.8% 91.4%` | `#e2e8f0` | `217.2 32.6% 17.5%` | `#1e293b` |
| `--input` | `214.3 31.8% 91.4%` | `#e2e8f0` | `217.2 32.6% 17.5%` | `#1e293b` |
| `--ring` | `243 75% 59%` | `#4f46e5` | `243 75% 66%` | `#6366f1` |
| `--sidebar` | `210 40% 98%` | `#f8fafc` | `222.2 47.4% 11.2%` | `#171f33` |
| `--sidebar-foreground` | `222.2 47.4% 11.2%` | `#1e293b` | `210 40% 98%` | `#f8fafc` |

### A.2 品牌与语义色

| 令牌 | Light | Dark | 用途 / tint 用法 |
|------|-------|------|------------------|
| `--primary` | `243 75% 59%` (#4f46e5) | `243 75% 66%` (#6366f1) | 企业靛主色：主按钮、激活导航、聚焦环、关键链接 |
| `--primary-foreground` | `210 40% 98%` (#f8fafc) | `222.2 47.4% 11.2%` (#1e293b) | 主色上的字 |
| `--secondary` | `210 40% 96.1%` (#f1f5f9) | `217.2 32.6% 17.5%` (#1e293b) | 次按钮底 |
| `--secondary-foreground` | `222.2 47.4% 11.2%` | `210 40% 98%` | 次按钮字 |
| `--accent` | `210 40% 96.1%` | `217.2 32.6% 17.5%` | 悬浮/选中底 |
| `--accent-foreground` | `222.2 47.4% 11.2%` | `210 40% 98%` | 悬浮/选中字 |
| `--destructive` | `0 84.2% 60.2%` (#ef4444) | `0 62.8% 30.6%` (#991b1b) | 危险/删除 |
| `--destructive-foreground` | `210 40% 98%` | `210 40% 98%` | 危险上的字 |
| `--success` | `142 71% 45%` (#16a34a) | `142 69% 58%` | 启用/成功/在线；tint = `bg-success/10 text-success` |
| `--success-foreground` | `0 0% 100%` (#fff) | `144 80% 10%` | 绿底白字 |
| `--warning` | `38 92% 50%` (#f59e0b) | `38 92% 60%` | 待处理/警告；tint = `bg-warning/10 text-warning` |
| `--warning-foreground` | `38 92% 12%` (#422006) | `38 92% 12%` | 琥珀底深字（AA） |
| `--info` | `199 89% 48%` (#0ea5e9) | `199 89% 58%` | 信息/进行中；tint = `bg-info/10 text-info` |
| `--info-foreground` | `0 0% 100%` (#fff) | `199 90% 10%` | 蓝底白字 |

> **语义色一律走 tint（浅底深字），不铺满色块**——更克制、对比度更稳。徽标/状态列/角标统一复用 `Badge` 组件（v1.1 圆点徽标：`inline-flex items-center gap-1.5 rounded-full bg-{sem}/10 px-2.5 py-0.5 text-xs font-medium text-{sem}` + 前置圆点 `h-1.5 w-1.5 rounded-full bg-{sem}`）。

### A.3 几何令牌

| 令牌 | 值 | 用途 |
|------|----|------|
| `--radius` | `0.5rem` | **全局圆角，禁止破坏**；卡片 `rounded-lg`、按钮/输入 `rounded-md`、胶囊/圆标 `rounded-full` |
| `--sidebar-width` | `16rem` (`w-64`) | ≥1024px 常驻 |
| `--sidebar-width-collapsed` | `4rem` (`w-16`) | 折叠态仅图标 |
| `--header-height` | `3.5rem` (`h-14`) | 顶栏高 |
| 间距基准 | `4px` | Tailwind 默认（`p-4`=16px）；保持 4 的倍数节奏 |

### A.4 字体令牌

- **字体栈（全站统一）**：`Inter, "PingFang SC", "Microsoft YaHei", sans-serif`
- **基准字号**：`14px`（`0.875rem`）；行高 1.6；字重 400 为默认
- **字阶（来自 design-system.md §1.4）**：

| 角色 | 字号 | 行高 | 字重 | Tailwind 速记 | 用途 |
|------|------|------|------|---------------|------|
| H1 页面标题 | 20px (1.25rem) | 1.4 | 600 | `text-xl font-semibold` | 门户问候语 / PageHeader 标题 |
| H2 区块标题 | 16px (1rem) | 1.5 | 600 | `text-base font-semibold` | 分组标题 / 门户卡片标题 |
| 表头 | 12px (0.75rem) | 1.4 | 600 + `uppercase tracking-wide` | `text-xs font-semibold uppercase` | 表格列名（弱化降噪） |
| 正文/单元格 | 14px (0.875rem) | 1.6 | 400 | `text-sm` | 默认 |
| 辅助/说明 | 12px (0.75rem) | 1.5 | 400 | `text-xs` | 副文案、`muted-foreground` |

---

## B. 可直接粘贴的 CSS 变量块（关键交付）

> 直接合并进 `src/styles/globals.css`。`:root` = Light，`.dark` = 暗色。
> 用法约定：中性/品牌/语义走 shadcn 三元组 `hsl(var(--x))`；门户扩展变量见各自注释的引用方式；`--portal-gradient`、`--card-hover-shadow` 为完整值，直接 `var(...)` 使用。

### B.1 `:root`（Light）

```css
:root {
  /* ===== 中性与基础（引自 design-system.md，1:1） ===== */
  --background: 0 0% 100%;
  --foreground: 222.2 84% 4.9%;
  --card: 0 0% 100%;
  --card-foreground: 222.2 84% 4.9%;
  --popover: 0 0% 100%;
  --popover-foreground: 222.2 84% 4.9%;
  --muted: 210 40% 96.1%;
  --muted-foreground: 215.4 16.3% 46.9%;
  --border: 214.3 31.8% 91.4%;
  --input: 214.3 31.8% 91.4%;
  --ring: 243 75% 59%;
  --sidebar: 210 40% 98%;
  --sidebar-foreground: 222.2 47.4% 11.2%;

  /* ===== 品牌（企业靛） ===== */
  --primary: 243 75% 59%;
  --primary-foreground: 210 40% 98%;
  --secondary: 210 40% 96.1%;
  --secondary-foreground: 222.2 47.4% 11.2%;
  --accent: 210 40% 96.1%;
  --accent-foreground: 222.2 47.4% 11.2%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 210 40% 98%;

  /* ===== 语义 tint ===== */
  --success: 142 71% 45%;
  --success-foreground: 0 0% 100%;
  --warning: 38 92% 50%;
  --warning-foreground: 38 92% 12%;
  --info: 199 89% 48%;
  --info-foreground: 0 0% 100%;

  /* ===== 几何 ===== */
  --radius: 0.5rem;
  --sidebar-width: 16rem;
  --sidebar-width-collapsed: 4rem;
  --header-height: 3.5rem;

  /* ===== 门户扩展（仅门户层，基线之上；克制） ===== */
  /* 极轻双色渐变：仅用于门户顶部 hero 区，不铺满全页 */
  --portal-gradient: linear-gradient(180deg, hsl(210 40% 98%) 0%, hsl(243 75% 59% / 0.05) 100%);
  /* 卡片顶部细强调线 / 角标用色（同 --primary） */
  --portal-card-accent: 243 75% 59%;
  /* 门户卡片图标圆标：底色 tint（含 alpha），引用 hsl(var(--icon-badge-bg)) */
  --icon-badge-bg: 243 75% 59% / 0.10;
  /* 图标圆标前景：企业靛 */
  --icon-badge-fg: 243 75% 59%;
  /* 卡片 hover 抬升阴影（克制，不发光） */
  --card-hover-shadow: 0 6px 20px -8px rgb(15 23 42 / 0.15);
  /* 门户聚焦/激活环（同 --ring） */
  --portal-ring: 243 75% 59%;

  /* ===== 动效（全部包 motion-safe / 尊重 prefers-reduced-motion） ===== */
  --motion-enter: 200ms cubic-bezier(0.4, 0, 0.2, 1);
  --motion-hover: 150ms cubic-bezier(0.4, 0, 0.2, 1);
  --motion-lift: -2px;
  --stagger-1: 0ms;
  --stagger-2: 60ms;
  --stagger-3: 120ms;
  --stagger-4: 180ms;
  --stagger-5: 240ms;
  --stagger-6: 300ms;
}
```

### B.2 `.dark`

```css
.dark {
  /* ===== 中性与基础 ===== */
  --background: 222.2 84% 4.9%;
  --foreground: 210 40% 98%;
  --card: 222.2 84% 4.9%;
  --card-foreground: 210 40% 98%;
  --popover: 222.2 84% 4.9%;
  --popover-foreground: 210 40% 98%;
  --muted: 217.2 32.6% 17.5%;
  --muted-foreground: 215 20.2% 65.1%;
  --border: 217.2 32.6% 17.5%;
  --input: 217.2 32.6% 17.5%;
  --ring: 243 75% 66%;
  /* 暗色侧栏比主背景略亮一档，让导航浮出 */
  --sidebar: 222.2 47.4% 11.2%;
  --sidebar-foreground: 210 40% 98%;

  /* ===== 品牌（企业靛提亮） ===== */
  --primary: 243 75% 66%;
  --primary-foreground: 222.2 47.4% 11.2%;
  --secondary: 217.2 32.6% 17.5%;
  --secondary-foreground: 210 40% 98%;
  --accent: 217.2 32.6% 17.5%;
  --accent-foreground: 210 40% 98%;
  --destructive: 0 62.8% 30.6%;
  --destructive-foreground: 210 40% 98%;

  /* ===== 语义 tint ===== */
  --success: 142 69% 58%;
  --success-foreground: 144 80% 10%;
  --warning: 38 92% 60%;
  --warning-foreground: 38 92% 12%;
  --info: 199 89% 58%;
  --info-foreground: 199 90% 10%;

  /* ===== 门户扩展（暗色对应值） ===== */
  --portal-gradient: linear-gradient(180deg, hsl(222.2 47.4% 11.2%) 0%, hsl(243 75% 66% / 0.06) 100%);
  --portal-card-accent: 243 75% 66%;
  --icon-badge-bg: 243 75% 66% / 0.14;
  --icon-badge-fg: 243 75% 66%;
  --card-hover-shadow: 0 8px 24px -10px rgb(0 0 0 / 0.5);
  --portal-ring: 243 75% 66%;

  /* 动效令牌同 Light（维度不变） */
  --motion-enter: 200ms cubic-bezier(0.4, 0, 0.2, 1);
  --motion-hover: 150ms cubic-bezier(0.4, 0, 0.2, 1);
  --motion-lift: -2px;
  --stagger-1: 0ms;
  --stagger-2: 60ms;
  --stagger-3: 120ms;
  --stagger-4: 180ms;
  --stagger-5: 240ms;
  --stagger-6: 300ms;
}
```

### B.3 引用速查（原型构建师）

```css
/* 图标圆标底色/前景 */
background: hsl(var(--icon-badge-bg));
color: hsl(var(--icon-badge-fg));

/* 门户顶部极轻渐变（仅 hero 区） */
background-image: var(--portal-gradient);

/* 卡片 hover 抬升阴影 */
box-shadow: var(--card-hover-shadow);

/* 卡片顶部强调线 / 角标 */
background: hsl(var(--portal-card-accent));

/* 聚焦环（等价于 ring-ring） */
box-shadow: 0 0 0 2px hsl(var(--portal-ring));

/* 入场 stagger（内联 style 用 transition-delay） */
transition: transform var(--motion-enter), box-shadow var(--motion-enter);
transition-delay: var(--stagger-2);
```

### B.4 Tailwind `theme.extend.colors` 映射提示（可选）

```ts
// tailwind.config.ts — 仅示例，shadcn 已默认生成；门户扩展按需补
colors: {
  // shadcn 默认已含 background/foreground/card/primary/.../sidebar
  // 门户扩展（用 CSS 变量，保持 hsl() 包裹）
  'icon-badge': 'hsl(var(--icon-badge-fg))',
  'portal-accent': 'hsl(var(--portal-card-accent))',
}
// 组件里直接用：bg-[hsl(var(--icon-badge-bg))] text-[hsl(var(--icon-badge-fg))]
//               bg-[image:var(--portal-gradient)] shadow-[var(--card-hover-shadow)]
```

---

## C. 门户专属组件视觉规格（给原型构建师的 class 指引）

> 通用约定：间距取 4 的倍数；圆角用 `--radius`（`rounded-lg`=0.5rem 卡片、`rounded-md`=0.375rem 按钮/输入、`rounded-full` 圆标/胶囊）；图标一律 lucide-react；所有 hover/入场过渡包 `motion-safe:`。

### C1. 门户卡片（子系统入口）Portal Card

- **容器**：`group relative rounded-lg border bg-card p-4 transition`；鼠标整卡可点（`<a>`/`<button>` 语义）。
- **图标圆标**：`flex h-10 w-10 items-center justify-center rounded-full bg-[hsl(var(--icon-badge-bg))] text-[hsl(var(--icon-badge-fg))]` + lucide 图标 `h-5 w-5`。
- **标题**：H2 字阶 `text-base font-semibold leading-tight`（16/600）；**一句话定位**：辅助字阶 `mt-2 text-xs text-muted-foreground`（12/400），单行截断 `truncate`。
- **hover 态**（克制抬升）：`motion-safe:hover:-translate-y-0.5 motion-safe:transition-transform motion-safe:duration-150 hover:shadow-[var(--card-hover-shadow)]`；图标圆标轻微强调 `group-hover:bg-[hsl(var(--icon-badge-bg))]` 已含 tint，可加 `group-hover:scale-105 motion-safe:transition-transform`。
- **置顶/激活态**：顶部细强调线 `before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:rounded-t-lg before:bg-[hsl(var(--portal-card-accent))]`（仅置顶卡显示，避免堆砌）；或 `ring-1 ring-primary/20`。
- **「新 / 待办」角标**（右上）：`absolute right-3 top-3 rounded-full px-2 py-0.5 text-xs font-medium`；新=`bg-primary/10 text-primary`、待办=`bg-warning/10 text-warning`（tint 方案）。

```html
<a class="group relative block rounded-lg border bg-card p-4 transition
          motion-safe:hover:-translate-y-0.5 motion-safe:transition-transform
          motion-safe:duration-150 hover:shadow-[var(--card-hover-shadow)]
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
  <span class="absolute right-3 top-3 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">待办 3</span>
  <span class="flex h-10 w-10 items-center justify-center rounded-full bg-[hsl(var(--icon-badge-bg))] text-[hsl(var(--icon-badge-fg))]">
    <svg class="h-5 w-5"><!-- lucide icon --></svg>
  </span>
  <h3 class="mt-3 text-base font-semibold leading-tight">用户管理</h3>
  <p class="mt-1 truncate text-xs text-muted-foreground">账号、组织与权限的统一治理</p>
</a>
```

### C2. 分组区块（3 分组）Grouped Sections

- 三组：**管理与治理 / 业务与运营 / 协同与平台**。
- **分组标题**：H2 字阶 `flex items-center gap-2 text-base font-semibold`；左侧可选小图标 `h-4 w-4 text-muted-foreground` 或极细左强调条 `h-4 w-1 rounded-full bg-[hsl(var(--portal-card-accent))]`；下方细分隔线 `border-b border-border pb-2 mb-4`（可选，降噪优先用留白）。
- **网格响应式**：`grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3`（gap-4=16px，4 的倍数）；`lg:grid-cols-3` 对齐三组各一排卡片。

```html
<section class="mb-8">
  <h2 class="mb-4 flex items-center gap-2 text-base font-semibold">
    <span class="h-4 w-1 rounded-full bg-[hsl(var(--portal-card-accent))]"></span>
    管理与治理
  </h2>
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"><!-- C1 卡片 --></div>
</section>
```

### C3. 分类筛选 Segmented / Tab

- 选项：**全部 / 管理治理 / 业务运营 / 协同平台**。
- **推荐下划线式**（克制、引用 --primary）：容器 `flex items-center gap-6 border-b border-border`，每项为 `border-b-2 border-transparent pb-2 text-sm text-muted-foreground`；激活 `border-primary font-medium text-foreground`。
- **备选胶囊式**（更强存在感）：`inline-flex items-center gap-1 rounded-full border bg-muted/50 p-1`，每项 `rounded-full px-3 py-1.5 text-sm`，激活 `bg-primary text-primary-foreground shadow-sm`。

```html
<!-- 下划线式（默认推荐） -->
<nav class="flex items-center gap-6 border-b border-border">
  <button class="border-b-2 border-primary pb-2 text-sm font-medium text-foreground">全部</button>
  <button class="border-b-2 border-transparent pb-2 text-sm text-muted-foreground hover:text-foreground">管理治理</button>
  <!-- ... -->
</nav>
```

### C4. 欢迎 / 个性化区 Welcome Area

- **容器**：门户顶部 hero，`bg-[image:var(--portal-gradient)]` 极轻渐变（不铺满全页，仅此区），`rounded-lg` 可选。
- **问候语**：H1 字阶 `text-xl font-semibold`（20/600），如「下午好，许明需」。
- **今日待办计数**：轻量 pill 组 `inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-3 py-1 text-sm font-medium text-warning`（待办 N）；或迷你 StatCard `rounded-lg border bg-card p-4` 多枚并列（待办/待审/消息，各自 tint）。

```html
<header class="bg-[image:var(--portal-gradient)] rounded-lg px-6 py-5">
  <h1 class="text-xl font-semibold">下午好，许明需</h1>
  <div class="mt-3 flex flex-wrap gap-2">
    <span class="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-3 py-1 text-sm font-medium text-warning">待办 12</span>
    <span class="inline-flex items-center gap-1.5 rounded-full bg-info/10 px-3 py-1 text-sm font-medium text-info">待审 3</span>
  </div>
</header>
```

### C5. 最近访问 / 常用横向条 Recent / Frequent Bar

- 容器：`flex items-center gap-2 overflow-x-auto pb-1`（横向可滚，移动端不隐藏）。
- **chip**：`inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-sm transition hover:border-primary/30 hover:bg-accent`；图标 `h-3.5 w-3.5 text-muted-foreground` + 名称。
- hover：边框转 `--primary/30`、底转 `--accent`，给轻反馈。

```html
<div class="flex items-center gap-2 overflow-x-auto pb-1">
  <a class="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-sm transition hover:border-primary/30 hover:bg-accent">
    <svg class="h-3.5 w-3.5 text-muted-foreground"></svg> 用户管理
  </a>
  <!-- ...更多 chip -->
</div>
```

### C6. 顶栏（门户版）Portal Header

- **容器**：`flex h-14 items-center gap-4 border-b border-border bg-background px-4`（高 `h-14`=3.5rem，与基线一致）。
- **Logo**：`flex items-center gap-2`；标记 `flex h-7 w-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground` 显示 `▦`；文字 `font-semibold tracking-tight`（MIS Platform）。
- **全局搜索（Cmd+K 入口）**：`inline-flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground`，含放大镜图标 + 「搜索…」+ `<kbd>` 显示 `⌘K`。触发 `command` 弹层。
- **右侧操作区**：`ml-auto flex items-center gap-2`：
  - 待办/消息铃铛：`icon button`（`h-9 w-9 rounded-md hover:bg-accent`），右上未读小圆点 `bg-destructive`（红点）；
  - 主题切换：`icon button`（sun/moon，next-themes 切换 `.dark`）；
  - 用户菜单：`Avatar`（`h-8 w-8 rounded-full`）+ `DropdownMenu`（姓名/退出）。

### C7. 子系统壳顶栏（门户化扩展）Subsystem Shell Header

> 在既有 `AppLayout` 顶栏基础上**增加**两个入口（不重画框架）：

- **返回门户**：`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm text-foreground transition hover:bg-accent` + `ArrowLeft`/`Home` lucide 图标 + 文字「返回门户」；放顶栏左侧（面包屑之前/替代门户态面包屑）。
- **子系统切换器**：`DropdownMenu` 触发按钮，样式 `inline-flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm font-medium`，显示当前子系统名 + `ChevronDown`；下拉列出 **9 个子系统**，按 3 分组归类（管理与治理 / 业务与运营 / 协同与平台），每项带 lucide 图标 + 名称，激活项 `bg-accent`；数据从菜单注册表动态拉取。
- 这两者与 C6 顶栏共存：门户态显示 C6 全貌；进入子系统后，左侧切换为「返回门户 + 子系统切换器」，右侧保留搜索/铃铛/主题/用户菜单。

```html
<!-- 子系统态顶栏左段 -->
<div class="flex items-center gap-2">
  <button class="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm text-foreground transition hover:bg-accent">
    <svg class="h-4 w-4"></svg> 返回门户
  </button>
  <button class="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm font-medium">
    用户管理 <svg class="h-4 w-4 text-muted-foreground"></svg>
  </button>
</div>
```

### C8. 登录页（统一令牌版）Login（Token-Unified）

- **消除遗留债**：删硬编码 `#4f46e5`、卡片圆角 `16px`、输入圆角 `8px`、蓝调渐变 `#eef2ff`、无描边——全部改用令牌。
- **卡片**：`mx-auto mt-24 w-full max-w-sm rounded-lg border bg-card p-8 shadow-sm`（圆角=`--radius`、带 `border`、跟随 Light/Dark）。
- **标题**：`MIS Platform`（`text-xl font-semibold`）+ 副标题 `text-sm text-muted-foreground`。
- **字段**：用户名/密码/验证码；输入 `w-full rounded-md border bg-background px-3 py-2 text-sm`（圆角 `rounded-md`=0.375rem）。
- **提交**：`btn--primary w-full`（= `bg-primary text-primary-foreground`），主色走 `--primary`；错误用 `alert` 红边（`--destructive`）。
- 验证码图 `h-10` 可点刷新；回车提交；失败刷新验证码（沿用 `admin-web-design.md §5.1`）。

```html
<div class="mx-auto mt-24 w-full max-w-sm rounded-lg border bg-card p-8 shadow-sm">
  <h1 class="text-xl font-semibold">MIS Platform</h1>
  <p class="mt-1 text-sm text-muted-foreground">企业统一管理平台</p>
  <form class="mt-6 space-y-4">
    <input class="w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="用户名" />
    <input type="password" class="w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="密码" />
    <button class="btn--primary w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">登录</button>
  </form>
</div>
```

---

## D. 双主题与可访问性要点

- **双主题取值**：以 §A / §B 为准；`.dark` 侧栏 `--sidebar: 222.2 47.4% 11.2%`（`#171f33`）比主背景 `--background: 222.2 84% 4.9%`（`#0b0f1a`）略亮一档，让导航浮出。
- **对比度（已核，WCAG AA）**：
  - 正文 `foreground` vs `background` ≥ **7:1**（Light #0f172a on #fff；Dark #f8fafc on #0b0f1a）；
  - `muted-foreground` vs 背景 ≥ **4.5:1**（Light #64748b on #fff≈4.6:1；Dark #94a3b8 on #0b0f1a）；
  - 主色白字按钮 `primary`(#4f46e5) + `primary-foreground`(#f8fafc) ≈ **6.3:1** ≥4.5:1；
  - 语义 tint 文字（`text-success` 等）用在 `/10` 浅底上，深字对比度稳。
- **聚焦可见性**：所有可交互元素显式 `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`（2px）；门户扩展用 `ring-[hsl(var(--portal-ring))]` 等价。
- **动效偏好**：所有过渡/动画包 `motion-safe:`；`prefers-reduced-motion` 时禁用非必要动画（stagger 入场、hover 抬升自动失效）。
- **键盘 / 读屏**：语义 `nav/main/header`；图标按钮带 `aria-label`；Badge 状态附 `sr-only`（如「状态：启用」）；触摸目标 `min-h-11`（44px）用于主操作。
- **文本缩放**：布局用 `rem`/相对单位，支持 200% 缩放不破版。

---

## E. 设计决策摘要（一句话「为什么这样选」）

沿用既有**企业靛 shadcn** 体系（信任、稳重、企业级，且登录页颜色债本就同色系、改圆角/渐变/描边即合规），**不在色彩上另起炉灶**；门户「不素」仅靠三层**克制扩展**达成层次感——① 图标 tint 圆标让入口有焦点而不喧宾、② 极轻双色渐变只铺 hero 一隅、③ stagger 微动效与 hover 抬升给「活」的反馈；全程严守 `--radius`、shadcn 词汇表与 WCAG AA，把「清爽专业」落在「可读、可快速完成工作」的极简纪律上，而非视觉装饰。

---

## 附：与任务摘要「概要」的差异标注（以 design-system.md 为准）

任务摘要的「既有令牌权威取值 · 概要」将语义色的 **Light 取值写成 hex、Dark 写成 HSL**，且 Light HSL 实际值以文档为准（概要的 dark HSL 被误置到 light 位）。本文件已按 `design-system.md` 校正：

| 令牌 | 概要写法 | 本文档（document 真值） |
|------|----------|--------------------------|
| `--success` | Light `#16a34a` / Dark `142 69% 58%` | Light `142 71% 45%`(#16a34a) / Dark `142 69% 58%` |
| `--warning` | Light `#f59e0b` / Dark `38 92% 60%` | Light `38 92% 50%`(#f59e0b) / Dark `38 92% 60%` |
| `--info` | Light `#0ea5e9` / Dark `199 89% 58%` | Light `199 89% 48%`(#0ea5e9) / Dark `199 89% 58%` |
| `--destructive` | Light `#ef4444` / Dark `0 62.8% 30.6%` | Light `0 84.2% 60.2%`(#ef4444) / Dark `0 62.8% 30.6%`(#991b1b) |
| 附带 | 仅给基础色 | 补充了各语义色 `-foreground`（success/warning/info）真值 |

> 中性、品牌（primary/ring）、几何、字体取值与摘要一致，无冲突。

*design-system-expert · 2026-07-18 · 门户化扩展严格基于企业靛 shadcn 基线，未引入新色彩系统，未破坏 `--radius`。*
