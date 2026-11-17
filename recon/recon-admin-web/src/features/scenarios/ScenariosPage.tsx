import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ListChecks, Plus, RefreshCw, Pencil, Trash2, Play, FilePlus2 } from 'lucide-react';
import { scenariosApi } from '@/lib/api/scenarios';
import { checksApi } from '@/lib/api/checks';
import { opsApi } from '@/lib/api/ops';
import { errMsg } from '@/lib/api/client';
import { PermissionGate } from '@/components/auth/permission-gate';
import { P } from '@/lib/permissions';
import { checkCron } from '@/lib/cron';
import { prettyJson } from '@/lib/utils';
import type { ReconScenario, ReconCheck } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { CheckFormDialog } from './check-form/CheckFormDialog';

/* ---------------- 场景表单 ---------------- */

interface ScnForm {
  scenario_code: string;
  name: string;
  cron_expr: string;
  report_cron: string;
  pending_max_wait_hours: string;
  pool_max_age_hours: string;
  hooks_json: string;
  enabled: number;
}

const EMPTY_SCN: ScnForm = {
  scenario_code: '',
  name: '',
  cron_expr: '',
  report_cron: '',
  pending_max_wait_hours: '24',
  pool_max_age_hours: '72',
  hooks_json: '',
  enabled: 1,
};

function scnToForm(s?: ReconScenario): ScnForm {
  if (!s) return EMPTY_SCN;
  return {
    scenario_code: s.scenario_code,
    name: s.name,
    cron_expr: s.cron_expr ?? '',
    report_cron: s.report_cron ?? '',
    pending_max_wait_hours: s.pending_max_wait_hours?.toString() ?? '24',
    pool_max_age_hours: s.pool_max_age_hours?.toString() ?? '72',
    hooks_json: prettyJson(s.hooks_json),
    enabled: s.enabled,
  };
}

/* ---------------- 检查配置（由 CheckFormDialog 承载） ---------------- */

