/**
 * useSyncStatus.ts — catalog 编辑同步状态（**共享 Query 单一轮询源**；空闲 15s / 进行中 5s）。
 *
 * <p><b>为什么必须是共享 Query（而不是各组件各写 `setInterval`）</b>：`GET /iqd/catalog/sync-status`
 * 在建模台同时被 `ModelCanvas` / `PropertyPanel`（两个编辑器）/ `CubeEditor` / `PublishPipelineBar` /
 * `DriftDetailPanel` 订阅，而它们要的**是同一连接、同一份数据**。各写定时器的后果有两个：
 * ① 一个连接并发 3~5 条定时器重复打同一端点；② 各组件看到的 `current_edit_revision` 可能相差
 * 一个轮询周期 —— 而编辑正是拿它当 `base_revision` 做乐观并发的，会造出假 `40900` 冲突。
 * 共享同一个 query key 后：一个连接同一时刻**只有一条轮询**，所有订阅者拿到同一份值。
 *
 * <p><b>两档节奏</b>：
 * <ul>
 *   <li>空闲 {@link IQD_SYNC_POLL_INTERVAL_MS}（15s）—— 稳态；</li>
 *   <li>进行中 {@link IQD_SYNC_ACTIVE_POLL_INTERVAL_MS}（5s）—— 只在 build / index / 同步
 *       真正在跑时拉快（那时人正在盯进度，且同样只有一条轮询）。</li>
 * </ul>
 * 判定见 {@link isIqdSyncBusy}；作业开始/结束时**立刻换档**，不必等下一个周期。
 *
 * <p><b>为什么不用 Query 的 `refetchInterval`（关键）</b>：它是 **observer 级**的
 * （query-core `QueryObserver#updateRefetchInterval`），每个订阅者各起一条定时器，只在
 * 「同一时刻已有请求在飞」时才 join。错峰挂载的订阅者（选中节点、打开 Cube 弹窗）会按
 * 自己的相位再补一枪 —— 调用量又变成 N 倍。故这里用 {@link subscribePoll} 的**按连接计数**
 * 调度器：第一个订阅者起链条、最后一个卸载时停，保证同一连接同一时刻只有一条轮询。
 *
 * <p><b>为什么新订阅者不会「各补一枪」</b>：`staleTime` 取一个轮询周期（15s）——同一窗口内
 * 新挂载的订阅者（选中节点、打开 Cube 弹窗）直接复用缓存，不额外发请求；离开页面超过一个
 * 周期再回来才会补一次（那时缓存确实过期了，该补）。
 *
 * <p><b>其它语义（与改造前的 `setInterval` 版保持一致）</b>：轮询失败只记录 `error`、不打断
 * 也不重试（`retry: false`，下个周期再试）；`connectionId == null` 不发请求且 `status` 为 null；
 * 页面失焦/切标签页时暂停轮询（`refetchIntervalInBackground` 默认 false），后台不再空转；
 * 手动刷新走 `refresh()`（强制拉取，不受 staleTime 影响）。
 *
 * <p><b>T01 即可用</b>：底层 `getIqdCatalogSyncStatus` 二期已落地，非 stub。
 */
