/**
 * IqdIcon.tsx — 建模台 icon 工具组件（统一走 `lib/nav/icons.ts` 的 `ICON_MAP`）。
 *
 * <p><b>为什么需要它</b>：`resolveNavIcon()` 对**未登记**的 icon 名会**静默回退**
 * 成 `LayoutDashboard`（见 `icons.ts` 注释：「缺登记不会报错，只会静默回退」）。
 * 建模台用到的 icon 较多（`Workflow` / `GitBranchPlus` / `Calculator` / `Layers` …），
 * 若各组件各自 `import { X } from 'lucide-react'`：
 * ① 无法复用 ICON_MAP 的登记校验；② 侧栏与画布可能对同一语义用不同图标。
 * 本组件把「icon 名 → 组件」收敛到单一查找点。
 *
 * <p>V87 已登记（`icons.ts`）：`Workflow`（建模台 nav）/ `GitBranchPlus`（关系弹窗）/
 * `Calculator`（Cube 编辑器入口）/ `Layers`（模型树分组）。
 *
 * <p><b>prop 名为 `icon` 而非 `name`</b>：lucide 图标继承 `SVGProps`，其中已有 SVG 标准
 * 属性 `name?: string`（用于 `<a name>` 一类锚点语义）。若复用 `name` 会导致
 * `name?: string | null` 与父接口冲突（TS2430），且语义上「图标名」与「SVG name 属性」
 * 是两回事 —— 故显式取 `icon`。
 *
 * <p><b>T01 为纯展示组件，无业务逻辑</b>。
 */
import type { ComponentPropsWithoutRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { resolveNavIcon } from '@/lib/nav/icons';

/** `IqdIcon` Props（透传 lucide 图标原生 props，如 `className` / `size` / `strokeWidth`）。 */
export interface IqdIconProps extends ComponentPropsWithoutRef<LucideIcon> {
  /** ICON_MAP 中的 icon 名（如 `Workflow`）；未登记/缺省时回退 `LayoutDashboard`。 */
  icon?: string | null;
}

/**
 * 按 icon 名渲染 lucide 图标。
 *
 * @param props.icon ICON_MAP key；缺省渲染 `LayoutDashboard`
 * @returns lucide 图标元素（默认 1em 尺寸，随 font-size 缩放）
 */
export function IqdIcon({ icon, ...rest }: IqdIconProps) {
  const Icon: LucideIcon = resolveNavIcon(icon);
  return <Icon aria-hidden="true" {...rest} />;
}

export default IqdIcon;
