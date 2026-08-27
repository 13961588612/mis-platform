import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, GitCompareArrows, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { diffsApi } from '@/lib/api/diffs';
import { PermissionGate } from '@/components/auth/permission-gate';
import { P } from '@/lib/permissions';
import { checksApi } from '@/lib/api/checks';
import { scenariosApi } from '@/lib/api/scenarios';
import { errMsg } from '@/lib/api/client';
import { centsToYuan, prettyJson } from '@/lib/utils';
import type { DiffHandleReq, DiffQueryParams, DiffStatus, DiffType, HandleStatus } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { STATUS_BADGE, DIFF_TYPE_LABEL, TYPE_BADGE, HANDLE_BADGE } from './constants';

export function DiffsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useState<DiffQueryParams>({ page: 1, size: 20 });
  const [filters, setFilters] = useState({
    scenarioCode: '',
    checkName: '',
    status: '',
    diffType: '',
    handleStatus: '',
    matchKey: '',
    dateFrom: '',
    dateTo: '',
    amountFrom: '',
    amountTo: '',
  });
  const [expanded, setExpanded] = useState<number | null>(null);
  const [handleForm, setHandleForm] = useState<DiffHandleReq>({ handle_status: 'handled', remark: '' });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['diffs', params],
    queryFn: () => diffsApi.list(params),
  });

  // 场景 / 检查名下拉枚举（复用既有列表接口）
  const { data: scenarioPage } = useQuery({
    queryKey: ['scenario-options'],
    queryFn: () => scenariosApi.list({ page: 1, size: 1000 }),
  });
  const { data: checkPage } = useQuery({
    queryKey: ['check-options', filters.scenarioCode],
    queryFn: () => checksApi.list({ scenarioCode: filters.scenarioCode || undefined, page: 1, size: 1000 }),
    enabled: !!filters.scenarioCode,
  });

  const { data: stats } = useQuery({
    queryKey: ['diff-stats', params.scenarioCode],
    queryFn: () => diffsApi.stats(params.scenarioCode),
  });

  const qc = useQueryClient();
  const handleDiff = useMutation({
    mutationFn: ({ id, body }: { id: number; body: DiffHandleReq }) => diffsApi.handle(id, body),
    onSuccess: () => {
      toast.success('差异已处理');
      setExpanded(null);
      qc.invalidateQueries({ queryKey: ['diffs'] });
      qc.invalidateQueries({ queryKey: ['diff-stats'] });
      refetch();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  function applyFilter() {
    const next: DiffQueryParams = { page: 1, size: 20 };
    if (filters.scenarioCode) next.scenarioCode = filters.scenarioCode;
    if (filters.checkName) next.checkName = filters.checkName;
    if (filters.status) next.status = filters.status as DiffStatus;
    if (filters.diffType) next.diffType = filters.diffType as DiffType;
    if (filters.handleStatus) next.handleStatus = filters.handleStatus as HandleStatus;
    if (filters.matchKey.trim()) next.matchKey = filters.matchKey.trim();
    if (filters.dateFrom) next.dateFrom = filters.dateFrom.replace('T', ' ');
    if (filters.dateTo) next.dateTo = filters.dateTo.replace('T', ' ');
    if (filters.amountFrom.trim()) next.diffAmountCentFrom = Math.round(Number(filters.amountFrom) * 100);
    if (filters.amountTo.trim()) next.diffAmountCentTo = Math.round(Number(filters.amountTo) * 100);
    setParams(next);
  }

  function resetFilter() {
    setFilters({
      scenarioCode: '',
      checkName: '',
      status: '',
      diffType: '',
      handleStatus: '',
      matchKey: '',
      dateFrom: '',
      dateTo: '',
      amountFrom: '',
      amountTo: '',
    });
    setParams({ page: 1, size: 20 });
  }

  /** 点统计条类型 badge：查该类型的未处理列表（与统计条"未处理"口径对齐） */
  function queryTypeUnhandled(type: string) {
    setFilters((f) => ({ ...f, diffType: type, handleStatus: 'unhandled' }));
    setParams({ page: 1, size: 20, diffType: type as DiffType, handleStatus: 'unhandled' });
  }

  const ratioEntries = Object.entries(stats?.diff_type_ratio ?? {}) as [string, number][];

  return (
    <div className="space-y-4">
      {/* 统计条 */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="flex flex-col gap-1 p-4">
            <span className="text-xs text-muted-foreground">未处理差异</span>
            <span className="text-2xl font-semibold">{stats?.total_unhandled ?? 0}</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 p-4">
            <span className="text-xs text-muted-foreground">已确认未处理</span>
            <span className="text-2xl font-semibold text-destructive">{stats?.total_confirmed_unhandled ?? 0}</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 p-4">
            <span className="text-xs text-muted-foreground">金额差异合计（元）</span>
            <span className="text-2xl font-semibold">{centsToYuan(stats?.amount_cent_total)}</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 p-4">
            <span className="text-xs text-muted-foreground">类型占比</span>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {ratioEntries.length === 0 && <span className="text-sm text-muted-foreground">-</span>}
              {ratioEntries.map(([type, count]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => queryTypeUnhandled(type)}
                  title={`查看 ${DIFF_TYPE_LABEL[type as DiffType] ?? type} 的未处理列表`}
                  className="cursor-pointer rounded-full border px-2.5 py-0.5 text-[11px] transition-colors hover:bg-accent"
                >
                  {DIFF_TYPE_LABEL[type as DiffType] ?? type}: {count}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <GitCompareArrows className="h-4 w-4 text-primary" />
              差异查询
            </CardTitle>
            <CardDescription>只读查询 + 人工处理（T07）；匹配键支持模糊搜索</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> 刷新
          </Button>
        </CardHeader>
        <CardContent>
          {/* 筛选条 */}
          <div className="mb-4 space-y-2">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
              <select
                className="flex h-9 rounded-md border border-input bg-card px-3 text-sm"
                value={filters.scenarioCode}
                onChange={(e) => setFilters({ ...filters, scenarioCode: e.target.value, checkName: '' })}
              >
                <option value="">场景:全部</option>
                {(scenarioPage?.list ?? []).map((s) => (
                  <option key={s.scenario_code} value={s.scenario_code}>
                    {s.name ? `${s.name}（${s.scenario_code}）` : s.scenario_code}
                  </option>
                ))}
              </select>
              <select
                className="flex h-9 rounded-md border border-input bg-card px-3 text-sm disabled:opacity-60"
                value={filters.checkName}
                disabled={!filters.scenarioCode}
                onChange={(e) => setFilters({ ...filters, checkName: e.target.value })}
              >
                <option value="">{filters.scenarioCode ? '检查:全部' : '先选场景'}</option>
                {(checkPage?.list ?? []).map((c) => (
                  <option key={c.check_name} value={c.check_name}>
                    {c.check_name}
                  </option>
                ))}
              </select>
              <select
                className="flex h-9 rounded-md border border-input bg-card px-3 text-sm"
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              >
                <option value="">状态:全部</option>
                <option value="pending">待确认</option>
                <option value="confirmed">已确认</option>
                <option value="resolved">已解决</option>
              </select>
              <select
                className="flex h-9 rounded-md border border-input bg-card px-3 text-sm"
                value={filters.diffType}
                onChange={(e) => setFilters({ ...filters, diffType: e.target.value })}
              >
                <option value="">类型:全部</option>
                <option value="unmatched_left">单边缺失-左</option>
                <option value="unmatched_right">单边缺失-右</option>
                <option value="field_mismatch">字段不符</option>
                <option value="anomaly">异常</option>
              </select>
              <select
                className="flex h-9 rounded-md border border-input bg-card px-3 text-sm"
                value={filters.handleStatus}
                onChange={(e) => setFilters({ ...filters, handleStatus: e.target.value })}
              >
                <option value="">处理:全部</option>
                <option value="unhandled">未处理</option>
                <option value="handled">已处理</option>
              </select>
              <Input
                placeholder="匹配键 / hash 模糊"
                value={filters.matchKey}
                onChange={(e) => setFilters({ ...filters, matchKey: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                首次发现≥
                <Input
                  type="datetime-local"
                  value={filters.dateFrom}
                  onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
                />
              </label>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                首次发现≤
                <Input
                  type="datetime-local"
                  value={filters.dateTo}
                  onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
                />
              </label>
              <Input
                type="number"
                step="0.01"
                placeholder="金额差≥（元）"
                value={filters.amountFrom}
                onChange={(e) => setFilters({ ...filters, amountFrom: e.target.value })}
              />
              <Input
                type="number"
                step="0.01"
                placeholder="金额差≤（元）"
                value={filters.amountTo}
                onChange={(e) => setFilters({ ...filters, amountTo: e.target.value })}
              />
              <div className="col-span-2 flex gap-2 md:col-span-1 lg:col-span-2">
                <Button size="sm" onClick={applyFilter}>
                  查询
                </Button>
                <Button size="sm" variant="outline" onClick={resetFilter}>
                  重置
                </Button>
              </div>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>场景 / 检查</TableHead>
                <TableHead>匹配键</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>处理</TableHead>
                <TableHead className="text-right">金额差（元）</TableHead>
                <TableHead className="text-right">积分差额</TableHead>
                <TableHead>首次发现</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                    加载中…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && (data?.list.length ?? 0) === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                    暂无差异数据（触发对账后生成）
                  </TableCell>
                </TableRow>
              )}
              {data?.list.map((row) => {
                const st = STATUS_BADGE[row.status] ?? { label: row.status, variant: 'default' as const };
                const tp = TYPE_BADGE[row.diff_type] ?? { label: row.diff_type, variant: 'default' as const };
                const hd = HANDLE_BADGE[row.handle_status] ?? { label: row.handle_status, variant: 'default' as const };
                const open = expanded === row.id;
                return (
                  <>
                    <TableRow
                      key={row.id}
                      className="cursor-pointer"
                      onClick={() => setExpanded(open ? null : row.id)}
                    >
                      <TableCell>
                        <div className="text-[13px] font-medium">{row.scenario_code}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">{row.check_name}</div>
                      </TableCell>
                      <TableCell className="max-w-[200px]">
                        <div className="truncate font-mono text-xs" title={row.match_key_display}>
                          {row.match_key_display || row.raw_key || row.match_key_hash?.slice(0, 16)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={tp.variant}>{tp.label}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={st.variant}>{st.label}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={hd.variant}>{hd.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {centsToYuan(row.diff_amount_cent)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {row.diff_point != null && row.diff_point > 0 ? row.diff_point : '-'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                        {row.first_seen_at?.replace('T', ' ').slice(0, 19)}
                      </TableCell>
                      <TableCell className="text-right">
                        <button
                          className="text-xs text-blue-600 hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/diffs/${row.id}`);
                          }}
                        >
                          详情
                        </button>
                      </TableCell>
                    </TableRow>
                    {open && (
                      <TableRow key={`${row.id}-detail`}>
                        <TableCell colSpan={9} className="bg-muted/40">
                          <div className="grid grid-cols-2 gap-3 text-xs">
                            <div>
                              <div className="mb-1 font-semibold text-muted-foreground">差异描述</div>
                              <pre className="whitespace-pre-wrap rounded bg-card p-2 text-foreground">
                                {row.diff_desc || '-'}
                              </pre>
                            </div>
                            <div>
                              <div className="mb-1 font-semibold text-muted-foreground">左右值（JSON）</div>
                              <div className="grid grid-cols-2 gap-2">
                                <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-card p-2 font-mono text-[11px]">
                                  左侧{'\n'}{prettyJson(row.left_value_json) || '-'}
                                </pre>
                                <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-card p-2 font-mono text-[11px]">
                                  右侧{'\n'}{prettyJson(row.right_value_json) || '-'}
                                </pre>
                              </div>
                            </div>
                          </div>
                          <div className="mt-2 text-[11px] text-muted-foreground">
                            诊断：
                            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-card p-2 font-mono">
                              {prettyJson(row.diff_diagnosis_json) || '-'}
                            </pre>
                          </div>
                          {row.handle_status === 'unhandled' && (
                            <div className="mt-3 flex flex-wrap items-end gap-2 rounded border border-dashed p-3">
                              <div className="grid gap-1">
                                <span className="text-[11px] text-muted-foreground">处理结论</span>
                                <select
                                  className="flex h-9 rounded-md border border-input bg-card px-3 text-sm"
                                  value={handleForm.handle_status}
                                  onChange={(e) =>
                                    setHandleForm({ ...handleForm, handle_status: e.target.value as DiffHandleReq['handle_status'] })
                                  }
                                >
                                  <option value="handled">已处理（对账侧修正）</option>
                                  <option value="ignored">忽略（业务允许）</option>
                                  <option value="false_positive">误报</option>
                                </select>
                              </div>
                              <div className="min-w-[220px] flex-1 grid gap-1">
                                <span className="text-[11px] text-muted-foreground">备注</span>
                                <Input
                                  placeholder="处理说明（可选）"
                                  value={handleForm.remark ?? ''}
                                  onChange={(e) => setHandleForm({ ...handleForm, remark: e.target.value })}
                                />
                              </div>
                              <PermissionGate permission={P.DIFF.CONFIRM}>
                                <Button
                                  size="sm"
                                  disabled={handleDiff.isPending}
                                  onClick={() => handleDiff.mutate({ id: row.id!, body: handleForm })}
                                >
                                  <Check className="mr-1 h-3.5 w-3.5" /> 确认处理
                                </Button>
                              </PermissionGate>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                );
              })}
            </TableBody>
          </Table>
          {(data?.pages ?? 1) > 1 && (
            <div className="mt-3 flex items-center justify-between text-[13px] text-muted-foreground">
              <span>
                共 {data?.total ?? 0} 条 · 第 {params.page}/{data?.pages ?? 1} 页
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={(params.page ?? 1) <= 1}
                  onClick={() => setParams({ ...params, page: (params.page ?? 1) - 1 })}
                >
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={(params.page ?? 1) >= (data?.pages ?? 1)}
                  onClick={() => setParams({ ...params, page: (params.page ?? 1) + 1 })}
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
