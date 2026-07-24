import { create } from 'zustand';

/** AI 全局健康态 */
export type AiHealth = 'up' | 'down' | 'unknown';

interface SetFeaturesPayload {
  enabled: string[];
  allowedCategories?: string[];
  canApprove?: boolean;
  config?: Record<string, Record<string, unknown>>;
  confThreshold?: number;
}

interface AiState {
  /** 当前路由下可用 feature 键（来自 /ai/features） */
  enabledFeatures: string[];
  /** 平台算出的可访问 AI 类目 */
  allowedCategories: string[];
  /** 审批写确认权（本阶段仅预留） */
  canApprove: boolean | null;
  health: AiHealth;
  /** 全局 Copilot 浮窗开合（由 AppLayout 头部按钮驱动） */
  copilotOpen: boolean;
  /** 低置信强制确认阈值（默认 0.85） */
  confThreshold: number;
  /** 各 feature 配置（如 confThreshold） */
  featureConfig: Record<string, Record<string, unknown>>;
  /** /features 是否已加载（未加载前入口一律隐藏，fail-closed） */
  featuresLoaded: boolean;
  setFeatures: (payload: SetFeaturesPayload) => void;
  setHealth: (health: AiHealth) => void;
  setCopilotOpen: (open: boolean) => void;
  reset: () => void;
}

/**
 * AI 全局状态（内存态，不持久化）。
 * 降级默认：enabledFeatures 为空 → 入口按 fallback 隐藏（fail-closed）。
 */
export const useAiStore = create<AiState>((set) => ({
  enabledFeatures: [],
  allowedCategories: [],
  canApprove: null,
  health: 'unknown',
  copilotOpen: false,
  confThreshold: 0.85,
  featureConfig: {},
  featuresLoaded: false,
  setFeatures: ({ enabled, allowedCategories = [], canApprove = null, config = {}, confThreshold }) =>
    set((state) => ({
      enabledFeatures: enabled,
      allowedCategories,
      canApprove,
      featureConfig: config,
      confThreshold: confThreshold ?? state.confThreshold,
      featuresLoaded: true,
    })),
  setHealth: (health) => set({ health }),
  setCopilotOpen: (copilotOpen) => set({ copilotOpen }),
  reset: () =>
    set({
      enabledFeatures: [],
      allowedCategories: [],
      canApprove: null,
      health: 'unknown',
      copilotOpen: false,
      confThreshold: 0.85,
      featureConfig: {},
      featuresLoaded: false,
    }),
}));
