/**
 * iqd-catalog-page.tsx — 问数清单管理（W2，路径 /iqd/catalog）。
 *
 * <p>覆盖 mis-iqd 清单（iqd_catalog_item）：从连接配置选连接名 → 清单（物理表 / 模型分 Tab）→
 * 纳入问数范围勾选。字段不进主表，由行内「字段纳入」弹窗按父节点管理（弹窗内可编辑
 * 字段业务描述）。表 / 模型行铅笔可编 display_name + description。
 * WrenAI 基址在「连接配置」页维护，本页不手填。
 * 数据源为 BFF 代理 `/api/v1/iqd/catalog**`（权限码 iqd:catalog:view / iqd:scope:save）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Columns3, Pencil, RefreshCw, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  listIqdCatalog,
  setIqdCatalogInScope,
  updateIqdCatalogNode,
  getIqdCatalogSyncStatus,
  type IqdCatalogItem,
  type IqdDependents,
} from '@/lib/api/iqd';
import { CatalogSyncStatusBar } from './components/CatalogSyncStatusBar';
import { SelfHealPanel } from './components/SelfHealPanel';
import { useCatalogNodes } from './hooks/useCatalogNodes';
import { createModelFromTable, errorCode, errorData, listConnections } from './api/iqd-modeling';
import { iqdKeys } from './queries/iqd-keys';
import { ProjectSwitcher } from './components/shared/ProjectSwitcher';
import { useActiveProjectId } from './hooks/useActiveProject';
import { IQD_CONFIG_PAGE_PATH } from './iqd-config-page';

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

/** 主列表 Tab（字段不进主表）。 */
type CatalogTab = 'table' | 'model' | 'other';

const CATALOG_TABS: Array<{ key: CatalogTab; label: string }> = [
  { key: 'table', label: '物理表' },
  { key: 'model', label: '模型' },
  { key: 'other', label: '关系 / Cube 等' },
];

/** 「其它」Tab 收录的 kind（不含 table/model/column）。 */
const OTHER_KINDS = new Set([
  'relationship',
  'cube',
  'measure',
  'metric',
  'dimension',
  'view',
]);

/**
 * 某表/模型下的字段：表 → parent=表 key；模型 → 计算列挂模型 + 物理列挂同名表。
 */
function columnsOfHost(all: IqdCatalogItem[], host: IqdCatalogItem): IqdCatalogItem[] {
  if (host.kind === 'table') {
    return all.filter((it) => it.kind === 'column' && it.parent_key === host.item_key);
  }
  if (host.kind !== 'model') {
    return [];
  }
  const tableName =
    host.display_name?.trim() ||
    host.item_key.replace(/^mdl:model:/i, '').split('.').pop() ||
    '';
  const nameLower = tableName.toLowerCase();
  return all.filter((it) => {
    if (it.kind !== 'column') return false;
    const parent = it.parent_key ?? '';
    if (parent === host.item_key) return true;
    if (!nameLower) return false;
    const parentLower = parent.toLowerCase();
    return parentLower === nameLower || parentLower.endsWith(`.${nameLower}`);
  });
}

export const IQD_CATALOG_PAGE_PATH = '/iqd/catalog';

