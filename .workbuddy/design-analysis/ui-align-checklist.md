# 按参考截图调整系统表单/表格/按钮 的修改清单

> 视角：给一般 IT 人员看的「改哪、改什么、怎么改」清单  
> 结论先行：当前系统**已经部分像那张图了**（表头本来就是加粗+浅灰底、按钮/链接也是蓝字 14px、字体也是微软雅黑）。真正和图不一样的地方只有几处，而且大多集中在 1~2 个共享文件里，改一处就全站生效。  
> 下面按「改动文件」分组，每组标了【影响范围】和【怎么改】。

---

## 一、先说哪些「不用改」（已经和图一致，别白忙）

- **字体**：系统已经是「微软雅黑 / PingFang + 14px 正文」，和图一样。
- **表头风格**：已经是「加粗 + 浅灰底」，和图一样。
- **按钮**：主按钮蓝底白字、次按钮白底描边、字号 14px，已经和图一样。
- **操作列**：「详情 / 编辑 / 更多」本来就是蓝色文字链，和图一致。
- **必填红星 `*`、浅绿状态徽标「正常」**：已经一致。

所以本次实际要动的，只有：**圆角变小、表头字号变小、列间加竖线、表单标签字号变小** 这 4 件事。

---

## 二、改动 1：圆角 6px → 4px（全局，一处生效）

**文件**：`frontend/mis-admin-web/src/styles/globals.css`  
**位置**：`:root {` 里这一行  
```css
--radius: 0.375rem;   /* 当前 = 6px */
```
**改成**：
```css
--radius: 0.25rem;    /* = 4px，和参考图一致 */
```
**【影响范围】**：全站所有按钮、输入框、卡片、标签页、弹窗、抽屉的圆角会一起变小。这正是你说的「按钮/表单风格统一」。**`.dark` 暗色不用单独改**，它读的是同一个 `--radius`。

---

## 三、改动 2：表头字号 14px → 13px（全局，一处生效）

**文件**：`frontend/mis-admin-web/src/styles/globals.css`  
**位置**：文件末尾附近这段全局规则
```css
thead th {
  @apply font-bold;
  padding-top: 0.75rem !important;
  padding-bottom: 0.75rem !important;
}
```
**改成**（加一行字号）：
```css
thead th {
  @apply font-bold;
  font-size: 0.8125rem;   /* 13px，和参考图一致 */
  padding-top: 0.75rem !important;
  padding-bottom: 0.75rem !important;
}
```
**【影响范围】**：全站所有表格（列表页、树表、任职子表）的表头字号一起变。

> 可选微调：若想让表头底色更贴近图的 `#fafafa`，把同文件里 `--table-header: 220 14% 92%;` 改成 `220 14% 96%;`（更浅一点）。不改也行，现在已经是浅灰。

---

## 四、改动 3：表单标签字号 14px → 13px（两处）

参考图里表单前面的「标签文字」比正文略小。系统现在表单标签是 14px。

**(a) 通用 Label 组件**  
**文件**：`frontend/mis-admin-web/src/components/ui/label.tsx`  
**当前**：
```tsx
className={cn('text-sm font-medium leading-none ...', className)}
```
**改成**：把 `text-sm` 换成 `text-[13px]`（其余不动）。

**(b) 列表页里的筛选卡标签 + 表单抽屉标签**（这俩是直接在引擎里写的，不走上面的组件，要单独改）  
**文件**：`frontend/mis-admin-web/src/features/system/admin-list-page.tsx`  
- 搜索 `fieldLabelClass`（约 284 行），把 `text-sm font-medium` 改成 `text-[13px] font-medium`。
- 搜索筛选卡里的 `<label className="mb-[0.4rem] block text-sm font-medium text-foreground">`（约 723 行），同样把 `text-sm` 改成 `text-[13px]`。

**【影响范围】**：所有用这套表单的地方（12 个列表页的筛选区 + 新增/编辑抽屉）。

---

## 五、改动 4：表格列间加竖线分隔（列表引擎，一处生效）

参考图里每一列之间有 1px 浅灰竖线；系统现在只有「行与行之间横线」、没有竖线。

**文件**：`frontend/mis-admin-web/src/features/system/admin-list-page.tsx`  
**主表格的表头和单元格两处加左边框**（第一列不加，避免最左边多一条）：

