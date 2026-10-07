/**
 * iqd-trace-page.tsx — 问数审计回查（W3，路径 /iqd/traces）。
 *
 * <p>运营/QA 联调审计：分页回查 iqd_ask_log（用户/问题/状态/耗时/命中表），
 * 点开单条查看完整计划时间线 + SQL 代码块 + 引用明细（需 iqd:trace:view；
 * 无该码 BFF 后端裁定拒绝，前端 view 仅为建议）。
 */

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { Badge } from '@/components/ui/badge';
import {
  getIqdTrace,
  listIqdTraces,
  type IqdAskLog,
} from '@/lib/api/iqd';

export const IQD_TRACE_PAGE_PATH = '/iqd/traces';

const PLAN_LABEL: Record<string, string> = {
  scope_check: '范围校验',
  understanding: '意图理解',
  searching: '语义检索',
  generating: 'SQL 生成',
  lineage_check: '血缘校验',
  executing: '执行',
  masking: '脱敏',
  finished: '完成',
};

const STATUS_LABEL: Record<string, string> = {
  succeeded: '成功',
  failed: '失败',
  denied: '拒绝',
  running: '进行中',
  unsupported: '不支持',
};

function tryParseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

interface PlanStepView {
  seq: number;
  code: string;
  label?: string;
  detail?: string | null;
  sql?: string | null;
  status: string;
  duration_ms?: number | null;
}

interface CitationView {
  kind: string;
  item_key: string;
  display_name?: string;
  snippet?: string | null;
}

