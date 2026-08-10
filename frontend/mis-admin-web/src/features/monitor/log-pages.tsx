import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { StatusBadge } from '@/components/common/list-page-skeleton';
import { SortIndicator } from '@/components/common/sort-indicator';
import { useClientSort } from '@/components/common/use-client-sort';
import { useColumnWidths, type ResizableColumn } from '@/components/common/use-column-widths';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { pageLoginLogs, pageOperLogs } from '@/lib/api/dicts';
import type { LoginLogItem, OperLogItem } from '@/types/api';

const thPad = 'px-3';

const OPER_COLUMNS: ResizableColumn[] = [
  { key: 'operTime', label: '时间' },
  { key: 'username', label: '用户' },
  { key: 'module', label: '模块' },
  { key: 'operation', label: '操作' },
  { key: 'requestUri', label: 'URI' },
  { key: 'durationMs', label: '耗时' },
  { key: 'responseCode', label: '结果', locked: true },
];

const LOGIN_COLUMNS: ResizableColumn[] = [
  { key: 'loginAt', label: '时间' },
  { key: 'username', label: '用户' },
  { key: 'ip', label: 'IP' },
  { key: 'status', label: '状态' },
  { key: 'msg', label: '消息', locked: true },
];

function formatTime(v: string | null | undefined) {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString('zh-CN');
  } catch {
    return v;
  }
}

function DetailField({
  label,
  mono,
  children,
}: {
  label: string;
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr] gap-2 border-b py-2 text-sm last:border-0">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={cn('min-w-0 break-words', mono && 'whitespace-pre-wrap break-all font-mono text-xs leading-relaxed')}>
        {children}
      </span>
    </div>
  );
}

