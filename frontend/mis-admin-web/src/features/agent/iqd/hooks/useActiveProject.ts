/**
 * useActiveProject.ts —— 「当前项目」共享读取 hook（2026-09-30）。
 *
 * <p>问数各页（可视化工作台 / 语义模型 / 范围与权限 / 知识与规则 / 试问）都以「项目」
 * （= wren context）为上下文。本 hook 把「当前项目」收敛到 store 的单一槽位
 * （{@link useModelingStore}.connectionId），切一处全问数域跟随，且跨页保持。
 *
 * <p>默认值：store 为空时自动选「默认」项目（`name='default'` 优先，否则最小 id），
 * 保证首次进入任意页都不空白。
 *
 * <p>与组件分离（`.ts` 不含 JSX）以满足 React Fast Refresh 的 only-export-components。
 */
import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listConnections } from '../api/iqd-modeling';
import { iqdKeys } from '../queries/iqd-keys';
import { useModelingStore } from '../store/modeling-store';
import type { Connection } from '../types/modeling';

/**
 * 读取「当前项目 id（number）」并保证已选中默认项目。
 *
 * @returns 当前项目数字 id（store 为空且尚无连接时为 null）
 */
/**
 * 过滤出「可切换 / 可问数」的项目（仅 enabled）。
 *
 * <p>与运行时裁定口径对齐：范围裁定读的 /get-connections **只返回 enabled=1** 的连接，
 * 停用连接（如 seed 的 900001）虽仍在连接管理页可见，但**不参与问数**。切换器若把停用
 * 连接也列出来并默认选中（旧的「name=default 优先，否则最小 id」规则会先命中 900001），
 * 就会出现「界面显示 900001、实际问数跑 test」的错位。故此处统一收敛为 enabled 集。
 *
 * <p>`enabled` 缺省视为可用（兼容未回传该字段的历史载荷 / 测试替身）；显式 `false` 才排除。
 */
export function selectableConnections(list: Connection[]): Connection[] {
  return list.filter((c) => c.id != null && c.enabled !== false);
}

export function useActiveProjectId(): number | null {
  const connectionId = useModelingStore((s) => s.connectionId);
  const setConnectionId = useModelingStore((s) => s.setConnectionId);

  const { data } = useQuery({
    queryKey: iqdKeys.connections(),
    queryFn: listConnections,
    staleTime: 30_000,
  });
  const connections = useMemo(() => selectableConnections(data ?? []), [data]);

  useEffect(() => {
    if (connectionId != null || connections.length === 0) return;
    const withId = connections.filter((c) => c.id != null);
    const preferred =
      withId.find((c) => (c.name ?? '').toLowerCase() === 'default') ?? withId[0];
    if (preferred?.id != null) {
      setConnectionId(String(preferred.id));
    }
  }, [connectionId, connections, setConnectionId]);

  useEffect(() => {
    if (connectionId == null || connections.length === 0) return;
    const exists = connections.some((c) => String(c.id) === connectionId);
    if (!exists) {
      const withId = connections.filter((c) => c.id != null);
      const preferred =
        withId.find((c) => (c.name ?? '').toLowerCase() === 'default') ?? withId[0];
      setConnectionId(preferred?.id != null ? String(preferred.id) : null);
    }
  }, [connectionId, connections, setConnectionId]);

  if (connectionId == null) return null;
  const parsed = Number(connectionId);
  return Number.isFinite(parsed) ? parsed : null;
}
