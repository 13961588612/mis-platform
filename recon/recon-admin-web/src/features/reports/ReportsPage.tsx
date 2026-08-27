import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileBarChart2, FileText, Play, Plus, RefreshCw, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { runsApi, reportersApi } from '@/lib/api/reports';
import { scenariosApi } from '@/lib/api/scenarios';
import { checksApi } from '@/lib/api/checks';
import { errMsg } from '@/lib/api/client';
import { prettyJson } from '@/lib/utils';
import type { BalanceResp, ReportDetailResp, ReporterSaveReq, ReconScenario } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const SEND_BADGE: Record<string, { label: string; variant: 'success' | 'destructive' | 'warning' | 'secondary' }> = {
  success: { label: '成功', variant: 'success' },
  failed: { label: '失败', variant: 'destructive' },
  partial: { label: '部分', variant: 'warning' },
};

const SEVERITY_BADGE: Record<string, { label: string; variant: 'secondary' | 'warning' | 'destructive' }> = {
  info: { label: '提示', variant: 'secondary' },
  warn: { label: '警告', variant: 'warning' },
  critical: { label: '严重', variant: 'destructive' },
};

const REPORT_TYPE_BADGE: Record<string, { label: string; variant: 'secondary' | 'success' | 'warning' }> = {
  diff: { label: '差异明细报告', variant: 'secondary' },
  balance: { label: '平衡表（零差异证明）', variant: 'success' },
  both: { label: '差异 + 平衡表组合', variant: 'warning' },
};

function fmt(t?: string | null): string {
  return t ? t.replace('T', ' ').slice(0, 19) : '-';
}

/** 金额格式化：分 → 元 */
function yuan(cent: number): string {
  return `¥${(cent / 100).toFixed(2)}`;
}

