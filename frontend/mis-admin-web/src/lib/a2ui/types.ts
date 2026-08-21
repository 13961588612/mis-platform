/**
 * A2UI 渲染层协议类型（T06' 迁入 mis-admin-web）。
 *
 * <p>口径基准（docs/ai-fusion/a2ui/02-task-breakdown.md §4）：
 * - catalogId：`mis-a2ui-catalog-v1`（协议版本锚点；资产 major ↔ Gateway catalog major 匹配）
 * - 组件名：`approval-card`（approval:view / approval:decide）、`data-table`（默认可见）、
 *   `form-sheet`（form:submit）、`entity-select`（默认可见）
 * - 错误码：40301 / 40303 / 40304 / 40305 / 4004 / 40101
 * - 用户操作回传：前端经 WS `{ type: 'a2ui_action', action: A2uiClientAction }` 回传
 */

// ------------------------------------------------------------------ 常量口径

/** 协议版本锚点（与 Gateway A2UIMiddlewareConfig.defaultCatalogId 对齐）。 */
export const A2UI_CATALOG_ID = 'mis-a2ui-catalog-v1' as const;

/** A2UI v0.9 协议版本。 */
export const A2UI_PROTOCOL_VERSION = 'v0.9' as const;

/** 错误码（与 03-permission-design.md §3.3 对齐）。 */
export const A2UI_ERROR_CODES = {
  FORBIDDEN: 40301,
  ACL_UNAVAILABLE: 40303,
  RENDER_FORBIDDEN: 40304,
  EVENT_FORBIDDEN: 40305,
  POLICY_UNMAPPED: 4004,
  EMBED_TOKEN_INVALID: 40101,
} as const;

// ------------------------------------------------------------------ 组件名

/** 受支持的 A2UI 组件名（与 Gateway SHARED_CATALOG 严格一致）。 */
export type A2uiComponentName =
  | 'approval-card'
  | 'data-table'
  | 'form-sheet'
  | 'entity-select';

/** 已知组件名集合。 */
export const KNOWN_A2UI_COMPONENTS: ReadonlySet<string> = new Set<string>([
  'approval-card',
  'data-table',
  'form-sheet',
  'entity-select',
]);

// ------------------------------------------------------------------ Surface Model

/** Surface 组件树节点（占位保留原 id，保证 updateComponents path 稳定）。 */
export interface A2uiComponentNode {
  /** 组件实例 id（Gateway 生成，updateComponents 以 path/id 定位）。 */
  id: string;
  /** 组件名（registry 注册的组件名）。 */
  component: string;
  /** 纯数据 props（前端已 camelize，组件直接消费）。 */
  props: Record<string, unknown>;
  /** 子节点（容器组件）。 */
  children?: A2uiComponentNode[];
}

/** 单个 A2UI Surface（= 一张动态卡片 / 界面）。 */
export interface A2uiSurface {
  surfaceId: string;
  components: A2uiComponentNode[];
  dataModels: Record<string, unknown>;
  /** 渲染权限过滤后的降级占位（Gateway 已过滤；本地 UX 层再兜一层）。 */
  permissionDenied?: boolean;
}

// ------------------------------------------------------------------ A2UI Operations

/**
 * A2UI operations（ACTIVITY_SNAPSHOT 渲染指令）。
 *
 * <p>02 文档：A2UI operations 封装在 ACTIVITY_SNAPSHOT 的 `a2ui_operations`
 * 中（`{ version: 'v0.9', <one operation> }`）。前端 MessageProcessor 兼容
 * `{ operations: [...] }` 与单操作 `{ version, ...operation }` 两种承载。
 */