import { useCallback, useEffect, useMemo } from 'react';
import { focusManager, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { getIqdCatalogSyncStatus, type IqdCatalogSyncStatus } from '@/lib/api/iqd';
import { iqdKeys } from '../../queries/iqd-keys';

/**
 * 空闲态轮询间隔（毫秒）—— 全仓同步状态轮询的**唯一**取值来源。
 *
 * <p>2026-09-27 由 5000 下调至 15000：同一连接上多个组件并发订阅同一 `sync-status` 端点，
 * 5s 一轮的服务端调用密度过高。要再调速只改这里。
 */
export const IQD_SYNC_POLL_INTERVAL_MS = 15_000;

/**
 * 进行中轮询间隔（毫秒）—— 只在 build / index / 同步真正在跑时使用。
 *
 * <p>进行中是人真正在盯的窗口，且此时全应用仍只有**一条**轮询，所以拉快到 5s 也不会
 * 回到改造前的调用密度。想更保守就把这里改成与空闲同值（即退化为单一 15s 节奏）。
 */
export const IQD_SYNC_ACTIVE_POLL_INTERVAL_MS = 5_000;

/**
 * 视作「进行中」的状态词（小写比对）。
 *
 * <p>词表刻意比展示侧的 `PublishPipelineBar.classifyStatus` 窄：这里只回答「要不要拉快轮询」，
 * 所以只收真正的进行态，不收 `ok` / `ready` / `completed` 这类成功别名。
 */
const ACTIVE_STATUS_WORDS = new Set(['running', 'pending', 'queued', 'syncing', 'in_progress']);

/** 判定同步是否处于进行中（决定用哪档轮询间隔）。 */
export function isIqdSyncBusy(status?: IqdCatalogSyncStatus | null): boolean {
  if (!status) return false;
  return [status.edit_status, status.build_status, status.index_status].some(
    (v) => typeof v === 'string' && ACTIVE_STATUS_WORDS.has(v.trim().toLowerCase()),
  );
}

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

/** 单条共享轮询的条目。 */
interface PollEntry {
  /** 订阅者数量（归零即停链条）。 */
  refs: number;
  /** 下一次轮询（自适应间隔 = 每轮重排，故用 `setTimeout` 而非固定 `setInterval`）。 */
  timer: ReturnType<typeof setTimeout> | null;
  /** 当前档位（毫秒），用于判断换档时是否真要重排。 */
  delay: number;
}

/**
 * 「连接 → 轮询」表，按 QueryClient 隔离（`WeakMap`：测试里各 client 互不串）。
 */
const polls = new WeakMap<QueryClient, Map<number, PollEntry>>();

/** 按档位取间隔。 */
function delayFor(busy: boolean): number {
  return busy ? IQD_SYNC_ACTIVE_POLL_INTERVAL_MS : IQD_SYNC_POLL_INTERVAL_MS;
}

/** 取（必要时建）某 client 的连接表。 */
function pollTable(client: QueryClient): Map<number, PollEntry> {
  let table = polls.get(client);
  if (!table) {
    table = new Map<number, PollEntry>();
    polls.set(client, table);
  }
  return table;
}

/**
 * 排下一轮轮询（会清掉旧的，保证一条链只有一根 timer）。
 *
 * <p>失焦（切标签页）时**跳过这一枪但不打断链条** —— 与 `refetchIntervalInBackground: false`
 * 同语义，回到前台后自然继续。
 */
function armPoll(
  client: QueryClient,
  connectionId: number,
  entry: PollEntry,
  delay: number,
): void {
  if (entry.timer) clearTimeout(entry.timer);
  entry.delay = delay;
  entry.timer = setTimeout(() => {
    entry.timer = null;
    if (!pollTable(client).has(connectionId)) return; // 已退订
    if (focusManager.isFocused()) {
      void client.refetchQueries(
        { queryKey: iqdKeys.syncStatus(connectionId), type: 'active' },
        { cancelRefetch: false },
      );
    }
    armPoll(client, connectionId, entry, delay);
  }, delay);
}

/**
 * 订阅共享轮询：**第一个**订阅者起链条，**最后一个**卸载时停。
 *
 * @returns 退订函数（供 `useEffect` cleanup）
 */
function subscribePoll(client: QueryClient, connectionId: number): () => void {
  const table = pollTable(client);
  let entry = table.get(connectionId);
  if (!entry) {
    entry = {
      refs: 0,
      timer: null,
      delay: delayFor(isIqdSyncBusy(client.getQueryData(iqdKeys.syncStatus(connectionId)))),
    };
    table.set(connectionId, entry);
    armPoll(client, connectionId, entry, entry.delay);
  }
  entry.refs += 1;

  return () => {
    const current = table.get(connectionId);
    if (!current) return;
    current.refs -= 1;
    if (current.refs <= 0) {
      if (current.timer) clearTimeout(current.timer);
      table.delete(connectionId);
    }
  };
}

/** 换档（进行中 ⇄ 空闲）：档位没变就不动，避免把已排好的那一枪推迟。 */
function rearmPoll(client: QueryClient, connectionId: number, busy: boolean): void {
  const entry = pollTable(client).get(connectionId);
  if (!entry) return;
  const delay = delayFor(busy);
  if (entry.delay === delay) return;
  armPoll(client, connectionId, entry, delay);
}

/**
 * 按连接订阅 catalog 编辑同步状态（同一连接、全应用共享一条轮询）。
 *
 * @param connectionId 连接 id；为 `null` 时不发请求（清空 status），
 *                     连接切换即换 query key（A-14 多连接隔离）。
 * @returns 最新状态 / 加载中 / 错误 / 手动刷新
 */
export function useSyncStatus(connectionId: number | null): UseSyncStatusResult {
  const queryClient = useQueryClient();
  const query = useQuery<IqdCatalogSyncStatus | null>({
    queryKey: iqdKeys.syncStatus(connectionId),
    queryFn: () => getIqdCatalogSyncStatus(connectionId as number),
    enabled: connectionId != null,
    // 轮询由 subscribePoll 的单条调度器驱动，**刻意不用** refetchInterval（见文件头）
    // 一个周期内的新订阅者复用缓存（去重的关键，见文件头）
    staleTime: IQD_SYNC_POLL_INTERVAL_MS,
    refetchOnWindowFocus: false,
    // 轮询失败只记录、下个周期再试（不重试、不刷屏）
    retry: false,
  });

  const status = connectionId == null ? null : (query.data ?? null);
  const error = query.error instanceof Error ? query.error.message : null;
  const busy = isIqdSyncBusy(status);

  // 订阅/退订共享轮询（第一个订阅者起、最后一个卸载时停）
  useEffect(() => {
    if (connectionId == null) return;
    return subscribePoll(queryClient, connectionId);
  }, [queryClient, connectionId]);

  // 作业开始/结束立刻换档，不等下一个周期
  useEffect(() => {
    if (connectionId == null) return;
    rearmPoll(queryClient, connectionId, busy);
  }, [queryClient, connectionId, busy]);

  const refresh = useCallback((): void => {
    if (connectionId == null) return;
    void queryClient.refetchQueries(
      { queryKey: iqdKeys.syncStatus(connectionId), type: 'active' },
      { cancelRefetch: true },
    );
  }, [queryClient, connectionId]);

  // 对象身份尽量稳定：消费端（PropertyPanel）把整个 `sync` 放进了 useCallback 依赖
  return useMemo(
    () => ({ status, loading: query.isFetching, error, refresh }),
    [status, query.isFetching, error, refresh],
  );
}
