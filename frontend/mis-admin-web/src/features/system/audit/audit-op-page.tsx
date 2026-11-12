import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  fetchAuditOpDetail,
  fetchAuditOps,
  fetchAuditStats,
  parseDiff,
  type AuditOpDetail,
  type AuditOpItem,
  type AuditStats,
} from '@/lib/api/audit-ops';
import { cn } from '@/lib/utils';

/**
 * 系统管理 · 操作审计（P4）。
 *
 * <p>结构化展示业务操作日志，支持多条件筛选与 before/after 变更对比；
 * 无需再在程序日志的 JSON 里排查。见 docs/architecture/msg-log-workflow/02-operational-logging-design.md。
 */
export function AuditOpPage() {
  // 单租户阶段固定 tenantId=1；网关身份透传后改为从登录态取。
  const tenantId = '1';

  const [items, setItems] = useState<AuditOpItem[]>([]);
  const [stats, setStats] = useState<AuditStats>({ total: 0, failed: 0 });
  const [keyword, setKeyword] = useState('');
  const [module, setModule] = useState('');
  const [operationType, setOperationType] = useState('');
  const [resultStatus, setResultStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [detail, setDetail] = useState<AuditOpDetail | null>(null);
  const size = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchAuditOps({
        tenantId,
        keyword: keyword.trim() || undefined,
        module: module.trim() || undefined,
        operationType: operationType.trim() || undefined,
        resultStatus: resultStatus || undefined,
        page,
        size,
      });
      setItems(result.list);
      setTotal(result.total);
      setStats(await fetchAuditStats(tenantId, 7));
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [tenantId, keyword, module, operationType, resultStatus, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / size)), [total]);

  async function openDetail(item: AuditOpItem) {
    try {
      setDetail(await fetchAuditOpDetail(item.id, tenantId));
    } catch (e) {
      setError(e instanceof Error ? e.message : '获取详情失败');
    }
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader
        title="操作审计"
        description="谁对什么业务做了什么 —— 结构化操作日志与变更对比"
        actions={
          <div className="flex items-center gap-3 text-xs">
            <span className="text-muted-foreground">近7天操作 <b className="text-foreground">{stats.total}</b></span>
            <span className={cn(stats.failed > 0 ? 'text-destructive' : 'text-muted-foreground')}>
              失败 <b>{stats.failed}</b>
            </span>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Input value={module} onChange={(e) => setModule(e.target.value)} placeholder="模块" className="h-8 w-32" />
        <Input
          value={operationType}
          onChange={(e) => setOperationType(e.target.value)}
          placeholder="操作类型"
          className="h-8 w-32"
        />
        <select
          value={resultStatus}
          onChange={(e) => setResultStatus(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">全部结果</option>
          <option value="SUCCESS">成功</option>
          <option value="FAIL">失败</option>
        </select>
        <Input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setPage(1);
              void load();
            }
          }}
          placeholder="搜索描述 / 业务ID"
          className="h-8 w-56"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setPage(1);
            void load();
          }}
        >
          <Search className="mr-1 h-3.5 w-3.5" />
          查询
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-card">
        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">加载中…</div>
        ) : error ? (
          <div className="flex h-40 items-center justify-center text-sm text-destructive">{error}</div>
        ) : items.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">暂无审计记录</div>
        ) : (
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">时间</th>
                <th className="px-3 py-2 font-medium">用户</th>
                <th className="px-3 py-2 font-medium">模块</th>
                <th className="px-3 py-2 font-medium">操作</th>
                <th className="px-3 py-2 font-medium">业务</th>
                <th className="px-3 py-2 font-medium">描述</th>
                <th className="px-3 py-2 font-medium">结果</th>
                <th className="px-3 py-2 font-medium">耗时</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="cursor-pointer border-t transition hover:bg-muted/40"
                  onClick={() => void openDetail(item)}
                >
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {item.operTime?.replace('T', ' ').slice(0, 19)}
                  </td>
                  <td className="px-3 py-2">{item.username ?? '-'}</td>
                  <td className="px-3 py-2">{item.module ?? '-'}</td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{item.operationType}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {item.businessType ? `${item.businessType} / ${item.businessId ?? '-'}` : '-'}
                  </td>
                  <td className="max-w-[280px] truncate px-3 py-2" title={item.description ?? ''}>
                    {item.description ?? '-'}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        'rounded px-1.5 py-0.5 text-[11px]',
                        item.resultStatus === 'SUCCESS'
                          ? 'bg-success/10 text-success'
                          : 'bg-destructive/10 text-destructive',
                      )}
                    >
                      {item.resultStatus === 'SUCCESS' ? '成功' : '失败'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {item.durationMs != null ? `${item.durationMs}ms` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          共 <b className="text-foreground">{total}</b> 条 · 第 {page}/{totalPages} 页
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            上一页
          </Button>
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

      <Dialog open={detail != null} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detail?.description ?? '操作详情'}</DialogTitle>
          </DialogHeader>
          {detail ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground">用户：</span>{detail.username ?? '-'}</div>
                <div><span className="text-muted-foreground">时间：</span>{detail.operTime?.replace('T', ' ').slice(0, 19)}</div>
                <div><span className="text-muted-foreground">模块：</span>{detail.module ?? '-'}</div>
                <div><span className="text-muted-foreground">操作：</span>{detail.operationType}</div>
                <div><span className="text-muted-foreground">业务：</span>{detail.businessType ?? '-'} / {detail.businessId ?? '-'}</div>
                <div><span className="text-muted-foreground">耗时：</span>{detail.durationMs != null ? `${detail.durationMs}ms` : '-'}</div>
              </div>

              <div>
                <div className="mb-1 text-sm font-medium">变更对比</div>
                {parseDiff(detail.diffSummary).length === 0 ? (
                  <div className="text-sm text-muted-foreground">无字段差异</div>
                ) : (
                  <table className="w-full border-separate border-spacing-0 text-sm">
                    <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-1.5 font-medium">字段</th>
                        <th className="px-3 py-1.5 font-medium">变更前</th>
                        <th className="px-3 py-1.5 font-medium">变更后</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parseDiff(detail.diffSummary).map((d) => (
                        <tr key={d.field} className="border-t">
                          <td className="px-3 py-1.5 font-mono text-xs">{d.field}</td>
                          <td className="px-3 py-1.5 text-destructive">{d.old ?? '—'}</td>
                          <td className="px-3 py-1.5 text-success">{d.new ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {detail.errorMsg ? (
                <div>
                  <div className="mb-1 text-sm font-medium text-destructive">错误信息</div>
                  <pre className="max-h-40 overflow-auto rounded bg-destructive/5 p-2 text-xs text-destructive">
                    {detail.errorMsg}
                  </pre>
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default AuditOpPage;