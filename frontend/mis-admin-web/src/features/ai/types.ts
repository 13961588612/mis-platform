/**
 * 前端 AI SDK 契约类型。
 * 仅消费既有 BFF /api/v1/ai/* 响应；字段命名以「前端表单 AdminField.key 为唯一真源」。
 */

/** AI 能力类型（对应 BFF 端点） */
export type AiCapability = 'chat' | 'summary' | 'extract' | 'rag';

/** 注册表 feature 键 */
export type AiFeatureKey =
  | 'form-fill'
  | 'text-extract'
  | 'detail-summary'
  | 'rag-qa'
  | 'copilot'
  | 'nl2sql';

/** 入口降级策略 */
export type AiFallback = 'hide' | 'disable' | 'message';

/** 挂载点 */
export type AiMountPoint =
  | 'form-top'
  | 'form-field'
  | 'detail-header'
  | 'global-copilot'
  | 'list-top-right';

/** 页面上下文：路由/模块/当前记录/选中行（脱敏后注入） */
export interface AiPageContext {
  route: string;
  module?: string;
  record?: Record<string, unknown> | null;
  selectedRows?: Record<string, unknown>[];
}

/** 表单字段 schema（由 AdminField 映射，作为 extract 输入真源） */
export type FormFieldType = 'string' | 'number' | 'select' | 'switch' | 'textarea';

export interface FormFieldSchema {
  name: string;
  label: string;
  type: FormFieldType;
  options?: { value: unknown; label: string }[];
  required?: boolean;
}

/** 字段回填建议单元（HITL 仅确认项落值） */
export interface FieldSuggestion {
  value: unknown;
  confidence: number;
}

export type AiErrorKind = 'network' | 'timeout' | 'business' | 'gate';

export interface AiError {
  kind: AiErrorKind;
  message: string;
  code?: number | string;
  traceId?: string;
}

/** useAI 选项 */
export interface UseAIOptions<TReq> {
  capability: AiCapability;
  feature?: string;
  request: TReq;
  stream?: boolean;
  context?: AiPageContext;
  onToken?: (delta: string) => void;
  onDone?: (result: unknown) => void;
  onError?: (err: AiError) => void;
  fallback?: AiFallback;
}

/** useAI 返回结果 */
export interface UseAIResult<TResp> {
  data: TResp | null;
  streaming: string;
  loading: boolean;
  error: AiError | null;
  unavailable: boolean;
  /** 触发请求（可覆盖 options 局部字段） */
  run: (overrides?: Partial<UseAIOptions<unknown>>) => Promise<void>;
}

/** extract 响应（兼容 T-ext 前的标量 confidence） */
export interface ExtractResponse {
  fields: Record<string, unknown>;
  /** T-ext 前为标量 number；T-ext 后为 Record<string, number> */
  confidence: number | Record<string, number>;
  unmapped?: Array<{ raw: string; hint?: string }>;
  sessionId?: string;
}

/** 摘要要点（MVP 兼容 List<String>，T-sum 后支持结构化 label/value/risk） */
export interface SummaryPoint {
  label?: string;
  value?: string;
  risk?: string;
  text?: string;
}

export interface SummaryCitation {
  field?: string;
  value?: string;
  source?: string;
}

export interface SummaryResponse {
  summary?: string;
  points?: SummaryPoint[] | string[];
  citations?: SummaryCitation[] | string[];
  sessionId?: string;
}

export interface RagCitation {
  doc?: string;
  page?: string;
  snippet?: string;
  score?: number;
  source?: string;
}

export interface RagResponse {
  answer: string;
  citations?: RagCitation[];
  sessionId?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatResponse {
  content?: string;
  messages?: ChatMessage[];
  sessionId?: string;
}

/** feature 声明（双向对齐后端 CapabilityMeta） */
export interface AiFeatureDeclaration {
  key: string;
  capability: AiCapability | 'chat-stream' | 'nl2sql';
  mountPoint: AiMountPoint;
  title: string;
  fallback: AiFallback;
  canApproveOnly?: boolean;
  requiresStream?: boolean;
}

/** AI 上下文消费接口（由 useAiContext 提供） */
export interface AiContextValue {
  /** feature 是否在当前路由/用户下启用 */
  isFeatureEnabled: (key: string, route?: string) => boolean;
  /** 获取 feature 的降级策略 */
  getFallback: (key: string) => AiFallback;
  /** 低置信强制确认阈值 */
  getConfThreshold: () => number;
  /** 是否具备审批写确认权（本阶段仅预留） */
  canApprove: () => boolean;
  /** 当前页面上下文（route/module） */
  getContext: () => AiPageContext;
}

/** /ai/features 响应 data */
export interface AiFeaturesData {
  enabled: string[];
  disabled?: string[];
  allowedCategories?: string[];
  canApprove?: boolean;
  config?: Record<string, Record<string, unknown>>;
}