function SortableTh({
  col,
  sortKey,
  sortDir,
  toggleSort,
  widthOf,
  startResize,
}: {
  col: ResizableColumn;
  sortKey: string | null;
  sortDir: 'asc' | 'desc';
  toggleSort: (key: string) => void;
  widthOf: (key: string) => number | undefined;
  startResize: (e: React.MouseEvent, key: string) => void;
}) {
  const active = sortKey === col.key;
  if (col.locked) {
    return (
      <th
        className="whitespace-nowrap px-0 py-0 text-[13px] font-bold"
        style={{ width: widthOf(col.key) }}
      >
        <button
          type="button"
          onClick={() => toggleSort(col.key)}
          className={cn(
            'flex w-full items-center gap-1 text-left font-bold transition-colors',
            thPad,
            active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
          aria-label={`按${col.label}排序`}
        >
          {col.label}
          <SortIndicator state={active ? sortDir : 'none'} />
        </button>
      </th>
    );
  }
  return (
    <th
      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      style={{ width: widthOf(col.key) }}
      className="whitespace-nowrap px-0 py-0 text-[13px] font-bold"
    >
      <button
        type="button"
        onClick={() => toggleSort(col.key)}
        className={cn(
          'flex w-full items-center gap-1 pr-5 text-left font-bold transition-colors',
          thPad,
          active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
        aria-label={`按${col.label}排序`}
      >
        {col.label}
        <SortIndicator state={active ? sortDir : 'none'} />
      </button>
      <span
        role="separator"
        aria-orientation="vertical"
        onMouseDown={(e) => startResize(e, col.key)}
        onClick={(e) => e.stopPropagation()}
        className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-primary/30"
        title={`拖动调整${col.label}列宽`}
      />
    </th>
  );
}

export function OperLogListPage() {
  const [rows, setRows] = useState<OperLogItem[]>([]);
  const [username, setUsername] = useState('');
  const [module, setModule] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<OperLogItem | null>(null);
  const size = 20;

  const { widthOf, startResize, hasCustom, reset: resetColWidths, tableStyle } = useColumnWidths(
    OPER_COLUMNS,
    'mis-oper-log-table-widths',
  );

  const getValue = useCallback((row: OperLogItem, key: string) => {
    switch (key) {
      case 'operTime':
        return row.operTime ?? '';
      case 'username':
        return row.username ?? '';
      case 'module':
        return row.module ?? '';
      case 'operation':
        return row.operation ?? '';
      case 'requestUri':
        return `${row.requestMethod ?? ''} ${row.requestUri ?? ''}`;
      case 'durationMs':
        return row.durationMs ?? -1;
      case 'responseCode':
        return row.responseCode ?? '';
      default:
        return null;
    }
  }, []);
  const { sorted, sortKey, sortDir, toggleSort } = useClientSort(rows, getValue);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await pageOperLogs({
        page,
        size,
        username: username.trim() || undefined,
        module: module.trim() || undefined,
      });
      setRows(data.list ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载操作日志失败');
    } finally {
      setLoading(false);
    }
  }, [page, username, module]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / size));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="操作日志"
        description="管理端操作审计（只读）。"
        breadcrumbs={buildAppBreadcrumbs({
          app: 'system',
          group: '审计',
          title: '操作日志',
        })}
        actions={
          hasCustom ? (
            <Button type="button" variant="outline" size="sm" onClick={resetColWidths}>
              重置列宽
            </Button>
          ) : null
        }
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <Input
          className="h-9 w-40"
          placeholder="用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <Input
          className="h-9 w-40"
          placeholder="模块"
          value={module}
          onChange={(e) => setModule(e.target.value)}
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setPage(1);
            void load();
          }}
        >
          <Search className="h-4 w-4" />
          查询
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-table-surface">
        <table className="border-separate border-spacing-0 bg-table-surface text-left text-sm" style={tableStyle}>
          <thead className="bg-table-header text-muted-foreground">
            <tr>
              {OPER_COLUMNS.map((col) => (
                <SortableTh
                  key={col.key}
                  col={col}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  toggleSort={toggleSort}
                  widthOf={widthOf}
                  startResize={startResize}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={OPER_COLUMNS.length} className="px-3 py-10 text-center text-muted-foreground">
                  加载中…
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={OPER_COLUMNS.length} className="px-3 py-10 text-center text-muted-foreground">
                  暂无日志
                </td>
              </tr>
            ) : (
              sorted.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-b border-border/50 last:border-0 bg-table-row even:bg-table-stripe hover:bg-table-hover"
                  onClick={() => setDetail(row)}
                >
                  <td className="px-3 py-2 text-muted-foreground">{formatTime(row.operTime)}</td>
                  <td className="px-3 py-2">{row.username ?? '—'}</td>
                  <td className="px-3 py-2">{row.module ?? '—'}</td>
                  <td className="px-3 py-2">{row.operation ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {row.requestMethod} {row.requestUri}
                  </td>
                  <td className="px-3 py-2">{row.durationMs != null ? `${row.durationMs}ms` : '—'}</td>
                  <td className="px-3 py-2">{row.responseCode ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
        <span>共 {total} 条</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            上一页
          </Button>
          <span>
            {page}/{totalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </Button>
        </div>
      </div>

      <Sheet open={detail !== null} onOpenChange={(v) => !v && setDetail(null)}>
        <SheetContent className="flex w-full flex-col sm:max-w-md">
          <SheetHeader>
            <SheetTitle>操作日志详情</SheetTitle>
            <SheetDescription>请求与执行明细（只读）。</SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-3 overflow-auto px-5 py-4">
            {detail ? (
              <div className="space-y-3">
                <DetailField label="时间">{formatTime(detail.operTime)}</DetailField>
                <DetailField label="用户">{detail.username ?? '—'}</DetailField>
                <DetailField label="模块">{detail.module ?? '—'}</DetailField>
                <DetailField label="操作">{detail.operation ?? '—'}</DetailField>
                <DetailField label="方法">{detail.requestMethod ?? '—'}</DetailField>
                <DetailField label="URI" mono>
                  {detail.requestUri ?? '—'}
                </DetailField>
                <DetailField label="状态码">{detail.responseCode ?? '—'}</DetailField>
                <DetailField label="耗时">
                  {detail.durationMs != null ? `${detail.durationMs} ms` : '—'}
                </DetailField>
                <DetailField label="IP">{detail.ip ?? '—'}</DetailField>
                <DetailField label="参数" mono>
                  {detail.requestParams?.trim() ? detail.requestParams : '—'}
                </DetailField>
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function LoginLogListPage() {
  const [rows, setRows] = useState<LoginLogItem[]>([]);
  const [username, setUsername] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<LoginLogItem | null>(null);
  const size = 20;

  const { widthOf, startResize, hasCustom, reset: resetColWidths, tableStyle } = useColumnWidths(
    LOGIN_COLUMNS,
    'mis-login-log-table-widths',
  );

  const getValue = useCallback((row: LoginLogItem, key: string) => {
    switch (key) {
      case 'loginAt':
        return row.loginAt ?? '';
      case 'username':
        return row.username;
      case 'ip':
        return row.ip ?? '';
      case 'status':
        return row.status;
      case 'msg':
        return row.msg ?? '';
      default:
        return null;
    }
  }, []);
  const { sorted, sortKey, sortDir, toggleSort } = useClientSort(rows, getValue);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await pageLoginLogs({
        page,
        size,
        username: username.trim() || undefined,
      });
      setRows(data.list ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载登录日志失败');
    } finally {
      setLoading(false);
    }
  }, [page, username]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / size));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="登录日志"
        description="登录成功/失败审计。"
        breadcrumbs={buildAppBreadcrumbs({
          app: 'system',
          group: '审计',
          title: '登录日志',
        })}
        actions={
          hasCustom ? (
            <Button type="button" variant="outline" size="sm" onClick={resetColWidths}>
              重置列宽
            </Button>
          ) : null
        }
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <Input
          className="h-9 w-40"
          placeholder="用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setPage(1);
            void load();
          }}
        >
          <Search className="h-4 w-4" />
          查询
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-table-surface">
        <table className="border-separate border-spacing-0 bg-table-surface text-left text-sm" style={tableStyle}>
          <thead className="bg-table-header text-muted-foreground">
            <tr>
              {LOGIN_COLUMNS.map((col) => (
                <SortableTh
                  key={col.key}
                  col={col}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  toggleSort={toggleSort}
                  widthOf={widthOf}
                  startResize={startResize}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={LOGIN_COLUMNS.length} className="px-3 py-10 text-center text-muted-foreground">
                  加载中…
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={LOGIN_COLUMNS.length} className="px-3 py-10 text-center text-muted-foreground">
                  暂无日志
                </td>
              </tr>
            ) : (
              sorted.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-b border-border/50 last:border-0 bg-table-row even:bg-table-stripe hover:bg-table-hover"
                  onClick={() => setDetail(row)}
                >
                  <td className="px-3 py-2 text-muted-foreground">{formatTime(row.loginAt)}</td>
                  <td className="px-3 py-2">{row.username}</td>
                  <td className="px-3 py-2">{row.ip ?? '—'}</td>
                  <td className="px-3 py-2">
                    <StatusBadge tone={row.status === 1 ? 'success' : 'destructive'} text={row.status === 1 ? '成功' : '失败'} />
                  </td>
                  <td className="px-3 py-2">{row.msg ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
        <span>共 {total} 条</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            上一页
          </Button>
          <span>
            {page}/{totalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </Button>
        </div>
      </div>

      <Sheet open={detail !== null} onOpenChange={(v) => !v && setDetail(null)}>
        <SheetContent className="flex w-full flex-col sm:max-w-md">
          <SheetHeader>
            <SheetTitle>登录日志详情</SheetTitle>
            <SheetDescription>登录环境与结果明细（只读）。</SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-3 overflow-auto px-5 py-4">
            {detail ? (
              <div className="space-y-3">
                <DetailField label="时间">{formatTime(detail.loginAt)}</DetailField>
                <DetailField label="用户">{detail.username}</DetailField>
                <DetailField label="IP">{detail.ip ?? '—'}</DetailField>
                <DetailField label="状态">
                  <StatusBadge
                    tone={detail.status === 1 ? 'success' : 'destructive'}
                    text={detail.status === 1 ? '成功' : '失败'}
                  />
                </DetailField>
                <DetailField label="消息">{detail.msg ?? '—'}</DetailField>
                <DetailField label="客户端" mono>
                  {detail.userAgent?.trim() ? detail.userAgent : '—'}
                </DetailField>
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
