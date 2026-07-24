# MIS Platform 门户化 · 设计令牌与组件视觉规格（Design Token Spec）

> 角色：设计系统专家（彩格调 / design-system-expert）
> 用途：直接交付原型构建师（Phase 3）消费，含 B「CSS 变量块」与 C「组件视觉规格」两块核心输入。
> 基线：与 [design-system.md](./design-system.md) 同色系（企业靛）；**圆角与画布以本文件为准**（`--radius: 0.375rem`、冷灰画布）。`admin-web-design.md` / admin 实现须跟本令牌，不另起视觉体系。
> 红线（不可逾越）：沿用既有**企业靛 shadcn** 设计系统；不另起色彩体系；圆角统一为 `--radius: 0.375rem`（商务硬朗、全局共用）；不脱离 shadcn 组件词汇表。
> 范围：本文件 = **门户层（portal）** 的克制扩展，在基线上新增少量门户变量与组件规格；子系统内页共用同一套中性/主色令牌。

---

## A. 令牌总表（确认既有值，1:1 引自 design-system.md）

> HSL 为代码真值；Hex 仅供设计/走查。所有颜色经 `hsl(var(--x))` 引用（带 alpha 用 `hsl(var(--x) / a)`）。

### A.1 中性与基础（Light / Dark）

> 2026-07-20 调整：从「纯白画布 + 近白侧栏」改为「商务现代」——画布柔和冷灰让白卡浮起、侧栏经对比评估后定为**中灰冷**（略深于画布，轻层次框架、统一不抢焦点，避免深墨蓝过重/全冷灰无框架）；主色仍为**企业靛**，未另起色系、圆角由 `0.5rem` 收紧为 `0.375rem`（更硬朗商务）。

| 令牌 | Light HSL | Light Hex | Dark HSL | Dark Hex |
|------|-----------|-----------|----------|----------|
| `--background` | `214 32% 96.5%` | `#eef1f5` | `222 47% 7%` | `#0c0f1a` |
| `--foreground` | `222.2 47% 11%` | `#141b2b` | `210 40% 98%` | `#f8fafc` |
| `--card` | `0 0% 100%` | `#ffffff` | `222 40% 12%` | `#161b2b` |
| `--card-foreground` | `222.2 47% 11%` | `#141b2b` | `210 40% 98%` | `#f8fafc` |
| `--popover` | `0 0% 100%` | `#ffffff` | `222 40% 12%` | `#161b2b` |
| `--popover-foreground` | `222.2 47% 11%` | `#141b2b` | `210 40% 98%` | `#f8fafc` |
| `--muted` | `214 32% 93%` | `#e9edf2` | `217.2 33% 18%` | `#1f2937` |
| `--muted-foreground` | `215 19% 42%` | `#586173` | `215 20% 68%` | `#9aa6b8` |
| `--border` | `214 30% 88%` | `#dde3ea` | `217.2 33% 20%` | `#232c3d` |
| `--input` | `214 30% 88%` | `#dde3ea` | `217.2 33% 20%` | `#232c3d` |
| `--ring` | `243 75% 59%` | `#4f46e5` | `243 75% 66%` | `#6366f1` |
| `--sidebar` | `214 32% 90%` | `#dde4ee` | `217 33% 14%` | `#182130` |
| `--sidebar-foreground` | `222 47% 11%` | `#0f1729` | `210 40% 96%` | `#eef2f8` |
| `--sidebar-border` | `214 30% 82%` | `#c3cfdf` | `217 33% 22%` | `#26344b` |
| `--sidebar-accent` | `214 32% 84%` | `#c9d5e3` | `217 33% 20%` | `#222f44` |
| `--sidebar-muted` | `215 16% 45%` | `#607085` | `215 18% 62%` | `#8d9bb0` |

### A.1.1 门户扩展令牌（阴影 / 渐变）

