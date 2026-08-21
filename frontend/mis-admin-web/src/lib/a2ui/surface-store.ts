/**
 * A2UI Surface 状态（zustand）— 渲染层自持（T06'）。
 *
 * <p>由 MessageProcessor 应用 A2UI operations 更新；SurfaceRenderer 订阅后渲染。
 * Surface 与 chat 消息分离：一条消息可承载多个 surface（或一个 surface 独立展示）。
 */

import { create } from 'zustand';
import type { A2uiSurface } from './types';

interface SurfaceState {
  /** surfaceId → surface。 */
  surfaces: Record<string, A2uiSurface>;
  /** 最近的 surfaceId（供 Copilot 面板定位当前渲染目标）。 */
  activeSurfaceId: string | null;
  upsert: (surface: A2uiSurface) => void;
  update: (surfaceId: string, updater: (surface: A2uiSurface) => A2uiSurface) => void;
  remove: (surfaceId: string) => void;
  setActive: (surfaceId: string | null) => void;
  clear: () => void;
}

export const useSurfaceStore = create<SurfaceState>((set) => ({
  surfaces: {},
  activeSurfaceId: null,

  upsert: (surface) =>
    set((state) => ({
      surfaces: { ...state.surfaces, [surface.surfaceId]: surface },
    })),

  update: (surfaceId, updater) =>
    set((state) => {
      const existing = state.surfaces[surfaceId];
      if (!existing) return state;
      return {
        surfaces: { ...state.surfaces, [surfaceId]: updater(existing) },
      };
    }),

  remove: (surfaceId) =>
    set((state) => {
      const { [surfaceId]: _removed, ...rest } = state.surfaces;
      return {
        surfaces: rest,
        activeSurfaceId: state.activeSurfaceId === surfaceId ? null : state.activeSurfaceId,
      };
    }),

  setActive: (activeSurfaceId) => set({ activeSurfaceId }),

  clear: () => set({ surfaces: {}, activeSurfaceId: null }),
}));

export default useSurfaceStore;
