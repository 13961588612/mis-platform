/**
 * iqd-catalog-page.tsx — 问数清单管理（W2，路径 /ai/iqd/catalog）。
 *
 * <p>覆盖 mis-iqd 清单（iqd_catalog_item）：连接配置 → 清单树（model/column/
 * relationship）→ 纳入问数范围勾选。数据源为 BFF 代理 `/api/v1/iqd/catalog**`
 * （权限码 iqd:catalog:view / iqd:scope:save）。
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Save, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { Badge } from '@/components/ui/badge';
import {
  getIqdConfig,
  listIqdCatalog,
  saveIqdConfig,
  setIqdCatalogInScope,
  type IqdCatalogItem,
  type IqdConnectionConfig,
} from '@/lib/api/iqd';

const KIND_LABEL: Record<string, string> = {
  table: '表',
  column: '字段',
  model: '模型',
  relationship: '关系',
  cube: '立方体',
  measure: '度量',
  metric: '指标',
  dimension: '维度',
  view: '视图',
};

/** 清单按类型分组的展示顺序（cube/measure 为 P0-3 补全新增）。 */
const KIND_ORDER: string[] = [
  'table',
  'model',
  'column',
  'relationship',
  'cube',
  'measure',
  'metric',
  'dimension',
  'view',
];

export const IQD_CATALOG_PAGE_PATH = '/iqd/catalog';