export function IqdTracePage() {
  const [logs, setLogs] = useState<IqdAskLog[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<IqdAskLog | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await listIqdTraces({
        limit: 100,
        status: statusFilter.trim() || undefined,
      });
      // 时间倒序兜底（后端已按 created_at desc；同秒按 id desc）
      const sorted = [...items].sort((a, b) => {
        const ta = a.created_at ? Date.parse(a.created_at) : 0;
        const tb = b.created_at ? Date.parse(b.created_at) : 0;
        if (tb !== ta) return tb - ta;
        return (b.id ?? 0) - (a.id ?? 0);
      });
      setLogs(sorted);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载审计日志失败');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = useCallback(async (id: number | undefined) => {
    if (id == null) return;
    setError(null);
    try {
      const detail = await getIqdTrace(id);
      setSelected(detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载审计详情失败');
    }
  }, []);

  const planSteps: PlanStepView[] = selected
    ? tryParseJson<PlanStepView[]>(selected.plan_steps, [])
    : [];
  const citations: CitationView[] = selected
    ? tryParseJson<CitationView[]>(selected.citations, [])
    : [];
  const maskedColumns: string[] = selected
    ? tryParseJson<string[]>(selected.masked_columns, [])
    : [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="问数审计"
        description="回查问数日志：用户/问题/状态/耗时/命中表，展开查看完整计划与 SQL（需 iqd:trace:view）。"
        breadcrumbs={buildAppBreadcrumbs({ app: 'agent', title: '问数审计' })}
        actions={
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            刷新
          </Button>
        }
      />

      {error ? (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <div className="mb-3 flex items-center gap-2">
        <Input
          className="w-56"
          placeholder="状态过滤（succeeded/failed/denied）"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        />
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          查询
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
        {/* 左：日志列表 */}
        <div className="overflow-auto rounded-lg border bg-card">
          {logs.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {loading ? '加载中…' : '暂无问数日志'}
            </div>
          ) : (
            <table className="w-full border-separate border-spacing-0 bg-table-surface text-left text-sm">
              <thead className="border-b-2 border-foreground/20 bg-table-header text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-bold">时间</th>
                  <th className="px-3 py-2 font-bold">用户</th>
                  <th className="px-3 py-2 font-bold">问题</th>
                  <th className="px-3 py-2 font-bold">状态</th>
                  <th className="px-3 py-2 font-bold">耗时</th>
                  <th className="w-14 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr
                    key={log.id}
                    className="cursor-pointer border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe hover:bg-accent"
                    onClick={() => void openDetail(log.id)}
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                      {log.created_at ? new Date(log.created_at).toLocaleString() : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs">{log.employee_id || log.user_id || '—'}</td>
                    <td className="max-w-[16rem] truncate px-3 py-2 text-xs" title={log.question ?? ''}>
                      {log.question ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <Badge
                        variant={
                          log.status === 'succeeded'
                            ? 'default'
                            : log.status === 'denied'
                              ? 'warning'
                              : 'destructive'
                        }
                      >
                        {STATUS_LABEL[log.status ?? ''] ?? log.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {log.latency_ms != null ? `${log.latency_ms} ms` : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          void openDetail(log.id);
                        }}
                      >
                        详情
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 右：详情 */}
        <div className="overflow-auto rounded-lg border bg-card">
          {selected ? (
            <div className="space-y-3 p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge
                  variant={selected.status === 'succeeded' ? 'default' : 'destructive'}
                >
                  {STATUS_LABEL[selected.status ?? ''] ?? selected.status}
                </Badge>
                <span className="text-muted-foreground">{selected.query_id}</span>
                <span className="text-muted-foreground">
                  {selected.user_id != null ? `user=${selected.user_id}` : ''}
                  {selected.employee_id ? ` · ${selected.employee_id}` : ''}
                </span>
                {selected.simulated_role_code ? (
                  <Badge variant="secondary">模拟角色 {selected.simulated_role_code}</Badge>
                ) : null}
                <span className="text-muted-foreground">
                  {selected.latency_ms != null ? `${selected.latency_ms} ms` : ''}
                </span>
                {maskedColumns.length > 0 ? (
                  <Badge variant="secondary">脱敏 {maskedColumns.join(', ')}</Badge>
                ) : null}
              </div>

              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">问题</div>
                <div className="text-sm">{selected.question ?? '—'}</div>
              </div>

              {/* 完整计划时间线（W3：各阶段 status+耗时+SQL） */}
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  完整计划时间线
                </div>
                <ol className="space-y-1">
                  {planSteps.length === 0 ? (
                    <li className="text-xs text-muted-foreground">无计划步骤</li>
                  ) : (
                    planSteps.map((p) => (
                      <li key={p.seq} className="rounded-md border border-border/60 p-2">
                        <div className="flex items-center gap-2 text-xs">
                          <span
                            className={cn(
                              'h-1.5 w-1.5 rounded-full',
                              p.status === 'done'
                                ? 'bg-success'
                                : p.status === 'failed'
                                  ? 'bg-destructive'
                                  : 'bg-muted',
                            )}
                          />
                          <span className="w-20 shrink-0 font-medium">
                            {PLAN_LABEL[p.code] ?? p.code}
                          </span>
                          <span className="truncate text-muted-foreground">{p.detail ?? ''}</span>
                          {p.duration_ms != null ? (
                            <span className="ml-auto shrink-0 text-muted-foreground">
                              {p.duration_ms} ms
                            </span>
                          ) : null}
                        </div>
                        {p.sql ? (
                          <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 font-mono text-[0.7rem] leading-relaxed">
                            {p.sql}
                          </pre>
                        ) : null}
                      </li>
                    ))
                  )}
                </ol>
              </div>

              {/* SQL 代码块 */}
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  SQL（注入后）{selected.sql_dialect ? ` · ${selected.sql_dialect}` : ''}
                </div>
                <pre className="max-h-64 overflow-auto rounded bg-muted p-2 font-mono text-[0.7rem] leading-relaxed">
                  {selected.sql_text || '（user 视图无 SQL）'}
                </pre>
              </div>

              {/* 引用明细 */}
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">引用明细</div>
                {citations.length === 0 ? (
                  <div className="text-xs text-muted-foreground">无引用</div>
                ) : (
                  <ul className="space-y-1">
                    {citations.map((c) => (
                      <li key={`${c.kind}-${c.item_key}`} className="rounded-md border border-border/60 p-2 text-xs">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{c.kind}</Badge>
                          <span className="font-mono">{c.item_key}</span>
                          <span className="text-muted-foreground">{c.display_name ?? ''}</span>
                        </div>
                        {c.snippet ? (
                          <div className="mt-1 text-muted-foreground">{c.snippet}</div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {selected.error_message ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                  {selected.error_message}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              点击左侧日志查看详情
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default IqdTracePage;
