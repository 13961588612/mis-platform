import { useCallback, useEffect, useState } from 'react';
import { fetchApps } from '@/lib/api/platform';
import { fetchBizCategories } from '@/lib/api/biz-category';

/** 平台级归属的展示文案（`appCode == null`）。 */
export const PLATFORM_LABEL = '平台';
/** 业务类型缺失时的占位（`bizType == null`）。 */
export const EMPTY_BIZ_TYPE_LABEL = '—';

/**
 * 门户消息 / 待办表格的两组「编码 → 展示名」映射器。
 *
 * <p>两 Tab 复用同一 hook，避免各自重复请求应用列表与业务分类。
 */
export interface PortalLookups {
  /** `appCode` → 展示名：`null` → 「平台」；命中应用列表取 `name`；取不到回退 `appCode` 本身。 */
  appNameOf: (appCode: string | null | undefined) => string;
  /** `bizType` → 展示名：`null` → 「—」；命中业务分类取 `name`；取不到回退 `bizType` 本身。 */
  bizTypeNameOf: (bizType: string | null | undefined) => string;
}

/** 把 `{code, name}` 列表折叠成 `code → name` 映射。 */
function toNameMap(items: ReadonlyArray<{ code: string; name: string }>): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of items) {
    map.set(item.code, item.name);
  }
  return map;
}

/**
 * 拉取并缓存「应用名」「业务分类名」两张映射，供门户两表复用。
 *
 * <p>两处请求均**静默降级**：拉取失败不影响列表渲染，`appNameOf`/`bizTypeNameOf`
 * 会自然回退到原始 code（应用）或「—」（业务类型）。
 *
 * @param tenantId 租户 id（业务分类按租户隔离）；空串时不发起业务分类请求。
 */
export function usePortalLookups(tenantId: string): PortalLookups {
  const [appNames, setAppNames] = useState<Map<string, string>>(() => new Map());
  const [bizNames, setBizNames] = useState<Map<string, string>>(() => new Map());

  useEffect(() => {
    let cancelled = false;
    fetchApps()
      .then((list) => {
        if (!cancelled) setAppNames(toNameMap(list));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    fetchBizCategories(tenantId)
      .then((list) => {
        if (!cancelled) setBizNames(toNameMap(list));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const appNameOf = useCallback(
    (appCode: string | null | undefined): string => {
      if (appCode == null) return PLATFORM_LABEL;
      return appNames.get(appCode) ?? appCode;
    },
    [appNames],
  );

  const bizTypeNameOf = useCallback(
    (bizType: string | null | undefined): string => {
      if (bizType == null) return EMPTY_BIZ_TYPE_LABEL;
      return bizNames.get(bizType) ?? bizType;
    },
    [bizNames],
  );

  return { appNameOf, bizTypeNameOf };
}
