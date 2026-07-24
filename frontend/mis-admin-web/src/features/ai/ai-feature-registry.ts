import type { AiFeatureDeclaration } from './types';

/**
 * 声明式特征注册表：feature 清单 + 挂载点 + fallback + requiresStream。
 * 双向对齐后端 CapabilityMeta；前端业务页只写 <AiFeature feature="...">。
 */
export const AI_FEATURES: Record<string, AiFeatureDeclaration> = {
  // UC-1 表单智能填充
  'form-fill': {
    key: 'form-fill',
    capability: 'extract',
    mountPoint: 'form-top',
    title: 'AI 填充',
    fallback: 'hide',
  },
  // UC-3 文本/文档抽取
  'text-extract': {
    key: 'text-extract',
    capability: 'extract',
    mountPoint: 'form-top',
    title: '智能录入',
    fallback: 'hide',
  },
  // UC-2 记录智能摘要
  'detail-summary': {
    key: 'detail-summary',
    capability: 'summary',
    mountPoint: 'detail-header',
    title: 'AI 摘要',
    fallback: 'hide',
  },
  // UC-4 上下文 RAG 问答
  'rag-qa': {
    key: 'rag-qa',
    capability: 'rag',
    mountPoint: 'detail-header',
    title: 'AI 问答',
    fallback: 'hide',
  },
  // UC-5 全局 Copilot（全局基础入口，缺能力时保留入口点击提示）
  copilot: {
    key: 'copilot',
    capability: 'chat-stream',
    mountPoint: 'global-copilot',
    title: 'AI Copilot',
    fallback: 'message',
    requiresStream: true,
  },
  // F8 预留：NL2SQL 仅登记，不实现组件（阶段4 之后）
  nl2sql: {
    key: 'nl2sql',
    capability: 'nl2sql',
    mountPoint: 'list-top-right',
    title: 'AI 查数',
    fallback: 'hide',
  },
};

export function getFeatureDeclaration(key: string): AiFeatureDeclaration | undefined {
  return AI_FEATURES[key];
}
