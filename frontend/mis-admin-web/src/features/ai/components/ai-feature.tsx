import type { ReactNode } from 'react';
import { useAiContext } from '../ai-context';
import { useAiStore } from '@/stores/ai-store';
import type { AiMountPoint } from '../types';

interface AiFeatureProps {
  feature: string;
  /** 声明式挂载点（可选，仅作注册元数据；业务页只需 feature + children） */
  mountPoint?: AiMountPoint;
  /** 可选自定义触发节点（默认渲染 children） */
  trigger?: ReactNode;
  /** 业务自定义内容（触发按钮 / 面板入口） */
  children?: ReactNode;
}

/**
 * <AiFeature> 通用壳：声明式挂载点 + 门禁 + 降级。
 * - 未加载 / 未启用 → 按 fallback 降级（默认 hide：不渲染入口）。
 * - 降级绝不影响主流程（列表/详情/表单/审批照常可用）。
 * 业务页零感知流式/JWT/脱敏：只写 <AiFeature feature="...">{trigger}</AiFeature>。
 */
export function AiFeature({ feature, trigger, children }: AiFeatureProps) {
  const { getFallback } = useAiContext();
  const enabledFeatures = useAiStore((s) => s.enabledFeatures);
  const featuresLoaded = useAiStore((s) => s.featuresLoaded);

  // 未加载前一律隐藏（fail-closed）
  const enabled = featuresLoaded && enabledFeatures.includes(feature);
  const fallback = getFallback(feature);

  if (!enabled) {
    // 本期页面 feature 均为 hide；disable/message 分支供全局 copilot 等预留
    if (fallback === 'hide') return null;
    return <>{trigger ?? children}</>;
  }

  return <>{trigger ?? children}</>;
}
