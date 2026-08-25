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

/**
 * 将 live surface 深拷贝为「消息私有」id。
 *
 * <p>LLM / 中间件常跨轮复用同一 {@code surfaceId}（如 {@code main}）；若不隔离，
 * 后一轮 createSurface/update 会覆盖 SurfaceStore 中同一条目，导致历史气泡
 * 全部改显示最新卡片。done 时调用本函数，把当前 live 快照钉到消息上。
 *
 * @returns 私有 surfaceId；live 不存在时回退原 id
 */
export function scopeSurfaceToMessage(liveSurfaceId: string, messageId: string): string {
  const store = useSurfaceStore.getState();
  const live = store.surfaces[liveSurfaceId];
  if (!live) return liveSurfaceId;
  // 已是本消息私有副本则不再套娃
  if (liveSurfaceId.includes(`__msg__${messageId}`)) return liveSurfaceId;
  const scopedId = `${liveSurfaceId}__msg__${messageId}`;
  let cloned: A2uiSurface;
  try {
    cloned = JSON.parse(JSON.stringify(live)) as A2uiSurface;
  } catch {
    return liveSurfaceId;
  }
  cloned.surfaceId = scopedId;
  store.upsert(cloned);
  return scopedId;
}

export default useSurfaceStore;
