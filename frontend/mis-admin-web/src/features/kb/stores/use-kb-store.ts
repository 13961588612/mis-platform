import { create } from 'zustand';
import type { KbEngineCapabilities, KbEngineHealth, KbEngineModelPool } from '../types';
import { engineCapabilities, engineHealth, listEngineModels } from '../api/kb-api';

/**
 * 知识库全局态（内存态，不持久化）。
 *
 * <p>承载引擎健康/能力/模型池轮询结果，供「引擎」页与「概览」页共享，避免重复请求。
 * 数据获取失败时保持上一帧结果，fail-soft，不阻塞业务页面。
 *
 * <p>{@code libraryEpoch}：知识库列表变更世代。创建/编辑/删除后递增，
 * 让 KeepAlive 下已挂载的 {@code KbLibraryPicker} 重新拉列表——否则文档/权限等页
 * 会一直停在首次挂载时的空下拉。
 *
 * <p>{@code modelPool}（kb_settings_model_chunk）：模型池快照，由创建向导 / 库详情页
 * 通过 {@code refreshModels()} 拉取。**后端已带降级语义**（available=false + degradedReason），
 * 前端绝不把不可用池当空列表展示（设计 §8-6）。
 */
interface KbState {
  /** 引擎健康（最近一次轮询） */
  health: KbEngineHealth | null;
  /** 引擎能力（最近一次轮询） */
  capabilities: KbEngineCapabilities | null;
  /** 模型池（kb_settings_model_chunk；可用/降级语义见类型注释） */
  modelPool: KbEngineModelPool | null;
  /** 是否正在轮询 */
  loading: boolean;
  /** 是否已加载过（fail-closed：未加载前概览页引擎卡不显示异常） */
  loaded: boolean;
  /** 知识库列表变更世代（picker 订阅） */
  libraryEpoch: number;
  /** 分类树变更世代（知识库域一期：新建/移动/删除分类后递增，供 KeepAlive 页面联动失效） */
  categoryEpoch: number;
  /** 拉取引擎健康 + 能力 */
  refreshEngine: () => Promise<void>;
  /** 仅拉取健康（轻量心跳，可由概览页定时触发） */
  refreshHealth: () => Promise<void>;
  /** 拉取模型池（UI 显式触发；60s TTL 内后端命中缓存不重打引擎） */
  refreshModels: () => Promise<void>;
  /** 通知所有 KbLibraryPicker 重新拉列表 */
  invalidateLibraries: () => void;
  /** 通知分类相关页面/组件重新拉取（知识库域一期） */
  invalidateCategories: () => void;
  reset: () => void;
}

export const useKbStore = create<KbState>((set) => ({
  health: null,
  capabilities: null,
  modelPool: null,
  loading: false,
  loaded: false,
  libraryEpoch: 0,
  categoryEpoch: 0,

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

  refreshModels: async () => {
    try {
      const pool = await listEngineModels();
      set({ modelPool: pool, loaded: true });
    } catch {
      // fail-soft：保留上一帧 modelPool；调用方按「池不可判定」保守处理
      set({ loaded: true });
    }
  },

  invalidateLibraries: () => set((s) => ({ libraryEpoch: s.libraryEpoch + 1 })),

  invalidateCategories: () => set((s) => ({ categoryEpoch: s.categoryEpoch + 1 })),

  reset: () =>
    set({
      health: null,
      capabilities: null,
      modelPool: null,
      loading: false,
      loaded: false,
      libraryEpoch: 0,
      categoryEpoch: 0,
    }),
}));
