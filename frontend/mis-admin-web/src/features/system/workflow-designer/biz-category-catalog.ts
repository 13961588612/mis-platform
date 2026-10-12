/**
 * 业务分类的「候选项来源」（对标 `form-catalog.ts` 的 `useFormCatalog`）。
 *
 * <p>编排弹窗、属性面板、定义列表筛选都需要「全部业务分类」的扁平清单。
 * 这里统一拉一次 `GET /biz-categories`（扁平列表，无 children）并缓存到 state。
 *
 * <p>⚠️ 业务分类（`biz_category`）是租户通用邻接树，取代原 `wf_category` / `form_category`，
 * 与 APP 无关。后端不就绪时的降级：请求失败直接抛错给调用方（由调用方决定是否给出提示），
 * 不在这里吞成空数组——否则下拉会是空白且没有任何「接口坏了」的信号。
 */
import { useEffect, useState } from 'react';
import { fetchBizCategories, fetchBizCategoryTree, type BizCategoryItem } from '@/lib/api/biz-category';

export interface BizCategoryCatalog {
  /** 扁平分类清单（按 sortOrder → name 字典序）。 */
  options: BizCategoryItem[];
  /** 首次加载中。 */
  loading: boolean;
  /** 最近一次加载的错误（null = 正常）。非空时调用方应给出可见提示。 */
  error: string | null;
}

export interface BizCategoryTreeCatalog {
  /** 嵌套分类树（`children` 已填充），供下拉树等按层级渲染。 */
  tree: BizCategoryItem[];
  /** 首次加载中。 */
  loading: boolean;
  /** 最近一次加载的错误（null = 正常）。非空时调用方应给出可见提示。 */
  error: string | null;
}

function sortCategories(list: BizCategoryItem[]): BizCategoryItem[] {
  return [...list].sort((a, b) => {
    const s = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    if (s !== 0) return s;
    return a.name.localeCompare(b.name, 'zh-Hans-CN');
  });
}

export function useBizCategories(tenantId = '1'): BizCategoryCatalog {
  const [options, setOptions] = useState<BizCategoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchBizCategories(tenantId)
      .then((items) => {
        if (!alive) return;
        setOptions(sortCategories(items));
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setOptions([]);
        setError(e instanceof Error ? e.message : '获取业务分类失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [tenantId]);

  return { options, loading, error };
}

/**
 * 业务分类**树**来源（对标 {@link useBizCategories} 的 tree 版）。
 *
 * <p>拉一次 `GET /biz-categories/tree`（嵌套 children）并缓存到 state，供「分类下拉树」
 * （单 / 多选）按父子层级渲染。降级口径与 {@link useBizCategories} 一致：请求失败时
 * 置空树并把错误抛给调用方展示，不静默吞掉。
 */
export function useBizCategoryTree(tenantId = '1'): BizCategoryTreeCatalog {
  const [tree, setTree] = useState<BizCategoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchBizCategoryTree(tenantId)
      .then((items) => {
        if (!alive) return;
        setTree(items);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setTree([]);
        setError(e instanceof Error ? e.message : '获取业务分类失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [tenantId]);

  return { tree, loading, error };
}
