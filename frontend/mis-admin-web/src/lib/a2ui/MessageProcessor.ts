/**
 * A2UI MessageProcessor（T06'）。
 *
 * <p>02 文档：`@a2ui/web_core@^0.9.0`（SurfaceModel + DataModel + MessageProcessor +
 * Zod schema + 路径双向绑定）。本项目以自研薄封装落地协议语义（保持对
 * `@a2ui/web_core` 的依赖声明与版本锚点，P1 验证通过后可在不改变组件/权限门控的
 * 前提下替换为官方 MessageProcessor——见 docs/ai-fusion/a2ui/04-open-source-reuse.md §5）。
 *
 * <p>职责：将 ACTIVITY_SNAPSHOT 的 A2UI operations 应用到 SurfaceStore：
 * - createSurface：新建 surface（含初始组件树）
 * - updateComponents：按 path（`/components/{id}` 或 `/components/{index}`）或 id 定位
 *   更新组件（component 类型 / props / children），实现增量渐进渲染
 * - updateDataModel：更新 surface 级数据模型（path 双向绑定）
 * - removeSurface：删除 surface
 */

import { useSurfaceStore } from './surface-store';
import type { A2uiComponentNode, A2uiOperation, A2uiSurface } from './types';

/** 单条 A2UI 消息的两种承载：数组 operations 或单操作 `{ version, ...operation }`。 */
export interface A2uiMessageInput {
  type: 'a2ui_surface';
  operations?: A2uiOperation[];
  surfaceId?: string;
  /** 单操作承载（兼容 `{ version: 'v0.9', <one operation> }`）。 */
  op?: A2uiOperation;
  version?: string;
}

/**
 * 处理一条 A2UI surface 消息，更新 SurfaceStore。
 * 返回受影响的 surfaceId（无则 null）。防御式：非法操作忽略，绝不抛异常中断对话流。
 */
export function processA2uiMessage(message: A2uiMessageInput): string | null {
  const operations: A2uiOperation[] = [];

  if (Array.isArray(message.operations)) {
    operations.push(...message.operations);
  }
  if (message.op != null) {
    operations.push(message.op);
  }

  let touched: string | null = null;
  for (const operation of operations) {
    // 每条 operation 重新取最新 store 状态：同一消息可承载多条 operations
    // （Gateway EventConverter 产出 `[createSurface, updateComponents]` 数组），
    // 后序 op 依赖前序 op 已写入的 surface，不能用消息开头的一次性快照。
    const latestStore = useSurfaceStore.getState();
    const surfaceId = applyOperation(latestStore, operation);
    if (surfaceId != null) touched = surfaceId;
  }

  // B3 修复：setActive 前校验 surface 仍存在——removeSurface 后不得把已删除 id 设回 active
  if (touched != null) {
    const latest = useSurfaceStore.getState();
    if (latest.surfaces[touched] != null) {
      latest.setActive(touched);
    }
  }
  return touched;
}

/** A2UI v0.9 协议 operation 键名（`{ version, <one operation> }` 风格）。 */
const A2UI_V09_OPERATION_KEYS = [
  'createSurface',
  'updateComponents',
  'updateDataModel',
  'removeSurface',
  'deleteSurface',
] as const;

/**
 * 解析单条 operation 的操作名与载荷，兼容两种风格：
 * - `{ op: 'createSurface', surfaceId, ... }`（op 风格）；
 * - `{ version: 'v0.9', createSurface: {...} }`（v0.9 风格，Gateway 中间件/
 *   EventConverter 实际产出；deleteSurface 映射为前端 removeSurface）。
 *
 * 无法识别（缺 op 且无已知 operation 键名）返回 null → applyOperation 静默忽略，
 * 防御式处理，绝不抛异常中断对话流。
 */
function resolveOperation(
  operation: A2uiOperation,
): { name: string; payload: Record<string, unknown> } | null {
  if (operation == null || typeof operation !== 'object') return null;

  // 风格 1：{ op: 'createSurface', ... }
  if ('op' in operation) {
    const opName = operation.op;
    if (typeof opName !== 'string' || opName.length === 0) return null;
    return {
      name: opName,
      payload: operation as unknown as Record<string, unknown>,
    };
  }

  // 风格 2：{ version: 'v0.9', createSurface: {...} } —— 遍历已知 operation 键名
  const record = operation as unknown as Record<string, unknown>;
  for (const key of A2UI_V09_OPERATION_KEYS) {
    const payload = record[key];
    if (payload != null && typeof payload === 'object' && !Array.isArray(payload)) {
      return {
        name: key === 'deleteSurface' ? 'removeSurface' : key,
        payload: payload as Record<string, unknown>,
      };
    }
  }
  return null;
}

/** 应用单个 operation；返回受影响的 surfaceId。 */
function applyOperation(
  store: ReturnType<typeof useSurfaceStore.getState>,
  operation: A2uiOperation,
): string | null {
  const resolved = resolveOperation(operation);
  if (resolved == null) return null;
  const { name, payload } = resolved;

  switch (name) {
    case 'createSurface': {
      const surfaceId = String(payload.surfaceId ?? '');
      if (!surfaceId) return null;
      const surface: A2uiSurface = {
        surfaceId,
        components: Array.isArray(payload.components)
          ? (payload.components as A2uiComponentNode[])
          : [],
        dataModels: {},
      };
      store.upsert(surface);
      return surfaceId;
    }

    case 'updateComponents': {
      const surfaceId = String(payload.surfaceId ?? '');
      const existing = store.surfaces[surfaceId];
      if (!existing) return null;
      const nextComponents = existing.components.map((node) => ({ ...node, children: node.children ? [...node.children] : undefined }));
      const patches = Array.isArray(payload.components) ? payload.components : [];
      for (const patch of patches as ComponentPatch[]) {
        applyComponentPatch(nextComponents, patch);
      }
      store.update(surfaceId, (surface) => ({
        ...surface,
        components: nextComponents,
      }));
      return surfaceId;
    }

    case 'updateDataModel': {
      const surfaceId = String(payload.surfaceId ?? '');
      store.update(surfaceId, (surface) => {
        const dataModels = { ...surface.dataModels };
        setByPath(dataModels, String(payload.path ?? ''), payload.value);
        return { ...surface, dataModels };
      });
      return surfaceId;
    }

    case 'removeSurface': {
      const surfaceId = String(payload.surfaceId ?? '');
      store.remove(surfaceId);
      return surfaceId;
    }

    default:
      return null;
  }
}