| 令牌 | Light 值 | Dark 值 | 用途 |
|------|----------|---------|------|
| `--card-shadow` | `0 1px 2px rgb(15 23 42/.04), 0 2px 6px -2px rgb(15 23 42/.08)` | `0 1px 2px rgb(0 0 0/.4), 0 2px 8px -2px rgb(0 0 0/.5)` | 卡片静息阴影（冷灰画布上稳落地） |
| `--card-hover-shadow` | `0 10px 30px -12px rgb(15 23 42/.22)` | `0 12px 32px -12px rgb(0 0 0/.6)` | 卡片 hover 抬升阴影 |
| `--portal-gradient` | `linear-gradient(135deg, hsl(243 75% 59%/.12) 0%, hsl(243 75% 59%/.03) 52%, hsl(199 89% 48%/.07) 100%)` | `linear-gradient(135deg, hsl(243 75% 66%/.18) 0%, hsl(243 75% 66%/.04) 52%, hsl(199 89% 58%/.10) 100%)` | Hero 区品牌洗染渐变 |
| `--portal-card-accent` | `243 75% 59%` | `243 75% 66%` | 区块左强调条 / 角标色（= --primary） |
| `--icon-badge-bg` | `243 75% 59% / 0.10` | `243 75% 66% / 0.16` | 图标圆标底 tint |
| `--icon-badge-fg` | `243 75% 59%` | `243 75% 66%` | 图标圆标前景（企业靛） |
| `--portal-ring` | `243 75% 59%` | `243 75% 66%` | 门户聚焦/激活环 |

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
| `--radius` | `0.375rem` | **全局圆角（卡片/按钮/输入/tab 统一共用），商务硬朗**；胶囊/圆标 `rounded-full` |
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
  /* ===== 中性与基础（商务现代：画布冷灰、白卡浮起） ===== */
  --background: 214 32% 96.5%;
  --foreground: 222.2 47% 11%;
  --card: 0 0% 100%;
  --card-foreground: 222.2 47% 11%;
  --popover: 0 0% 100%;
  --popover-foreground: 222.2 47% 11%;
  --muted: 214 32% 93%;
  --muted-foreground: 215 19% 42%;
  --border: 214 30% 88%;
  --input: 214 30% 88%;
  --ring: 243 75% 59%;
  /* 中灰冷侧栏：略深于冷灰画布，形成轻层次框架（商务、统一、不抢焦点） */
  --sidebar: 214 32% 90%;
  --sidebar-foreground: 222 47% 11%;
  /* 侧栏内专用派生令牌 */
  --sidebar-border: 214 30% 82%;
  --sidebar-accent: 214 32% 84%;
  --sidebar-muted: 215 16% 45%;

  /* ===== 品牌（企业靛） ===== */
  --primary: 243 75% 59%;
  --primary-foreground: 0 0% 100%;
  --secondary: 214 32% 93%;
  --secondary-foreground: 222.2 47% 11%;
  --accent: 214 32% 93%;
  --accent-foreground: 222.2 47% 11%;
  --destructive: 0 72% 51%;
  --destructive-foreground: 0 0% 100%;

  /* ===== 语义 tint ===== */
  --success: 142 71% 40%;
  --success-foreground: 0 0% 100%;
  --warning: 35 92% 48%;
  --warning-foreground: 35 92% 12%;
  --info: 199 89% 46%;
  --info-foreground: 0 0% 100%;

  /* ===== 几何 ===== */
  --radius: 0.375rem;
  --sidebar-width: 16rem;
  --sidebar-width-collapsed: 4rem;
  --header-height: 3.5rem;

  /* ===== 门户扩展（仅门户层；商务现代层次） ===== */
  /* 卡片静息阴影 + hover 抬升阴影：在冷灰画布上稳稳落地 */
  --card-shadow: 0 1px 2px rgb(15 23 42 / .04), 0 2px 6px -2px rgb(15 23 42 / .08);
  --card-hover-shadow: 0 10px 30px -12px rgb(15 23 42 / .22);
  /* 品牌渐变（靛蓝洗染 + 柔光晕），仅用于门户顶部 hero 区 */
  --portal-gradient: linear-gradient(135deg, hsl(243 75% 59% / .12) 0%, hsl(243 75% 59% / .03) 52%, hsl(199 89% 48% / .07) 100%);
  /* 卡片顶部细强调线 / 角标用色（同 --primary） */
  --portal-card-accent: 243 75% 59%;
  /* 门户卡片图标圆标：底色 tint（含 alpha），引用 hsl(var(--icon-badge-bg)) */
  --icon-badge-bg: 243 75% 59% / 0.10;
  /* 图标圆标前景：企业靛 */
  --icon-badge-fg: 243 75% 59%;
  /* 门户聚焦/激活环（同 --ring） */
  --portal-ring: 243 75% 59%;
  /* 登录页背景图（默认内置 SVG 抽象商务底图；可整体替换为真实图片 url，建议 ≥1600px 宽、深色调、文字区留白） */
  --login-bg-image: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='800' viewBox='0 0 1200 800'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='%230b1020'/><stop offset='1' stop-color='%231e2a4d'/></linearGradient><radialGradient id='r1' cx='18%' cy='22%' r='55%'><stop offset='0' stop-color='%234f46e5' stop-opacity='0.6'/><stop offset='1' stop-color='%234f46e5' stop-opacity='0'/></radialGradient><radialGradient id='r2' cx='88%' cy='82%' r='60%'><stop offset='0' stop-color='%233b82f6' stop-opacity='0.5'/><stop offset='1' stop-color='%233b82f6' stop-opacity='0'/></radialGradient><pattern id='dots' width='30' height='30' patternUnits='userSpaceOnUse'><circle cx='2' cy='2' r='1.5' fill='%23ffffff' fill-opacity='0.10'/></pattern></defs><rect width='1200' height='800' fill='url(%23g)'/><rect width='1200' height='800' fill='url(%23r1)'/><rect width='1200' height='800' fill='url(%23r2)'/><rect width='1200' height='800' fill='url(%23dots)'/><g stroke='%23ffffff' stroke-opacity='0.12' stroke-width='1.5' fill='none'><path d='M120 640 L360 470 L560 560 L820 360 L1060 470'/><path d='M200 720 L420 540 L640 620 L900 420'/></g><g fill='%23ffffff' fill-opacity='0.5'><circle cx='360' cy='470' r='5'/><circle cx='560' cy='560' r='5'/><circle cx='820' cy='360' r='5'/><circle cx='1060' cy='470' r='5'/><circle cx='420' cy='540' r='5'/><circle cx='900' cy='420' r='5'/></g></svg>");

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
  /* ===== 中性与基础（深底画布略提、白卡再亮，保持层次） ===== */
  --background: 222 47% 7%;
  --foreground: 210 40% 96%;
  --card: 222 40% 12%;
  --card-foreground: 210 40% 96%;
  --popover: 222 40% 12%;
  --popover-foreground: 210 40% 96%;
  --muted: 217.2 33% 18%;
  --muted-foreground: 215 20% 68%;
  --border: 217.2 33% 20%;
  --input: 217.2 33% 20%;
  --ring: 243 75% 66%;
  /* 暗色侧栏比主背景略亮一档，形成轻层次框架 */
  --sidebar: 217 33% 14%;
  --sidebar-foreground: 210 40% 96%;
  --sidebar-border: 217 33% 22%;
  --sidebar-accent: 217 33% 20%;
  --sidebar-muted: 215 18% 62%;

  /* ===== 品牌（企业靛提亮） ===== */
  --primary: 243 75% 66%;
  --primary-foreground: 222.2 47.4% 11%;
  --secondary: 217.2 32.6% 17.5%;
  --secondary-foreground: 210 40% 98%;
  --accent: 217.2 32.6% 17.5%;
  --accent-foreground: 210 40% 98%;
  --destructive: 0 62.8% 45%;
  --destructive-foreground: 210 40% 98%;

  /* ===== 语义 tint ===== */
  --success: 142 69% 55%;
  --success-foreground: 144 80% 10%;
  --warning: 38 92% 58%;
  --warning-foreground: 38 92% 12%;
  --info: 199 89% 56%;
  --info-foreground: 199 90% 10%;

  /* ===== 门户扩展（暗色对应值） ===== */
  --card-shadow: 0 1px 2px rgb(0 0 0 / .4), 0 2px 8px -2px rgb(0 0 0 / .5);
  --card-hover-shadow: 0 12px 32px -12px rgb(0 0 0 / .6);
  --portal-gradient: linear-gradient(135deg, hsl(243 75% 66% / .18) 0%, hsl(243 75% 66% / .04) 52%, hsl(199 89% 58% / .10) 100%);
  --portal-card-accent: 243 75% 66%;
  --icon-badge-bg: 243 75% 66% / 0.16;
  --icon-badge-fg: 243 75% 66%;
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

