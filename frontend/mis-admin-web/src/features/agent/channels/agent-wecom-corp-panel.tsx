/**
 * 企微企业配置面板（方案 B §64–#70）。
 *
 * <p>企业清单落 `configs/channels/wecom-corps.yaml`（corp_id / tenant_id / 绑定模式）；
 * corpsecret **不落 YAML**，经 CredentialVault（AES-256-GCM）加密存
 * `ai_platform.credential_mappings`，YAML 只写 `secret://wecom/corp/<corp_id>` 引用。
 *
 * <p>密钥安全：读接口只回「是否已配置 + 引用类型」，明文 corpsecret 永不回显；
 * 编辑时留空 = 不修改。
 */
import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Pencil, Plus, RefreshCw, Trash2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PermissionGate } from '@/components/auth/permission-gate';
import { SortIndicator } from '@/components/common/sort-indicator';
import { useClientSort } from '@/components/common/use-client-sort';
import { useColumnWidths, type ResizableColumn } from '@/components/common/use-column-widths';
import { RESET_COL_WIDTH_OVERLAY_CLASS, ResetColWidthButton } from '@/components/common/header-action-buttons';
import { AgentContentState } from '../components/agent-page-shell';
import { AgentConfirmDialog } from '../components/agent-confirm-dialog';
import { AgentWecomCorpDialog } from './agent-wecom-corp-dialog';
import {
  deleteWecomCorp,
  listWecomCorps,
  testWecomCorp,
} from '../api/agent-ops-api';
import { agentErrorMessage } from '../types';
import type { WecomCorp } from '../types';

const CORP_COLS: ResizableColumn[] = [
  { key: 'corp_id', label: '企业 ID' },
  { key: 'name', label: '名称' },
  { key: 'tenant_id', label: '租户' },
  { key: 'user_bind_mode', label: '绑定模式' },
  { key: 'secret_ref_kind', label: '密钥来源' },
  { key: 'secret_configured', label: '密钥状态' },
  { key: '__ops__', label: '操作', locked: true },
];

const BIND_MODE_LABEL: Record<string, string> = {
  auto_phone: '自动（手机号）',
  manual_only: '仅人工',
  disabled: '禁用',
};

const REF_KIND_LABEL: Record<string, string> = {
  vault: 'Vault',
  env: '环境变量',
  inline: '明文(不推荐)',
  global: '全局兜底',
};