export function IqdCatalogPage() {
  const [items, setItems] = useState<IqdCatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<CatalogTab>('table');
  /** 当前项目（统一取自共享 store，与其他问数页一致）。 */
  const connectionId = useActiveProjectId();
  /** 字段纳入弹窗：当前表/模型宿主。 */
  const [fieldHost, setFieldHost] = useState<IqdCatalogItem | null>(null);
  /** T02b-4：MR-S2「从物理表生成模型」对话框开关。 */
  const [fromTableOpen, setFromTableOpen] = useState(false);

  const connectionsQuery = useQuery({
    queryKey: iqdKeys.connections(),
    queryFn: listConnections,
  });
  const connections = useMemo(
    () => (connectionsQuery.data ?? []).filter((c) => c.id != null),
    [connectionsQuery.data],
  );
  const activeConnection = useMemo(
    () => connections.find((c) => c.id === connectionId) ?? null,
    [connections, connectionId],
  );

  const load = useCallback(async () => {
    if (connectionId == null) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setItems(await listIqdCatalog(connectionId));
    } catch (e) {
      setItems([]);
      setError(e instanceof Error ? e.message : '加载清单失败');
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    void load();
  }, [load]);

  // 项目变更（跨页也会变）→ 清空本页选中与弹窗実体，避免跨项目串扰
  useEffect(() => {
    setSelected(new Set());
    setFieldHost(null);
  }, [connectionId]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return items;
    return items.filter(
      (it) =>
        it.item_key.toLowerCase().includes(kw) ||
        (it.display_name ?? '').toLowerCase().includes(kw),
    );
  }, [items, keyword]);

  /** 当前 Tab 主列表行（永不含 column）。 */
  const tabRows = useMemo(() => {
    return filtered.filter((it) => {
      if (it.kind === 'column') return false;
      if (tab === 'table') return it.kind === 'table';
      if (tab === 'model') return it.kind === 'model';
      return OTHER_KINDS.has(it.kind);
    });
  }, [filtered, tab]);

  const tabCounts = useMemo(() => {
    const base = filtered.filter((it) => it.kind !== 'column');
    return {
      table: base.filter((it) => it.kind === 'table').length,
      model: base.filter((it) => it.kind === 'model').length,
      other: base.filter((it) => OTHER_KINDS.has(it.kind)).length,
    };
  }, [filtered]);

  const switchTab = useCallback((next: CatalogTab) => {
    setTab(next);
    setSelected(new Set());
  }, []);

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

  const inScopeHostCount = useMemo(
    () => items.filter((it) => it.in_scope && (it.kind === 'table' || it.kind === 'model')).length,
    [items],
  );
  const selectedCount = selected.size;

  // ===================== 二期：语义模型编辑（P0-1~P0-12）=====================
  /** 支持 expression 编辑的 catalog 类型（其余类型仅展示 display_name / description）。 */
  const EXPRESSION_KINDS = useMemo(
    () => new Set(['model', 'view', 'relationship', 'cube', 'measure', 'metric', 'dimension']),
    [],
  );
  /**
   * 写回闸门：与后端 `updateCatalogNode` 一致，仅看连接 `mdl_writeback_enabled`。
   *
   * <p>{@code iqd_catalog_item.editable} 一期恒 0 且从未在 upsert 路径置 1，若再 AND
   * {@code it.editable} 会导致铅笔永远不出现。节点级 editable 留作后续灰度，本页不再挡描述写入。
   */
  const canEditItem = useCallback(
    (_it: IqdCatalogItem) => Boolean(activeConnection?.mdl_writeback_enabled),
    [activeConnection?.mdl_writeback_enabled],
  );

  const [editing, setEditing] = useState<IqdCatalogItem | null>(null);
  const [editForm, setEditForm] = useState<{ display_name: string; description: string; expression: string }>({
    display_name: '',
    description: '',
    expression: '',
  });
  const [editBaseRevision, setEditBaseRevision] = useState<number>(0);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  /** 422 引用阻断：直接引用方列表（禁用确认）。 */
  const [editDependents, setEditDependents] = useState<IqdDependents | null>(null);
  /** 409 乐观并发冲突：被服务端告知的当前版本（引导重读）。 */
  const [editConflictRevision, setEditConflictRevision] = useState<number | null>(null);

  const openEdit = useCallback(
    async (it: IqdCatalogItem) => {
      if (connectionId == null || !canEditItem(it)) return;
      setEditing(it);
      setEditForm({
        display_name: it.display_name ?? '',
        description: it.description ?? '',
        expression: it.expression ?? '',
      });
      setEditError(null);
      setEditDependents(null);
      setEditConflictRevision(null);
      // base_revision = 连接当前 current_edit_revision（mis-iqd 与之比对乐观并发）
      try {
        const status = await getIqdCatalogSyncStatus(connectionId);
        setEditBaseRevision(status?.current_edit_revision ?? 0);
      } catch {
        setEditBaseRevision(0);
      }
    },
    [connectionId, canEditItem],
  );

  const rereadVersion = useCallback(async () => {
    if (connectionId == null) return;
    try {
      const status = await getIqdCatalogSyncStatus(connectionId);
      setEditBaseRevision(status?.current_edit_revision ?? 0);
      setEditConflictRevision(null);
      setEditError(null);
    } catch {
      /* 忽略：重读失败不影响用户继续编辑 */
    }
  }, [connectionId]);

  const submitEdit = useCallback(async () => {
    if (editing == null || connectionId == null) return;
    setEditSaving(true);
    setEditError(null);
    const payload = {
      item_key: editing.item_key,
      kind: editing.kind,
      patch: {
        display_name: editForm.display_name || null,
        description: editForm.description || null,
        expression: editForm.expression || null,
      },
      base_revision: editBaseRevision,
      idempotency_key: crypto.randomUUID(),
    };
    try {
      await updateIqdCatalogNode(connectionId, payload);
      // 乐观 UI：本地即时反映编辑结果（display_name/description/expression + source=platform_edit）
      const nextSource = 'platform_edit';
      setItems((prev) =>
        prev.map((x) =>
          x.item_key === editing.item_key
            ? {
                ...x,
                display_name: editForm.display_name || null,
                description: editForm.description || null,
                expression: editForm.expression || null,
                source: nextSource,
              }
            : x,
        ),
      );
      setEditing(null);
    } catch (e) {
      const err = e as Error & {
        code?: number;
        data?: { current_edit_revision?: number; dependents?: IqdDependents };
      };
      if (err.code === 40900) {
        // 乐观并发冲突：服务端返回最新版本，引导「重读版本」后重试（U2）
        setEditConflictRevision(err.data?.current_edit_revision ?? null);
        setEditError(`版本已变更（当前 ${err.data?.current_edit_revision ?? '?'}），请点「重读版本」后重试`);
      } else if (err.code === 42200) {
        // 引用阻断：列出直接引用方并禁用确认（P1-1 / U1）
        setEditDependents(err.data?.dependents ?? []);
        setEditError('该节点被直接引用，禁止改名/删除');
      } else {
        setEditError(err.message || '编辑 catalog 节点失败');
      }
    } finally {
      setEditSaving(false);
    }
  }, [editing, connectionId, editForm, editBaseRevision]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="语义模型"
        description="管理 WrenAI 语义模型清单，勾选纳入问数范围；表/模型行铅笔与「字段纳入」内可编业务描述（需开启 MDL 写回）。"
        breadcrumbs={buildAppBreadcrumbs({ app: 'agent', title: '语义模型' })}
        actions={
          <div className="flex items-center gap-2">
            {/* T02b-4 / MR-S2：从物理表生成模型（M-G1 路径；入口见本文件末尾 FromTableModelDialog） */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setFromTableOpen(true)}
              disabled={connectionId == null}
            >
              <Sparkles className="h-4 w-4" />
              从物理表生成模型
            </Button>
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              刷新
            </Button>
          </div>
        }
      />

      {/* 顶栏：连接 + 编辑同步 + 运维自愈（单行） */}
      <div className="mb-3 rounded-lg border bg-card p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground">项目</span>
            <ProjectSwitcher className="h-8 w-[13rem]" />
            {activeConnection ? (
              <Badge variant={activeConnection.status === 'active' ? 'default' : 'secondary'}>
                {activeConnection.status ?? '未知'}
              </Badge>
            ) : null}
            <Button size="sm" variant="ghost" className="h-8 px-2" asChild>
              <Link to={IQD_CONFIG_PAGE_PATH}>配置</Link>
            </Button>
          </div>

          <div className="hidden h-6 w-px shrink-0 bg-border sm:block" aria-hidden />

          <CatalogSyncStatusBar connectionId={connectionId} compact />

          <div className="hidden h-6 w-px shrink-0 bg-border lg:block" aria-hidden />

          <SelfHealPanel connectionId={connectionId} compact />
        </div>
      </div>

      {connections.length === 0 && !connectionsQuery.isLoading ? (
        <div className="mb-3 rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          尚未创建问数连接。请先在{' '}
          <Link className="text-primary underline-offset-4 hover:underline" to={IQD_CONFIG_PAGE_PATH}>
            连接配置
          </Link>{' '}
          中创建连接（含 WrenAI 地址），再回到本页选择连接名管理语义模型清单。
        </div>
      ) : null}
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
            本页 {tabRows.length} 项 · 表/模型已纳入 {inScopeHostCount}
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

      <div className="mb-2 flex gap-1 border-b">
        {CATALOG_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={cn(
              'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              tab === t.key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            onClick={() => switchTab(t.key)}
          >
            {t.label}（{tabCounts[t.key]}）
          </button>
        ))}
      </div>

      {/* 清单表格（按 Tab：物理表 / 模型 / 其它；不含字段） */}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-table-surface">
        <table className="w-full border-separate border-spacing-0 bg-table-surface text-left text-sm">
          <thead className="sticky top-0 z-10 border-b-2 border-foreground/20 bg-table-header text-muted-foreground">
            <tr>
              <th className="w-10 px-3 py-2" />
              <th className="px-3 py-2 font-bold">类型</th>
              <th className="px-3 py-2 font-bold">item_key</th>
              <th className="px-3 py-2 font-bold">展示名</th>
              <th className="px-3 py-2 font-bold">敏感等级</th>
              <th className="px-3 py-2 font-bold">脱敏规则</th>
              <th className="px-3 py-2 font-bold">纳入范围</th>
              <th className="w-40 px-3 py-2 font-bold">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                  加载中…
                </td>
              </tr>
            ) : tabRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                  {items.length === 0
                    ? '清单为空（保存连接后自动同步 MDL）'
                    : '当前 Tab 没有匹配项'}
                </td>
              </tr>
            ) : (
              tabRows.map((it) => {
                const hostFields =
                  it.kind === 'table' || it.kind === 'model' ? columnsOfHost(items, it) : [];
                const fieldInScope = hostFields.filter((c) => c.in_scope).length;
                return (
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
                    <td
                      className="max-w-[24rem] truncate px-3 py-2 font-mono text-xs"
                      title={it.item_key}
                    >
                      {it.item_key}
                    </td>
                    <td className="truncate px-3 py-2" title={it.display_name ?? ''}>
                      <div className="flex items-center gap-2">
                        <span className="truncate">{it.display_name || '—'}</span>
                        {canEditItem(it) ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 shrink-0"
                            onClick={() => void openEdit(it)}
                            title="编辑展示名 / 业务描述"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                      </div>
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
                    <td className="px-3 py-2">
                      {it.kind === 'table' || it.kind === 'model' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          onClick={() => setFieldHost(it)}
                          title="管理该节点下字段的纳入范围"
                        >
                          <Columns3 className="h-3.5 w-3.5" />
                          字段纳入
                          {hostFields.length > 0 ? (
                            <span className="ml-1 text-muted-foreground">
                              {fieldInScope}/{hostFields.length}
                            </span>
                          ) : null}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 二期：语义模型编辑弹窗（P0-1~P0-12） */}
      <Dialog open={editing != null} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>编辑语义模型节点</DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {editing?.item_key}
              {editing ? ` · ${KIND_LABEL[editing.kind] ?? editing.kind}` : ''}
            </DialogDescription>
          </DialogHeader>

          {editing ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted-foreground">展示名（display_name）</label>
                <Input
                  value={editForm.display_name}
                  onChange={(e) => setEditForm((f) => ({ ...f, display_name: e.target.value }))}
                  placeholder={
                    editing.kind === 'column'
                      ? '字段展示名（如「订单金额」）'
                      : editing.kind === 'table'
                        ? '表展示名（如「订单表」）'
                        : editing.kind === 'model'
                          ? '模型展示名（如「订单主模型」）'
                          : '展示名'
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted-foreground">业务描述（description）</label>
                <Textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder={
                    editing.kind === 'column'
                      ? '字段业务含义（如「含税成交额，单位元」）'
                      : editing.kind === 'table'
                        ? '物理表业务含义（如「全渠道成交订单主表」）'
                        : editing.kind === 'model'
                          ? '语义模型业务含义（问数 get_context 优先使用；如「订单域主模型」）'
                          : '业务描述'
                  }
                  rows={3}
                />
              </div>
              {EXPRESSION_KINDS.has(editing.kind) ? (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-muted-foreground">表达式（expression）</label>
                  <Textarea
                    value={editForm.expression}
                    onChange={(e) => setEditForm((f) => ({ ...f, expression: e.target.value }))}
                    placeholder="表达式"
                    rows={3}
                    className="font-mono text-xs"
                  />
                </div>
              ) : null}

              {editError ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
                  {editError}
                  {editConflictRevision != null ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-2"
                      onClick={() => void rereadVersion()}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      重读版本
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {editDependents && editDependents.length > 0 ? (
                <div className="rounded-md border border-warning/40 bg-warning/5 p-2.5 text-xs text-warning">
                  <div className="mb-1 font-semibold">直接引用方（禁止改名/删除）：</div>
                  <ul className="ml-4 list-disc">
                    {editDependents.map((d) => (
                      <li key={d.item_key} className="font-mono">
                        {d.item_key} <span className="text-muted-foreground">({d.kind})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={editSaving}>
              取消
            </Button>
            <Button
              onClick={() => void submitEdit()}
              disabled={editSaving || (editDependents != null && editDependents.length > 0)}
            >
              {editSaving ? '保存中…' : '保存编辑'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* T02b-4 / MR-S2：从物理表生成模型（入口在上方 actions） */}
      <FieldScopeDialog
        open={fieldHost != null}
        host={fieldHost}
        columns={fieldHost ? columnsOfHost(items, fieldHost) : []}
        connectionId={connectionId}
        canEditColumn={(col) => canEditItem(col)}
        onEditColumn={(col) => {
          void openEdit(col);
        }}
        onClose={() => setFieldHost(null)}
        onSaved={() => void load()}
      />
      <FromTableModelDialog
        open={fromTableOpen}
        onOpenChange={setFromTableOpen}
        connectionId={connectionId}
        onCreated={() => void load()}
      />
    </div>
  );
}

/**
 * 表/模型下的字段纳入弹窗（主列表不再平铺全部字段）。
 * <p>问数闸门仍以表/模型级为主；此处便于按父节点批量维护字段 {@code in_scope} 标记，
 * 并入口编辑字段业务描述（与主列表铅笔同源 {@code PUT /catalog/node}）。
 */
function FieldScopeDialog({
  open,
  host,
  columns,
  connectionId,
  canEditColumn,
  onEditColumn,
  onClose,
  onSaved,
}: {
  open: boolean;
  host: IqdCatalogItem | null;
  columns: IqdCatalogItem[];
  connectionId: number | null;
  canEditColumn: (col: IqdCatalogItem) => boolean;
  onEditColumn: (col: IqdCatalogItem) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPicked(new Set());
    setError(null);
  }, [open, host?.item_key]);

  const toggle = (key: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAll = () => setPicked(new Set(columns.map((c) => c.item_key)));
  const clearAll = () => setPicked(new Set());

  const apply = async (inScope: boolean) => {
    if (connectionId == null || picked.size === 0) return;
    setSaving(true);
    setError(null);
    try {
      await setIqdCatalogInScope(connectionId, inScope, [...picked]);
      setPicked(new Set());
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新字段范围失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="flex max-h-[85vh] w-full max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border/60 px-4 py-3">
          <DialogTitle className="text-[14px]">
            字段纳入与描述
            {host ? (
              <span className="ml-2 font-normal text-muted-foreground">
                · {KIND_LABEL[host.kind] ?? host.kind} {host.display_name || host.item_key}
              </span>
            ) : null}
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            勾选批量维护纳入范围；铅笔编辑字段业务描述（需连接已开启 MDL 写回）。
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2">
          <Button size="sm" variant="outline" onClick={selectAll} disabled={columns.length === 0}>
            全选
          </Button>
          <Button size="sm" variant="outline" onClick={clearAll} disabled={picked.size === 0}>
            清空勾选
          </Button>
          <span className="text-xs text-muted-foreground">
            共 {columns.length} 字段 · 已勾选 {picked.size}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-2">
          {columns.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">该节点下暂无字段</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-background text-muted-foreground">
                <tr className="border-b">
                  <th className="w-10 px-2 py-1.5" />
                  <th className="px-2 py-1.5 font-medium">字段</th>
                  <th className="px-2 py-1.5 font-medium">类型</th>
                  <th className="px-2 py-1.5 font-medium">业务描述</th>
                  <th className="px-2 py-1.5 font-medium">纳入</th>
                  <th className="w-12 px-2 py-1.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {columns.map((col) => (
                  <tr key={col.item_key} className="border-b border-border/40">
                    <td className="px-2 py-1.5">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={picked.has(col.item_key)}
                        onChange={() => toggle(col.item_key)}
                      />
                    </td>
                    <td
                      className="max-w-[10rem] truncate px-2 py-1.5"
                      title={col.display_name ?? col.item_key}
                    >
                      {col.display_name || col.item_key.split('.').pop()}
                    </td>
                    <td className="px-2 py-1.5 text-xs text-muted-foreground">
                      {col.data_type ?? '—'}
                    </td>
                    <td
                      className="max-w-[14rem] truncate px-2 py-1.5 text-xs text-muted-foreground"
                      title={col.description ?? undefined}
                    >
                      {col.description?.trim() ? col.description : '—'}
                    </td>
                    <td className="px-2 py-1.5 text-xs">
                      {col.in_scope ? (
                        <span className="text-success">已纳入</span>
                      ) : (
                        <span className="text-muted-foreground">未纳入</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {canEditColumn(col) ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          title="编辑字段展示名 / 业务描述"
                          onClick={() => onEditColumn(col)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {error ? (
          <div className="mx-4 mb-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        <DialogFooter className="border-t border-border/60 px-4 py-3">
          <Button size="sm" variant="outline" onClick={onClose} disabled={saving}>
            关闭
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={saving || picked.size === 0 || connectionId == null}
            onClick={() => void apply(false)}
          >
            移出范围
          </Button>
          <Button
            size="sm"
            disabled={saving || picked.size === 0 || connectionId == null}
            onClick={() => void apply(true)}
          >
            <ShieldCheck className="h-4 w-4" />
            纳入范围（{picked.size}）
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * FromTableModelDialog — 「从物理表生成模型」（MR-S2 / M-G1 核心路径，T02b-4）。
 *
 * <h2>数据来源（Q5 单源）</h2>
 * 用 {@link useCatalogNodes} 取**同一份 catalog 缓存**（与建模台画布/左树同一 cache entry），
 * 过滤出「`kind=table` 且尚无同名 model」的候选表 —— 已建模的表不再列出，避免重复建模。
 *
 * <h2>列从哪来（前端不传 `columns`）</h2>
 * 只提交 `{schema, name}`：T02a 的 `createModelFromTable` 有**三级回退**（请求携带 columns →
 * catalog 既有 table/column 行 → `mdl_raw` 经 `IqdMdlParser`）。本入口依赖**回退②**——
 * 故通常需该表结构已在 catalog 里（即先跑过一次 MDL 同步）。若三级全落空，服务端返回
 * **42200**，此处给可行动的提示（先去建模台「表发现导入」同步该表）。
 *
 * <h2>错误码（均已按 T02a 实证处理）</h2>
 * <ul>
 *   <li><b>40900</b>：`base_revision` 不符 → 读 `data.current_edit_revision` 提示「版本已变更，先刷新」；</li>
 *   <li><b>40901</b>：同幂等键并发提交 → 提示稍后重试；</li>
 *   <li><b>42200</b>：源表不存在 / 无可导入字段 → 提示先去同步表结构。</li>
 * </ul>
 *
 * <h2>治理边界</h2>
 * **刻意不传 `in_scope`**（PRD §6.3「导入 ≠ 可问」，服务端默认 false）；
 * 生成后引导用户到 `/iqd/scope` 自行决定是否纳入问数范围。
 *
 * <h2>幂等</h2>
 * 提交确定性幂等键 `fromtable:{connId}:{schema}.{name}`（同表重复点击 → 命中同一 key，
 * 不二次 bump；即使不带 key，T02a 的**语义幂等**也会兜住）。
 */
function FromTableModelDialog({
  open,
  onOpenChange,
  connectionId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: number | null;
  onCreated?: () => void;
}) {
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflictRevision, setConflictRevision] = useState<number | null>(null);
  const [createdKeys, setCreatedKeys] = useState<string[]>([]);

  const { catalog, isLoading, error: catalogError } = useCatalogNodes(open ? connectionId : null);

  /** 候选：kind=table 且没有同名 model。 */
  const candidates = useMemo(() => {
    const modeled = new Set(
      catalog
        .filter((item) => item.kind === 'model')
        .map((item) => (item.display_name ?? item.item_key).toLowerCase()),
    );
    return catalog
      .filter(
        (item) =>
          item.kind === 'table' &&
          !modeled.has((item.display_name ?? item.item_key).toLowerCase()),
      )
      .sort((a, b) => (a.display_name ?? a.item_key).localeCompare(b.display_name ?? b.item_key));
  }, [catalog]);

  const submit = async (item: IqdCatalogItem) => {
    if (connectionId == null) {
      return;
    }
    // item_key 形如 {datasource}.{schema}.{table} → 取末两段
    const segments = item.item_key.split('.');
    const name = segments[segments.length - 1] ?? item.item_key;
    const schema = segments.length >= 2 ? segments[segments.length - 2] : 'public';
    setSubmitting(item.item_key);
    setError(null);
    setConflictRevision(null);
    try {
      const result = await createModelFromTable({
        connection_id: connectionId,
        source_table: { schema, name },
        // 确定性幂等键（§3.3：{connId}+{sha1(source_table)} 的等价人读形态）
        idempotency_key: `fromtable:${connectionId}:${schema}.${name}`,
        // 注意：刻意不传 in_scope（PRD §6.3 导入 ≠ 可问）
      });
      const key = String(result?.item_key ?? `mdl:model:${name}`);
      setCreatedKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
      onCreated?.();
    } catch (err) {
      const code = errorCode(err);
      const data = errorData(err);
      if (code === 40900) {
        const current = Number(data?.current_edit_revision ?? 0);
        setConflictRevision(Number.isFinite(current) ? current : 0);
      } else if (code === 40901) {
        setError('该表正在被另一个请求导入（幂等键并发），请稍后重试。');
      } else if (code === 42200) {
        setError(
          `源表不存在或无可导入字段：${schema}.${name}。` +
            '请先在建模台「表发现导入」同步该表结构（或让 DBA 确认 profile 注入），再回来生成模型。',
        );
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-[14px]">从物理表生成模型</DialogTitle>
          <DialogDescription className="text-[12px]">
            选择一张尚未建模的物理表，平台将据此生成 <code>kind=model</code> 节点与字段子节点
            （一次事务，随后异步触发 build）。
          </DialogDescription>
        </DialogHeader>

        {/* 错误 / 冲突 */}
        {error && (
          <div className="rounded border border-destructive/40 bg-destructive/5 p-2 text-[12px] text-destructive">
            {error}
          </div>
        )}
        {conflictRevision != null && (
          <div className="rounded border border-amber-500/40 bg-amber-500/5 p-2 text-[12px]">
            编辑版本已变更（服务端当前 `current_edit_revision = {conflictRevision}`）。
            请关闭本对话框、点右上「刷新」拿到最新清单后重试。
          </div>
        )}
        {createdKeys.length > 0 && (
          <div className="rounded border border-emerald-500/40 bg-emerald-500/5 p-2 text-[12px]">
            已生成 {createdKeys.length} 个模型：{createdKeys.join('、')}。
            <br />
            导入<strong>不等于可问</strong>：如需纳入问数范围，请到 <code>/iqd/scope</code> 勾选。
          </div>
        )}

        {/* 候选表清单（单层滚动） */}
        <div className="min-h-0 max-h-[50vh] overflow-auto rounded border border-border/60">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 z-10 bg-background">
              <tr className="border-b border-border/60 text-left">
                <th className="px-2 py-1.5 font-medium">物理表</th>
                <th className="border-l border-border/60 px-2 py-1.5 font-medium">item_key</th>
                <th className="w-24 border-l border-border/60 px-2 py-1.5 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((item) => (
                <tr key={item.item_key} className="border-b border-border/40 hover:bg-accent/40">
                  <td className="px-2 py-1">{item.display_name ?? item.item_key}</td>
                  <td className="border-l border-border/60 px-2 py-1 font-mono text-[11px] text-muted-foreground">
                    {item.item_key}
                  </td>
                  <td className="border-l border-border/60 px-2 py-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[12px]"
                      disabled={submitting !== null}
                      onClick={() => void submit(item)}
                    >
                      {submitting === item.item_key ? '生成中…' : '生成模型'}
                    </Button>
                  </td>
                </tr>
              ))}
              {!isLoading && candidates.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-2 py-6 text-center text-muted-foreground">
                    {catalogError
                      ? `读取清单失败：${catalogError}`
                      : catalog.length === 0
                        ? '该连接暂无清单数据，先去建模台「表发现导入」同步库结构。'
                        : '所有物理表都已建模（无待生成的表）。'}
                  </td>
                </tr>
              )}
              {isLoading && (
                <tr>
                  <td colSpan={3} className="px-2 py-6 text-center text-muted-foreground">
                    加载中…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting !== null}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default IqdCatalogPage;