> 通用约定：间距取 4 的倍数；圆角统一用 `--radius`（`rounded-lg`/`rounded-md` 均映射 `--radius`=0.375rem；卡片/按钮/输入/tab 统一圆角；圆标/胶囊 `rounded-full`）；图标一律 lucide-react；所有 hover/入场过渡包 `motion-safe:`。

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

### C9. 多级侧栏导航 Multi-level Sidebar

- **数据**：导航项支持 `children` 数组；有 `children` 的为父项（`.nav-parent`），否则为叶子（`.nav-item`）。
- **父项**：整行可点，右侧 `chevronRight` 图标；展开态 `.expanded` 旋转 90°、底色 `sidebar-accent/.6`；子列表 `.nav-children` 默认展开（`open`），点击父项 `toggle` 展开/收起。
- **子项缩进**：`.nav-children` 左留 `0.95rem` 边距 + 1px `sidebar-border` 左边线，子 `.nav-item` 再缩进，形成清晰层级；collapsed 态隐藏子列表与 chevron（仅顶层图标）。
- **激活态（整行变色，更商务醒目）**：叶子选中 `.nav-item.active` = **整行实色块** `background:hsl(var(--primary))` + `color:hsl(var(--primary-foreground))`(白字) + 字重 600 + 轻投影；不再用「淡底+左细条」，解决浅灰侧栏上淡底看不清的问题。hover 不覆盖激活态（`:not(.active):hover`）。
- 原型入口：进入「系统管理」子系统即可见「权限管理 ▸ 用户/组织/角色/菜单」多级样板。

