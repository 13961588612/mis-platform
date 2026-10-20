/**
 * 从会话历史 metadata.a2ui 回填 SurfaceStore（切会话后表格/卡片可见）。
 *
 * <p>后端 A2uiRunLoop 在成功 render_a2ui 后将
 * ``{ surfaces: [{ surfaceId, components, data? }] }`` 写入 assistant metadata；
 * 本模块在 loadHistory → mapSessionMessage 时重建 createSurface（+ 可选 data）。
 */

import { processA2uiMessage } from './MessageProcessor';
import { scopeSurfaceToMessage } from './surface-store';
import type { A2uiComponentInput, A2uiOperation } from './types';

/** 落库的单条 surface 快照（与后端 ``_snapshot_render_a2ui_args`` 对齐）。 */
export interface A2uiHistorySurfaceSnap {
  surfaceId?: unknown;
  components?: unknown;
  data?: unknown;
}

/** assistant metadata.a2ui 载荷。 */
export interface A2uiHistoryMetadata {
  surfaces?: unknown;
  operations?: unknown;
}

/**
 * 将历史 metadata.a2ui 写入 SurfaceStore，并返回消息私有 surfaceId。
 *
 * @param metadataA2ui metadata.a2ui 对象（或缺省）
 * @param messageId 历史消息 UUID（用于 scopeSurfaceToMessage）
 * @returns 挂到 ChatMessage.surfaceId 的私有 id；无法还原时 undefined
 */
export function hydrateA2uiFromMetadata(
  metadataA2ui: unknown,
  messageId: string,
): string | undefined {
  if (metadataA2ui == null || typeof metadataA2ui !== 'object' || Array.isArray(metadataA2ui)) {
    return undefined;
  }
  const a2ui = metadataA2ui as A2uiHistoryMetadata;

  // 优先：已序列化的 operations（向前兼容）
  if (Array.isArray(a2ui.operations) && a2ui.operations.length > 0) {
    const liveId = processA2uiMessage({
      type: 'a2ui_surface',
      operations: a2ui.operations as A2uiOperation[],
    });
    if (!liveId) return undefined;
    return scopeSurfaceToMessage(liveId, messageId);
  }

  const surfaces = a2ui.surfaces;
  if (!Array.isArray(surfaces) || surfaces.length === 0) return undefined;

  let lastScoped: string | undefined;
  for (const raw of surfaces) {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const snap = raw as A2uiHistorySurfaceSnap;
    const surfaceId = typeof snap.surfaceId === 'string' ? snap.surfaceId.trim() : '';
    if (!surfaceId || !Array.isArray(snap.components)) continue;

    const operations: A2uiOperation[] = [
      {
        op: 'createSurface',
        surfaceId,
        components: snap.components as A2uiComponentInput[],
      },
    ];
    if (snap.data !== undefined) {
      operations.push({
        op: 'updateDataModel',
        surfaceId,
        path: '/',
        value: snap.data,
      });
    }

    const liveId = processA2uiMessage({ type: 'a2ui_surface', operations });
    if (liveId) {
      lastScoped = scopeSurfaceToMessage(liveId, messageId);
    }
  }
  return lastScoped;
}

export default hydrateA2uiFromMetadata;