export function ScenariosPage() {
  const qc = useQueryClient();
  const [scnOpen, setScnOpen] = useState(false);
  const [scnEditing, setScnEditing] = useState<ReconScenario | null>(null);
  const [scnForm, setScnForm] = useState<ScnForm>(EMPTY_SCN);
  const [scnErr, setScnErr] = useState<string | null>(null);

  const [chkOpen, setChkOpen] = useState(false);
  const [chkEditing, setChkEditing] = useState<ReconCheck | null>(null);
  const [chkLoading, setChkLoading] = useState(false);

  const { data: scns, isLoading, refetch } = useQuery({
    queryKey: ['scenarios'],
    queryFn: () => scenariosApi.list({ page: 1, size: 100 }),
  });

  const [selected, setSelected] = useState<string>('');

  const { data: checks } = useQuery({
    queryKey: ['checks', selected],
    queryFn: () => checksApi.list({ scenarioCode: selected, page: 1, size: 100 }),
    enabled: !!selected,
  });

  const reconMutation = useMutation({
    mutationFn: (code: string) => opsApi.recon(code),
    onSuccess: (r) => toast.success(`对账任务已接受：run_id=${r.run_id} status=${r.status}`),
    onError: (e) => toast.error(errMsg(e)),
  });

  const scnSave = useMutation({
    mutationFn: (body: ReconScenario) =>
      scnEditing ? scenariosApi.update(scnEditing.scenario_code, body) : scenariosApi.create(body),
    onSuccess: () => {
      toast.success(scnEditing ? '场景已更新' : '场景已创建');
      setScnOpen(false);
      setScnEditing(null);
      qc.invalidateQueries({ queryKey: ['scenarios'] });
    },
    onError: (e) => setScnErr(errMsg(e)),
  });

  const scnDelete = useMutation({
    mutationFn: (code: string) => scenariosApi.remove(code),
    onSuccess: () => {
      toast.success('场景已删除');
      if (selected) setSelected('');
      qc.invalidateQueries({ queryKey: ['scenarios'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const chkDelete = useMutation({
    mutationFn: ({ code, name }: { code: string; name: string }) => checksApi.remove(code, name),
    onSuccess: () => {
      toast.success('检查已删除');
      qc.invalidateQueries({ queryKey: ['checks', selected] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  function openScnCreate() {
    setScnEditing(null);
    setScnForm(EMPTY_SCN);
    setScnErr(null);
    setScnOpen(true);
  }

  function openScnEdit(s: ReconScenario) {
    setScnEditing(s);
    setScnForm(scnToForm(s));
    setScnErr(null);
    setScnOpen(true);
  }

  function submitScn() {
    if (!scnForm.scenario_code.trim() || !scnForm.name.trim()) {
      setScnErr('场景编码与名称必填');
      return;
    }
    const cronErr = checkCron(scnForm.cron_expr, '对账 cron') ?? checkCron(scnForm.report_cron, '报告 cron');
    if (cronErr) {
      setScnErr(cronErr);
      return;
    }
    setScnErr(null);
    scnSave.mutate({
      scenario_code: scnForm.scenario_code.trim(),
      name: scnForm.name.trim(),
      cron_expr: scnForm.cron_expr.trim() || undefined,
      report_cron: scnForm.report_cron.trim() || undefined,
      pending_max_wait_hours: Number(scnForm.pending_max_wait_hours) || 24,
      pool_max_age_hours: Number(scnForm.pool_max_age_hours) || 72,
      /* hooks_json：占位能力（MVP 不开放配置），UI 已隐藏，编辑时原样带回、保存原样回传以不破坏已有数据 */
      hooks_json: scnForm.hooks_json.trim() || undefined,
      enabled: scnForm.enabled,
    });
  }

  function openChkCreate() {
    if (!selected) return;
    setChkEditing(null);
    setChkOpen(true);
  }

  function openChkEdit(c: ReconCheck) {
    /* 列表接口不含 match/compare 规则，编辑需拉详情聚合（check + match_rule + compare_rule） */
    setChkLoading(true);
    checksApi
      .detail(selected, c.check_name)
      .then((d) => {
        setChkEditing({ ...d.check, match_rule: d.match_rule, compare_rule: d.compare_rule });
        setChkOpen(true);
      })
      .catch((e) => toast.error(errMsg(e)))
      .finally(() => setChkLoading(false));
  }

  const current = scns?.list.find((s) => s.scenario_code === selected);

  return (
    <div className="flex h-full gap-4">
      {/* 左：场景列表 */}
      <Card className="w-72 shrink-0">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ListChecks className="h-4 w-4 text-primary" />
            场景
          </CardTitle>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refetch()}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" className="h-7 w-7" onClick={openScnCreate}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-2">
          {isLoading && <div className="p-3 text-[13px] text-muted-foreground">加载中…</div>}
          {(scns?.list.length ?? 0) === 0 && !isLoading && (
            <div className="p-3 text-[13px] text-muted-foreground">暂无场景</div>
          )}
          <div className="space-y-1">
            {scns?.list.map((s) => (
              <div
                key={s.scenario_code}
                className={`group cursor-pointer rounded-md px-3 py-2 transition-colors ${
                  selected === s.scenario_code
                    ? 'border-l-2 border-primary bg-sidebar-accent'
                    : 'hover:bg-accent'
                }`}
                onClick={() => setSelected(s.scenario_code)}
              >
                <div className="text-[13px] font-medium">{s.name}</div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] text-muted-foreground">{s.scenario_code}</span>
                  {s.enabled === 1 ? (
                    <Badge variant="success" className="text-[10px]">
                      启用
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">
                      停用
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 右：场景详情 + 检查管理 */}
      {selected && current ? (
        <Card className="min-w-0 flex-1">
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2">
                {current.name}
                <Badge variant="secondary" className="font-mono">
                  {current.scenario_code}
                </Badge>
              </CardTitle>
              <CardDescription className="mt-1 space-y-0.5">
                <div>
                  cron：<span className="font-mono">{current.cron_expr || '未配置（仅手动触发）'}</span>
                  {' · '}pending 确认等待：<span className="font-mono">{current.pending_max_wait_hours ?? 24}h</span>
                  {' · '}池账龄：<span className="font-mono">{current.pool_max_age_hours ?? 72}h</span>
                </div>
                <div>
                  状态：{current.enabled === 1 ? '启用' : '停用'}
                  {' · '}report_cron：<span className="font-mono">{current.report_cron || '-'}</span>
                </div>
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <PermissionGate permission={P.SCENARIO.RUN}>
                <Button
                  variant="success"
                  size="sm"
                  disabled={reconMutation.isPending}
                  onClick={() => reconMutation.mutate(selected)}
                >
                  <Play className={`mr-1 h-3.5 w-3.5 ${reconMutation.isPending ? 'animate-pulse' : ''}`} />
                  {reconMutation.isPending ? '触发中…' : '触发对账'}
                </Button>
              </PermissionGate>
              <Button variant="outline" size="sm" onClick={() => openScnEdit(current)}>
                <Pencil className="mr-1 h-3.5 w-3.5" /> 编辑
              </Button>
              <PermissionGate permission={P.SCENARIO.DELETE}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (confirm(`确认删除场景 ${current.scenario_code}？`)) scnDelete.mutate(current.scenario_code);
                  }}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5 text-destructive" />
                </Button>
              </PermissionGate>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[13px] font-semibold text-muted-foreground">
                检查规则（{checks?.list.length ?? 0}）
              </div>
              <Button size="sm" variant="outline" onClick={openChkCreate}>
                <FilePlus2 className="mr-1 h-3.5 w-3.5" /> 新增检查
              </Button>
            </div>
            <div className="space-y-2">
              {(checks?.list.length ?? 0) === 0 && (
                <div className="rounded-md border border-dashed p-6 text-center text-[13px] text-muted-foreground">
                  暂无检查规则，点击「新增检查」配置 consume / match / compare 规则
                </div>
              )}
              {checks?.list.map((c) => (
                <div key={c.check_name} className="flex items-center justify-between rounded-md border p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium">{c.check_name}</span>
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        seq {c.seq_no}
                      </Badge>
                    </div>
                    <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                      消费：{c.consume_json?.slice(0, 80)}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={chkLoading}
                      onClick={() => openChkEdit(c)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        if (confirm(`确认删除检查 ${c.check_name}？`)) chkDelete.mutate({ code: selected, name: c.check_name });
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="flex min-w-0 flex-1 items-center justify-center">
          <div className="text-center text-muted-foreground">
            <ListChecks className="mx-auto mb-2 h-8 w-8" />
            <div className="text-sm">从左侧选择一个场景，管理其检查规则与对账触发</div>
          </div>
        </Card>
      )}

      {/* 场景编辑 */}
      <Dialog open={scnOpen} onOpenChange={setScnOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{scnEditing ? `编辑场景 ${scnEditing.scenario_code}` : '新建场景'}</DialogTitle>
            <DialogDescription>场景聚合一组检查规则；cron 留空=仅手动触发对账</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>场景编码 *</Label>
                <Input
                  value={scnForm.scenario_code}
                  disabled={!!scnEditing}
                  onChange={(e) => setScnForm({ ...scnForm, scenario_code: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>名称 *</Label>
                <Input value={scnForm.name} onChange={(e) => setScnForm({ ...scnForm, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>对账 cron</Label>
                <Input
                  value={scnForm.cron_expr}
                  placeholder="0 */5 * * * ?"
                  onChange={(e) => setScnForm({ ...scnForm, cron_expr: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>报告 cron</Label>
                <Input
                  value={scnForm.report_cron}
                  placeholder="0 0 1 * * ?"
                  onChange={(e) => setScnForm({ ...scnForm, report_cron: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>pending 确认等待（小时）</Label>
                <Input
                  value={scnForm.pending_max_wait_hours}
                  onChange={(e) => setScnForm({ ...scnForm, pending_max_wait_hours: e.target.value })}
                />
                <p className="f-note">差异待人工确认的最长等待时间，超时自动归为池异常</p>
              </div>
              <div className="space-y-1.5">
                <Label>池账龄（小时）</Label>
                <Input
                  value={scnForm.pool_max_age_hours}
                  onChange={(e) => setScnForm({ ...scnForm, pool_max_age_hours: e.target.value })}
                />
                <p className="f-note">对账结果池中记录的最长保留时间</p>
              </div>
              <div className="space-y-1.5">
                <Label>状态</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
                  value={scnForm.enabled}
                  onChange={(e) => setScnForm({ ...scnForm, enabled: Number(e.target.value) })}
                >
                  <option value={1}>启用</option>
                  <option value={0}>停用</option>
                </select>
              </div>
            </div>
            {scnErr && <div className="rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive">{scnErr}</div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScnOpen(false)}>
              取消
            </Button>
            <PermissionGate permission={P.SCENARIO.WRITE}>
              <Button onClick={submitScn} disabled={scnSave.isPending}>
                {scnSave.isPending ? '保存中…' : '保存'}
              </Button>
            </PermissionGate>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 检查配置（三 Tab：消费模式 / 匹配规则 / 比较规则） */}
      <CheckFormDialog
        open={chkOpen}
        onOpenChange={setChkOpen}
        scenarioCode={selected}
        editing={chkEditing}
      />
    </div>
  );
}
