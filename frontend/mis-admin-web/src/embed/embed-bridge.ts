/**
 * embed A2UI 写操作事件桥（T07'）。
 *
 * <p>01-architecture.md §5.2：嵌入场景写操作（approval-card 通过/驳回、form-sheet 提交）
 * 不再直连 BFF，经 postMessage 透出父页处理（权限边界最清晰：写操作 100% 由宿主用
 * 自己的会话执行，P4 最易落地）：
 * - iframe → 父页：`A2UI_EVENT`（eventId / event{name,componentName,payload} / meta{sessionId,hostId}）
 * - 父页 → iframe：`A2UI_EVENT_RESULT`（eventId / ok / data / error{code,message,missingPermissions}）
 *
 * <p>双模式：`createEmbedBffAdapter('bridge')` 默认事件桥；`'direct'` 备选直调 BFF
 * （P1 开关：要求宿主对 BFF 开放 CORS + 兑换 JWT 可调写接口）。
 */

import { A2UI_ERROR_CODES, type BffActionError, type BffActionResult } from '@/lib/a2ui/types';
import type { A2uiContextValue } from '@/components/a2ui/a2ui-context';
import { getActionBinding } from '@/components/a2ui/registry';
import { useChatStore } from '@/stores/chat-store';
import { isAllowedParentOrigin } from './embed-env';
import { sanitizeHostId } from './embed-session';
import { useEmbedStore } from './embedStore';

/** 父页处理写操作超时（ms）。 */
export const EMBED_EVENT_TIMEOUT_MS = 15_000;

/** A2UI_EVENT 载荷（iframe → 父页）。 */
export interface A2uiBridgeEvent {
  /** 操作名（与 registry actionApiMap key 一致：approve / reject / submit）。 */
  name: string;
  componentName: string;
  payload: Record<string, unknown>;
}

/** A2UI_EVENT_RESULT 消息（父页 → iframe）。 */
export interface A2uiEventResultMessage {
  type: 'A2UI_EVENT_RESULT';
  eventId: string;
  ok: boolean;
  data?: unknown;
  error?: { code?: number; message?: string; missingPermissions?: string[] };
}

interface PendingEntry {
  resolve: (result: BffActionResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingEntry>();

function generateEventId(): string {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function isPermissionCode(code: number): boolean {
  return (
    code === A2UI_ERROR_CODES.FORBIDDEN ||
    code === A2UI_ERROR_CODES.ACL_UNAVAILABLE ||
    code === A2UI_ERROR_CODES.RENDER_FORBIDDEN ||
    code === A2UI_ERROR_CODES.EVENT_FORBIDDEN ||
    code === A2UI_ERROR_CODES.POLICY_UNMAPPED
  );
}

/** A2UI_EVENT_RESULT → BffActionResult（PermissionErrorBanner 无缝消费）。 */
function toBffResult(message: A2uiEventResultMessage): BffActionResult {
  if (message.ok) return { ok: true, data: message.data };
  const code = typeof message.error?.code === 'number' ? message.error.code : -1;
  const error: BffActionError = {
    code,
    message: message.error?.message ?? '父页拒绝该操作',
    missingPermissions: Array.isArray(message.error?.missingPermissions)
      ? message.error.missingPermissions.filter((p): p is string => typeof p === 'string')
      : [],
    permissionDenied: isPermissionCode(code),
  };
  return { ok: false, error };
}

/**
 * 透出写操作事件到父页并等待结果。
 * 校验：父页 origin 必须已通过白名单（鉴权时记录）；超时 / 发送失败返回结构化错误。
 */
export function postA2uiEvent(
  event: A2uiBridgeEvent,
  meta: { sessionId: string; hostId: string },
): Promise<BffActionResult> {
  return new Promise<BffActionResult>((resolve) => {
    const parent = window.parent;
    const parentOrigin = useEmbedStore.getState().parentOrigin;
    if (!parent || !parentOrigin) {
      resolve({
        ok: false,
        error: {
          code: -1,
          message: '父页未就绪（未完成鉴权），无法透出写操作',
          missingPermissions: [],
          permissionDenied: false,
        },
      });
      return;
    }

    const eventId = generateEventId();
    const timer = setTimeout(() => {
      pending.delete(eventId);
      resolve({
        ok: false,
        error: {
          code: -1,
          message: '父页处理超时，未收到 A2UI_EVENT_RESULT',
          missingPermissions: [],
          permissionDenied: false,
        },
      });
    }, EMBED_EVENT_TIMEOUT_MS);

    pending.set(eventId, { resolve, timer });

    try {
      parent.postMessage({ type: 'A2UI_EVENT', eventId, event, meta }, parentOrigin);
    } catch {
      clearTimeout(timer);
      pending.delete(eventId);
      resolve({
        ok: false,
        error: {
          code: -1,
          message: 'postMessage 发送失败',
          missingPermissions: [],
          permissionDenied: false,
        },
      });
    }
  });
}

/**
 * 注册 A2UI_EVENT_RESULT 监听（返回取消函数）。
 * origin 必须通过白名单且等于已鉴权父页（防第三方伪造回包）。
 */
export function onA2uiEventResult(): () => void {
  const handler = (event: MessageEvent): void => {
    const data = event.data as A2uiEventResultMessage | null;
    if (data == null || data.type !== 'A2UI_EVENT_RESULT') return;
    if (!isAllowedParentOrigin(event.origin)) {
      console.warn('[embed-bridge] 拒绝非白名单父域的 A2UI_EVENT_RESULT:', event.origin);
      return;
    }
    const authenticatedOrigin = useEmbedStore.getState().parentOrigin;
    if (authenticatedOrigin && event.origin !== authenticatedOrigin) {
      console.warn('[embed-bridge] A2UI_EVENT_RESULT origin 与已鉴权父页不一致，忽略:', event.origin);
      return;
    }
    const entry = pending.get(data.eventId);
    if (!entry) return;
    pending.delete(data.eventId);
    clearTimeout(entry.timer);
    entry.resolve(toBffResult(data));
  };

  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}

/** 写操作执行模式：bridge = 事件桥（默认）；direct = iframe 直调 BFF（P1 备选开关）。 */
export type EmbedWriteMode = 'bridge' | 'direct';

/**
 * 构建 A2uiProvider 可注入的 executeBffAction 适配器。
 * - bridge（默认）：组件写操作 → A2UI_EVENT 透出父页 → A2UI_EVENT_RESULT 回传展示
 * - direct（P1 备选）：iframe 直调 BFF（bff-actions 动态 import，避免 axios 进主 chunk）
 */
export function createEmbedBffAdapter(
  mode: EmbedWriteMode = 'bridge',
): A2uiContextValue['executeBffAction'] {
  return async (componentName, action, payload) => {
    if (mode === 'direct') {
      const binding = getActionBinding(componentName, action);
      if (!binding) {
        return {
          ok: false,
          error: {
            code: A2UI_ERROR_CODES.POLICY_UNMAPPED,
            message: `组件 ${componentName} 的操作 ${action} 未映射到 BFF API`,
            missingPermissions: [],
            permissionDenied: true,
          },
        };
      }
      const { callBffAction } = await import('@/components/a2ui/bff-actions');
      return callBffAction(binding, payload);
    }

    const hostId =
      useEmbedStore.getState().pageContext?.hostId ||
      sanitizeHostId(new URLSearchParams(window.location.search).get('hostId')) ||
      'anon';
    const sessionId = useChatStore.getState().sessionId ?? '';
    return postA2uiEvent({ name: action, componentName, payload }, { sessionId, hostId });
  };
}
