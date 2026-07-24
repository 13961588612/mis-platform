/**
 * A2UI 组件注册表（H5 消费侧真实渲染器）。
 *
 * 维护 component 名 → React 组件 的映射，与
 * backend/src/runtime/events.py::A2UI_COMPONENTS 双向登记（DEP-9）。
 * getA2uiComponent 对未知组件返回 undefined，由 A2uiRenderer 渲染安全回退卡片。
 */

import type { A2UIComponent, A2UIComponentName } from "./types";
import { ApprovalCardView } from "./ApprovalCardView";
import { DataTableView } from "./DataTableView";
import { FormSheetView } from "./FormSheetView";

/** 已知组件名集合（与后端 A2UI_COMPONENTS 一致）。 */
export const KNOWN_A2UI_COMPONENTS: ReadonlySet<string> = new Set<string>([
  "approval-card",
  "data-table",
  "form-sheet",
] as A2UIComponentName[]);

/** 组件名 → React 组件 注册表。 */
const registry = new Map<string, A2UIComponent>([
  ["approval-card", ApprovalCardView],
  ["data-table", DataTableView],
  ["form-sheet", FormSheetView],
]);

/** 注册/覆盖一个 A2UI 组件（供未来扩展双向登记）。 */
export function registerA2uiComponent(name: string, component: A2UIComponent): void {
  registry.set(name, component);
}

/** 取组件；未知返回 undefined（调用方渲染安全回退）。 */
export function getA2uiComponent(name: string): A2UIComponent | undefined {
  return registry.get(name);
}

/** 判断组件名是否登记于注册表。 */
export function isKnownA2uiComponent(name: string): boolean {
  return KNOWN_A2UI_COMPONENTS.has(name);
}
