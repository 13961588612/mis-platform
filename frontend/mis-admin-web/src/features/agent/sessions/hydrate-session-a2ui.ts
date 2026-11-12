/**
 * 会话管理回放：把 assistant metadata.a2ui 写入 SurfaceStore（与 Copilot 隔离）。
 *
 * <p>surfaceId 使用 ``ops__{sessionId}__{messageId}__{original}``，避免覆盖 Copilot
 * 正在用的 ``main`` 等 live id；hydrate 前后恢复 activeSurfaceId。
 */

import { processA2uiMessage } from '@/lib/a2ui/MessageProcessor';
import { useSurfaceStore } from '@/lib/a2ui/surface-store';
import type { A2uiComponentInput, A2uiOperation } from '@/lib/a2ui/types';
import type { SessionMessage } from '../types';

/** 运营回放 surfaceId 前缀（关闭抽屉时按此前缀清理）。 */
export const OPS_A2UI_PREFIX = 'ops__';

export function buildOpsSurfaceId(
  sessionId: string,
  messageId: string,
  originalSurfaceId: string,
): string {
  return `${OPS_A2UI_PREFIX}${sessionId}__${messageId}__${originalSurfaceId}`;
}

/** 是否为本会话运营回放产生的 surface。 */
export function isOpsSessionSurface(surfaceId: string, sessionId: string): boolean {
  return surfaceId.startsWith(`${OPS_A2UI_PREFIX}${sessionId}__`);
}

/**
 * 批量 hydrate；返回 messageId → 私有 surfaceId（无 a2ui 的消息不入表）。
 *
 * @param messages #29 消息列表
 * @param sessionId 当前回放会话 id
 */
export function hydrateOpsSessionA2ui(
  messages: SessionMessage[],
  sessionId: string,
): Record<string, string> {
  const sid = sessionId.trim();
  if (!sid) return {};

  const prevActive = useSurfaceStore.getState().activeSurfaceId;
  const map: Record<string, string> = {};

  try {
    for (const msg of messages) {
      if (msg.role !== 'assistant') continue;
      const a2ui = msg.metadata?.a2ui;
      if (a2ui == null || typeof a2ui !== 'object' || Array.isArray(a2ui)) continue;

      const record = a2ui as { surfaces?: unknown; operations?: unknown };
      let lastId: string | undefined;

      if (Array.isArray(record.operations) && record.operations.length > 0) {
        // operations 内 surfaceId 改写为 ops 私有，避免撞 Copilot
        const rewritten = rewriteOperationsSurfaceIds(
          record.operations as A2uiOperation[],
          sid,
          msg.id,
        );
        const liveId = processA2uiMessage({
          type: 'a2ui_surface',
          operations: rewritten,
        });
        if (liveId) lastId = liveId;
      } else if (Array.isArray(record.surfaces)) {
        for (const raw of record.surfaces) {
          if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) continue;
          const snap = raw as {
            surfaceId?: unknown;
            components?: unknown;
            data?: unknown;
          };
          const original =
            typeof snap.surfaceId === 'string' ? snap.surfaceId.trim() : '';
          if (!original || !Array.isArray(snap.components)) continue;

          const uniqueId = buildOpsSurfaceId(sid, msg.id, original);
          const operations: A2uiOperation[] = [
            {
              op: 'createSurface',
              surfaceId: uniqueId,
              components: snap.components as A2uiComponentInput[],
            },
          ];
          if (snap.data !== undefined) {
            operations.push({
              op: 'updateDataModel',
              surfaceId: uniqueId,
              path: '/',
              value: snap.data,
            });
          }
          const liveId = processA2uiMessage({ type: 'a2ui_surface', operations });
          if (liveId) lastId = liveId;
        }
      }

      if (lastId) map[msg.id] = lastId;
    }
  } finally {
    // 勿把运营回放的 surface 设成 Copilot 当前 active
    useSurfaceStore.getState().setActive(prevActive);
  }

  return map;
}

/**
 * 移除本会话运营回放写入的 surface（不 clear 全局，不影响 Copilot）。
 */
export function cleanupOpsSessionA2ui(sessionId: string): void {
  const sid = sessionId.trim();
  if (!sid) return;
  const store = useSurfaceStore.getState();
  for (const id of Object.keys(store.surfaces)) {
    if (isOpsSessionSurface(id, sid)) {
      store.remove(id);
    }
  }
}

/** 移除一组已知 surfaceId（刷新前替换用）。 */
export function removeOpsSurfaces(surfaceIds: Iterable<string>): void {
  const store = useSurfaceStore.getState();
  for (const id of surfaceIds) {
    if (id) store.remove(id);
  }
}

function rewriteOperationsSurfaceIds(
  operations: A2uiOperation[],
  sessionId: string,
  messageId: string,
): A2uiOperation[] {
  return operations.map((op) => {
    if (op == null || typeof op !== 'object') return op;
    if ('op' in op && typeof (op as { op?: unknown }).op === 'string') {
      const record = op as Record<string, unknown>;
      const original = typeof record.surfaceId === 'string' ? record.surfaceId : '';
      if (!original) return op;
      return {
        ...record,
        surfaceId: buildOpsSurfaceId(sessionId, messageId, original),
      } as A2uiOperation;
    }
    // v0.9 风格：{ createSurface: { surfaceId } } 等
    const record = op as Record<string, unknown>;
    const next: Record<string, unknown> = { ...record };
    for (const key of [
      'createSurface',
      'updateComponents',
      'updateDataModel',
      'removeSurface',
      'deleteSurface',
    ] as const) {
      const payload = record[key];
      if (payload != null && typeof payload === 'object' && !Array.isArray(payload)) {
        const body = payload as Record<string, unknown>;
        const original = typeof body.surfaceId === 'string' ? body.surfaceId : '';
        if (original) {
          next[key] = {
            ...body,
            surfaceId: buildOpsSurfaceId(sessionId, messageId, original),
          };
        }
      }
    }
    return next as A2uiOperation;
  });
}
