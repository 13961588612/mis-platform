// @vitest-environment jsdom
/**
 * useSyncStatus.test.tsx — catalog 同步状态共享 Query（去重 + 两档节奏）。
 *
 * <p>为什么单独钉这个 hook：它的全部价值就在「**同一连接只有一条轮询**」与
 * 「**只在进行中拉快**」。一旦退回「每个订阅者各起一条定时器」，服务端调用量立刻回到
 * 改造前的 3~5 倍 —— 这种回归在页面上一眼看不出来，单测是最便宜的护栏。
 *
 * <p>覆盖：① 多订阅者去重；② 无连接不发请求；③ 空闲不按 5s 补拉（稳态 15s）；
 * ④ 进行中按 5s 补拉；⑤ 手动 `refresh()` 立刻拉一次（不受 staleTime 影响）；
 * ⑥ **错峰挂载**的第二个订阅者不会自己再补一枪（这条最容易随框架语义变化而退化）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as iqdApi from '@/lib/api/iqd';
import {
  IQD_SYNC_ACTIVE_POLL_INTERVAL_MS,
  IQD_SYNC_POLL_INTERVAL_MS,
  useSyncStatus,
} from './useSyncStatus';

vi.mock('@/lib/api/iqd', () => ({ getIqdCatalogSyncStatus: vi.fn() }));

const m = vi.mocked(iqdApi);

/** 探针：一个订阅者（点按钮 = 手动刷新）。 */
function Probe({ connectionId }: { connectionId: number | null }) {
  const { status, refresh } = useSyncStatus(connectionId);
  return (
    <button type="button" onClick={() => refresh()}>
      {status?.edit_status ?? '未加载'}
    </button>
  );
}

/** 每个用例一个干净缓存（`gcTime: Infinity` 防止假定时器下缓存被回收）。 */
function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
}

/** N 个订阅者（模拟画布 + 属性面板 + 流水线订阅同一连接）。 */
function Probes({
  connectionIds,
  client,
}: {
  connectionIds: Array<number | null>;
  client: QueryClient;
}) {
  return (
    <QueryClientProvider client={client}>
      {connectionIds.map((id, i) => (
        <Probe key={i} connectionId={id} />
      ))}
    </QueryClientProvider>
  );
}

/** 同时挂 N 个订阅者。 */
function renderProbes(connectionIds: Array<number | null>) {
  return render(<Probes connectionIds={connectionIds} client={makeClient()} />);
}

/** 冲掉微任务（假定时器下的挂载期请求）。 */
async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  m.getIqdCatalogSyncStatus.mockResolvedValue({ edit_status: 'SYNCED', build_status: 'success' });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('useSyncStatus 共享 Query（去重）', () => {
  it('同一连接 3 个订阅者：挂载只发 1 次，一个周期后共 2 次（而不是 6 次）', async () => {
    vi.useFakeTimers();
    renderProbes([7, 7, 7]);
    await flush();
    expect(m.getIqdCatalogSyncStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(IQD_SYNC_POLL_INTERVAL_MS);
    });
    expect(m.getIqdCatalogSyncStatus).toHaveBeenCalledTimes(2);
    expect(m.getIqdCatalogSyncStatus).toHaveBeenCalledWith(7);
  });

  it('connectionId 为 null 时不发请求', async () => {
    vi.useFakeTimers();
    renderProbes([null]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(IQD_SYNC_POLL_INTERVAL_MS * 2);
    });
    expect(m.getIqdCatalogSyncStatus).not.toHaveBeenCalled();
    expect(screen.getByRole('button').textContent).toBe('未加载');
  });

  it('错峰挂载的第二个订阅者不会再补一枪（同一连接只有一条轮询链）', async () => {
    vi.useFakeTimers();
    const client = makeClient();
    const view = render(<Probes connectionIds={[7]} client={client} />);
    await flush();
    expect(m.getIqdCatalogSyncStatus).toHaveBeenCalledTimes(1);

    // 5s 后再挂第二个订阅者（等价于「选中节点 / 打开 Cube 弹窗」）
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    view.rerender(<Probes connectionIds={[7, 7]} client={client} />);
    expect(m.getIqdCatalogSyncStatus).toHaveBeenCalledTimes(1); // 缓存仍新鲜，不补拉

    // 到 25s：只应发生「挂载时 1 次 + 15s 周期 1 次」；
    // 若退化成 observer 级定时器，第二个订阅者会在 20s 自己再补一枪（= 3 次）
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(m.getIqdCatalogSyncStatus).toHaveBeenCalledTimes(2);
  });
});

describe('useSyncStatus 两档节奏', () => {
  it('空闲：5s 内不补拉（稳态仍是一个周期 15s）', async () => {
    vi.useFakeTimers();
    renderProbes([7]);
    await flush();
    expect(m.getIqdCatalogSyncStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(IQD_SYNC_ACTIVE_POLL_INTERVAL_MS);
    });
    expect(m.getIqdCatalogSyncStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(IQD_SYNC_POLL_INTERVAL_MS);
    });
    expect(m.getIqdCatalogSyncStatus).toHaveBeenCalledTimes(2);
  });

  it('进行中（build_status=running）：5s 就补拉一枪', async () => {
    m.getIqdCatalogSyncStatus.mockResolvedValue({
      edit_status: 'SYNCING',
      build_status: 'running',
    });
    vi.useFakeTimers();
    renderProbes([7]);
    await flush();
    expect(m.getIqdCatalogSyncStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(IQD_SYNC_ACTIVE_POLL_INTERVAL_MS);
    });
    expect(m.getIqdCatalogSyncStatus).toHaveBeenCalledTimes(2);
  });

  it('手动 refresh 立刻拉一次（不受 staleTime 影响）', async () => {
    vi.useFakeTimers();
    renderProbes([7]);
    await flush();
    expect(m.getIqdCatalogSyncStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      screen.getByRole('button').click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(m.getIqdCatalogSyncStatus).toHaveBeenCalledTimes(2);
  });
});