export function IqdCatalogPage() {
  const [config, setConfig] = useState<IqdConnectionConfig | null>(null);
  const [items, setItems] = useState<IqdCatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const connectionId = useMemo(() => config?.id ?? null, [config]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cfg = await getIqdConfig();
      setConfig(cfg);
      if (cfg.id != null) {
        setItems(await listIqdCatalog(cfg.id));
      } else {
        setItems([]);
      }
    } catch (e) {
      setItems([]);
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return items;
    return items.filter(
      (it) =>
        it.item_key.toLowerCase().includes(kw) ||
        (it.display_name ?? '').toLowerCase().includes(kw),
    );
  }, [items, keyword]);

  // 按类型分组（树形分组；cube/measure 等新增类型自然落入分组头）。保留 KIND_ORDER 顺序。
  const grouped = useMemo(() => {
    const map = new Map<string, typeof items>();
    for (const it of filtered) {
      const arr = map.get(it.kind) ?? [];
      arr.push(it);
      map.set(it.kind, arr);
    }
    return [...map.keys()]
      .sort((a, b) => {
        const ia = KIND_ORDER.indexOf(a);
        const ib = KIND_ORDER.indexOf(b);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      })
      .map((kind) => ({ kind, rows: map.get(kind) ?? [] }));
  }, [filtered]);

  const toggleSelect = useCallback((itemKey: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemKey)) next.delete(itemKey);
      else next.add(itemKey);
      return next;
    });
  }, []);

  const applyScope = useCallback(
    async (inScope: boolean) => {
      if (connectionId == null || selected.size === 0) return;
      setSaving(true);
      setError(null);
      try {
        await setIqdCatalogInScope(connectionId, inScope, [...selected]);
        setSelected(new Set());
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : '更新范围失败');
      } finally {
        setSaving(false);
      }
    },
    [connectionId, selected, load],
  );

  const saveConnection = useCallback(async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await saveIqdConfig({
        name: config.name || 'default',
        base_url: config.base_url,
        auth_type: config.auth_type,
        project_id: config.project_id,
        default_connector: config.default_connector,
        timeout_seconds: config.timeout_seconds ?? 60,
        language: config.language || 'zh-CN',
        enabled: config.enabled ?? true,
      });
      setConfig(saved);
      if (saved.id != null) {
        setItems(await listIqdCatalog(saved.id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存连接失败');
    } finally {
      setSaving(false);
    }
  }, [config]);

  const inScopeCount = useMemo(() => items.filter((it) => it.in_scope).length, [items]);
  const selectedCount = selected.size;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="问数清单"
        description="管理 WrenAI 语义模型清单，勾选纳入问数范围（治理层）。"
        breadcrumbs={buildAppBreadcrumbs({ app: 'agent', title: '问数清单' })}
        actions={
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            刷新
          </Button>
        }
      />

      {/* 连接配置快捷区 */}
      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3">
        <div className="min-w-[16rem] flex-1">
          <label className="mb-[0.4rem] block text-xs text-muted-foreground">WrenAI 地址</label>
          <Input
            placeholder="http://host:port"
            value={config?.base_url ?? ''}
            onChange={(e) => setConfig((c) => (c ? { ...c, base_url: e.target.value } : c))}
          />
        </div>
        <div className="w-44">
          <label className="mb-[0.4rem] block text-xs text-muted-foreground">连接状态</label>
          <Badge variant={config?.status === 'active' ? 'default' : 'secondary'}>
            {config?.status ?? '未配置'}
          </Badge>
        </div>
        <Button size="sm" variant="secondary" onClick={() => void saveConnection()} disabled={saving}>
          <Save className="h-4 w-4" />
          保存连接
        </Button>
      </div>

      {error ? (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {/* 筛选 + 范围操作区 */}
      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3">
        <div className="min-w-[14rem] flex-1">
          <label className="mb-[0.4rem] block text-xs text-muted-foreground">关键字</label>
          <Input
            placeholder="搜索 item_key / 展示名"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 pb-1">
          <span className="text-xs text-muted-foreground">
            共 {items.length} 项，已纳入 {inScopeCount} 项
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={selectedCount === 0 || saving || connectionId == null}
            onClick={() => void applyScope(true)}
          >
            <ShieldCheck className="h-4 w-4" />
            纳入范围（{selectedCount}）
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={selectedCount === 0 || saving || connectionId == null}
            onClick={() => void applyScope(false)}
          >
            移出范围
          </Button>
        </div>
      </div>

      {/* 清单表格 */}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-table-surface">
        <table className="w-full border-separate border-spacing-0 bg-table-surface text-left text-sm">
          <thead className="border-b-2 border-foreground/20 bg-table-header text-muted-foreground">
            <tr>
              <th className="w-10 px-3 py-2" />
              <th className="px-3 py-2 font-bold">类型</th>
              <th className="px-3 py-2 font-bold">item_key</th>
              <th className="px-3 py-2 font-bold">展示名</th>
              <th className="px-3 py-2 font-bold">敏感等级</th>
              <th className="px-3 py-2 font-bold">脱敏规则</th>
              <th className="px-3 py-2 font-bold">纳入范围</th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                  加载中…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                  {items.length === 0 ? '清单为空（保存连接后自动同步 MDL）' : '没有匹配项'}
                </td>
              </tr>
            ) : (
              grouped.map((g) => (
                <Fragment key={g.kind}>
                  <tr>
                    <td
                      colSpan={7}
                      className="border-b border-border/50 bg-muted/40 px-3 py-1.5 text-xs font-semibold text-muted-foreground"
                    >
                      {KIND_LABEL[g.kind] ?? g.kind}（{g.rows.length}）
                    </td>
                  </tr>
                  {g.rows.map((it) => (
                <tr
                  key={it.item_key}
                  className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe hover:bg-table-hover"
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={selected.has(it.item_key)}
                      onChange={() => toggleSelect(it.item_key)}
                    />
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <Badge variant="secondary">{KIND_LABEL[it.kind] ?? it.kind}</Badge>
                  </td>
                  <td className="max-w-[24rem] truncate px-3 py-2 font-mono text-xs" title={it.item_key}>
                    {it.item_key}
                  </td>
                  <td className="truncate px-3 py-2" title={it.display_name ?? ''}>
                    {it.display_name || '—'}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {it.sensitive_level === 'high' ? (
                      <span className="text-destructive">高</span>
                    ) : it.sensitive_level === 'low' ? (
                      <span className="text-warning">低</span>
                    ) : (
                      <span className="text-muted-foreground">无</span>
                    )}
                  </td>
                  <td className="truncate px-3 py-2 font-mono text-xs text-muted-foreground">
                    {it.mask_rule || '—'}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {it.in_scope ? (
                      <span className="text-success">已纳入</span>
                    ) : (
                      <span className="text-muted-foreground">未纳入</span>
                    )}
                  </td>
                </tr>
                  ))}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default IqdCatalogPage;
