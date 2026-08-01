import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/common/page-header';
import { StatusBadge } from '@/components/common/list-page-skeleton';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { pageLoginLogs, pageOperLogs } from '@/lib/api/dicts';
import type { LoginLogItem, OperLogItem } from '@/types/api';

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

export function OperLogListPage() {
  const [rows, setRows] = useState<OperLogItem[]>([]);
  const [username, setUsername] = useState('');
  const [module, setModule] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<OperLogItem | null>(null);
  const size = 20;

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
    <div className="flex min-h-0 flex-1 flex-col p-4 md:p-5">
      <PageHeader title="操作日志" description="管理端操作审计（只读）。" />
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
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-card">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead className="sticky top-0 z-10 border-b bg-muted/60 text-muted-foreground backdrop-blur">
            <tr>
              <th className="px-3 py-2 font-bold">时间</th>
              <th className="px-3 py-2 font-bold">用户</th>
              <th className="px-3 py-2 font-bold">模块</th>
              <th className="px-3 py-2 font-bold">操作</th>
              <th className="px-3 py-2 font-bold">URI</th>
              <th className="px-3 py-2 font-bold">耗时</th>
              <th className="px-3 py-2 font-bold">结果</th>
            </tr>
          </thead>
          <tbody className="bg-muted/40">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                  加载中…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                  暂无日志
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-b border-border/50 last:border-0 hover:bg-muted/70 even:bg-muted/60"
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
          <div className="flex-1 overflow-auto py-4">
            {detail ? (
              <div>
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
    <div className="flex min-h-0 flex-1 flex-col p-4 md:p-5">
      <PageHeader title="登录日志" description="登录成功/失败审计。" />
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
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 z-10 border-b bg-muted/60 text-muted-foreground backdrop-blur">
            <tr>
              <th className="px-3 py-2 font-bold">时间</th>
              <th className="px-3 py-2 font-bold">用户</th>
              <th className="px-3 py-2 font-bold">IP</th>
              <th className="px-3 py-2 font-bold">状态</th>
              <th className="px-3 py-2 font-bold">消息</th>
            </tr>
          </thead>
          <tbody className="bg-muted/40">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">
                  加载中…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">
                  暂无日志
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-b border-border/50 last:border-0 hover:bg-muted/70 even:bg-muted/60"
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
          <div className="flex-1 overflow-auto py-4">
            {detail ? (
              <div>
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
