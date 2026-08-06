import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, History, RefreshCw, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { SortIndicator } from '@/components/common/sort-indicator';
import { useClientSort } from '@/components/common/use-client-sort';
import { useColumnWidths, type ResizableColumn } from '@/components/common/use-column-widths';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getTicket, listTickets, patchTicket } from '../api/kb-api';
import type { KbQaTicket } from '../types';
import {
  KB_TICKET_REL_ACTION_OPTIONS,
  KB_TICKET_STATUS_OPTIONS,
  formatTime,
  ticketRelActionLabel,
  ticketStatusLabel,
  ticketTypeLabel,
} from '../types';

const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';
const fieldLabel = 'mb-[0.3rem] block text-xs font-medium text-muted-foreground';

const PAGE_SIZE = 20;

/** 工单状态徽标：待处理告警色，处理中信息色，已解决成功色，其余中性。 */
function TicketStatusBadge({ status }: { status: string | null | undefined }) {
  const variant =
    status === 'open'
      ? 'warning'
      : status === 'processing'
        ? 'info'
        : status === 'resolved'
          ? 'success'
          : 'secondary';
  return <Badge variant={variant}>{ticketStatusLabel(status)}</Badge>;
}

/** 处理表单（PATCH 语义：留空字段不提交，服务端不改）。 */
interface HandleForm {
  status: string;
  relAction: string;
  note: string;
  processorId: string;
}

/**
 * 工单页签（A-02c）。
 *
 * <p>列表 + 处理弹窗。处理走 PATCH：**只提交被改动的字段**，
 * 未填写的一律不下发（后端对 null 视为「不修改」），避免误把备注清空。
 *
 * <p>状态流转轨迹 `timeline` 由服务端在每次状态变更时追加，前端只读展示，
 * 不做本地拼接——本地拼出来的轨迹在多人并发处理时必然与服务端不一致。
 */
