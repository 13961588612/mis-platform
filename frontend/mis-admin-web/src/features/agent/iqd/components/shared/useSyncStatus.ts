/**
 * useSyncStatus.ts — 发布流水线状态轮询 hook（5000ms，沿用 `CatalogSyncStatusBar` 范式）。
 *
 * <p><b>为什么是 5000ms</b>：与既有 `CatalogSyncStatusBar` / `SelfHealPanel` / 一期
 * `SyncStatusBar` 同口径（Q5：5000ms 轮询 + TanStack Query `invalidateQueries` 组合），
 * 保证「编辑落库 → 异步 build → 状态回写」这条链上多个组件的观测节奏一致，
 * 不会出现「状态条已 SYNCED、流水线仍 SYNCING」的视觉打架。
 *
 * <p><b>与 TanStack Query 的关系</b>：本 hook 面向「**无需缓存、只读最新态**」的
 * 状态条场景（后到者覆盖先到者，历史值无意义），因此用轻量 `setInterval` 而非
 * `useQuery`（避免 5s 节奏把 Query 缓存刷成噪声）。需要缓存派生（画布 nodes/edges）
 * 的场景仍走 Query + `iqdKeys`。
 *
 * <p><b>T01 即可用</b>：底层 `getIqdCatalogSyncStatus` 二期已落地，非 stub。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getIqdCatalogSyncStatus, type IqdCatalogSyncStatus } from '@/lib/api/iqd';

/** 默认轮询间隔（毫秒）。 */
export const IQD_SYNC_POLL_INTERVAL_MS = 5000;

/** `useSyncStatus` 返回值。 */
export interface UseSyncStatusResult {
  /** 最新同步状态；无连接或尚未加载为 null。 */
  status: IqdCatalogSyncStatus | null;
  /** 是否正在请求（手动刷新可据此展示 spinner）。 */
  loading: boolean;
  /** 最近一次错误消息（轮询失败不打断，仅记录）。 */
  error: string | null;
  /** 立即拉取一次（不等下一个轮询周期）。 */
  refresh: () => void;
}

/**
 * 按连接轮询 catalog 编辑同步状态。
 *
 * @param connectionId 连接 id；为 `null` 时不发请求（清空 status），
 *                     连接切换即重置（A-14 多连接隔离）。
 * @param intervalMs 轮询间隔，默认 5000ms
 * @returns 最新状态 / 加载中 / 错误 / 手动刷新
 */
export function useSyncStatus(
  connectionId: number | null,
  intervalMs: number = IQD_SYNC_POLL_INTERVAL_MS,
): UseSyncStatusResult {
  const [status, setStatus] = useState<IqdCatalogSyncStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (connectionId == null) {
      setStatus(null);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      setStatus(await getIqdCatalogSyncStatus(connectionId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '获取编辑同步状态失败');
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    void load();
    if (timer.current) {
      clearInterval(timer.current);
    }
    timer.current = setInterval(() => {
      void load();
    }, intervalMs);
    return () => {
      if (timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    };
  }, [load, intervalMs]);

  const refresh = useCallback((): void => {
    void load();
  }, [load]);

  return { status, loading, error, refresh };
}