export function AgentWecomCorpPanel() {
  const [items, setItems] = useState<WecomCorp[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WecomCorp | null>(null);
  const [pending, setPending] = useState<{ kind: 'delete' | 'test'; row: WecomCorp } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const { widthOf, startResize, hasCustom, reset, tableStyle } = useColumnWidths(
    CORP_COLS,
    'mis-agent-wecom-corp-table-widths',
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listWecomCorps());
    } catch (e) {
      setItems([]);
      setError(agentErrorMessage(e, '获取企微企业列表失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate(): void {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(row: WecomCorp): void {
    setEditing(row);
    setFormOpen(true);
  }

  async function runPending(): Promise<void> {
    if (!pending) return;
    const { kind, row } = pending;
    setBusyKey(row.corp_id);
    try {
      if (kind === 'delete') {
        await deleteWecomCorp(row.corp_id, true);
        toast.success(`企业「${row.name || row.corp_id}」已删除（含密钥）`);
      } else {
        const result = await testWecomCorp(row.corp_id);
        toast[result.ok ? 'success' : 'error'](
          result.ok ? '连接正常（access_token 获取成功）' : '连接失败（密钥无效或企微不可达）',
        );
      }
      setPending(null);
      await load();
    } catch (e) {
      toast.error(agentErrorMessage(e, kind === 'delete' ? '删除企业失败' : '连通性测试失败'));
    } finally {
      setBusyKey(null);
    }
  }

  const getSortValue = useCallback((row: WecomCorp, key: string) => row[key as keyof WecomCorp] as unknown, []);
  const { sorted, sortKey, sortDir, toggleSort } = useClientSort(items, getSortValue);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
        <KeyRound className="mt-[0.1rem] h-3.5 w-3.5 shrink-0 text-primary" />
        <p className="leading-relaxed">
          <span className="font-medium text-foreground">企业清单</span>决定哪些企微主体可参与身份绑定；
          <span className="font-medium text-foreground">密钥</span>（corpsecret）用于读取通讯录手机号，
          加密存 Vault，明文不回显、不落 YAML。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
        <span className="text-xs text-muted-foreground">共 {items.length} 个企业</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            刷新
          </Button>
          <PermissionGate permission="agent:wecom:manage">
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              新增企业
            </Button>
          </PermissionGate>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <AgentContentState
          loading={loading && items.length === 0}
          error={error}
          onRetry={() => void load()}
          empty={!loading && !error && items.length === 0}
          emptyText="尚未配置任何企微企业"
          emptyHint="点击右上角「新增企业」登记 corp_id / 租户，再为其配置通讯录应用密钥。"
        >
          <div className="relative min-h-0 flex-1 overflow-auto rounded-lg border bg-table-surface">
            {hasCustom ? (
              <ResetColWidthButton onClick={reset} className={RESET_COL_WIDTH_OVERLAY_CLASS} />
            ) : null}
            <table className="border-separate border-spacing-0 bg-table-surface text-left text-sm" style={tableStyle}>
              <thead className="border-b-2 border-foreground/20 bg-table-header text-muted-foreground">
                <tr>
                  {CORP_COLS.map((c, ci) => {
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
                    <td colSpan={CORP_COLS.length} className="px-3 py-10 text-center text-muted-foreground">
                      没有匹配的企业
                    </td>
                  </tr>
                ) : (
                  sorted.map((row) => {
                    const rowBusy = busyKey === row.corp_id;
                    return (
                      <tr
                        key={row.corp_id}
                        className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe hover:bg-table-hover"
                      >
                        <td className="truncate px-3 py-2 font-mono text-xs" title={row.corp_id}>
                          {row.corp_id}
                        </td>
                        <td className="truncate px-3 py-2" title={row.name}>
                          {row.name || '-'}
                        </td>
                        <td className="px-3 py-2 text-xs">{row.tenant_id}</td>
                        <td className="px-3 py-2 text-xs">
                          {BIND_MODE_LABEL[row.user_bind_mode] ?? row.user_bind_mode}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {REF_KIND_LABEL[row.secret_ref_kind] ?? row.secret_ref_kind}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {row.secret_configured ? (
                            <span className="text-success">已配置</span>
                          ) : (
                            <span className="text-warning">未配置</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap items-center justify-end gap-1">
                            <PermissionGate permission="agent:wecom:manage">
                              <button
                                type="button"
                                disabled={rowBusy}
                                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10 disabled:opacity-50"
                                onClick={() => openEdit(row)}
                              >
                                <Pencil className="h-3 w-3" />
                                编辑 / 配密钥
                              </button>
                            </PermissionGate>
                            <PermissionGate permission="agent:wecom:manage">
                              <button
                                type="button"
                                disabled={rowBusy || !row.secret_configured}
                                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-foreground hover:bg-muted disabled:opacity-50"
                                onClick={() => setPending({ kind: 'test', row })}
                              >
                                <Zap className="h-3 w-3" />
                                测试
                              </button>
                            </PermissionGate>
                            <PermissionGate permission="agent:wecom:manage">
                              <button
                                type="button"
                                disabled={rowBusy}
                                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-destructive hover:bg-destructive/10 disabled:opacity-50"
                                onClick={() => setPending({ kind: 'delete', row })}
                              >
                                <Trash2 className="h-3 w-3" />
                                删除
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

      <AgentWecomCorpDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        corp={editing}
        onSaved={() => void load()}
      />

      <AgentConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        danger={pending?.kind === 'delete'}
        title={pending?.kind === 'delete' ? '确认删除企业' : '确认测试连接'}
        confirmText={pending?.kind === 'delete' ? '删除' : '测试'}
        confirmKeyword={pending?.kind === 'delete' ? pending.row.corp_id : undefined}
        description={
          pending ? (
            <>
              <p>
                企业：<span className="font-mono">{pending.row.corp_id}</span>
                {pending.row.name ? `（${pending.row.name}）` : ''}。
              </p>
              {pending.kind === 'delete' ? (
                <p>删除企业会同时清理其加密密钥；该 corp 的消息将无法解析 MIS 身份（fail-closed）。</p>
              ) : (
                <p>用该企业的 corpsecret 换取一次 access_token，验证密钥是否有效。</p>
              )}
            </>
          ) : null
        }
        onConfirm={runPending}
      />
    </div>
  );
}
