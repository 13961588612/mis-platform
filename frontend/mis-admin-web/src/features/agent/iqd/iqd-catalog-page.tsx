/**
 * iqd-catalog-page.tsx — 问数清单管理（W2，路径 /iqd/catalog）。
 *
 * <p>覆盖 mis-iqd 清单（iqd_catalog_item）：连接配置 → 清单树（model/column/
 * relationship）→ 纳入问数范围勾选。数据源为 BFF 代理 `/api/v1/iqd/catalog**`
 * （权限码 iqd:catalog:view / iqd:scope:save）。
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, RefreshCw, RotateCcw, Save, ShieldCheck, Sparkles } from 'lucide-react';
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
  getIqdConfig,
  listIqdCatalog,
  saveIqdConfig,
  setIqdCatalogInScope,
  updateIqdCatalogNode,
  getIqdCatalogSyncStatus,
  type IqdCatalogItem,
  type IqdConnectionConfig,
  type IqdDependents,
} from '@/lib/api/iqd';
import { CatalogSyncStatusBar } from './components/CatalogSyncStatusBar';
import { SelfHealPanel } from './components/SelfHealPanel';
import { useCatalogNodes } from './hooks/useCatalogNodes';
import { createModelFromTable, errorCode, errorData } from './api/iqd-modeling';

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
  /** T02b-4：MR-S2「从物理表生成模型」对话框开关。 */
  const [fromTableOpen, setFromTableOpen] = useState(false);

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

  // ===================== 二期：语义模型编辑（P0-1~P0-12）=====================
  /** 支持 expression 编辑的 catalog 类型（其余类型仅展示 display_name / description）。 */
  const EXPRESSION_KINDS = useMemo(
    () => new Set(['model', 'view', 'relationship', 'cube', 'measure', 'metric', 'dimension']),
    [],
  );
  /** 仅 mdl_writeback_enabled && editable 的节点允许编辑（Q4 闸门 + 一期 editable）。 */
  const canEditItem = useCallback(
    (it: IqdCatalogItem) => Boolean(config?.mdl_writeback_enabled) && Boolean(it.editable),
    [config],
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
        description="管理 WrenAI 语义模型清单，勾选纳入问数范围（治理层）。"
        breadcrumbs={buildAppBreadcrumbs({ app: 'agent', title: '语义模型' })}
        actions={
          <div className="flex items-center gap-2">
            {/* T02b-4 / MR-S2：从物理表生成模型（M-G1 路径；入口见本文件末尾 FromTableModelDialog） */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setFromTableOpen(true)}
              disabled={!config?.id}
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

      {/* 二期：模型编辑同步状态条（5000ms 轮询；STALE_DRIFT 横幅 + 重新导入） */}
      <CatalogSyncStatusBar connectionId={connectionId} />

      {/* 运维自愈三按钮（强制重建 + 二次确认 / 重新索引 / 模型校验；gate + 失败横幅，复用 5000ms 轮询） */}
      <SelfHealPanel connectionId={connectionId} />

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
                    <div className="flex items-center gap-2">
                      <span className="truncate">{it.display_name || '—'}</span>
                      {canEditItem(it) ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 shrink-0"
                          onClick={() => void openEdit(it)}
                          title="编辑语义模型节点"
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
                </tr>
                  ))}
                </Fragment>
              ))
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
                  placeholder="展示名"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted-foreground">描述（description）</label>
                <Textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="描述"
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
      <FromTableModelDialog
        open={fromTableOpen}
        onOpenChange={setFromTableOpen}
        connectionId={config?.id ?? null}
        onCreated={() => void load()}
      />
    </div>
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
