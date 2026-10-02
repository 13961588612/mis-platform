/**
 * 企微用户身份绑定 子面板（wecom-user-binding-design.md §11 #59–#62）。
 *
 * <p>挂在「企微机器人」页的第二个 Tab 下。列表展示 `corp_id + wecom_user_id →
 * tenant_id + mis_user_id` 的绑定事实与来源 / 状态；支持人工绑定、解绑、校验。
 *
 * <p>与 Bot 页一致的两处降级：
 *   ① 筛选区常驻（error 态也能改条件重试），只有表格区走 `AgentContentState`；
 *   ② 写操作统一走 `AgentConfirmDialog` 二次确认。
 *
 * <p>安全：手机号只展示 `phone_masked`，接口与页面都拿不到明文。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link2, Pencil, Plus, RefreshCw, ShieldCheck, Unlink } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PermissionGate } from '@/components/auth/permission-gate';
import { SortIndicator } from '@/components/common/sort-indicator';
import { useClientSort } from '@/components/common/use-client-sort';
import { useColumnWidths, type ResizableColumn } from '@/components/common/use-column-widths';
import { RESET_COL_WIDTH_OVERLAY_CLASS, ResetColWidthButton } from '@/components/common/header-action-buttons';
import { AgentContentState } from '../components/agent-page-shell';
import { AgentConfirmDialog } from '../components/agent-confirm-dialog';
import { AgentWecomBindDialog } from './agent-wecom-bind-dialog';
import {
  listWecomBindings,
  syncBackfillWecomBindings,
  unbindWecomUser,
  verifyWecomUser,
} from '../api/agent-ops-api';
import { agentErrorMessage } from '../types';
import type { WecomUserBinding } from '../types';

const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

const BIND_COLS: ResizableColumn[] = [
  { key: 'corp_id', label: '企业' },
  { key: 'wecom_user_id', label: '企微 userid' },
  { key: 'mis_user_id', label: 'MIS 用户' },
  { key: 'bind_source', label: '来源' },
  { key: 'status', label: '状态' },
  { key: 'phone_masked', label: '手机号' },
  { key: 'last_verified_at', label: '最近校验' },
  { key: '__ops__', label: '操作', locked: true },
];

const SOURCE_LABEL: Record<string, string> = {
  manual: '人工绑定',
  auto_phone: '自动（手机号）',
  sync: '同步回填',
};

/** 把 ISO 时间压成 `YYYY-MM-DD HH:mm`，空值返回 `-`。 */
function formatTime(raw: string | null): string {
  if (!raw) return '-';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AgentWecomBindingPanel() {
  const [items, setItems] = useState<WecomUserBinding[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled'>('all');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WecomUserBinding | null>(null);
  const [pending, setPending] = useState<{ kind: 'unbind' | 'verify'; row: WecomUserBinding } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);

  const { widthOf, startResize, hasCustom, reset, tableStyle } = useColumnWidths(
    BIND_COLS,
    'mis-agent-wecom-binding-table-widths',
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await listWecomBindings({
        keyword: keyword.trim() || undefined,
        status: statusFilter === 'all' ? undefined : statusFilter,
        page_size: 200,
      });
      setItems(page.items);
      setTotal(page.total);
    } catch (e) {
      setItems([]);
      setTotal(0);
      setError(agentErrorMessage(e, '获取企微用户绑定列表失败'));
    } finally {
      setLoading(false);
    }
  }, [keyword, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate(): void {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(row: WecomUserBinding): void {
    setEditing(row);
    setFormOpen(true);
  }

  /** P5：触发一次按通讯录的同步回填（只对未绑定用户 + 手机号 exact-one 生效）。 */
  async function runBackfill(): Promise<void> {
    setBackfilling(true);
    try {
      const result = await syncBackfillWecomBindings();
      const summary = result.corps
        .map((c) => `${c.corp_id || '(未知企业)'}: 新增 ${c.bound} / 跳过 ${c.skipped} / 未匹配 ${c.unmatched} / 冲突 ${c.conflict}`)
        .join('；');
      toast.success(summary ? `同步回填完成 — ${summary}` : '没有已配置的企业，未执行回填');
      await load();
    } catch (e) {
      toast.error(agentErrorMessage(e, '同步回填失败'));
    } finally {
      setBackfilling(false);
    }
  }

  async function runPending(): Promise<void> {
    if (!pending) return;
    const { kind, row } = pending;
    setBusyKey(row.id);
    try {
      if (kind === 'unbind') {
        await unbindWecomUser(row.corp_id, row.wecom_user_id);
        toast.success('已解绑（置为停用，不再自动重生）');
      } else {
        await verifyWecomUser(row.corp_id, row.wecom_user_id);
        toast.success('已刷新校验时间');
      }
      setPending(null);
      await load();
    } catch (e) {
      toast.error(agentErrorMessage(e, kind === 'unbind' ? '解绑失败' : '校验失败'));
    } finally {
      setBusyKey(null);
    }
  }

  const getSortValue = useCallback((row: WecomUserBinding, key: string) => {
    if (key === 'status') return row.status === 'active' ? 1 : 0;
    return row[key as keyof WecomUserBinding] as unknown;
  }, []);
  const { sorted, sortKey, sortDir, toggleSort } = useClientSort(items, getSortValue);

  const activeCount = useMemo(() => items.filter((r) => r.status === 'active').length, [items]);

  const headerActions = (
    <>
      <span className="mr-1 text-xs text-muted-foreground">
        共 {items.length} / {total} 条，生效 {activeCount} 条
      </span>
      <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
        <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        刷新
      </Button>
      <PermissionGate permission="agent:wecom:user:manage">
        <Button size="sm" variant="outline" onClick={() => void runBackfill()} disabled={backfilling}>
          <ShieldCheck className={cn('h-4 w-4', backfilling && 'animate-pulse')} />
          同步回填
        </Button>
      </PermissionGate>
      <PermissionGate permission="agent:wecom:user:manage">
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          新增绑定
        </Button>
      </PermissionGate>
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
        <Link2 className="mt-[0.1rem] h-3.5 w-3.5 shrink-0 text-primary" />
        <p className="leading-relaxed">
          <span className="font-medium text-foreground">绑定事实</span>：企微 userid → MIS 用户。
          首次无绑定时才按手机号精确匹配一次；绑定后每条消息只查本地表。
          <span className="font-medium text-foreground">解绑</span> 会置为停用，不会被自动绑定重新生成。
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3">
        <div className="min-w-[14rem] flex-1">
          <label className="mb-[0.4rem] block text-xs text-muted-foreground">关键字</label>
          <Input
            placeholder="搜索企微 userid / MIS 用户 ID"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
        <div className="w-40">
          <label className="mb-[0.4rem] block text-xs text-muted-foreground">状态</label>
          <select
            className={selectClass}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'disabled')}
          >
            <option value="all">全部</option>
            <option value="active">生效</option>
            <option value="disabled">已停用</option>
          </select>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setKeyword('');
            setStatusFilter('all');
          }}
        >
          重置
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-2 pb-0.5">{headerActions}</div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <AgentContentState
          loading={loading && items.length === 0}
          error={error}
          onRetry={() => void load()}
          empty={!loading && !error && items.length === 0}
          emptyText="尚未建立任何企微用户绑定"
          emptyHint="配置通讯录应用后，用户首次发消息会按手机号自动绑定；也可点右上角「新增绑定」手工建立。"
        >
          <div className="relative min-h-0 flex-1 overflow-auto rounded-lg border bg-table-surface">
            {hasCustom ? (
              <ResetColWidthButton onClick={reset} className={RESET_COL_WIDTH_OVERLAY_CLASS} />
            ) : null}
            <table
              className="border-separate border-spacing-0 bg-table-surface text-left text-sm"
              style={tableStyle}
            >
              <thead className="border-b-2 border-foreground/20 bg-table-header text-muted-foreground">
                <tr>
                  {BIND_COLS.map((c, ci) => {
                    const active = sortKey === c.key;
                    return (
                      <th
                        key={c.key}
                        style={{ width: widthOf(c.key) }}
                        aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                        className={cn(
                          'relative overflow-hidden whitespace-nowrap px-0 py-0 font-bold',
                          ci > 0 && 'border-l border-border/60',
                          c.locked && 'text-right',
                        )}
                      >
                        {c.locked ? (
                          <span className="block px-3 py-2">{c.label}</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => toggleSort(c.key)}
                            className={cn(
                              'flex w-full items-center gap-1 px-3 py-2 pr-5 text-left font-bold',
                              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            {c.label}
                            <SortIndicator state={active ? sortDir : 'none'} />
                          </button>
                        )}
                        {!c.locked ? (
                          <span
                            role="separator"
                            aria-label={`调整${c.label}列宽`}
                            onMouseDown={(e) => startResize(e, c.key)}
                            className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-primary/30"
                          />
                        ) : null}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr>
                    <td colSpan={BIND_COLS.length} className="px-3 py-10 text-center text-muted-foreground">
                      没有匹配当前筛选条件的绑定
                    </td>
                  </tr>
                ) : (
                  sorted.map((row) => {
                    const rowBusy = busyKey === row.id;
                    return (
                      <tr
                        key={row.id}
                        className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe hover:bg-table-hover"
                      >
                        <td className="truncate px-3 py-2 font-mono text-xs" title={row.corp_id}>
                          {row.corp_id}
                        </td>
                        <td className="truncate px-3 py-2 font-mono text-xs" title={row.wecom_user_id}>
                          {row.wecom_user_id}
                        </td>
                        <td className="truncate px-3 py-2 font-mono text-xs" title={String(row.mis_user_id)}>
                          {row.mis_user_id}
                        </td>
                        <td className="truncate px-3 py-2 text-xs">
                          {SOURCE_LABEL[row.bind_source] ?? row.bind_source}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {row.status === 'active' ? (
                            <span className="text-success">生效</span>
                          ) : (
                            <span className="text-muted-foreground">已停用</span>
                          )}
                        </td>
                        <td className="truncate px-3 py-2 font-mono text-xs text-muted-foreground">
                          {row.phone_masked || '-'}
                        </td>
                        <td className="truncate px-3 py-2 text-xs text-muted-foreground">
                          {formatTime(row.last_verified_at)}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap items-center justify-end gap-1">
                            <PermissionGate permission="agent:wecom:user:manage">
                              <button
                                type="button"
                                disabled={rowBusy}
                                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10 disabled:opacity-50"
                                onClick={() => openEdit(row)}
                              >
                                <Pencil className="h-3 w-3" />
                                绑定
                              </button>
                            </PermissionGate>
                            <PermissionGate permission="agent:wecom:user:manage">
                              <button
                                type="button"
                                disabled={rowBusy}
                                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-foreground hover:bg-muted disabled:opacity-50"
                                onClick={() => setPending({ kind: 'verify', row })}
                              >
                                <ShieldCheck className="h-3 w-3" />
                                校验
                              </button>
                            </PermissionGate>
                            <PermissionGate permission="agent:wecom:user:manage">
                              <button
                                type="button"
                                disabled={rowBusy}
                                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-destructive hover:bg-destructive/10 disabled:opacity-50"
                                onClick={() => setPending({ kind: 'unbind', row })}
                              >
                                <Unlink className="h-3 w-3" />
                                解绑
                              </button>
                            </PermissionGate>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </AgentContentState>
      </div>

      <AgentWecomBindDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        binding={editing}
        onSaved={() => void load()}
      />

      <AgentConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        danger={pending?.kind === 'unbind'}
        title={pending?.kind === 'unbind' ? '确认解绑企微用户' : '确认校验绑定'}
        confirmText={pending?.kind === 'unbind' ? '解绑' : '校验'}
        description={
          pending ? (
            <>
              <p>
                目标：<span className="font-mono">{pending.row.wecom_user_id}</span>（企业{' '}
                <span className="font-mono">{pending.row.corp_id}</span>）→ MIS 用户{' '}
                <span className="font-mono">{pending.row.mis_user_id}</span>。
              </p>
              {pending.kind === 'unbind' ? (
                <p>解绑后该企微用户的消息将解析不到 MIS 身份，受控工具会 fail-closed；且不会被自动绑定重新生成。</p>
              ) : (
                <p>校验只会刷新「最近校验时间」，不改变绑定关系。</p>
              )}
            </>
          ) : null
        }
        onConfirm={runPending}
      />
    </div>
  );
}