interface ComponentPatch {
  /** 组件实例 id（v0.9 风格 updateComponents：无 path 时按 id 整节点替换/追加）。 */
  id?: string;
  path?: string;
  component?: string;
  props?: Record<string, unknown>;
  children?: A2uiComponentNode[];
}

/**
 * 按 path 或 id 更新组件树（路径双向绑定：/components/{id} 或 /components/{index}）。
 *
 * <p>兼容两种承载：
 * - op 风格（path 定位增量补丁）：`{ path, component?, props?, children? }`；
 * - v0.9 风格（id 整节点 upsert）：`{ id, component, props, children? }`——
 *   存在同 id 则替换整节点，否则追加到根组件列表（A2UI 协议 updateComponents 语义）。
 */
function applyComponentPatch(components: A2uiComponentNode[], patch: ComponentPatch): void {
  // v0.9 风格：组件定义直接带 id（无 path）→ 按 id 整节点替换 / 追加
  if (patch.path == null || patch.path.length === 0) {
    if (patch.id != null) {
      upsertComponentById(components, patch as A2uiComponentNode);
    }
    return;
  }

  const target = resolveComponent(components, patch.path);
  if (!target) return;

  if (patch.component != null) {
    target.component = patch.component;
  }
  if (patch.props != null) {
    target.props = { ...target.props, ...patch.props };
  }
  if (patch.children != null) {
    target.children = patch.children;
  }
}

/** 按 id 整节点替换（存在）或追加到根组件列表（v0.9 updateComponents 语义）。 */
function upsertComponentById(components: A2uiComponentNode[], node: A2uiComponentNode): void {
  const index = components.findIndex((c) => c.id === node.id);
  if (index >= 0) {
    components[index] = node;
  } else {
    components.push(node);
  }
}

/**
 * 解析组件：path 支持 `components` 前缀段（可省略），按 id 或 index 逐层下钻；
 * `children` 段进入子节点列表。示例：
 * - `/components/approval-card-001`
 * - `/components/0/children/field-002`
 * - `/approval-card-001/children/0`
 */
function resolveComponent(components: A2uiComponentNode[], path?: string): A2uiComponentNode | null {
  if (path == null || path.length === 0) return null;
  const segments = path.split('/').filter((s) => s.length > 0 && s !== 'components');
  if (segments.length === 0) return null;

  let node: A2uiComponentNode | null = null;
  let current: A2uiComponentNode[] = components;
  let i = 0;
  while (i < segments.length) {
    const segment = segments[i];
    if (segment === 'children') {
      // children 段：下一段是子节点 id/index；无 children 则定位失败
      if (node == null || !Array.isArray(node.children)) return null;
      current = node.children;
      i += 1;
      continue;
    }
    const index = Number(segment);
    const found =
      Number.isInteger(index) && index >= 0 && index < current.length
        ? current[index]
        : current.find((c) => c.id === segment);
    if (!found) return null;
    node = found;
    current = node.children ?? [];
    i += 1;
  }
  return node;
}

/**
 * 按 a.b[0].c 风格 path 写入深层值（DataModel 双向绑定）。
 *
 * <p>B2 修复：数字索引段（`0` / `[0]`）在父节点不存在或为普通对象时，必须创建**数组**
 * 而非对象字面量，保证 `rows.0.name` / `rows[0].name` 产出 `{ rows: [{ name }] }`。
 */
function setByPath(target: Record<string, unknown>, rawPath: string, value: unknown): void {
  // 方括号索引归一化：`rows[0].name` → `rows.0.name`
  const path = rawPath.replace(/\[(\d+)\]/g, '.$1');
  const segments = path.split('.').filter((s) => s.length > 0);
  if (segments.length === 0) return;

  const isIndexSegment = (s: string): boolean => /^\d+$/.test(s);

  let cursor: Record<string, unknown> | unknown[] = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    const nextIsIndex = isIndexSegment(segments[i + 1]);

    if (Array.isArray(cursor)) {
      const idx = Number(segment);
      if (!Number.isInteger(idx)) return;
      const nextItem = (cursor as unknown[])[idx] as Record<string, unknown> | unknown[] | undefined;
      const created = nextItem ?? (nextIsIndex ? [] : {});
      (cursor as unknown[])[idx] = created;
      cursor = created as Record<string, unknown> | unknown[];
    } else {
      const existing = (cursor as Record<string, unknown>)[segment] as Record<string, unknown> | unknown[] | undefined;
      const created = existing ?? (nextIsIndex ? [] : {});
      (cursor as Record<string, unknown>)[segment] = created;
      cursor = created as Record<string, unknown> | unknown[];
    }
  }

  const last = segments[segments.length - 1];
  if (Array.isArray(cursor)) {
    const idx = Number(last);
    if (Number.isInteger(idx) && idx >= 0) {
      (cursor as unknown[])[idx] = value;
    }
  } else {
    (cursor as Record<string, unknown>)[last] = value;
  }
}

export default processA2uiMessage;