export function KbTicketTab() {
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<KbQaTicket[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const [current, setCurrent] = useState<KbQaTicket | null>(null);
  const [open, setOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<HandleForm>({
    status: '',
    relAction: '',
    note: '',
    processorId: '',
  });

  /* 列宽 + 当前页客户端排序（服务端分页，排序仅作用于本页） */
  const TICKET_COLS = useMemo<ResizableColumn[]>(
    () => [
      { key: 'id', label: '工单' },
      { key: 'sessionId', label: '会话' },
      { key: 'type', label: '类型' },
      { key: 'status', label: '状态' },
      { key: 'content', label: '问题描述' },
      { key: 'relAction', label: '处理动作' },
      { key: 'createdAt', label: '提交时间' },
      { key: '__ops__', label: '操作', locked: true },
    ],
    [],
  );
  const { widthOf, startResize, hasCustom, reset, tableStyle } = useColumnWidths(TICKET_COLS, 'mis-kb-ticket-table-widths');
  const getSortValue = useCallback((row: KbQaTicket, key: string) => row[key as keyof KbQaTicket], []);
  const { sorted: sortedRows, sortKey, sortDir, toggleSort } = useClientSort(rows, getSortValue);

  const load = useCallback(async (p: number, s: string) => {
    setLoading(true);
    try {
      const res = await listTickets(s || null, p, PAGE_SIZE);
      setRows(res.list ?? []);
      setTotal(res.total ?? 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载工单失败');
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(page, status);
  }, [page, status, load]);

  async function openHandle(id: number) {
    setOpen(true);
    setDetailLoading(true);
    setCurrent(null);
    try {
      const t = await getTicket(id);
      setCurrent(t);
      setForm({
        status: t.status ?? '',
        relAction: t.relAction ?? '',
        note: '',
        processorId: t.processorId == null ? '' : String(t.processorId),
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载工单详情失败');
      setOpen(false);
    } finally {
      setDetailLoading(false);
    }
  }

  async function onSubmit() {
    if (current == null) return;
    const processorId = Number(form.processorId);
    // 只下发有值的字段：空串 → null（PATCH 语义下服务端跳过）
    const payload = {
      status: form.status || null,
      relAction: form.relAction || null,
      note: form.note.trim() || null,
      processorId:
        form.processorId.trim() === '' || !Number.isFinite(processorId) || processorId <= 0
          ? null
          : processorId,
    };
    if (
      payload.status == null &&
      payload.relAction == null &&
      payload.note == null &&
      payload.processorId == null
    ) {
      toast.warning('没有需要提交的变更');
      return;
    }
    setSaving(true);
    try {
      const updated = await patchTicket(current.id, payload);
      setCurrent(updated);
      setForm((f) => ({ ...f, note: '' }));
      toast.success('已提交处理');
      await load(page, status);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '处理工单失败');
    } finally {
      setSaving(false);
    }
  }

  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-end gap-2 rounded-lg border bg-card p-3">
        <div className="w-40">
          <label className={fieldLabel}>状态</label>
          <select
            className={selectClass}
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
            }}
          >
            <option value="">全部</option>
            {KB_TICKET_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void load(page, status)}>
          <RefreshCw className="h-4 w-4" />
          刷新
        </Button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-auto rounded-lg border bg-table-surface">
        {hasCustom ? (
          <button
            type="button"
            onClick={reset}
            className="absolute right-3 top-3 z-20 rounded-md bg-card px-2 py-0.5 text-xs text-muted-foreground shadow-sm hover:text-foreground"
          >
            重置列宽
          </button>
        ) : null}
        <table
          className="border-separate border-spacing-0 bg-table-surface text-left text-sm"
          style={tableStyle}
        >
          <thead className="border-b-2 border-foreground/20 bg-table-header text-muted-foreground">
            <tr>
              {TICKET_COLS.map((c) => {
                const active = sortKey === c.key;
                return (
                  <th
                    key={c.key}
                    style={{ width: widthOf(c.key) }}
                    aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className={cn(
                      'overflow-hidden whitespace-nowrap px-0 py-0 font-bold',
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
            {loading ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                  加载中…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                  暂无工单
                </td>
              </tr>
            ) : (
              sortedRows.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe hover:bg-table-hover"
                >
                  <td className="overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2 font-mono text-xs">#{t.id}</td>
                  <td className="overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2 font-mono text-xs">{t.sessionId ?? '-'}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline">{t.typeLabel ?? ticketTypeLabel(t.type)}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    <TicketStatusBadge status={t.status} />
                  </td>
                  <td className="max-w-[22rem] truncate px-3 py-2" title={t.content ?? ''}>
                    {t.content ?? '-'}
                  </td>
                  <td className="overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {t.relAction ? ticketRelActionLabel(t.relAction) : '-'}
                  </td>
                  <td className="overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {formatTime(t.createdAt)}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                      onClick={() => void openHandle(t.id)}
                    >
                      <Wrench className="h-3 w-3" />
                      处理
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex shrink-0 items-center justify-between text-xs text-muted-foreground">
        <span>
          共 {total} 条 · 第 {page} / {maxPage} 页
        </span>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={loading || page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
            上一页
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={loading || page >= maxPage}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] w-full max-w-2xl flex-col">
          <DialogHeader>
            <DialogTitle>处理工单 #{current?.id ?? '-'}</DialogTitle>
            <DialogDescription>
              PATCH 语义：留空的字段不会被提交，服务端保持原值。
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-3 overflow-auto pr-1">
            {detailLoading ? (
              <p className="py-10 text-center text-sm text-muted-foreground">加载中…</p>
            ) : current == null ? (
              <p className="py-10 text-center text-sm text-muted-foreground">暂无数据</p>
            ) : (
              <>
                <div className="rounded-lg border bg-card p-3 text-sm">
                  <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                    <div className="flex gap-2 py-1">
                      <span className="w-20 shrink-0 text-muted-foreground">会话</span>
                      <span>{current.sessionId ?? '-'}</span>
                    </div>
                    <div className="flex gap-2 py-1">
                      <span className="w-20 shrink-0 text-muted-foreground">消息</span>
                      <span>{current.messageId ?? '-'}</span>
                    </div>
                    <div className="flex gap-2 py-1">
                      <span className="w-20 shrink-0 text-muted-foreground">类型</span>
                      <span>{current.typeLabel ?? ticketTypeLabel(current.type)}</span>
                    </div>
                    <div className="flex gap-2 py-1">
                      <span className="w-20 shrink-0 text-muted-foreground">当前状态</span>
                      <TicketStatusBadge status={current.status} />
                    </div>
                    <div className="flex gap-2 py-1">
                      <span className="w-20 shrink-0 text-muted-foreground">提交人</span>
                      <span>{current.creatorId ?? '-'}</span>
                    </div>
                    <div className="flex gap-2 py-1">
                      <span className="w-20 shrink-0 text-muted-foreground">处理人</span>
                      <span>{current.processorId ?? current.handlerId ?? '-'}</span>
                    </div>
                  </div>
                  <div className="mt-2 border-t pt-2">
                    <p className="text-xs text-muted-foreground">问题描述</p>
                    <p className="mt-1 whitespace-pre-wrap break-words">{current.content ?? '-'}</p>
                  </div>
                  {current.note ? (
                    <div className="mt-2 border-t pt-2">
                      <p className="text-xs text-muted-foreground">最新处理备注</p>
                      <p className="mt-1 whitespace-pre-wrap break-words">{current.note}</p>
                    </div>
                  ) : null}
                </div>

                <div className="rounded-lg border bg-card p-3">
                  <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                    <History className="h-4 w-4 text-muted-foreground" />
                    流转轨迹（{current.timeline?.length ?? 0}）
                  </h4>
                  {current.timeline && current.timeline.length > 0 ? (
                    <ol className="space-y-1.5">
                      {current.timeline.map((e, i) => (
                        <li
                          key={`${e.at ?? ''}-${i}`}
                          className="flex flex-wrap items-center gap-2 rounded-md bg-secondary/40 px-2.5 py-1.5 text-xs"
                        >
                          <span className="text-muted-foreground">{formatTime(e.at)}</span>
                          <span>
                            {ticketStatusLabel(e.from)} → {ticketStatusLabel(e.to)}
                          </span>
                          {e.userId != null ? (
                            <span className="text-muted-foreground">操作人 #{e.userId}</span>
                          ) : null}
                          {e.note ? <span className="min-w-0 break-words">{e.note}</span> : null}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-xs text-muted-foreground">（暂无流转记录）</p>
                  )}
                </div>

                <div className="rounded-lg border bg-card p-3">
                  <h4 className="mb-2 text-sm font-semibold">提交处理</h4>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className={fieldLabel}>目标状态</label>
                      <select
                        className={selectClass}
                        value={form.status}
                        onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                      >
                        <option value="">不修改</option>
                        {KB_TICKET_STATUS_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={fieldLabel}>关联动作</label>
                      <select
                        className={selectClass}
                        value={form.relAction}
                        onChange={(e) => setForm((f) => ({ ...f, relAction: e.target.value }))}
                      >
                        <option value="">不修改</option>
                        {KB_TICKET_REL_ACTION_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={fieldLabel}>处理人 ID</label>
                      <Input
                        value={form.processorId}
                        placeholder="留空不修改"
                        onChange={(e) => setForm((f) => ({ ...f, processorId: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="mt-3">
                    <label className={fieldLabel}>处理备注</label>
                    <Textarea
                      rows={3}
                      value={form.note}
                      placeholder="记录处理结论；会写入流转轨迹"
                      onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button disabled={saving || current == null} onClick={() => void onSubmit()}>
              提交
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