1. 表头 `<th>`（约 779 行，有两处：列循环里 + "操作"列）：
```tsx
// 改前
<th className="whitespace-nowrap px-4 py-2.5 text-sm font-bold text-muted-foreground">
// 改后（第一列不要加 border-l）
<th className="border-l border-border/60 whitespace-nowrap px-4 py-2.5 text-[13px] font-bold text-muted-foreground">
```
> 把循环里的第一列（序号之类）的 `border-l` 去掉即可，其余列都加上。

2. 单元格 `<td>`（约 863 行）：
```tsx
// 改前
<td key={c.key} className="px-4 py-[0.7rem] align-middle text-sm">
// 改后（第一列不要加 border-l）
<td key={c.key} className="border-l border-border/60 px-4 py-[0.7rem] align-middle text-sm">
```
"操作"列的 `<td>`（约 896 行）也照此加 `border-l border-border/60`。

**照抄提示**：本文件里 `AssignmentTable`（任职子表，约 256 行）已经用了 `border-l border-border/60` 写法，直接参考它最省事。

**【影响范围】**：下面 12 个列表页的表格一起变（因为都走这一个引擎）：
- 用户管理 / 组织管理 / 部门管理 / 员工管理 / 岗位管理
- 应用管理 / 角色权限 / 菜单管理 / 字典管理 / 系统参数
- 登录日志 / 操作日志

---

## 六、树表页面也要同步（模块管理、部门管理等）

模块管理、部门管理这类「左边树 + 右边表」的页面用的是另一个共享组件 `TreeTable`，不在上面的引擎里，需要单独补同样的竖线。

**文件**：`frontend/mis-admin-web/src/components/common/tree-table.tsx`  
- 表头 `<th className="px-2 py-1.5 font-bold">` → 加 `text-[13px]` 和 `border-l border-border/60`（第一列除外）。
- 单元格 `<td className="px-2 py-1.5">` → 加 `border-l border-border/60`（第一列除外）。
- 表头底色已由 globals 的 `--table-header` 控制，不用改。

**【影响范围】**：模块管理、部门管理等用树表的页面。

> 菜单管理等 B 类页面若也用到了 `<table>`，按上面同样的 `border-l` 模式补一下即可（先确认它有没有自己的表格）。

---

## 七、门户原型不会自动变（提醒，不在本次范围）

`docs/frontend/design-proposal/mis-portal-prototype.html` 是**独立的 HTML 文件**，不读 `globals.css`，所以上面所有改动**不会影响门户原型**。要门户也统一，得单独改它的内联 CSS，工作量较大，建议另排期。

---

## 八、可选：主色要不要也换成图的亮蓝？

参考图主色是亮蓝 `#1c64f2`；系统现在用的是**企业靛 `#4f46e5`**。你这次只说「字体/表格风格」，没提换色，所以我没动色。

若也要换：改 `globals.css` 里 `--primary` 和 `--ring`（Light + Dark 共 4 行）即可全站按钮/链接变色。  
**提醒**：这会偏离我们已定的设计规范（企业靛是经过对比度校验的），属于产品级决定，建议先确认再动。

---

## 九、怎么验证改完了

1. 进前端目录启动：`cd frontend/mis-admin-web && npm run dev`（默认 vite :5173）。
2. 打开任意列表页（如「用户管理」），对照参考图看 4 件事：圆角是否变小、表头是否 13px、列间是否有竖线、表单标签是否变小。
3. 跑 `npm run typecheck` 确认没有语法/类型错误（这个前端没有单测，typecheck 是提交门禁）。

---

## 十、一句话总结改动清单

| 改什么 | 文件 | 工作量 |
|---|---|---|
| 圆角 6→4px | `styles/globals.css` 1 行 | 极小 |
| 表头 14→13px | `styles/globals.css` 1 行 | 极小 |
| 表单标签 14→13px | `components/ui/label.tsx` + `admin-list-page.tsx` 2~3 处 | 小 |
| 列表表格加竖线 | `admin-list-page.tsx` 表头+单元格 | 小 |
| 树表加竖线 | `components/common/tree-table.tsx` | 小 |
| （可选）主色换亮蓝 | `styles/globals.css` 4 行 | 极小，但需产品确认 |

> 说明：以上改动会让系统视觉偏离我们原先锁定的设计规范（6px 圆角、弱化表头）。这是产品层面的有意调整，没问题；只要保证全站统一（令牌系统已经帮我们做到了），就不产生新的「风格碎片」。
