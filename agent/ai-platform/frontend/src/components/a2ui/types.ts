/**
 * A2UI 类型定义（Agent-to-UI / 生成式 UI）。
 *
 * 后端经 AgentEvent.ui_render(component, props) 产出结构化 UI 描述，
 * 前端按 component 映射到 React 组件并以 props 渲染。组件名与
 * backend/src/runtime/events.py::A2UI_COMPONENTS 双向登记（DEP-8 / DEP-9）。
 */

import type { ComponentType } from "react";

/** 受支持的 A2UI 组件名（必须与后端 A2UI_COMPONENTS 严格一致）。 */
export type A2UIComponentName = "approval-card" | "data-table" | "form-sheet";

/** A2UI 动作的回调声明（后端只给描述，前端绑定实际处理函数）。 */
export interface A2UIActions {
  onApprove?: (data?: Record<string, unknown>) => void;
  onReject?: (data?: Record<string, unknown>) => void;
  onSubmit?: (data: Record<string, unknown>) => void;
}

/**
 * A2UI 组件统一 Props。
 * - component：组件名（用于调试/回退）。
 * - props：后端下发的纯数据 JSON（渲染前由 A2uiRenderer 做 snake→camel）。
 * - actions：前端注入的回调（非后端提供）。
 */
export interface A2UIComponentProps {
  component: A2UIComponentName;
  props: Record<string, unknown>;
  actions?: A2UIActions;
}

/** 单条 ui.render 事件的持久化结构（存入 ChatMessage.a2ui）。 */
export interface A2UIRender {
  component: string;
  props: Record<string, unknown>;
}

/** A2UI React 组件类型（所有注册组件统一签名）。 */
export type A2UIComponent = ComponentType<A2UIComponentProps>;
