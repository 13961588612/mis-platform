/**
 * 前端 AI SDK 统一导出。
 * 业务页只需消费 <AiFeature> / useAI / useAiContext / 注册表 / 类型。
 */
export { AIProvider, useAiContext } from './ai-context';
export { useAI } from './use-ai';
export { aiFetchEventSource } from './ai-sse-client';
export { AI_FEATURES, getFeatureDeclaration } from './ai-feature-registry';
export { AiFeature } from './components/ai-feature';
export { useFormFillBridge, FormFillBridgeProvider } from './context/form-fill-bridge';
export * from './types';
