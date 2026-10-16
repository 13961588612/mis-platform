import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, RefreshCw } from 'lucide-react';
import { summaryApi } from '@/lib/api/summary';
import { scenariosApi } from '@/lib/api/scenarios';
import { syncShellRoute } from '@/lib/router/shell-nav';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { SummaryRow } from '@/types/api';

/** 策略中文小标（§1.6 中文 + 英文值） */
const STRATEGY_LABEL: Record<string, string> = {
  exact_key: '精确匹配',
  composite_key: '复合键',
  sum_check: '汇总校验',
  custom: '自定义',
  custom_check: '整检查自定义',
};

/** 行级展示状态：执行失败 / 进行中 / 已跳过 / 成功 / 未运行 */
type RowState = 'failed' | 'running' | 'skipped' | 'success' | 'norun';

function rowState(r: SummaryRow): RowState {
  if (r.run_status === 'failed') return 'failed';
  if (r.run_status === 'running') return 'running';
  if (r.run_status === 'skipped') return 'skipped';
  if (r.run_status === 'success') return 'success';
  return 'norun';
}

const fmtTime = (t?: string | null) => (t || t === '' ? t : '—');

/** 整体累计数值：null（主数据源未配置）→ — */
function stat(n?: number | null): string {
  return n == null ? '—' : String(n);
}

