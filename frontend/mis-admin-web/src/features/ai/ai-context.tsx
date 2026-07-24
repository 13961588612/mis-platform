import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import api from '@/lib/api/client';
import { useAuthStore } from '@/stores/auth-store';
import { useAiStore } from '@/stores/ai-store';
import { getFeatureDeclaration } from './ai-feature-registry';
import type { AiContextValue, AiFallback, AiPageContext } from './types';

/** 从路由推导模块名：/system/employee -> employee；/monitor/login-log -> login-log */
function deriveModule(route: string): string {
  const parts = route.split('/').filter(Boolean);
  return parts.length >= 2 ? parts[1] : parts[0] ?? '';
}

const AiContext = createContext<AiContextValue | null>(null);

/**
 * AIProvider：持有门禁/健康/降级/页上下文。
 * 挂载时若已登录，并行拉 /ai/features 与 /ai/health；登录态或路由变化重拉 /features。
 * 未登录 / 失败 → fail-closed（入口默认隐藏，主流程不受影响）。
 */
export function AIProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const accessToken = useAuthStore((s) => s.accessToken);

  const setFeatures = useAiStore((s) => s.setFeatures);
  const setHealth = useAiStore((s) => s.setHealth);
  const enabledFeatures = useAiStore((s) => s.enabledFeatures);
  const featuresLoaded = useAiStore((s) => s.featuresLoaded);
  const confThreshold = useAiStore((s) => s.confThreshold);
  const canApprove = useAiStore((s) => s.canApprove);

  useEffect(() => {
    const authed = useAuthStore.getState().isAuthenticated();
    if (!authed) {
      useAiStore.getState().reset();
      return;
    }
    const route = location.pathname;
    const module = deriveModule(route);
    // 拉取 feature 门禁（route 维度）
    void api
      .get<{ code: number; data?: Record<string, unknown> }>('/ai/features', {
        params: { route, module },
      })
      .then((res) => {
        const payload = res.data as unknown as { code: number; data?: Record<string, unknown> };
        if (payload && payload.code === 0 && payload.data) {
          const d = payload.data as Record<string, unknown>;
          const enabled = Array.isArray(d.enabled) ? (d.enabled as string[]) : [];
          const allowedCategories = Array.isArray(d.allowedCategories)
            ? (d.allowedCategories as string[])
            : [];
          const config = (d.config as Record<string, Record<string, unknown>>) ?? {};
          const ff = config['form-fill'] as Record<string, unknown> | undefined;
          const ct = typeof ff?.confThreshold === 'number' ? (ff.confThreshold as number) : undefined;
          setFeatures({
            enabled,
            allowedCategories,
            canApprove: typeof d.canApprove === 'boolean' ? d.canApprove : undefined,
            config,
            confThreshold: ct,
          });
        } else {
          // 业务失败按 fail-closed
          setFeatures({ enabled: [], allowedCategories: [], canApprove: undefined, config: {} });
        }
      })
      .catch(() => {
        setFeatures({ enabled: [], allowedCategories: [], canApprove: undefined, config: {} });
      });

    // 轻量健康检查
    void api
      .get('/ai/health')
      .then((res) => {
        const payload = res.data as unknown as { code: number; data?: Record<string, unknown> };
        const up = payload?.code === 0 && (payload?.data?.status === 'up' || payload?.data?.up === true);
        setHealth(up ? 'up' : 'down');
      })
      .catch(() => setHealth('down'));
  }, [location.pathname, accessToken, setFeatures, setHealth]);

  const value = useMemo<AiContextValue>(
    () => ({
      isFeatureEnabled: (key: string) => {
        if (!featuresLoaded) return false;
        return enabledFeatures.includes(key);
      },
      getFallback: (key: string): AiFallback => {
        const decl = getFeatureDeclaration(key);
        return decl?.fallback ?? 'hide';
      },
      getConfThreshold: () => confThreshold,
      canApprove: () => canApprove === true,
      getContext: (): AiPageContext => ({
        route: location.pathname,
        module: deriveModule(location.pathname),
      }),
    }),
    [enabledFeatures, featuresLoaded, confThreshold, canApprove, location.pathname],
  );

  return <AiContext.Provider value={value}>{children}</AiContext.Provider>;
}

/** AI 上下文消费 Hook（含门禁/健康/降级/页上下文） */
export function useAiContext(): AiContextValue {
  const ctx = useContext(AiContext);
  if (!ctx) {
    // 未在 Provider 内：安全降级，确保不崩溃
    return {
      isFeatureEnabled: () => false,
      getFallback: () => 'hide',
      getConfThreshold: () => 0.85,
      canApprove: () => false,
      getContext: () => ({ route: '', module: '' }),
    };
  }
  return ctx;
}