export type A2uiOperation =
  | {
      op: 'createSurface';
      surfaceId: string;
      components?: A2uiComponentNode[];
    }
  | {
      op: 'updateComponents';
      surfaceId: string;
      components: Array<{
        /** 定位路径：`/components/{id}` 或 `/components/{index}`；缺省按 id 匹配。 */
        path?: string;
        component?: string;
        props?: Record<string, unknown>;
        children?: A2uiComponentNode[];
      }>;
    }
  | {
      op: 'updateDataModel';
      surfaceId: string;
      path: string;
      value: unknown;
    }
  | {
      op: 'removeSurface';
      surfaceId: string;
    };

// ------------------------------------------------------------------ 用户操作回传

/**
 * A2UI 用户操作（前端 → Gateway，02 文档 §4 用户操作回传）。
 *
 * <p>Gateway 转 `RunAgentInput.forwardedProps.a2uiAction` 交给中间件
 * `processUserAction` 合成 tool call 消息发回 Python。
 */
export interface A2uiClientAction {
  surfaceId: string;
  componentId: string;
  /** 操作名（与 registry actionApiMap 的 key 一致：approve / reject / submit / confirm…）。 */
  action: string;
  payload: Record<string, unknown>;
}

// ------------------------------------------------------------------ 组件 Props

/**
 * A2UI 组件统一 Props（所有注册组件共享签名）。
 *
 * <p>与 agent/frontend `components/a2ui/types.ts` 对齐，扩展 bff 回调与权限回调：
 * - `actions.onApprove/onReject`：审批决定（写操作，走 bff-actions）
 * - `actions.onSubmit`：表单提交（写操作，走 bff-actions）
 * - `actions.onEntitySelect`：实体选择（回传 Agent，经 Gateway dispatchAction，非 BFF 写操作）
 */
export interface A2uiComponentProps {
  /** 组件名（调试 / 回退）。 */
  component: A2uiComponentName;
  /** 后端下发纯数据 props（已 camelize）。 */
  props: Record<string, unknown>;
  /** 前端注入回调。 */
  actions?: A2uiActions;
}

/** A2UI 动作回调声明。 */
export interface A2uiActions {
  onApprove?: (data?: Record<string, unknown>) => void;
  onReject?: (data?: Record<string, unknown>) => void;
  onSubmit?: (data: Record<string, unknown>) => void;
  onEntitySelect?: (data: {
    resumeToken: string;
    selectedCandidate?: Record<string, unknown>;
    action: 'confirm' | 'manual' | 'cancel';
  }) => void;
}

// ------------------------------------------------------------------ Registry Entry

/** 操作 → BFF API 映射（前端声明仅供调用方使用；BFF 以 sys_api 表为唯一权威）。 */
export interface A2uiActionApiBinding {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  permissionCode: string;
}

/** 前端 registry 条目（D5 双层声明：UX 层，可篡改仅影响显示；Gateway catalog 权威）。 */
export interface A2uiRegistryEntry {
  name: A2uiComponentName;
  component: import('react').ComponentType<A2uiComponentProps>;
  /** 渲染权限码（UX 层提示；Gateway SurfacePermissionFilter 权威过滤）。 */
  requiredPermission?: string;
  /** 操作 → BFF API 映射（写操作 100% 由 BFF 校验，见 03-permission-design.md §3.2）。 */
  actionApiMap?: Record<string, A2uiActionApiBinding>;
  /** 组件级渲染权限降级文案（无权限时的占位文案，缺省用通用文案）。 */
  deniedText?: string;
}

/** 渲染权限校验结果。 */
export interface A2uiPermissionDecision {
  allowed: boolean;
  /** 缺失的权限码列表。 */
  missingPermissions: string[];
  /** 权限源不可用（fail-closed）。 */
  sourceUnavailable?: boolean;
}

/** BFF 写操作结构化错误（PermissionErrorBanner 消费）。 */
export interface BffActionError {
  code: number;
  message: string;
  missingPermissions: string[];
  /** 是否权限类错误（40301 / 40304 / 40305 / 4004）。 */
  permissionDenied: boolean;
}

/** BFF 写操作结果。 */
export interface BffActionResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: BffActionError;
}