export function ReportsPage() {
  const [tab, setTab] = useState('runs');
  const [scenarioCode, setScenarioCode] = useState('');
  const [reportType, setReportType] = useState('');
  const [sendStatus, setSendStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [alertSeverity, setAlertSeverity] = useState('');
  const [alertChannel, setAlertChannel] = useState('');
  const [triggerCode, setTriggerCode] = useState('');
  const [runPage] = useState({ page: 1, size: 20 });
  const [alertPage] = useState({ page: 1, size: 20 });
  const [reporterPage] = useState({ page: 1, size: 20 });
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [alertContent, setAlertContent] = useState<{ id: number; content?: string | null } | null>(null);
  const [balanceScenario, setBalanceScenario] = useState('');
  const [balanceDays, setBalanceDays] = useState('1');

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['report-detail', detailId],
    queryFn: () => runsApi.reportDetail(detailId!),
    enabled: detailId != null,
  });

  const { data: scenarios } = useQuery({
    queryKey: ['scenarios'],
    queryFn: () => scenariosApi.list({ page: 1, size: 100 }),
  });

  const { data: runs, isLoading: runsLoading, refetch: refetchRuns } = useQuery({
    queryKey: ['report-runs', runPage, scenarioCode, reportType, sendStatus, dateFrom, dateTo],
    queryFn: () =>
      runsApi.reportRuns({
        ...runPage,
        scenarioCode: scenarioCode || undefined,
        reportType: reportType || undefined,
        sendStatus: sendStatus || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      }),
  });
  const { data: alerts, isLoading: alertsLoading, refetch: refetchAlerts } = useQuery({
    queryKey: ['alert-logs', alertPage, scenarioCode, alertSeverity, alertChannel],
    queryFn: () =>
      runsApi.alertLogs({
        ...alertPage,
        scenarioCode: scenarioCode || undefined,
        severity: alertSeverity || undefined,
        channel: alertChannel || undefined,
      }),
  });
  const { data: reporters, isLoading: reportersLoading, refetch: refetchReporters } = useQuery({
    queryKey: ['reporters', reporterPage, scenarioCode],
    queryFn: () => reportersApi.list({ ...reporterPage, scenarioCode: scenarioCode || undefined }),
  });
  const { data: balance, isLoading: balanceLoading } = useQuery({
    queryKey: ['balance', balanceScenario, balanceDays],
    queryFn: () => runsApi.balance(balanceScenario, Number(balanceDays)),
    enabled: !!balanceScenario,
  });

  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['report-runs'] });
    qc.invalidateQueries({ queryKey: ['alert-logs'] });
  };

  const trigger = useMutation({
    mutationFn: (code: string) => runsApi.report(code),
    onSuccess: (r) => {
      toast.success(`报告已触发：diff=${r.diff_count} send=${r.send_status}`);
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const resend = useMutation({
    mutationFn: (code: string) => runsApi.resendReport(code),
    onSuccess: (r) => {
      toast.success(`已重发：diff=${r.diff_count} send=${r.send_status}`);
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const removeReporter = useMutation({
    mutationFn: (id: number) => reportersApi.remove(id),
    onSuccess: () => {
      toast.success('渠道配置已删除');
      refetchReporters();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const tagValue: Record<string, { label: string; variant: 'success' | 'destructive' | 'warning' | 'secondary' }> = SEND_BADGE;
  const reportTypeTag: Record<string, { label: string; variant: 'secondary' | 'success' | 'warning' }> = REPORT_TYPE_BADGE;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileBarChart2 className="h-4 w-4 text-primary" />
              报告中心
            </CardTitle>
            <CardDescription>报告运行 / 平衡表（零差异证明）/ 告警留痕 / 渠道配置（T07）</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={triggerCode} onValueChange={setTriggerCode}>
              <SelectTrigger className="w-52">
                <SelectValue placeholder="选择要触发的场景" />
              </SelectTrigger>
              <SelectContent>
                {scenarios?.list.map((s) => (
                  <SelectItem key={s.scenario_code} value={s.scenario_code}>
                    {s.scenario_code}
                    {s.name ? ` · ${s.name}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" disabled={!triggerCode.trim() || trigger.isPending} onClick={() => trigger.mutate(triggerCode.trim())}>
              <Play className="mr-1 h-3.5 w-3.5" /> 触发报告
            </Button>
          </div>
        </CardHeader>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="runs">报告运行</TabsTrigger>
          <TabsTrigger value="balance">平衡表 · 零差异证明</TabsTrigger>
          <TabsTrigger value="alerts">告警留痕</TabsTrigger>
          <TabsTrigger value="reporters">渠道配置</TabsTrigger>
        </TabsList>

        {/* ---------------- 报告运行 ---------------- */}
        <TabsContent value="runs">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">recon_report_run</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-6">
                <Select value={scenarioCode || 'all'} onValueChange={(v) => setScenarioCode(v === 'all' ? '' : v)}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="场景" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部场景</SelectItem>
                    {scenarios?.list.map((s) => (
                      <SelectItem key={s.scenario_code} value={s.scenario_code}>
                        {s.scenario_code}
                        {s.name ? ` · ${s.name}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={reportType || 'all'} onValueChange={(v) => setReportType(v === 'all' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="报告类型" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部类型</SelectItem>
                    <SelectItem value="diff">差异明细报告</SelectItem>
                    <SelectItem value="balance">平衡表</SelectItem>
                    <SelectItem value="both">差异+平衡表</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={sendStatus || 'all'} onValueChange={(v) => setSendStatus(v === 'all' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="发送状态" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部状态</SelectItem>
                    <SelectItem value="success">成功</SelectItem>
                    <SelectItem value="failed">失败</SelectItem>
                    <SelectItem value="partial">部分成功</SelectItem>
                  </SelectContent>
                </Select>
                <Input placeholder="开始时间 2026-08-01 00:00:00" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                <Input placeholder="结束时间 2026-08-01 23:59:59" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                <Button variant="outline" size="sm" onClick={() => refetchRuns()}>
                  <RefreshCw className="mr-1 h-3.5 w-3.5" /> 查询
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>场景</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead className="text-right">差异数</TableHead>
                    <TableHead>发送状态</TableHead>
                    <TableHead>起止时间</TableHead>
                    <TableHead>错误</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runsLoading && (
                    <TableRow>
                      <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">加载中…</TableCell>
                    </TableRow>
                  )}
                  {!runsLoading && (runs?.list.length ?? 0) === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                        暂无报告运行记录（手动触发或 report_cron 调度后生成）
                      </TableCell>
                    </TableRow>
                  )}
                  {runs?.list.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.id}</TableCell>
                      <TableCell className="text-[13px]">{r.scenario_code}</TableCell>
                      <TableCell>
                        <Badge variant={reportTypeTag[r.report_type]?.variant ?? 'secondary'}>
                          {reportTypeTag[r.report_type]?.label ?? r.report_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{r.diff_count}</TableCell>
                      <TableCell>
                        <Badge variant={tagValue[r.send_status]?.variant ?? 'secondary'}>
                          {tagValue[r.send_status]?.label ?? r.send_status}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                        {fmt(r.started_at)} ~ {fmt(r.finished_at)}
                      </TableCell>
                      <TableCell className="max-w-[160px] truncate text-xs text-muted-foreground" title={r.err_msg ?? ''}>
                        {r.err_msg || '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => setDetailId(r.id)}>
                          <FileText className="mr-1 h-3.5 w-3.5" /> 详情
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={resend.isPending}
                          onClick={() => resend.mutate(r.scenario_code)}
                        >
                          <Send className="mr-1 h-3.5 w-3.5" /> 重发
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- 平衡表 ---------------- */}
        <TabsContent value="balance">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">平衡表 · 零差异证明</CardTitle>
              <CardDescription>按场景聚合对账轮次，出具覆盖窗口内的平衡结论</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-end gap-2">
                <div className="grid gap-1.5">
                  <Label>场景</Label>
                  <Select value={balanceScenario} onValueChange={setBalanceScenario}>
                    <SelectTrigger className="w-56">
                      <SelectValue placeholder="选择场景" />
                    </SelectTrigger>
                    <SelectContent>
                      {scenarios?.list
                        .filter((s) => s.enabled !== 0)
                        .map((s) => (
                          <SelectItem key={s.scenario_code} value={s.scenario_code}>
                            {s.scenario_code}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>统计窗口</Label>
                  <Select value={balanceDays} onValueChange={setBalanceDays}>
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">近 1 天</SelectItem>
                      <SelectItem value="7">近 7 天</SelectItem>
                      <SelectItem value="30">近 30 天</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {balanceLoading && <div className="py-8 text-center text-sm text-muted-foreground">加载中…</div>}
              {!balanceLoading && !balanceScenario && (
                <div className="rounded border border-dashed p-8 text-center text-sm text-muted-foreground">
                  请先选择场景，系统将聚合窗口内对账轮次出具平衡证明
                </div>
              )}
              {!balanceLoading && balanceScenario && balance && <BalanceView balance={balance} />}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- 告警留痕 ---------------- */}
        <TabsContent value="alerts">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">recon_alert_log（含 ops 运维告警）</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                <Select value={scenarioCode || 'all'} onValueChange={(v) => setScenarioCode(v === 'all' ? '' : v)}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="场景" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部场景</SelectItem>
                    {scenarios?.list.map((s) => (
                      <SelectItem key={s.scenario_code} value={s.scenario_code}>
                        {s.scenario_code}
                        {s.name ? ` · ${s.name}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={alertSeverity || 'all'} onValueChange={(v) => setAlertSeverity(v === 'all' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="级别" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部级别</SelectItem>
                    <SelectItem value="info">一般 info</SelectItem>
                    <SelectItem value="warn">警告 warn</SelectItem>
                    <SelectItem value="critical">严重 critical</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={alertChannel || 'all'} onValueChange={(v) => setAlertChannel(v === 'all' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="渠道" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部渠道</SelectItem>
                    <SelectItem value="email">邮件 email</SelectItem>
                    <SelectItem value="webhook">Webhook</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={() => refetchAlerts()}>
                  <RefreshCw className="mr-1 h-3.5 w-3.5" /> 查询
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>场景 / 检查</TableHead>
                    <TableHead>级别</TableHead>
                    <TableHead>渠道</TableHead>
                    <TableHead>发送 / 重试</TableHead>
                    <TableHead>内容</TableHead>
                    <TableHead>发送时间</TableHead>
                    <TableHead>关联差异</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alertsLoading && (
                    <TableRow>
                      <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">加载中…</TableCell>
                    </TableRow>
                  )}
                  {!alertsLoading && (alerts?.list.length ?? 0) === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">暂无告警记录</TableCell>
                    </TableRow>
                  )}
                  {alerts?.list.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-mono text-xs">{a.id}</TableCell>
                      <TableCell>
                        <div className="text-[13px]">{a.scenario_code ?? '-'}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">{a.check_name ?? ''}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={SEVERITY_BADGE[a.severity]?.variant ?? 'secondary'}>
                          {SEVERITY_BADGE[a.severity]?.label ?? a.severity}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{a.channel ?? '-'}</TableCell>
                      <TableCell>
                        <Badge variant={a.send_status === 'success' ? 'success' : 'destructive'}>
                          {a.send_status === 'success' ? '成功' : '失败'}
                        </Badge>
                        <span className="ml-1 text-[11px] text-muted-foreground">· {a.retry_count} 次</span>
                      </TableCell>
                      <TableCell className="max-w-[200px]">
                        <div className="truncate text-xs" title={a.content ?? ''}>{a.content ?? '-'}</div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                        {fmt(a.sent_at)}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">{a.detail_ids_json ?? '-'}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => setAlertContent({ id: a.id, content: a.content })}>
                          <FileText className="mr-1 h-3.5 w-3.5" /> 查看内容
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- 渠道配置 ---------------- */}
        <TabsContent value="reporters">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-sm">渠道配置（email / webhook）</CardTitle>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1 h-3.5 w-3.5" /> 新建渠道
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>场景</TableHead>
                    <TableHead>检查</TableHead>
                    <TableHead>渠道</TableHead>
                    <TableHead>最低级别</TableHead>
                    <TableHead>参数</TableHead>
                    <TableHead>启用</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reportersLoading && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">加载中…</TableCell>
                    </TableRow>
                  )}
                  {!reportersLoading && (reporters?.list.length ?? 0) === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">暂无渠道配置</TableCell>
                    </TableRow>
                  )}
                  {reporters?.list.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="text-[13px]">{c.scenario_code}</TableCell>
                      <TableCell className="font-mono text-xs">{c.check_name ?? '*'}</TableCell>
                      <TableCell className="text-xs">{c.channel}</TableCell>
                      <TableCell className="text-xs">{c.min_severity ?? 'info'}</TableCell>
                      <TableCell className="max-w-[200px] truncate font-mono text-[11px] text-muted-foreground" title={c.config_json}>
                        {c.config_json ? prettyJson(c.config_json).slice(0, 60) : '-'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={c.enabled === 1 ? 'success' : 'secondary'}>
                          {c.enabled === 1 ? '启用' : '停用'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => {
                            if (window.confirm(`删除渠道配置 #${c.id}？`)) removeReporter.mutate(c.id!);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
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

      <ReportDetailDialog id={detailId} detail={detail} loading={detailLoading} onClose={() => setDetailId(null)} />
      <AlertContentDialog alert={alertContent} onClose={() => setAlertContent(null)} />
      <ReporterCreateDialog
        open={createOpen}
        scenarios={scenarios?.list ?? []}
        onClose={() => setCreateOpen(false)}
        onCreated={() => refetchReporters()}
      />
    </div>
  );
}

/* ---------------- 平衡表视图 ---------------- */

function BalanceView({ balance }: { balance: BalanceResp }) {
  const conclusionVariant =
    balance.conclusion === 'balanced' ? 'success' : balance.conclusion === 'unbalanced' ? 'destructive' : 'secondary';
  const conclusionLabel =
    balance.conclusion === 'balanced' ? '对平（零差异）' : balance.conclusion === 'unbalanced' ? '未对平' : '暂无运行';
  const dsRows = balance.datasource_health ?? [];

  const stats: Array<{ label: string; value: number }> = [
    { label: 'matched_count', value: balance.matched_count },
    { label: '字段不一致', value: balance.field_mismatch },
    { label: '左侧缺失', value: balance.unmatched_left },
    { label: '右侧缺失', value: balance.unmatched_right },
    { label: '数据异常', value: balance.anomaly },
    { label: 'resolved_count', value: balance.resolved_count },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">
        <div className="flex items-center gap-2 font-medium">{conclusionLabel}</div>
        <div>{balance.conclusion_text}</div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded border p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">覆盖窗口</div>
          <div className="text-[13px]">
            统计周期：{fmt(balance.window_start)} ~ {fmt(balance.window_end)}
            <div className="mt-1">覆盖轮次：{balance.covered_rounds} / {balance.total_rounds}</div>
            <div className="mt-1">
              平衡结论：
              <Badge variant={conclusionVariant} className="ml-1">{conclusionLabel}</Badge>
            </div>
          </div>
        </div>
        <div className="rounded border p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">本期变动</div>
          <div className="text-[13px]">本期新增差异：{balance.new_diff}</div>
          <div className="text-[13px]">本期消除差异：{balance.resolved_diff}</div>
          <div className="text-[13px]">期末差异池：{balance.end_pool_count} 条</div>
        </div>
      </div>
      <div className="rounded border p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">对账结果</div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {stats.map((s) => (
            <div key={s.label} className="rounded bg-muted/40 p-2 text-center">
              <div className="text-[11px] text-muted-foreground">{s.label}</div>
              <div className="font-mono text-lg font-medium">{s.value.toLocaleString()}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded border p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">参与数据源健康</div>
        {dsRows.length === 0 && <div className="py-4 text-center text-xs text-muted-foreground">暂无启用数据源</div>}
        {dsRows.length > 0 && (
          <div className="space-y-1.5">
            {dsRows.map((d) => (
              <div key={d.ds_code} className="flex items-center gap-2 text-[13px]">
                <span className="w-44 truncate font-mono">{d.ds_code}</span>
                <span className="w-32 truncate text-muted-foreground">{d.ds_name ?? '-'}</span>
                <HealthBadge status={d.health_status} />
                <span className="ml-auto text-[11px] text-muted-foreground">今日成功 {d.today_success_count}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{fmt(d.last_pull_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="rounded border p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">轮次完整性</div>
        <div className="text-[13px]">
          skipped / failed 轮次：{balance.skipped_rounds} / {balance.failed_rounds}
          {balance.skipped_rounds === 0 && balance.failed_rounds === 0 ? (
            <Badge className="ml-2" variant="success">该期完整</Badge>
          ) : (
            <Badge className="ml-2" variant="destructive">该期不完整</Badge>
          )}
        </div>
      </div>
    </div>
  );
}

function HealthBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' }> = {
    healthy: { label: '健康', variant: 'success' },
    degraded: { label: '质量降级', variant: 'warning' },
    empty: { label: '空窗口', variant: 'warning' },
    error: { label: '拉取失败', variant: 'destructive' },
  };
  return <Badge variant={map[status]?.variant ?? 'secondary'}>{map[status]?.label ?? status}</Badge>;
}

/* ---------------- 报告详情弹窗（含按检查汇总） ---------------- */

function ReportDetailDialog({
  id,
  detail,
  loading,
  onClose,
}: {
  id: number | null;
  detail?: ReportDetailResp;
  loading: boolean;
  onClose: () => void;
}) {
  const run = detail?.run;
  return (
    <Dialog open={id != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>报告详情 #{id ?? ''}</DialogTitle>
          <DialogDescription>报告运行记录 + 该次发送的报告正文 + 按检查分组差异汇总</DialogDescription>
        </DialogHeader>
        {loading && <div className="py-8 text-center text-sm text-muted-foreground">加载中…</div>}
        {!loading && !detail && <div className="py-8 text-center text-sm text-muted-foreground">暂无数据</div>}
        {!loading && detail && (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
              <div>
                <div className="text-muted-foreground">场景 / 类型</div>
                <div className="font-medium">{run?.scenario_code ?? '-'} · {run?.report_type ?? '-'}</div>
              </div>
              <div>
                <div className="text-muted-foreground">发送状态</div>
                <div>
                  <Badge variant={run ? SEND_BADGE[run.send_status]?.variant ?? 'secondary' : 'secondary'}>
                    {run ? SEND_BADGE[run.send_status]?.label ?? run.send_status : '-'}
                  </Badge>
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">差异数</div>
                <div className="font-medium">{run?.diff_count ?? 0}</div>
              </div>
              <div>
                <div className="text-muted-foreground">开始时间</div>
                <div className="font-mono">{fmt(run?.started_at)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">结束时间</div>
                <div className="font-mono">{fmt(run?.finished_at)}</div>
              </div>
              {run?.err_msg && (
                <div className="col-span-2 sm:col-span-3">
                  <div className="text-muted-foreground">错误</div>
                  <div className="text-destructive">{run.err_msg}</div>
                </div>
              )}
            </div>

            {(detail.check_summaries?.length ?? 0) > 0 && (
              <div>
                <div className="mb-2 text-xs font-medium text-muted-foreground">按场景 / 检查分组汇总</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>检查</TableHead>
                      <TableHead className="text-right">差异条数</TableHead>
                      <TableHead className="text-right">差异金额合计</TableHead>
                      <TableHead className="text-right">积分差额合计</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.check_summaries.map((s) => (
                      <TableRow key={s.check_name}>
                        <TableCell className="font-mono text-xs">{s.check_name}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{s.diff_count}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{yuan(s.diff_amount_cent)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {s.diff_point > 0 ? s.diff_point : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="space-y-3">
              {(detail.alerts?.length ?? 0) === 0 && (
                <div className="rounded border border-dashed p-4 text-center text-xs text-muted-foreground">
                  该次运行未产生报告正文（无差异或未发送）
                </div>
              )}
              {detail.alerts?.map((a) => (
                <div key={a.id} className="rounded border p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <Badge variant={SEVERITY_BADGE[a.severity]?.variant ?? 'secondary'}>
                      {SEVERITY_BADGE[a.severity]?.label ?? a.severity}
                    </Badge>
                    <span>渠道: {a.channel ?? '-'}</span>
                    <span>发送: {a.send_status === 'success' ? '成功' : '失败'}</span>
                    <span>{fmt(a.sent_at)}</span>
                    {a.check_name && <span>check: {a.check_name}</span>}
                  </div>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-3 font-mono text-xs leading-relaxed">
                    {a.content || '(空)'}
                  </pre>
                </div>
              ))}
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

/* ---------------- 告警内容弹窗 ---------------- */

function AlertContentDialog({ alert, onClose }: { alert: { id: number; content?: string | null } | null; onClose: () => void }) {
  return (
    <Dialog open={alert != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>告警内容 #{alert?.id ?? ''}</DialogTitle>
          <DialogDescription>告警留痕正文（发送的内容快照）</DialogDescription>
        </DialogHeader>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-3 font-mono text-xs leading-relaxed">
          {alert?.content || '(空)'}
        </pre>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- 渠道创建弹窗 ---------------- */

const SEVERITY_OPTIONS = [
  { value: 'info', label: '提示 info（全部）' },
  { value: 'warn', label: '警告 warn' },
  { value: 'critical', label: '严重 critical 仅' },
];

function ReporterCreateDialog({
  open,
  onClose,
  onCreated,
  scenarios,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  scenarios: ReconScenario[];
}) {
  const [form, setForm] = useState<ReporterSaveReq>({
    scenario_code: '',
    check_name: '*',
    channel: 'email',
    min_severity: 'info',
    enabled: true,
  });
  // 渠道参数结构化编辑态（提交时按渠道序列化为 config_json）
  const [email, setEmail] = useState({ to: '', cc: '' });
  const [webhook, setWebhook] = useState({ url: '', method: 'POST', headers: '' });

  const { data: checkList } = useQuery({
    queryKey: ['checks', form.scenario_code],
    queryFn: () => checksApi.list({ page: 1, size: 100, scenarioCode: form.scenario_code }),
    enabled: !!form.scenario_code && open,
  });

  const create = useMutation({
    mutationFn: (body: ReporterSaveReq) => reportersApi.create(body),
    onSuccess: () => {
      toast.success('渠道配置已创建');
      onCreated();
      onClose();
      setForm({ scenario_code: '', check_name: '*', channel: 'email', min_severity: 'info', enabled: true });
      setEmail({ to: '', cc: '' });
      setWebhook({ url: '', method: 'POST', headers: '' });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const cfgError = (): string | null => {
    if (form.channel === 'email' && !email.to.trim()) return '邮件渠道至少需填写收件人 to（多个用逗号分隔）';
    if (form.channel === 'webhook' && !webhook.url.trim()) return 'Webhook 渠道需填写回调地址 url（https://…）';
    return null;
  };

  const buildConfig = (): string | undefined => {
    if (form.channel === 'email') {
      const cfg: Record<string, string> = {};
      if (email.to.trim()) cfg.to = email.to.trim();
      if (email.cc.trim()) cfg.cc = email.cc.trim();
      return Object.keys(cfg).length ? JSON.stringify(cfg) : undefined;
    }
    const cfg: Record<string, string> = {};
    if (webhook.url.trim()) cfg.url = webhook.url.trim();
    if (webhook.method !== 'POST') cfg.method = webhook.method;
    if (webhook.headers.trim()) cfg.headers = webhook.headers.trim();
    return JSON.stringify(cfg);
  };

  const submit = () => {
    const err = cfgError();
    if (err) {
      toast.error(err);
      return;
    }
    create.mutate({ ...form, scenario_code: form.scenario_code.trim(), config_json: buildConfig() });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>新建报告渠道</DialogTitle>
          <DialogDescription>按场景绑定告警发送渠道；check_name 缺省 '*' 表示该场景全部 check</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>场景 *</Label>
              <Select
                value={form.scenario_code}
                onValueChange={(v) => setForm({ ...form, scenario_code: v, check_name: '*' })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择场景" />
                </SelectTrigger>
                <SelectContent>
                  {scenarios.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">暂无场景，请先到「对账场景」创建</div>}
                  {scenarios.map((s) => (
                    <SelectItem key={s.scenario_code} value={s.scenario_code}>
                      {s.scenario_code}
                      {s.name ? ` · ${s.name}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>目标 check</Label>
              <Select
                value={form.check_name ?? '*'}
                onValueChange={(v) => setForm({ ...form, check_name: v })}
                disabled={!form.scenario_code}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="*">全部 check（*）</SelectItem>
                  {checkList?.list.map((c) => (
                    <SelectItem key={c.check_name} value={c.check_name}>
                      {c.check_name}
                    </SelectItem>
                  ))}
                  {form.scenario_code && (checkList?.list.length ?? 0) === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">该场景暂无 check</div>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>渠道 *</Label>
              <Select
                value={form.channel}
                onValueChange={(v) => setForm({ ...form, channel: v as ReporterSaveReq['channel'] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">邮件 email</SelectItem>
                  <SelectItem value="webhook">Webhook</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>最低级别</Label>
              <Select value={form.min_severity ?? 'info'} onValueChange={(v) => setForm({ ...form, min_severity: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {form.channel === 'email' ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>收件人 to *</Label>
                <Input
                  value={email.to}
                  onChange={(e) => setEmail({ ...email, to: e.target.value })}
                  placeholder="ops@example.com, fin@example.com"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>抄送 cc（可选）</Label>
                <Input
                  value={email.cc}
                  onChange={(e) => setEmail({ ...email, cc: e.target.value })}
                  placeholder="manager@example.com"
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 grid gap-1.5">
                <Label>回调地址 url *</Label>
                <Input
                  value={webhook.url}
                  onChange={(e) => setWebhook({ ...webhook, url: e.target.value })}
                  placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/…"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>请求方法</Label>
                <Select value={webhook.method} onValueChange={(v) => setWebhook({ ...webhook, method: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="POST">POST</SelectItem>
                    <SelectItem value="GET">GET</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>请求头（可选 JSON）</Label>
                <Input
                  value={webhook.headers}
                  onChange={(e) => setWebhook({ ...webhook, headers: e.target.value })}
                  placeholder={'{"X-Token":"…"}'}
                />
              </div>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label>渠道参数（config_json 预览）</Label>
            <pre className="overflow-auto rounded bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">
              {buildConfig() || '{ }'}
            </pre>
          </div>

          <div className="flex items-center gap-2">
            <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
            <Label className="cursor-pointer">创建后立即启用</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button
            disabled={!form.scenario_code.trim() || create.isPending}
            onClick={submit}
          >
            {create.isPending ? '创建中…' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}