export function SummaryPage() {
  const navigate = useNavigate();

  const [scenarioCode, setScenarioCode] = useState('');
  const [status, setStatus] = useState('');
  const [queryKey, setQueryKey] = useState<{ scenarioCode: string; status: string }>({
    scenarioCode: '',
    status: '',
  });

  const { data, isLoading, refetch } = useQuery<SummaryRow[]>({
    queryKey: ['summary', queryKey],
    queryFn: () =>
      summaryApi.list({
        scenarioCode: queryKey.scenarioCode || undefined,
        status: queryKey.status || undefined,
      }),
  });

  // 场景下拉（平台全部场景）
  const { data: scenarioPage } = useQuery({
    queryKey: ['summary-scenario-options'],
    queryFn: () => scenariosApi.list({ page: 1, size: 1000 }),
  });

  function applyFilter() {
    setQueryKey({ scenarioCode, status });
  }

  function resetFilter() {
    setScenarioCode('');
    setStatus('');
    setQueryKey({ scenarioCode: '', status: '' });
  }

  // 顶部 4 卡（随筛选联动，v1.3 §3.3）
  const cards = useMemo(() => {
    const rows = data ?? [];
    const total = rows.length;
    const success = rows.filter((r) => rowState(r) === 'success').length;
    const failed = rows.filter((r) => rowState(r) === 'failed' || (r.fail ?? 0) > 0).length;
    const openDiff = rows.reduce((sum, r) => sum + Number(r.diff ?? 0), 0);
    return { total, success, failed, openDiff };
  }, [data]);

  /** 下钻差异处理列表视图：预筛选参数写 URL（DiffsPage 初始化读取）；iframe 模式同步壳子侧栏选中 */
  function drillDiffs(params: Record<string, string>) {
    const sp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) sp.set(k, v);
    });
    const target = `/diffs?${sp.toString()}`;
    if (!syncShellRoute(target)) navigate(target);
  }

  return (
    <div className="space-y-4">
      {/* 顶部 4 卡（R69） */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="flex flex-col gap-1 p-4">
            <span className="text-xs text-muted-foreground">对账总数</span>
            <span className="text-2xl font-semibold">{cards.total}</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 p-4">
            <span className="text-xs text-muted-foreground">成功对账</span>
            <span className="text-2xl font-semibold text-green-600">{cards.success}</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 p-4">
            <span className="text-xs text-muted-foreground">失败对账</span>
            <span className="text-2xl font-semibold text-destructive">{cards.failed}</span>
            <span className="text-[10px] text-muted-foreground">含异常存量 &gt;0 的对账</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 p-4">
            <span className="text-xs text-muted-foreground">未处理差异</span>
            <span className="text-2xl font-semibold text-orange-500" title="当前差异池存量（不含异常，跨轮累计）">
              {cards.openDiff}
            </span>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              对账汇总
            </CardTitle>
            <CardDescription>整体累计对账结果 · 无轮次，专注当下的整体结果（对账汇总 R13~R15）</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> 刷新
          </Button>
        </CardHeader>
        <CardContent>
          {/* 筛选区（R70）：场景 / 状态 + 查询/重置（无轮次，v1.3） */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <select
              className="flex h-9 rounded-md border border-input bg-card px-3 text-sm"
              value={scenarioCode}
              onChange={(e) => setScenarioCode(e.target.value)}
            >
              <option value="">场景:全部</option>
              {(scenarioPage?.list ?? []).map((s) => (
                <option key={s.scenario_code} value={s.scenario_code}>
                  {s.name ? `${s.name}（${s.scenario_code}）` : s.scenario_code}
                </option>
              ))}
            </select>
            <select
              className="flex h-9 rounded-md border border-input bg-card px-3 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              title="按最近一次执行状态筛选"
            >
              <option value="">状态:全部</option>
              <option value="success">成功</option>
              <option value="failed">失败</option>
              <option value="running">进行中</option>
              <option value="skipped">已跳过</option>
            </select>
            <Button size="sm" onClick={applyFilter}>
              查询
            </Button>
            <Button size="sm" variant="outline" onClick={resetFilter}>
              重置
            </Button>
          </div>

          {/* 汇总表（v1.3 §3.1：8 列，每 check 一行，整体累计） */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>对账</TableHead>
                <TableHead>场景</TableHead>
                <TableHead
                  className="text-right"
                  title="总数 = 成功 + 差异 + 失败（整体累计，跨轮去重，含对端独有笔数）"
                >
                  总数
                </TableHead>
                <TableHead className="text-right">成功</TableHead>
                <TableHead
                  className="text-right"
                  title="当前未处理池存量（不含异常，跨轮累计）；点击查看该对账未处理差异"
                >
                  差异（未处理）
                </TableHead>
                <TableHead className="text-right">失败</TableHead>
                <TableHead
                  className="whitespace-nowrap"
                  title="统计列为整体累计，最近执行为最近一次运行记录"
                >
                  最近执行
                </TableHead>
                <TableHead>状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    加载中…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && (data?.length ?? 0) === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    暂无对账数据，请先配置场景与检查
                  </TableCell>
                </TableRow>
              )}
              {data?.map((r) => {
                const state = rowState(r);
                const execFailed = state === 'failed';
                const rowCls = execFailed
                  ? 'bg-red-50/70 hover:bg-red-50'
                  : state === 'skipped' || state === 'norun'
                    ? 'opacity-60'
                    : undefined;
                const total = r.total ?? null;
                return (
                  <TableRow key={`${r.scenario_code}-${r.check_name}`} className={rowCls}>
                    <TableCell>
                      <button
                        type="button"
                        className="text-[13px] font-medium text-blue-600 hover:underline"
                        onClick={() => drillDiffs({ scenarioCode: r.scenario_code, checkName: r.check_name })}
                        title={`查看 ${r.scenario_code} / ${r.check_name} 的差异`}
                      >
                        {r.check_name}
                      </button>
                      <div className="mt-0.5">
                        <Badge variant="secondary" className="text-[10px] font-normal">
                          {STRATEGY_LABEL[r.strategy] ?? r.strategy}
                          <span className="ml-1 opacity-70">{r.strategy}</span>
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        className="text-[13px] text-blue-600 hover:underline"
                        onClick={() => drillDiffs({ scenarioCode: r.scenario_code })}
                        title={`查看场景 ${r.scenario_code} 的全部差异`}
                      >
                        {r.scenario_code}
                      </button>
                    </TableCell>
                    <TableCell className="text-right font-mono text-[13px]">{stat(total)}</TableCell>
                    <TableCell className="text-right font-mono text-[13px] text-green-700">
                      {stat(r.success)}
                    </TableCell>
                    <TableCell className="text-right">
                      {(r.diff ?? 0) > 0 ? (
                        <button
                          type="button"
                          className="font-mono text-[13px] font-medium text-orange-600 hover:underline"
                          onClick={() =>
                            drillDiffs({
                              scenarioCode: r.scenario_code,
                              checkName: r.check_name,
                              handleStatus: 'unhandled',
                            })
                          }
                          title="查看该对账未处理差异（待确认/已确认，不含异常）"
                        >
                          {stat(r.diff)}
                        </button>
                      ) : (
                        <span className="font-mono text-[13px] text-muted-foreground">{stat(r.diff)}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[13px]">
                      {execFailed ? (
                        <span className="font-medium text-red-600" title={r.err_msg ?? ''}>
                          执行失败
                        </span>
                      ) : (r.fail ?? 0) > 0 ? (
                        <button
                          type="button"
                          className="text-red-600 hover:underline"
                          onClick={() =>
                            drillDiffs({
                              scenarioCode: r.scenario_code,
                              checkName: r.check_name,
                              diffType: 'anomaly',
                            })
                          }
                          title="查看差异类型=数据异常"
                        >
                          {stat(r.fail)}
                        </button>
                      ) : (
                        <span className="text-muted-foreground">{stat(r.fail)}</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                      {fmtTime(r.latest_run_time)}
                    </TableCell>
                    <TableCell>
                      {state === 'failed' && (
                        <Badge variant="destructive" title={r.err_msg ?? ''}>
                          失败
                        </Badge>
                      )}
                      {state === 'running' && <Badge variant="default">进行中</Badge>}
                      {state === 'skipped' && <Badge variant="secondary">已跳过</Badge>}
                      {state === 'success' && <Badge variant="success">成功</Badge>}
                      {state === 'norun' && <Badge variant="secondary">未运行</Badge>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
