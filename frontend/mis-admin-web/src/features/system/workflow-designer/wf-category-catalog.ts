/**
 * 流程分类的「候选项来源」（对标 `form-catalog.ts` 的 `useFormCatalog`）。
 *
 * <p>编排弹窗、属性面板、定义列表筛选都需要「全部流程分类」的扁平清单。
 * 这里统一拉一次 `GET /workflow/categories`（扁平列表，无 children）并缓存到 state。
 *
 * <p>⚠️ 后端不就绪时的降级：请求失败直接抛错给调用方（由调用方决定是否给出提示），
 * 不在这里吞成空数组——否则下拉会是空白且没有任何「接口坏了」的信号。
 */
import { useEffect, useState } from 'react';
import { fetchWfCategories, type WfCategoryItem } from '@/lib/api/wf-category';

export interface WfCategoryCatalog {
  /** 扁平分类清单（按 sortOrder → name 字典序）。 */
  options: WfCategoryItem[];
  /** 首次加载中。 */
  loading: boolean;
  /** 最近一次加载的错误（null = 正常）。非空时调用方应给出可见提示。 */
  error: string | null;
}

function sortCategories(list: WfCategoryItem[]): WfCategoryItem[] {
  return [...list].sort((a, b) => {
    const s = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    if (s !== 0) return s;
    return a.name.localeCompare(b.name, 'zh-Hans-CN');
  });
}

export function useWfCategories(tenantId = '1'): WfCategoryCatalog {
  const [options, setOptions] = useState<WfCategoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchWfCategories(tenantId)
      .then((items) => {
        if (!alive) return;
        setOptions(sortCategories(items));
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setOptions([]);
        setError(e instanceof Error ? e.message : '获取流程分类失败');
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
