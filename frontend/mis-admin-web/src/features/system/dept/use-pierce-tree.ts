import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { fetchDeptPierce } from '@/lib/api/depts';
import type { DeptPierceNode } from '@/types/api';
import { isOrgInChain } from './dept-tree-types';

/** D9 防循环提示文案。 */
export const PIERCE_CYCLE_WARNING = '该组织已在穿透路径中，无法继续下钻（防循环）';

/** usePierceTree 返回值。 */
export interface UsePierceTreeResult {
  /** 穿透 forest 缓存（按来源组织 id 去重，原始 VO；渲染时再按当前路径归一化）。 */
  piercedCache: Record<string, DeptPierceNode[]>;
  /** 该组织的穿透数据是否正在加载。 */
  isPierceLoading: (orgId: string) => boolean;
  /**
   * 懒加载某组织的穿透 forest。
   *
   * @param orgId    目标组织 id（链接组织）
   * @param orgChain 触发节点的祖先组织链（用于防循环）
   * @returns 是否可以继续展开（false = 被防循环拦截或加载失败）
   */
  loadPierceOrg: (orgId: string, orgChain: string[]) => Promise<boolean>;
  /** 清空穿透缓存与加载态（切换组织 / 数据变更时调用，防串组织）。 */
  resetPierce: () => void;
  /** 某行是否展开（统一驱动本地子部门与穿透只读部门，D6）。 */
  isExpanded: (rowId: string) => boolean;
  /** 切换某行展开/收起。 */
  toggleExpand: (rowId: string) => void;
  /** 收起某行（删除部门后清理残留展开态）。 */
  collapse: (rowId: string) => void;
  /** 全部收起。 */
  resetExpanded: () => void;
}

/**
 * 部门树 inline 穿透状态 hook（D2 / D6 / D9）。
 *
 * <p>职责：
 * <ul>
 *   <li>按 `orgId` 缓存 `fetchDeptPierce` 返回的全深度 forest，每个组织仅请求一次（含并发去重）；</li>
 *   <li>展开链接组织前做祖先链校验，命中则 toast 拦截，避免 A→B→A 无限下钻；</li>
 *   <li>统一维护 `expandedIds`，使本地子部门与穿透只读部门的展开语义一致。</li>
 * </ul>
 */
export function usePierceTree(): UsePierceTreeResult {
  const [piercedCache, setPiercedCache] = useState<Record<string, DeptPierceNode[]>>({});
  const [loadingOrgIds, setLoadingOrgIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  /** 缓存镜像：供回调内同步读取，避免闭包读到旧 state 造成重复请求。 */
  const cacheRef = useRef<Record<string, DeptPierceNode[]>>({});
  /** 进行中的请求：同一组织并发点击只发一次请求。 */
  const inflightRef = useRef<Map<string, Promise<boolean>>>(new Map());

  const isPierceLoading = useCallback(
    (orgId: string): boolean => loadingOrgIds.has(orgId),
    [loadingOrgIds],
  );

  const loadPierceOrg = useCallback(async (orgId: string, orgChain: string[]): Promise<boolean> => {
    if (!orgId) return false;
    // D9：目标组织已在「根 → 当前节点」的组织链中 → 拦截
    if (isOrgInChain(orgChain, orgId)) {
      toast.warning(PIERCE_CYCLE_WARNING);
      return false;
    }
    // D2：已缓存（含空 forest）直接复用，不再请求
    if (cacheRef.current[orgId]) return true;
    const inflight = inflightRef.current.get(orgId);
    if (inflight) return inflight;

    const task: Promise<boolean> = (async () => {
      setLoadingOrgIds((prev) => {
        const next = new Set(prev);
        next.add(orgId);
        return next;
      });
      try {
        const forest = await fetchDeptPierce(orgId);
        cacheRef.current = { ...cacheRef.current, [orgId]: forest ?? [] };
        setPiercedCache(cacheRef.current);
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '加载组织穿透失败');
        return false;
      } finally {
        inflightRef.current.delete(orgId);
        setLoadingOrgIds((prev) => {
          const next = new Set(prev);
          next.delete(orgId);
          return next;
        });
      }
    })();
    inflightRef.current.set(orgId, task);
    return task;
  }, []);

  const resetPierce = useCallback(() => {
    cacheRef.current = {};
    inflightRef.current.clear();
    setPiercedCache({});
    setLoadingOrgIds(new Set());
  }, []);

  const isExpanded = useCallback((rowId: string): boolean => expandedIds.has(rowId), [expandedIds]);

  const toggleExpand = useCallback((rowId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }, []);

  const collapse = useCallback((rowId: string) => {
    setExpandedIds((prev) => {
      if (!prev.has(rowId)) return prev;
      const next = new Set(prev);
      next.delete(rowId);
      return next;
    });
  }, []);

  const resetExpanded = useCallback(() => {
    setExpandedIds(new Set());
  }, []);

  return {
    piercedCache,
    isPierceLoading,
    loadPierceOrg,
    resetPierce,
    isExpanded,
    toggleExpand,
    collapse,
    resetExpanded,
  };
}
