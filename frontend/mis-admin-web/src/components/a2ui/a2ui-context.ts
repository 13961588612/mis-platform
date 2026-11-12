/**
 * A2UI 渲染上下文（独立文件，避免 registry ↔ 组件 ↔ Provider 循环依赖）。
 *
 * <p>组件（registry 注册的 4 个业务组件）import `useA2ui` 获取执行回调；
 * A2uiProvider import 本文件并注入值。本文件零内部依赖（仅类型），
 * 是渲染层的「依赖环断裂点」。
 */

import { createContext, useContext } from 'react';
import type { A2uiClientAction, BffActionResult } from '@/lib/a2ui/types';

export interface A2uiContextValue {
  /** 用户操作回传（approval.decide / form.submit / entity.confirm → Gateway）。 */
  dispatchAction: (action: A2uiClientAction) => void;
  /** 写操作 → BFF REST 调用（403 结构化错误由 PermissionErrorBanner 消费）。 */
  executeBffAction: (
    componentName: string,
    action: string,
    payload: Record<string, unknown>,
  ) => Promise<BffActionResult>;
  /** 当前活动 Surface id（MessageProcessor 应用 operations 后自动更新）。 */
  activeSurfaceId: string | null;
}

export const A2uiContext = createContext<A2uiContextValue | null>(null);

/** 消费 A2UI 上下文；未包裹 Provider 时抛出明确错误。 */
export function useA2ui(): A2uiContextValue {
  const ctx = useContext(A2uiContext);
  if (!ctx) {
    throw new Error('useA2ui must be used within <A2uiProvider>');
  }
  return ctx;
}

// ------------------------------------------------------------------ 节点上下文

/**
 * 当前渲染节点的定位信息（由 SurfaceRenderer 注入）。
 *
 * <p>QA 建议 1：组件 dispatchAction 必须携带真实 surface.id 与 node.id，
 * 否则 Gateway 按 surfaceId/componentId 定位会失效。SurfaceRenderer 在渲染
 * 每个节点时包裹 `<A2uiNodeContext.Provider>`，组件经 `useA2uiNode()` 读取。
 */
export interface A2uiNodeContextValue {
  surfaceId: string;
  componentId: string;
}

export const A2uiNodeContext = createContext<A2uiNodeContextValue | null>(null);

/** 读取当前节点定位信息（预览场景下无 Provider 时返回 null，调用方自行降级）。 */
export function useA2uiNode(): A2uiNodeContextValue | null {
  return useContext(A2uiNodeContext);
}

export default A2uiContext;
