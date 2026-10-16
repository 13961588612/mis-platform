import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Activity, ActivitySquare, BellRing, Download, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { runsApi } from '@/lib/api/reports';
import { scenariosApi } from '@/lib/api/scenarios';
import { datasourcesApi } from '@/lib/api/datasources';
import { errMsg } from '@/lib/api/client';
import type { ReconRunDetailRow } from '@/types/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DateTimeInput } from '@/components/ui/datetime-input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const RUN_BADGE: Record<string, { label: string; variant: 'warning' | 'success' | 'destructive' | 'secondary' }> = {
  running: { label: '运行中', variant: 'warning' },
  success: { label: '成功', variant: 'success' },
  failed: { label: '失败', variant: 'destructive' },
  skipped: { label: '已跳过', variant: 'secondary' },
  partial_success: { label: '部分成功', variant: 'warning' },
};

const HEALTH_BADGE: Record<string, { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' }> = {
  healthy: { label: '健康', variant: 'success' },
  degraded: { label: '质量降级', variant: 'warning' },
  empty: { label: '空窗口', variant: 'warning' },
  error: { label: '拉取失败', variant: 'destructive' },
  unknown: { label: '未知', variant: 'secondary' },
};

function fmt(t?: string | null): string {
  return t ? t.replace('T', ' ').slice(0, 19) : '-';
}

function fmtShort(t?: string | null): string {
  return t ? t.replace('T', ' ').slice(5, 16) : '-';
}

/** 差异池账龄分布桶颜色（超 30 天标红） */
function agingClass(bucket: string): string {
  return bucket === '30+' ? 'bg-destructive' : 'bg-primary';
}

/** 拉取运行查询参数（应用式筛选） */
interface PullRunQuery {
  page: number;
  size: number;
  dsCode?: string;
  status?: string;
  healthStatus?: string;
  dateFrom?: string;
  dateTo?: string;
}

/** 对账运行查询参数（应用式筛选） */
interface ReconRunQuery {
  page: number;
  size: number;
  scenarioCode?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}