### C10. 新建 / 编辑表单抽屉（Sheet）Add / Edit Drawer

- **触发**：内容区顶部「新建」按钮（`data-act="add"`）点击 → `openAdd()` 打开右侧抽屉 `#add-panel`；遮罩 `#add-overlay`、关闭按钮、取消、Esc 均可关闭（`closeAdd()`）。
- **结构**：`sheet-overlay`(遮罩) + `sheet-panel`(右抽屉) = `sheet-header`(标题动态带子系统名 + 关闭) / `sheet-body`(表单字段) / `sheet-footer`(取消 + 确定)。
- **字段（样板）**：名称(必填，`input.input`、空值红边聚焦提示) / 类型(`select.input`) / 状态(分段控件 `.seg`：启用/禁用/锁定，`.seg-item.active`) / 所属组织(`input`) / 备注(`textarea.input`)。
- **令牌**：字段底色 `background`、聚焦环用 `--primary`/`.15` 阴影；圆角统一 `--radius`(0.375rem)；与 C 节其他组件共用同一令牌体系。
- **校验**：确定时名称非空，否则聚焦并标红边；通过则关闭抽屉（演示环境不真写库）。

---

## D. 双主题与可访问性要点

- **双主题取值**：以 §A / §B 为准；Light 侧栏 `--sidebar: 214 32% 90%`（`#dde4ee`）略深于冷灰画布 `--background: 214 32% 96.5%`（`#eef1f5`），靠右侧描边与更浅画布分隔出轻层次；Dark 侧栏 `--sidebar: 217 33% 14%`（`#182130`）比主背景 `--background: 222 47% 7%`（`#0e1320`）略亮一档，导航浮出。
- **对比度（已核，WCAG AA）**：
  - 正文 `foreground` vs `background` ≥ **7:1**（Light #141b2b on #eef1f5≈12:1；Dark #f8fafc on #0c0f1a≈16:1）；
  - `muted-foreground` vs 背景 ≥ **4.5:1**（Light #586173 on #eef1f5≈5.4:1；Dark #9aa6b8 on #0c0f1a≈8:1）；
  - 侧栏前景 `sidebar-foreground`（Light #0f1729 / Dark #eef2f8）vs 同主题 `sidebar`（Light #dde4ee / Dark #182130）≥ **12:1**；激活态为**整行实色块** `primary`(#4f46e5) 底 + `primary-foreground`(白字 #f8fafc) ≈ **6.3:1** AA 通过（Light/Dark 同此算法）；
  - 主色白字按钮 `primary`(#4f46e5) + `primary-foreground`(#f8fafc) ≈ **6.3:1** ≥4.5:1；
  - 语义 tint 文字（`text-success` 等）用在 `/10` 浅底上，深字对比度稳。
- **聚焦可见性**：所有可交互元素显式 `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`（2px）；门户扩展用 `ring-[hsl(var(--portal-ring))]` 等价。
- **动效偏好**：所有过渡/动画包 `motion-safe:`；`prefers-reduced-motion` 时禁用非必要动画（stagger 入场、hover 抬升自动失效）。
- **键盘 / 读屏**：语义 `nav/main/header`；图标按钮带 `aria-label`；Badge 状态附 `sr-only`（如「状态：启用」）；触摸目标 `min-h-11`（44px）用于主操作。
- **文本缩放**：布局用 `rem`/相对单位，支持 200% 缩放不破版。

---

### C11. 表单 / 筛选：12 列固定宽度栅格 Form & Filter Grid

> 问题：原抽屉表单与筛选卡的字段纵向堆叠、各占整行，长表单特别占垂直空间且不便对齐。改为**12 列固定宽度栅格**，字段按语义取固定跨度，可在一行内并排对齐。

- **容器**：`.form-grid { display:grid; grid-template-columns: repeat(12, minmax(0,1fr)); gap:.875rem 1rem }`（字段间距纵向 .875rem / 横向 1rem，与 4px 基准对齐）。
- **跨度工具类**（挂在 `.field` / `.filter-field` 上）：
  - `.col-12` 整行（备注、长文本）
  - `.col-8` 约 2/3（宽字段）
  - `.col-6` 半行（名称 + 类型并排）
  - `.col-4` 1/3（筛选条件三连）
  - `.col-3` 1/4（紧凑字段）
- **响应式收口**：`max-width:900px` 时 `.col-8→12 / .col-4→6 / .col-3→6`；`max-width:560px` 时**全部 `span 12`**（单列），保证窄屏不挤。
- **字段内部**：`.field` 仍是 `flex column`（label + 控件）；`.input`/`.select` 保持 `width:100%` 填满所在栅格单元——所以"固定宽度"由栅格单元决定，输入框自适应填满，无需逐个设宽。
- **分段控件**：`.seg` 由 `inline-flex` 改为 `flex; width:100%`，在 `.col-6` 内也铺满整格。
- **样板落点**：① 筛选卡三条件 = `col-4 + col-4 + col-4`（一行三连对齐）；② 新建抽屉 = 名称/类型 `col-6`（并排）、所属组织/状态 `col-6`（并排）、备注 `col-12`（整行）。

---

## E. 设计决策摘要（一句话「为什么这样选」）

沿用既有**企业靛 shadcn** 体系（信任、稳重、企业级，且登录页颜色债本就同色系、改圆角/渐变/描边即合规），**不在色彩上另起炉灶**；门户「不素」仅靠三层**克制扩展**达成层次感——① 图标 tint 圆标让入口有焦点而不喧宾、② 极轻双色渐变只铺 hero 一隅、③ stagger 微动效与 hover 抬升给「活」的反馈；全程统一 `--radius: 0.375rem`、shadcn 词汇表与 WCAG AA，把「清爽专业」落在「可读、可快速完成工作」的极简纪律上，而非视觉装饰。

> **2026-07-20 商务现代更新**：应「配色更商务现代、纯白太素」的反馈，未改主色/令牌体系，仅调整取值——画布由纯白改为柔和冷灰（`214 32% 96.5%`）使白卡浮起、侧栏由近白经深墨蓝方案评估后定为**中灰冷**（`214 32% 90%`，略深于画布，轻层次框架、统一不抢焦点）、顶栏改纯白卡 + 细描边、Hero 强化品牌洗染渐变、卡片加静息/抬升阴影；并新增 `--sidebar-border/--sidebar-accent/--sidebar-muted/--card-shadow` 四个门户扩展令牌；圆角由 `0.5rem` 收紧为 `0.375rem`、表单/按钮/tab 更硬朗商务。本次追加：① 列表表格**分页组件**（`.pager`）；② 登录页**分屏大气版**（`--login-bg-image` 背景图）；③ 侧栏叶子导航 `.nav-item` 补 `width:100%` 实现**整行 hover/激活高亮**；④ 补 `shield` 图标使「权限管理」父级按钮有图标；⑤ 表单/筛选改为 **12 列固定宽度栅格**（`.form-grid` + `.col-2/3/4/6/8/12`，窄屏自动收口单列）。**滚动与栅格微调**：⑥ 子系统壳改为 `100vh` flex 列定高布局（`#view-subsystem` + `.sub-shell` flex:1 + `overflow:hidden`），纵向滚动**限制在表格区**——列表视图筛选卡与状态标签固定顶部、仅 `.table-scroll`（含表头吸顶 `position:sticky`）内部滚动，概览视图整页内容在 `.scroll-y` 内滚动，**整页不再出滚动条**；⑦ 筛选卡字段宽度按语义区分：**创建时间 `col-4`、所属组织/关键词搜索 `col-2`**（新增 `.col-2`）。**外滚动条修复（本轮）**：⑧ 发现每页行数变化仍会牵动整页外滚动条——根因为列表容器 `#list-table-host` 用了 `flex:1 1 auto`（以内容高度为 basis），表格行数增多时其 basis 把高度泄漏到外壳致使整页变高；改为 `flex:1 1 0%` 的**列向 flex**（`flex-direction:column`），高度只由剩余空间分配、与内容无关，表格再高也只在 `.table-scroll` 内部滚动；并给 `.table-scroll` 加 `overscroll-behavior:contain` 阻断滚动链；同时将 `#view-subsystem` 由 `height:100vh` 升级为 `position:fixed; inset:0` 锁死视口，双保险彻底消除整页外滚动条。**登录页精炼（本轮，07-21）**：⑨ 应「右侧登录区字体稍大、整页更商务简洁」——右侧登录卡字号上调：标题 `欢迎登录` 1.5rem→1.75rem、副标 `企业统一管理平台` .875→1rem、字段标签 `.8125→.875rem`（抽屉同步统一为 14px）、登录输入框/主按钮 `.9375rem` 且 `min-height:2.75rem`（更大的点击区、更稳重）；卡内边距 2.25→2.75rem、阴影压平为 `0 1px 3px -1px rgb(15 23 42/.07)`、表单间距与 `.login-main` 留白加大，整体更通透克制；左侧品牌区副文案/要点字号小幅收敛（`.9/.875rem`）使整页更安静商务。Light/Dark 双主题同步保持层次与 AA 对比度。

> **门户首页子系统入口重设计（本轮，07-21）**：应「各子系统风格太松散、空白太多、选中视觉需重设计」——将门户首页子系统卡片由**纵向堆叠大卡**改为**横向紧凑瓦片**：① 栅格由 3 列收紧为桌面 **4 列**（`≥1280px`）、间距 `1rem→.75rem`、卡片内边距 `1rem→.75rem .875rem`，密度显著提升；② 卡片结构改为「**左侧圆角方图标徽标 + 右侧标题/描述（单行省略）+ 右侧进入箭头**」三栏，`subcard-title` 14px/600、`subcard-desc` 12px；③ **选中视觉统一语言**：新增左侧实色高亮条（`::before` 3px 主色，hover/focus/active 三态经 `scaleY` 展开），hover 叠加主色微染底 + 抬升阴影 + 箭头 `translateX` 滑入，键盘 `focus-visible` 用 3px 主色环；④ **显式选中态**：进入子系统后回填 `active` 类标记当前所在子系统，回到门户仍保持高亮，直观呈现「我在哪个系统」；⑤ 顶部统计卡间距 `1rem→.875rem`、内边距收紧，区块/最近访问/页脚纵向间距同步收敛（`.section 2rem→1.5rem`、`.recent/.footer` 同步），整体消除松散留白。Light/Dark 双主题与 AA 对比度不变。

---

## F. 流程中心 · 流程记录查看（审批详情）模板

> 交付物：`docs/frontend/design-proposal/process-record-template.html`（独立高保真原型，复用门户同款企业靛 shadcn 令牌与 `--radius:0.375rem`，Light/Dark 双主题）。
> 覆盖需求：流程表单 / 附件、流程进度、流程日志，以及**审批通过 / 驳回、发起人撤回**等操作。

> **流程记录详情接入门户整体（本轮，07-21）**：应「把整个流程记录页面集成到门户整体里」——不再作为独立文件，而是**直接打通进 `mis-portal-prototype.html` 的「流程中心」子系统**：① 流程中心各子菜单（待办任务 / 已办归档等）进入后展示**流程记录列表**（栏目：流程编号 / 名称 / 发起人 / 当前节点 / 状态 / 发起时间，整行可点 + 详情按钮），复用门户既有筛选卡（流程类型 `col-2`、发起时间 `col-4`、关键词 `col-2`）、状态 Tab（全部 / 待我审批 / 我发起的）、分页组件与表头吸顶；② 点行/详情 → **进入流程记录查看详情页**，复用门户 `#sub-content` 容器（不再独立全屏），详情含 `pr-detail-head`（返回列表 + 标题 + 状态徽标 + 打印）、`pr-meta` 元信息条、`pr-stepper` 进度 Stepper、`pr-body`（左 Tab【流程表单 / 附件 / 流程日志】+ 右信息栏【流程信息 / 审批链】）、`pr-actions` 底部操作栏；③ 详情内**审批通过 / 驳回（原因必填校验）/ 发起人撤回** 均做成可演示——右侧滑出 `sheet` 抽屉填意见，提交后实时改写节点状态、追加日志、推进 Stepper、更新状态徽标；④ **视角切换**下拉（当前审批人赵敏 / 发起人李文博）演示不同可执行动作；⑤ 详情态隐藏子系统顶部 Tab 条、返回列表恢复，列表页码/筛选态保留；⑥ 所有样式复用门户企业靛 shadcn 令牌与 `.badge-status/.card/.btn*/.sheet*/.table-scroll/.pager` 等既有组件，仅新增 `.pr-*` / `.ro-*` / `.att-*` / `.log-*` / `.aside-*` / `.step-*` 等流程专用类及 `process-record-template.html` 缺的图标（`PR_ICONS` + `pricon()`），Light/Dark 双主题与 AA 对比度不变。独立模板 `process-record-template.html` 保留为组件参考。

### F.1 页面结构（5 区，固定视口 `position:fixed; inset:0` flex 列）
1. **顶栏 `.pr-header`**：返回 + 面包屑 + 流程标题 + 状态徽标（`badge-status` 语义色）+ 打印/主题切换。
2. **元信息条 `.pr-meta`**：流程编号 / 发起人 / 部门 / 发起时间 / 紧急程度 + 右侧「当前节点」高亮。
3. **流程进度 `.pr-stepper`**（横向 Stepper，窄屏可横向滚动）：节点 = 发起提交 → 部门经理 → 财务复核 → 分管副总 → 出纳付款；状态 `done`(绿底✓) / `current`(主色底 + 脉冲光环 + 连接线高亮) / `pending`(灰) / `rejected`(红底✕)；连接线随上一节点完成变绿。
4. **主体 `.pr-body`**（`grid: 1fr 21rem`，窄屏 `<960px` 收起右栏）：左 = Tab【流程表单 / 附件 / 流程日志】+ 内部滚动内容；右 = `.pr-aside` 信息卡（流程信息 + 审批链状态 + 提示）。
5. **底部操作栏 `.pr-actions`**（sticky）：按**状态 + 查看视角**计算可执行动作；含「查看视角」切换（演示：当前审批人赵敏 / 发起人李文博）。

### F.2 关键组件与令牌
- **流程表单**：`.ro-grid` 两列（`.span-full` 整行），只读字段 `label(12px muted) + value(15px/600)`，金额用主色强调 `1.125rem/700`。
- **附件**：`.att-list` 自适应网格，`.att-item` 按类型着色图标徽标（`pdf`红 / `doc`蓝 / `img`绿）+ 名称 + 大小 + 下载按钮。
- **流程日志**：`.log-list` 竖向时间线，`.log-dot` 按动作类型着色（submit 信息蓝 / approve 绿 / reject 红 / route 灰 / revoke 橙 / comment 主色），含操作人、动作徽标、时间、意见气泡。
- **操作抽屉**：复用 `.sheet-panel`（右侧滑出），审批通过/驳回/撤回共用，驳回理由必填校验；提交后实时改写节点状态、追加日志、更新 Stepper 与状态徽标（纯前端 mock，可演示完整流转）。
- 复用基础类：`.btn(.primary/.outline/.destructive/.ghost)`、`.input`/`textarea.input`、`.badge-status`、`.card`、`.icon-btn`、`.sheet-overlay/.sheet-panel`——与门户完全一致，零新增设计债务。

### F.3 状态 × 视角 动作矩阵（开发落地参考）
| 流程状态 | 当前审批人视角 | 发起人视角 | 其他/只读 |
|---|---|---|---|
| 审批中(pending) | [驳回] [同意并通过] | [撤回申请] | 提示「当前节点处理中，无操作权限」 |
| 已通过/已驳回/已撤销 | [重新打印] [重新发起] | 同左 | 同左 |

> 注：真实系统应按 `当前节点.actor === 登录人` 与 `发起人 === 登录人` 做权限判断，模板用「查看视角」下拉模拟；驳回/撤回后状态终止，可「重新发起」复位演示。

---

## G. 系统管理控制台（独立模板）

> 交付物：`docs/frontend/design-proposal/system-admin-template.html`（独立高保真模板，复用门户同款企业靛 shadcn 令牌与 `--radius:0.375rem`，Light/Dark 双主题，已 Node 校验 JS 语法 + DOM 桩跑通 14 页无运行时错误）。
> 范围来源：依据 `docs/database/schema-design.md` 的 `system` 应用（租户管理控制台）表结构，经用户确认「完整 CRUD + 独立模板文件」后落地。

### G.1 页面清单（14 页，按 DB 表映射）
| 分组 | 页面 | 对应表 |
|---|---|---|
| 组织架构 | 组织管理 / 部门管理 / 员工管理 / 岗位管理 | `sys_org` / `sys_dept`(+类别) / `sys_employee` / `sys_post`(+类型+任职) |
| 应用与接口 | 应用管理 / 接口管理 / 模块管理 | `sys_app` / `sys_api`(+菜单绑定) / `sys_module` |
| 权限中心 | 用户管理 / 角色权限 / 菜单管理 | `sys_user` / `sys_role`(+权限+数据范围) / `sys_menu` |
| 基础数据 | 字典管理 / 系统参数 | `sys_dict_type`(+项) / `sys_config` |
| 审计 | 登录日志 / 操作日志 | `sys_login_log` / `sys_oper_log`（只读） |

> 平台级 `sys_tenant` / `sys_platform_user` / `sys_module`(平台) 不纳入；`sys_user`(每 APP 账号) 与 `sys_employee`(自然人) 拆分为两页，符合 DB 语义。

### G.2 架构（数据驱动，零重复）
- 单一 **CRUD 引擎** + 一个复用 **Sheet 抽屉**（新建/编辑/详情三态共用），由各页 `PAGES[id]` 描述符（filters / columns / form / sample）实例化——新增页面只需加一个描述对象。
- 外壳：顶栏（品牌 + 租户标识 + 主题切换）+ 左侧分组导航（激活态整行主色）+ 主区（面包屑 + 标题 + 描述 + 新建按钮）+ 内容区（筛选卡 + 状态 Tab 占位 + 表头吸顶表格 + 分页）。
- 组件全部复用门户既有语言：`.btn(.primary/.outline/.destructive/.ghost)`、`.input/textarea`、`.badge-status`、`.card`、`.switch`、`.form-grid(.col-*)`、`.table-scroll`(sticky thead)、`.pager`、`.sheet-*`——令牌 1:1 一致，无新增色系。
- 交互：查询/重置、分页（10/20/50 + 页码省略）、表头吸顶、行内 详情/编辑/删除；删除走确认弹层；`sys_user` 租户管理员不可删（防呆）；只读页（日志）隐藏新建与编辑。
- **特殊编辑器**：角色权限用菜单树复选框（`buildPermTree`，数据来自 `MENU_TREE`）+ 数据范围下拉；菜单管理用父级下拉树；详情态下角色权限以只读摘要呈现（`customDetail`）。
- 校验：必填项红框 + toast 提示；保存即写入内存 `dataStore` 并即时刷新列表（纯前端 mock，可演示完整增删改查闭环）。

### G.3 设计约束
- 圆角 `--radius:0.375rem`、企业靛主色、Light/Dark 双主题、WCAG AA 对比度与门户完全一致。
- 示例数据参考 `docs/database/seed-data.md`（默认租户、admin/TENANT_ADMIN、应用 system/iam/ops、模块 user/org/system/audit、系统参数等）。

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

*design-system-expert · 2026-07-20 · 门户化扩展严格基于企业靛 shadcn 基线，未引入新色彩系统，圆角统一为 `--radius: 0.375rem`（商务硬朗）。*
