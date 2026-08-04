import { create } from 'zustand';
import type { KbEngineCapabilities, KbEngineHealth } from '../types';
import { engineCapabilities, engineHealth } from '../api/kb-api';

/**
 * 知识库全局态（内存态，不持久化）。
 *
 * <p>承载引擎健康/能力轮询结果，供「引擎」页与「概览」页共享，避免重复请求。
 * 数据获取失败时保持上一帧结果，fail-soft，不阻塞业务页面。
 */
interface KbState {
  /** 引擎健康（最近一次轮询） */
  health: KbEngineHealth | null;
  /** 引擎能力（最近一次轮询） */
  capabilities: KbEngineCapabilities | null;
  /** 是否正在轮询 */
  loading: boolean;
  /** 是否已加载过（fail-closed：未加载前概览页引擎卡不显示异常） */
  loaded: boolean;
  /** 拉取引擎健康 + 能力 */
  refreshEngine: () => Promise<void>;
  /** 仅拉取健康（轻量心跳，可由概览页定时触发） */
  refreshHealth: () => Promise<void>;
  reset: () => void;
}

export const useKbStore = create<KbState>((set) => ({
  health: null,
  capabilities: null,
  loading: false,
  loaded: false,

  refreshEngine: async () => {
    set({ loading: true });
    try {
      const [h, c] = await Promise.all([engineHealth(), engineCapabilities()]);
      set({ health: h, capabilities: c, loaded: true });
    } catch {
      // fail-soft：保留上一帧 health/capabilities
      set({ loaded: true });
    } finally {
      set({ loading: false });
    }
  },

  refreshHealth: async () => {
    try {
      const h = await engineHealth();
      set({ health: h, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  reset: () => set({ health: null, capabilities: null, loading: false, loaded: false }),
}));