export function MonitorPage() {
  const [tab, setTab] = useState('pull');
  // 拉取：草稿筛选（下拉/时间）与应用后参数分离，点击"查询"才生效
  const [pullFilters, setPullFilters] = useState({ dsCode: '', status: '', health: '', dateFrom: '', dateTo: '' });
  const [pullParams, setPullParams] = useState<PullRunQuery>({ page: 1, size: 20 });
  // 对账：同上
  const [reconFilters, setReconFilters] = useState({ scenarioCode: '', status: '', dateFrom: '', dateTo: '' });
  const [reconParams, setReconParams] = useState<ReconRunQuery>({ page: 1, size: 20 });
  // 告警留痕（v6.9 R85 迁入监控页第 3 tab）：草稿筛选 + 应用参数分离
  const [alertFilters, setAlertFilters] = useState({ severity: '', channel: '', dateFrom: '', dateTo: '' });
  const [alertParams, setAlertParams] = useState<{ page: number; size: number; severity?: string; channel?: string; dateFrom?: string; dateTo?: string }>({ page: 1, size: 20 });
  const [alertContent, setAlertContent] = useState<{ id: number; content?: string | null } | null>(null);
  const [manualPullOpen, setManualPullOpen] = useState(false);
  const [manualReconOpen, setManualReconOpen] = useState(false);
  const [runDetailId, setRunDetailId] = useState<number | null>(null);
  const [healthRow, setHealthRow] = useState<{ id: number; ds_code: string; health_status?: string | null; err_msg?: string | null } | null>(null);

  const { data: recon, isLoading: reconLoading, refetch: refetchRecon } = useQuery({
    queryKey: ['recon-runs', reconParams],
    queryFn: async () => {
      try {
        return await runsApi.reconRuns(reconParams);
      } catch (e) {
        toast.error(`对账运行查询失败：${errMsg(e)}`);
        throw e;
      }
    },
  });
  const { data: pulls, isLoading: pullLoading, refetch: refetchPull } = useQuery({
    queryKey: ['pull-runs', pullParams],
    queryFn: async () => {
      try {
        return await runsApi.pullRuns(pullParams);
      } catch (e) {
        toast.error(`拉取运行查询失败：${errMsg(e)}`);
        throw e;
      }
    },
  });
  const { data: health, isLoading: healthLoading } = useQuery({
    queryKey: ['health-overview'],
    queryFn: () => runsApi.healthOverview(),
  });
  const { data: trend, isLoading: trendLoading } = useQuery({
    queryKey: ['recon-trend'],
    queryFn: () => runsApi.reconTrend(7),
  });
  const { data: aging, isLoading: agingLoading } = useQuery({
    queryKey: ['diff-aging'],
    queryFn: () => runsApi.diffAging(),
  });
  const { data: alerts } = useQuery({
    queryKey: ['alert-feed'],
    queryFn: () => runsApi.alertLogs({ page: 1, size: 5 }),
  });
  // 告警留痕主列表（第 3 tab）
  const { data: alertList, isLoading: alertsLoading, refetch: refetchAlerts } = useQuery({
    queryKey: ['alert-logs', alertParams],
    queryFn: () => runsApi.alertLogs(alertParams),
  });
  // 重发：同一场景重新扫描未报告差异（reported_at 防重）
  const resend = useMutation({
    mutationFn: (code: string) => runsApi.resendReport(code),
    onSuccess: (r) => {
      toast.success(`已重发：diff=${r.diff_count} send=${r.send_status}`);
      refetchAlerts();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const { data: runDetail, isLoading: runDetailLoading } = useQuery({
    queryKey: ['recon-run-detail', runDetailId],
    queryFn: () => runsApi.reconRunDetail(runDetailId!),
    enabled: runDetailId != null,
  });
  const { data: datasources } = useQuery({
    queryKey: ['datasources'],
    queryFn: () => datasourcesApi.list({ page: 1, size: 100 }),
  });
  const { data: scenarios } = useQuery({
    queryKey: ['scenarios'],
    queryFn: () => scenariosApi.list({ page: 1, size: 100 }),
  });

  /** 应用拉取筛选（DateTimeInput 已统一为 yyyy-MM-dd HH:mm:ss） */
  function applyPullFilter() {
    const next: PullRunQuery = { page: 1, size: 20 };
    if (pullFilters.dsCode) next.dsCode = pullFilters.dsCode;
    if (pullFilters.status) next.status = pullFilters.status;
    if (pullFilters.health) next.healthStatus = pullFilters.health;
    if (pullFilters.dateFrom) next.dateFrom = pullFilters.dateFrom;
    if (pullFilters.dateTo) next.dateTo = pullFilters.dateTo;
    setPullParams(next);
    // 参数未变化时（空条件点查询）queryKey 不变、不会自动 refetch，需手动刷新
    if (JSON.stringify(next) === JSON.stringify(pullParams)) {
      refetchPull();
    }
  }

  function resetPullFilter() {
    setPullFilters({ dsCode: '', status: '', health: '', dateFrom: '', dateTo: '' });
    setPullParams({ page: 1, size: 20 });
  }

  /** 应用对账筛选（DateTimeInput 已统一为 yyyy-MM-dd HH:mm:ss） */
  function applyReconFilter() {
    const next: ReconRunQuery = { page: 1, size: 20 };
    if (reconFilters.scenarioCode) next.scenarioCode = reconFilters.scenarioCode;
    if (reconFilters.status) next.status = reconFilters.status;
    if (reconFilters.dateFrom) next.dateFrom = reconFilters.dateFrom;
    if (reconFilters.dateTo) next.dateTo = reconFilters.dateTo;
    setReconParams(next);
    // 参数未变化时（空条件点查询）queryKey 不变、不会自动 refetch，需手动刷新
    if (JSON.stringify(next) === JSON.stringify(reconParams)) {
      refetchRecon();
    }
  }

  function resetReconFilter() {
    setReconFilters({ scenarioCode: '', status: '', dateFrom: '', dateTo: '' });
    setReconParams({ page: 1, size: 20 });
  }

  /** 应用告警筛选（v6.9 R85：级别 / 渠道 / 发送时间 sent_at） */
  function applyAlertFilter() {
    const next: typeof alertParams = { page: 1, size: 20 };
    if (alertFilters.severity) next.severity = alertFilters.severity;
    if (alertFilters.channel) next.channel = alertFilters.channel;
    if (alertFilters.dateFrom) next.dateFrom = alertFilters.dateFrom;
    if (alertFilters.dateTo) next.dateTo = alertFilters.dateTo;
    setAlertParams(next);
    if (JSON.stringify(next) === JSON.stringify(alertParams)) {
      refetchAlerts();
    }
  }

  function resetAlertFilter() {
    setAlertFilters({ severity: '', channel: '', dateFrom: '', dateTo: '' });
    setAlertParams({ page: 1, size: 20 });
  }

  const manualPull = useMutation({
    mutationFn: (body: { dsCode: string; start?: string; end?: string }) => runsApi.manualPull(body.dsCode, body.start || body.end ? { start: body.start, end: body.end } : undefined),
    onSuccess: (r) => {
      toast.success(`手动拉取已触发 run=${r.run_id}`);
      setManualPullOpen(false);
      refetchPull();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const manualRecon = useMutation({
    mutationFn: (body: { scenarioCode: string; start?: string; end?: string }) =>
      runsApi.manualRecon(body.scenarioCode, body.start || body.end ? { start: body.start, end: body.end } : undefined),
    onSuccess: (r) => {
      toast.success(`手动对账已触发 run=${r.run_id}`);
      setManualReconOpen(false);
      refetchRecon();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              运行监控
            </CardTitle>
            <CardDescription>数据拉取健康 · 对账轮次 · 消费进度（recon_run / pull_run，T07 接入）</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setManualPullOpen(true)}>
              <Download className="mr-1 h-3.5 w-3.5" /> 手动拉取
            </Button>
            <Button size="sm" onClick={() => setManualReconOpen(true)}>
              <Zap className="mr-1 h-3.5 w-3.5" /> 手动对账
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* 数据源健康总览 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {healthLoading && <div className="col-span-full py-4 text-center text-sm text-muted-foreground">加载中…</div>}
        {!healthLoading && (health?.length ?? 0) === 0 && (
          <div className="col-span-full py-4 text-center text-sm text-muted-foreground">暂无启用数据源</div>
        )}
        {health?.map((d) => (
          <button
            key={d.ds_code}
            onClick={() => {
              setTab('pull');
              setPullFilters((f) => ({ ...f, dsCode: d.ds_code }));
              setPullParams({ page: 1, size: 20, dsCode: d.ds_code });
            }}
            className="rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent/40"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[13px] font-medium">{d.ds_code}</span>
              <HealthBadge status={d.health_status} />
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{d.ds_name ?? '-'}</div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
              <span className={d.health_status === 'error' ? 'font-medium text-destructive' : ''}>
                {d.health_status === 'error' ? (d.last_err_msg || '拉取异常') : `今日成功 ${d.today_success_count}`}
              </span>
              <span className="font-mono">{fmtShort(d.last_pull_at)}</span>
            </div>
          </button>
        ))}
      </div>

      {/* 趋势 + 账龄 + 告警 feed */}
      <div className="grid gap-4 lg:grid-cols-7">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">对账成功率趋势 · 近 7 天</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendChart rows={trend ?? []} loading={trendLoading} />
          </CardContent>
        </Card>
        <div className="flex flex-col gap-3 min-w-0 lg:col-span-5">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">差异池账龄分布（按 first_seen_at）</CardTitle>
            </CardHeader>
            <CardContent>
              <AgingChart rows={aging ?? []} loading={agingLoading} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">最新告警（点击切换本页「告警留痕」tab）</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {(alerts?.list.length ?? 0) === 0 && <div className="py-3 text-center text-xs text-muted-foreground">暂无告警</div>}
              {alerts?.list.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setTab('alert')}
                  className="flex w-full items-start gap-2 rounded p-1.5 text-left text-[12px] hover:bg-accent/40"
                >
                  <Badge variant={SEV[a.severity]?.variant ?? 'secondary'} className="h-[18px] shrink-0 px-1.5">
                    {SEV[a.severity]?.label ?? a.severity}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate" title={a.content ?? ''}>
                    {a.content ?? '-'}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{fmtShort(a.sent_at)}</span>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="pull">拉取运行</TabsTrigger>
          <TabsTrigger value="recon">对账运行</TabsTrigger>
          <TabsTrigger value="alert">告警留痕</TabsTrigger>
        </TabsList>

        {/* 拉取运行 */}
        <TabsContent value="pull">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">pull_run</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-3 space-y-2">
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
                  <Select
                    value={pullFilters.dsCode || 'all'}
                    onValueChange={(v) => setPullFilters({ ...pullFilters, dsCode: v === 'all' ? '' : v })}
                  >
                    <SelectTrigger><SelectValue placeholder="数据源" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">数据源:全部</SelectItem>
                      {(datasources?.list ?? []).map((d) => (
                        <SelectItem key={d.ds_code} value={d.ds_code}>
                          {d.ds_code} · {d.name ?? ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={pullFilters.health || 'all'}
                    onValueChange={(v) => setPullFilters({ ...pullFilters, health: v === 'all' ? '' : v })}
                  >
                    <SelectTrigger><SelectValue placeholder="健康状态" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">健康:全部</SelectItem>
                      <SelectItem value="healthy">健康</SelectItem>
                      <SelectItem value="degraded">质量降级</SelectItem>
                      <SelectItem value="empty">空窗口</SelectItem>
                      <SelectItem value="error">拉取失败</SelectItem>
                      <SelectItem value="unknown">未知</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={pullFilters.status || 'all'}
                    onValueChange={(v) => setPullFilters({ ...pullFilters, status: v === 'all' ? '' : v })}
                  >
                    <SelectTrigger><SelectValue placeholder="状态" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">状态:全部</SelectItem>
                      <SelectItem value="running">进行中</SelectItem>
                      <SelectItem value="success">成功</SelectItem>
                      <SelectItem value="partial_success">部分成功</SelectItem>
                      <SelectItem value="failed">失败</SelectItem>
                    </SelectContent>
                  </Select>
                  <DateTimeInput
                    value={pullFilters.dateFrom}
                    onChange={(v) => setPullFilters({ ...pullFilters, dateFrom: v })}
                  />
                  <DateTimeInput
                    value={pullFilters.dateTo}
                    onChange={(v) => setPullFilters({ ...pullFilters, dateTo: v })}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={applyPullFilter}>
                      查询
                    </Button>
                    <Button size="sm" variant="outline" onClick={resetPullFilter}>
                      重置
                    </Button>
                  </div>
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>数据源</TableHead>
                    <TableHead>窗口起止</TableHead>
                    <TableHead className="text-right">行数</TableHead>
                    <TableHead className="text-right">新增/更新</TableHead>
                    <TableHead>健康</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>错误</TableHead>
                    <TableHead>开始 / 结束</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pullLoading && (
                    <TableRow>
                      <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">加载中…</TableCell>
                    </TableRow>
                  )}
                  {!pullLoading && (pulls?.list.length ?? 0) === 0 && (
                    <TableRow>
                      <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">
                        暂无拉取运行记录（触发拉取后生成）
                      </TableCell>
                    </TableRow>
                  )}
                  {pulls?.list.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.id}</TableCell>
                      <TableCell className="text-[13px]">{r.ds_code}</TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                        {fmtShort(r.window_start)} ~ {fmtShort(r.window_end)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{r.row_count}</TableCell>
                      <TableCell className="text-right font-mono text-xs">+{r.insert_count}/{r.update_count}</TableCell>
                      <TableCell>
                        {r.health_status ? <HealthBadge status={r.health_status} /> : '-'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={RUN_BADGE[r.status]?.variant ?? 'secondary'}>
                          {RUN_BADGE[r.status]?.label ?? r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[160px] truncate text-xs text-muted-foreground" title={r.err_msg ?? ''}>
                        {r.err_msg || '-'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                        {fmtShort(r.started_at)} ~ {fmtShort(r.finished_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setHealthRow({ id: r.id, ds_code: r.ds_code, health_status: r.health_status, err_msg: r.err_msg })}
                        >
                          <ActivitySquare className="mr-1 h-3.5 w-3.5" /> 健康详情
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {(pulls?.pages ?? 1) > 1 && (
                <div className="mt-3 flex items-center justify-between text-[13px] text-muted-foreground">
                  <span>
                    共 {pulls?.total ?? 0} 条 · 第 {pullParams.page}/{pulls?.pages ?? 1} 页
                  </span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={pullParams.page <= 1} onClick={() => setPullParams((p) => ({ ...p, page: p.page - 1 }))}>
                      上一页
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pullParams.page >= (pulls?.pages ?? 1)}
                      onClick={() => setPullParams((p) => ({ ...p, page: p.page + 1 }))}
                    >
                      下一页
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 对账运行 */}
        <TabsContent value="recon">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">recon_run</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-3 space-y-2">
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
                  <Select
                    value={reconFilters.scenarioCode || 'all'}
                    onValueChange={(v) => setReconFilters({ ...reconFilters, scenarioCode: v === 'all' ? '' : v })}
                  >
                    <SelectTrigger><SelectValue placeholder="场景" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">场景:全部</SelectItem>
                      {(scenarios?.list ?? []).map((s) => (
                        <SelectItem key={s.scenario_code} value={s.scenario_code}>
                          {s.name ? `${s.name}（${s.scenario_code}）` : s.scenario_code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={reconFilters.status || 'all'}
                    onValueChange={(v) => setReconFilters({ ...reconFilters, status: v === 'all' ? '' : v })}
                  >
                    <SelectTrigger><SelectValue placeholder="状态" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">状态:全部</SelectItem>
                      <SelectItem value="running">进行中</SelectItem>
                      <SelectItem value="success">成功</SelectItem>
                      <SelectItem value="partial_success">部分成功</SelectItem>
                      <SelectItem value="failed">失败</SelectItem>
                      <SelectItem value="skipped">已跳过</SelectItem>
                    </SelectContent>
                  </Select>
                  <DateTimeInput
                    value={reconFilters.dateFrom}
                    onChange={(v) => setReconFilters({ ...reconFilters, dateFrom: v })}
                  />
                  <DateTimeInput
                    value={reconFilters.dateTo}
                    onChange={(v) => setReconFilters({ ...reconFilters, dateTo: v })}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={applyReconFilter}>
                      查询
                    </Button>
                    <Button size="sm" variant="outline" onClick={resetReconFilter}>
                      重置
                    </Button>
                  </div>
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>场景</TableHead>
                    <TableHead className="text-right">匹配</TableHead>
                    <TableHead className="text-right">差异</TableHead>
                    <TableHead className="text-right">配平</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>错误</TableHead>
                    <TableHead>起止时间</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reconLoading && (
                    <TableRow>
                      <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">加载中…</TableCell>
                    </TableRow>
                  )}
                  {!reconLoading && (recon?.list.length ?? 0) === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                        暂无对账运行记录（触发对账后生成）
                      </TableCell>
                    </TableRow>
                  )}
                  {recon?.list.map((r) => (
                    <TableRow key={r.id} className={r.status === 'skipped' ? 'bg-amber-50/60' : ''}>
                      <TableCell className="font-mono text-xs">{r.id}</TableCell>
                      <TableCell className="text-[13px]">{r.scenario_code}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{r.matched_count}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{r.diff_count}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{r.resolved_count}</TableCell>
                      <TableCell>
                        <Badge variant={RUN_BADGE[r.status]?.variant ?? 'secondary'}>
                          {RUN_BADGE[r.status]?.label ?? r.status}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className={`max-w-[180px] truncate text-xs ${r.status === 'skipped' ? 'text-amber-600' : 'text-muted-foreground'}`}
                        title={r.err_msg ?? ''}
                      >
                        {r.err_msg || '-'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                        {fmtShort(r.started_at)} ~ {fmtShort(r.finished_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => setRunDetailId(r.id)}>
                          <Activity className="mr-1 h-3.5 w-3.5" /> 详情
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {(recon?.pages ?? 1) > 1 && (
                <div className="mt-3 flex items-center justify-between text-[13px] text-muted-foreground">
                  <span>
                    共 {recon?.total ?? 0} 条 · 第 {reconParams.page}/{recon?.pages ?? 1} 页
                  </span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={reconParams.page <= 1} onClick={() => setReconParams((p) => ({ ...p, page: p.page - 1 }))}>
                      上一页
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={reconParams.page >= (recon?.pages ?? 1)}
                      onClick={() => setReconParams((p) => ({ ...p, page: p.page + 1 }))}
                    >
                      下一页
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 告警留痕（v6.9 R85 迁入监控页第 3 tab） */}
        <TabsContent value="alert">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">recon_alert_log 告警留痕</CardTitle>
              <CardDescription>
                告警 = 引擎自省信号（发送留痕与重试记录）；对外正式文书在报告中心页（报告记录 · 平衡表）
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-5">
                <Select
                  value={alertFilters.severity || 'all'}
                  onValueChange={(v) => setAlertFilters({ ...alertFilters, severity: v === 'all' ? '' : v })}
                >
                  <SelectTrigger><SelectValue placeholder="级别" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">级别:全部</SelectItem>
                    <SelectItem value="info">一般 info</SelectItem>
                    <SelectItem value="warn">警告 warn</SelectItem>
                    <SelectItem value="critical">严重 critical</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={alertFilters.channel || 'all'}
                  onValueChange={(v) => setAlertFilters({ ...alertFilters, channel: v === 'all' ? '' : v })}
                >
                  <SelectTrigger><SelectValue placeholder="渠道" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">渠道:全部</SelectItem>
                    <SelectItem value="email">邮件 email</SelectItem>
                    <SelectItem value="webhook">Webhook</SelectItem>
                    <SelectItem value="ops">运维 ops</SelectItem>
                  </SelectContent>
                </Select>
                <DateTimeInput
                  value={alertFilters.dateFrom}
                  onChange={(v) => setAlertFilters({ ...alertFilters, dateFrom: v })}
                />
                <DateTimeInput
                  value={alertFilters.dateTo}
                  onChange={(v) => setAlertFilters({ ...alertFilters, dateTo: v })}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={applyAlertFilter}>
                    查询
                  </Button>
                  <Button size="sm" variant="outline" onClick={resetAlertFilter}>
                    重置
                  </Button>
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>告警 ID</TableHead>
                    <TableHead>场景 · 检查</TableHead>
                    <TableHead>级别</TableHead>
                    <TableHead>渠道</TableHead>
                    <TableHead>发送状态 · 重试</TableHead>
                    <TableHead>发送时间</TableHead>
                    <TableHead>关联差异</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alertsLoading && (
                    <TableRow>
                      <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">加载中…</TableCell>
                    </TableRow>
                  )}
                  {!alertsLoading && (alertList?.list.length ?? 0) === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">暂无告警记录</TableCell>
                    </TableRow>
                  )}
                  {alertList?.list.map((a) => (
                    <TableRow key={a.id} className={a.send_status === 'failed' ? 'bg-red-50/60' : ''}>
                      <TableCell className="font-mono text-xs">{a.id}</TableCell>
                      <TableCell>
                        <div className="text-[13px]">{a.scenario_code ?? '-'}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">{a.check_name ?? ''}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={SEV[a.severity]?.variant ?? 'secondary'}>
                          {SEV[a.severity]?.label ?? a.severity}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{a.channel ?? '-'}</TableCell>
                      <TableCell>
                        <Badge variant={a.send_status === 'success' ? 'success' : 'destructive'}>
                          {a.send_status === 'success' ? '成功' : '失败'}
                        </Badge>
                        <span className="ml-1 text-[11px] text-muted-foreground">· {a.retry_count} 次</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                        {fmt(a.sent_at)}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        {a.detail_ids_json ?? '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setAlertContent({ id: a.id, content: a.content })}
                        >
                          <BellRing className="mr-1 h-3.5 w-3.5" /> 查看内容
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!a.scenario_code || resend.isPending}
                          onClick={() => a.scenario_code && resend.mutate(a.scenario_code)}
                        >
                          <Zap className="mr-1 h-3.5 w-3.5" /> 重发
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ManualPullDialog
        open={manualPullOpen}
        datasources={datasources?.list ?? []}
        pending={manualPull.isPending}
        onClose={() => setManualPullOpen(false)}
        onSubmit={(body) => manualPull.mutate(body)}
      />
      <ManualReconDialog
        open={manualReconOpen}
        scenarios={(scenarios?.list ?? []).filter((s) => s.enabled !== 0)}
        pending={manualRecon.isPending}
        onClose={() => setManualReconOpen(false)}
        onSubmit={(body) => manualRecon.mutate(body)}
      />
      <RunDetailDialog id={runDetailId} detail={runDetail} loading={runDetailLoading} onClose={() => setRunDetailId(null)} />
      <PullHealthDialog row={healthRow} onClose={() => setHealthRow(null)} />
      <AlertContentDialog row={alertContent} onClose={() => setAlertContent(null)} />
    </div>
  );
}

/* ---------------- 7 天堆叠柱状图（纯 CSS） ---------------- */

const TREND_SEG: Record<string, { label: string; bg: string }> = {
  success: { label: '成功', bg: '#15803D' },
  skipped: { label: '已跳过', bg: '#F59E0B' },
  failed: { label: '失败', bg: '#DC2626' },
};

function TrendChart({ rows, loading }: { rows: Array<{ day: string; status: string; cnt: number }>; loading: boolean }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const data = useMemo(() => {
    const map = new Map<string, { day: string; success: number; skipped: number; failed: number }>();
    for (const r of rows) {
      const cur = map.get(r.day) ?? { day: r.day, success: 0, skipped: 0, failed: 0 };
      const n = Number(r.cnt) || 0;
      if (r.status === 'success') cur.success += n;
      else if (r.status === 'skipped') cur.skipped += n;
      else cur.failed += n;
      map.set(r.day, cur);
    }
    return [...map.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
  }, [rows]);

  if (loading) return <div className="py-8 text-center text-sm text-muted-foreground">加载中…</div>;
  if (data.length === 0) return <div className="py-8 text-center text-sm text-muted-foreground">暂无对账运行数据</div>;

  return (
    <div>
      {/* 图例 */}
      <div className="mb-2 flex items-center gap-5 text-[12px]">
        {Object.entries(TREND_SEG).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: v.bg }} />
            {v.label}
          </span>
        ))}
      </div>
      {/* 竖向柱状图 */}
      <div className="flex items-end gap-2">
        {data.map((d, i) => {
          const total = d.success + d.skipped + d.failed;
          const seg = (v: number) => (v <= 0 ? 0 : Math.max(2, Math.round((v / total) * 100)));
          return (
            <div
              key={d.day}
              className="relative flex flex-1 flex-col items-center gap-1"
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
            >
              {/* 悬浮 Tooltip */}
              {hoverIdx === i && (
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md border bg-popover px-2.5 py-1.5 text-[11px] shadow-md">
                  <div className="mb-0.5 font-medium">{d.day}</div>
                  {Object.entries(TREND_SEG).map(([k, v]) => {
                    const val = d[k as keyof typeof d] as number;
                    return (
                      <div key={k} className="flex items-center gap-1.5">
                        <span className="inline-block h-2 w-2 rounded-sm" style={{ background: v.bg }} />
                        <span>{v.label}：</span>
                        <span className="font-mono font-medium">{val}</span>
                        <span className="text-muted-foreground">（{total > 0 ? Math.round((val / total) * 100) : 0}%）</span>
                      </div>
                    );
                  })}
                  <div className="mt-0.5 border-t pt-0.5 text-muted-foreground">
                    合计：<span className="font-mono font-medium text-foreground">{total}</span>
                  </div>
                </div>
              )}
              <div className="flex w-full flex-col justify-end overflow-hidden rounded-sm bg-muted" style={{ height: 80 }}>
                {d.failed > 0 && <div className="w-full" style={{ height: seg(d.failed), background: TREND_SEG.failed.bg }} />}
                {d.skipped > 0 && <div className="w-full" style={{ height: seg(d.skipped), background: TREND_SEG.skipped.bg }} />}
                {d.success > 0 && <div className="w-full" style={{ height: seg(d.success), background: TREND_SEG.success.bg }} />}
              </div>
              <span className="font-mono text-[10px] text-muted-foreground">{d.day.slice(5)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- 账龄分布 ---------------- */

function AgingChart({ rows, loading }: { rows: Array<{ bucket: string; cnt: number }>; loading: boolean }) {
  const total = Math.max(1, ...rows.map((r) => r.cnt));
  if (loading) return <div className="py-6 text-center text-sm text-muted-foreground">加载中…</div>;
  if (rows.length === 0) return <div className="py-6 text-center text-sm text-muted-foreground">差异池为空</div>;
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.bucket} className="flex items-center gap-2 text-xs">
          <span className="w-14 shrink-0 text-muted-foreground">{r.bucket} 天</span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${agingClass(r.bucket)}`}
              style={{ width: `${Math.max(2, Math.round((r.cnt / total) * 100))}%` }}
            />
          </div>
          <span className="w-8 shrink-0 text-right font-mono">{r.cnt}</span>
        </div>
      ))}
      <div className="pt-1 text-[11px] text-muted-foreground">超账龄上限（30 天）标红，需优先处理。</div>
    </div>
  );
}

const SEV: Record<string, { label: string; variant: 'secondary' | 'warning' | 'destructive' }> = {
  info: { label: '一般', variant: 'secondary' },
  warn: { label: '警告', variant: 'warning' },
  critical: { label: '严重', variant: 'destructive' },
};

function HealthBadge({ status }: { status: string }) {
  const m = HEALTH_BADGE[status] ?? HEALTH_BADGE.unknown;
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

/* ---------------- 手动拉取弹窗 ---------------- */

function ManualPullDialog({
  open,
  datasources,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  datasources: Array<{ ds_code: string; name?: string }>;
  pending: boolean;
  onClose: () => void;
  onSubmit: (body: { dsCode: string; start?: string; end?: string }) => void;
}) {
  const [ds, setDs] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const ok = !!ds && !pending;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>手动拉取</DialogTitle>
          <DialogDescription>同步执行返回 pull_run 摘要，body 可选窗口覆盖</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label>数据源 *</Label>
            <Select value={ds} onValueChange={setDs}>
              <SelectTrigger><SelectValue placeholder="选择数据源" /></SelectTrigger>
              <SelectContent>
                {datasources.map((d) => (
                  <SelectItem key={d.ds_code} value={d.ds_code}>
                    {d.ds_code} · {d.name ?? ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <DateTimeInput label="窗口开始" en="window_start" value={start} onChange={setStart} note="留空=自动衔接上次成功窗口" />
            <DateTimeInput label="窗口结束" en="window_end" value={end} onChange={setEnd} note="留空=当前时刻" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button
            disabled={!ok}
            onClick={() => onSubmit({ dsCode: ds, start: start || undefined, end: end || undefined })}
          >
            触发拉取
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- 手动对账弹窗 ---------------- */

function ManualReconDialog({
  open,
  scenarios,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  scenarios: Array<{ scenario_code: string; name?: string }>;
  pending: boolean;
  onClose: () => void;
  onSubmit: (body: { scenarioCode: string; start?: string; end?: string }) => void;
}) {
  const [sc, setSc] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [err, setErr] = useState('');
  const ok = !!sc && !pending;

  function handleSubmit() {
    if (start && end && start >= end) {
      setErr('窗口开始必须早于窗口结束');
      return;
    }
    onSubmit({ scenarioCode: sc, start: start || undefined, end: end || undefined });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => {
      if (!o) {
        setErr('');
        onClose();
      }
    }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>手动对账</DialogTitle>
          <DialogDescription>
            立即触发指定场景对账；窗口留空则使用检查默认窗口。修改比较规则（金额 / 积分差额）后请重新对账，差异金额会按新规则覆盖。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label>场景 *</Label>
            <Select value={sc} onValueChange={(v) => {
              setSc(v);
              setErr('');
            }}>
              <SelectTrigger><SelectValue placeholder="选择场景" /></SelectTrigger>
              <SelectContent>
                {scenarios.map((s) => (
                  <SelectItem key={s.scenario_code} value={s.scenario_code}>
                    {s.name ? `${s.name} (${s.scenario_code})` : s.scenario_code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <DateTimeInput
              label="窗口开始"
              value={start}
              onChange={(v) => {
                setStart(v);
                setErr('');
              }}
              note="留空=使用检查默认窗口"
            />
            <DateTimeInput
              label="窗口结束"
              value={end}
              onChange={(v) => {
                setEnd(v);
                setErr('');
              }}
            />
          </div>
          {err && <div className="text-xs text-destructive">{err}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={!ok} onClick={handleSubmit}>
            {pending ? '触发中…' : '触发对账'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- 对账运行详情弹窗（消费进度） ---------------- */

function RunDetailDialog({
  id,
  detail,
  loading,
  onClose,
}: {
  id: number | null;
  detail?: ReconRunDetailRow;
  loading: boolean;
  onClose: () => void;
}) {
  const consumed = useMemo(() => parseConsumed(detail?.consumed_seq_json), [detail?.consumed_seq_json]);
  const dsSet = useMemo(() => {
    const s = new Set<string>();
    for (const vals of consumed.values()) {
      for (const k of Object.keys(vals)) s.add(k);
    }
    return [...s];
  }, [consumed]);

  return (
    <Dialog open={id != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>对账运行详情 #{id ?? ''}</DialogTitle>
          <DialogDescription>运行记录 + consumed_seq_json 消费进度（每 check 每 ds 已消费到最大 update_seq 高水位）</DialogDescription>
        </DialogHeader>
        {loading && <div className="py-8 text-center text-sm text-muted-foreground">加载中…</div>}
        {!loading && !detail && <div className="py-8 text-center text-sm text-muted-foreground">暂无数据</div>}
        {!loading && detail && (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
              <div>
                <div className="text-muted-foreground">场景</div>
                <div className="font-medium">{detail.scenario_code}</div>
              </div>
              <div>
                <div className="text-muted-foreground">状态</div>
                <Badge variant={RUN_BADGE[detail.status]?.variant ?? 'secondary'}>
                  {RUN_BADGE[detail.status]?.label ?? detail.status}
                </Badge>
              </div>
              <div>
                <div className="text-muted-foreground">匹配 / 差异 / 配平</div>
                <div className="font-mono">{detail.matched_count} / {detail.diff_count} / {detail.resolved_count}</div>
              </div>
              <div className="col-span-2 sm:col-span-3">
                <div className="text-muted-foreground">起止时间</div>
                <div className="font-mono">{fmt(detail.started_at)} ~ {fmt(detail.finished_at)}</div>
              </div>
              {detail.err_msg && (
                <div className="col-span-2 sm:col-span-3">
                  <div className="text-muted-foreground">错误</div>
                  <div className="text-destructive">{detail.err_msg}</div>
                </div>
              )}
            </div>

            <div>
              <div className="mb-2 text-xs font-medium text-muted-foreground">消费进度 consumed_seq_json（每 check 每 ds 高水位）</div>
              {consumed.size === 0 ? (
                <div className="rounded border border-dashed p-4 text-center text-xs text-muted-foreground">
                  该轮未记录消费进度（skipped 或运行早期结束）
                </div>
              ) : (
                <div className="overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>检查名</TableHead>
                        {dsSet.map((ds) => (
                          <TableHead key={ds} className="text-right font-mono">{ds}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...consumed.entries()].map(([check, vals]) => (
                        <TableRow key={check}>
                          <TableCell className="font-mono text-xs">{check}</TableCell>
                          {dsSet.map((ds) => (
                            <TableCell key={ds} className="text-right font-mono text-xs">
                              {vals[ds] ?? '—'}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 解析 consumed_seq_json：{checkName: {dsCode: maxSeq}} */
function parseConsumed(json?: string | null): Map<string, Record<string, number>> {
  const map = new Map<string, Record<string, number>>();
  if (!json) return map;
  try {
    const obj = JSON.parse(json) as Record<string, Record<string, number>>;
    for (const [check, vals] of Object.entries(obj)) {
      map.set(check, vals ?? {});
    }
  } catch {
    // 解析失败保持空
  }
  return map;
}

/* ---------------- 告警内容弹窗（告警留痕 · 查看内容） ---------------- */

function AlertContentDialog({
  row,
  onClose,
}: {
  row: { id: number; content?: string | null } | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={row != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>告警内容 #{row?.id ?? ''}</DialogTitle>
          <DialogDescription>recon_alert_log 该条告警发送的正文内容</DialogDescription>
        </DialogHeader>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-3 font-mono text-xs leading-relaxed">
          {row?.content || '(空)'}
        </pre>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- 拉取健康详情弹窗 ---------------- */

function PullHealthDialog({
  row,
  onClose,
}: {
  row: { id: number; ds_code: string; health_status?: string | null; err_msg?: string | null } | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={row != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>拉取健康详情 #{row?.id ?? ''}</DialogTitle>
          <DialogDescription>pull_run 健康状态与错误信息</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">数据源</span>
            <span className="font-mono">{row?.ds_code ?? '-'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">健康状态</span>
            {row?.health_status ? <HealthBadge status={row.health_status} /> : <span>-</span>}
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">错误信息</span>
            <span className="max-w-[240px] truncate text-right" title={row?.err_msg ?? ''}>
              {row?.err_msg || '-'}
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}