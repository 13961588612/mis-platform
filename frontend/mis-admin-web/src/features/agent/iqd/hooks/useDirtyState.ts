/**
 * useDirtyState.ts — 草稿 vs 服务端 的脏标记 hook（v1.11 / Q5）。
 *
 * <h2>职责边界（Q5 红线，务必守住）</h2>
 * 服务端真值是 TanStack Query 的 catalog 缓存；本 hook 只维护**提交前的草稿**
 * （UI 态），并把它登记到 zustand `modeling-store.dirtyDrafts`（T01 已落地该切片）。
 * 之所以**登记到 store 而不是组件本地 state**：脏标记需要被**别的组件**读到
 * （顶栏「有未保存修改」提示、发布前拦截、切换连接时统一清理），本地 state 做不到。
 *
 * <h2>幂等键（§8.4 模板）</h2>
 * 模板 `{connId}:{kind}:{action}:{uuid}` 由 {@link buildIdempotencyKey} 生成 —— 抽成
 * **纯函数**一是便于单测（模板写错会导致「同一次提交被当成两次编辑」，而服务端只按
 * 完全相同字符串去重，形近错误静默失效），二是保证三个调用点（关系 / Cube / 计算列）
 * 的格式**逐字一致**（后端按 `(connection_id, idempotency_key)` 去重，格式漂移不会报错，
 * 只会让幂等失效）。
 *
 * <p>「提交成功后 rotate」很重要：T03a 后端是**双幂等**（幂等键命中 → 返回首次结果；
 * 同 `item_key` 已存在 → 也返回首次结果），若复用同一个 key 做第二次「修改」，会拿到
 * 首次结果而**看起来保存成功却没改**。故 {@link UseDirtyStateResult.rotateIdempotencyKey}
 * 在每次提交后调用。
 */
import { useCallback, useMemo, useState } from 'react';
import { useModelingStore } from '../store/modeling-store';
import type { ItemDraft } from '../types/modeling';

/**
 * 生成幂等键（§8.4 模板：`{connId}:{kind}:{action}:{uuid}`）。
 *
 * @param connectionId 连接 id（多连接下必须带，否则跨连接会互相去重）
 * @param kind         catalog 节点种类（`relationship` / `cube` / `column` / `model`）
 * @param action       动作（`create` / `update`）
 * @param uuid         唯一后缀（默认 `crypto.randomUUID()`；测试可注入固定值）
 * @returns 形如 `7:relationship:create:1f0c…` 的幂等键
 */
export function buildIdempotencyKey(
  connectionId: number | string | null | undefined,
  kind: string,
  action: string,
  uuid?: string,
): string {
  const suffix = uuid ?? defaultUuid();
  return `${connectionId ?? 'none'}:${kind}:${action}:${suffix}`;
}

/** 取 uuid：优先 `crypto.randomUUID`（安全上下文），退化为时间戳+随机数（旧环境/非 https）。 */
function defaultUuid(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** `useDirtyState` 入参。 */
export interface UseDirtyStateOptions<TDraft extends Record<string, unknown>> {
  /** 连接 id（幂等键前缀 + 草稿按连接隔离）。 */
  connectionId: number | null;
  /** 节点稳定键（`dirtyDrafts` 的 key）。 */
  itemKey: string;
  /** 节点种类（进入 `ItemDraft.kind`）。 */
  kind: string;
  /** 打开时的服务端基线值（快照，用于「是否真的改了」判断）。 */
  baseValues: TDraft;
  /** 打开时的连接编辑版本（提交时作为 `base_revision`）。 */
  baseRevision: number;
  /** 动作（默认 `create`）。 */
  action?: string;
}

/** `useDirtyState` 返回值。 */
export interface UseDirtyStateResult<TDraft extends Record<string, unknown>> {
  /** 当前草稿（初值 = baseValues）。 */
  draft: TDraft;
  /** 合并式更新（浅合并；传 `undefined` 的键视为「不改」）。 */
  patchDraft: (patch: Partial<TDraft>) => void;
  /** 整体替换草稿（不登记脏标记也能用；调用方一般在 `patchDraft` 里用）。 */
  setDraft: (next: TDraft) => void;
  /** 丢弃草稿、回到基线。 */
  resetDraft: () => void;
  /** 是否与服务端基线不同（**值比较**，不是「有没有动过」）。 */
  isDirty: boolean;
  /** 本次提交应使用的幂等键。 */
  idempotencyKey: string;
  /** 提交成功后轮换幂等键（见文件头「提交成功后 rotate」）。 */
  rotateIdempotencyKey: () => void;
}

/**
 * 脏标记 hook（草稿 + 值比较 + 幂等键）。
 *
 * @param options 见 {@link UseDirtyStateOptions}
 * @returns 草稿 / 更新方法 / 脏标记 / 幂等键
 */
export function useDirtyState<TDraft extends Record<string, unknown>>(
  options: UseDirtyStateOptions<TDraft>,
): UseDirtyStateResult<TDraft> {
  const { connectionId, itemKey, kind, baseValues, baseRevision, action = 'create' } = options;

  const markDirty = useModelingStore((state) => state.markDirty);
  const clearDirty = useModelingStore((state) => state.clearDirty);

  const [draft, setDraftState] = useState<TDraft>(baseValues);
  const [uuid, setUuid] = useState<string>(() => defaultUuid());

  const idempotencyKey = useMemo(
    () => buildIdempotencyKey(connectionId, kind, action, uuid),
    [connectionId, kind, action, uuid],
  );

  /** 登记脏草稿（Q5：仅 UI 态；不打服务端请求）。 */
  const register = useCallback(
    (next: TDraft) => {
      const item: ItemDraft = {
        itemKey,
        kind,
        baseValues: { ...baseValues },
        draftValues: { ...next },
        baseRevision,
        idempotencyKey,
      };
      markDirty(itemKey, item);
    },
    [itemKey, kind, baseValues, baseRevision, idempotencyKey, markDirty],
  );

  const patchDraft = useCallback(
    (patch: Partial<TDraft>) => {
      setDraftState((prev) => {
        const next = { ...prev, ...patch } as TDraft;
        register(next);
        return next;
      });
    },
    [register],
  );

  const setDraft = useCallback(
    (next: TDraft) => {
      setDraftState(next);
      register(next);
    },
    [register],
  );

  const resetDraft = useCallback(() => {
    setDraftState(baseValues);
    clearDirty(itemKey);
  }, [baseValues, itemKey, clearDirty]);

  const rotateIdempotencyKey = useCallback(() => {
    setUuid(defaultUuid());
  }, []);

  /** 值比较：草稿与基线是否等价（顺序无关；`undefined` 与缺失等价）。 */
  const isDirty = useMemo(() => !shallowEqualDraft(draft, baseValues), [draft, baseValues]);

  return { draft, patchDraft, setDraft, resetDraft, isDirty, idempotencyKey, rotateIdempotencyKey };
}

/**
 * 浅比较两份草稿（忽略 `undefined`：`{a:1}` 与 `{a:1,b:undefined}` 视为等价）。
 *
 * <p>抽成导出函数便于单测：脏标记判错会导致「明明没改却提示未保存」或
 * 「改了却不提示」，两种都属静默 UX 缺陷。
 */
export function shallowEqualDraft(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    const a = left[key];
    const b = right[key];
    // `undefined` 与「缺失」等价（表单清空常留 undefined，不应被当作修改）
    if (a === undefined && b === undefined) {
      continue;
    }
    if (a !== b) {
      return false;
    }
  }
  return true;
}

export default useDirtyState;
