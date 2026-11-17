import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, RefreshCw, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { diffsApi } from '@/lib/api/diffs';
import { errMsg } from '@/lib/api/client';
import { centsToYuan, prettyJson } from '@/lib/utils';
import type { DiffHandleReq } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { STATUS_BADGE, TYPE_BADGE, HANDLE_BADGE } from './constants';
import { StatusTimeline } from './StatusTimeline';

export function DiffDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const numericId = Number(id);

  const { data, isLoading } = useQuery({
    queryKey: ['diff-detail', numericId],
    queryFn: () => diffsApi.detail(numericId),
    enabled: !Number.isNaN(numericId),
  });

  const [handleModal, setHandleModal] = useState<'handled' | 'ignored' | 'false_positive' | null>(null);
  const [handleForm, setHandleForm] = useState<DiffHandleReq>({ handle_status: 'handled', operator: '', remark: '' });
  const [revertOpen, setRevertOpen] = useState(false);
  const [revertForm, setRevertForm] = useState({ operator: '', remark: '' });
  const [fetchingAnchor, setFetchingAnchor] = useState<string | null>(null);

  const handleMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: DiffHandleReq }) => diffsApi.handle(id, body),
    onSuccess: () => {
      toast.success('差异已处理');
      setHandleModal(null);
      qc.invalidateQueries({ queryKey: ['diff-detail', numericId] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const revertMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: { operator?: string; remark?: string } }) =>
      diffsApi.revert(id, body),
    onSuccess: () => {
      toast.success('已回退为未处理');
      setRevertOpen(false);
      qc.invalidateQueries({ queryKey: ['diff-detail', numericId] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const fetchOneMut = useMutation({
    mutationFn: ({ id, side }: { id: number; side?: 'left' | 'right' }) => diffsApi.fetchOne(id, { side }),
    onSuccess: (results) => {
      const okCount = results.filter((r) => r.found).length;
      toast.success(`已触发 ${okCount}/${results.length} 条重拉，下轮对账自动重判`);
      setFetchingAnchor(null);
    },
    onError: (e) => {
      toast.error(errMsg(e));
      setFetchingAnchor(null);
    },
  });

  const detail = data?.detail;
  const amountFieldSet = useMemo(() => {
    const s = new Set<string>();
    if (data?.check_compare_rules) {
      for (const r of data.check_compare_rules) {
        if (!r.is_amount) continue;
        const l = r.left_field.split('.')[1];
        const rt = r.right_field.split('.')[1];
        if (l) s.add(l);
        if (rt) s.add(rt);
      }
    }
    return s;
  }, [data?.check_compare_rules]);

  if (isLoading) return <div className="p-6 text-muted-foreground">加载中...</div>;
  if (!detail) return <div className="p-6 text-muted-foreground">差异不存在</div>;

  const statusBadge = STATUS_BADGE[detail.status] ?? { label: detail.status, variant: 'secondary' as const };
  const typeBadge = TYPE_BADGE[detail.diff_type] ?? { label: detail.diff_type, variant: 'default' as const };
  const handleBadge = HANDLE_BADGE[detail.handle_status] ?? { label: detail.handle_status, variant: 'secondary' as const };
  const handled = detail.handle_status !== 'unhandled';

  function openHandleModal(s: 'handled' | 'ignored' | 'false_positive') {
    setHandleForm({ handle_status: s, operator: '', remark: '' });
    setHandleModal(s);
  }

  return (
    <div className="space-y-4">
      {/* 面包屑 + 返回 */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground mb-1">
            <button className="hover:underline" onClick={() => navigate('/diffs')}>差异查询</button>
            <span className="mx-1">/</span>
            <span className="font-medium text-foreground">差异处理</span>
          </div>
          <h1 className="text-xl font-semibold">差异处理 · {detail.match_key_display || id}</h1>
        </div>
        <Button variant="secondary" onClick={() => navigate('/diffs')}>
          <ArrowLeft className="w-4 h-4 mr-1" />返回列表
        </Button>
      </div>

      {/* 已处理 banner */}
      {handled && (
        <div className="rounded-md border border-orange-200 bg-orange-50 px-4 py-3 text-sm flex items-center gap-2">
          <span className="text-orange-600">⚠</span>
          <span>
            该差异已被 <b>{data?.handle_history?.[data.handle_history.length - 1]?.operator || '运维'}</b> 标记为{' '}
            <b>{handleBadge.label}</b>，可{' '}
            <button className="text-blue-600 hover:underline" onClick={() => setRevertOpen(true)}>
              回退为未处理
            </button>
          </span>
        </div>
      )}

      {/* 状态徽章组 + 差异身份 */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={typeBadge.variant}>{typeBadge.label}</Badge>
        <Badge variant={statusBadge.variant}>
          <span className="mr-1 inline-block w-1.5 h-1.5 rounded-full bg-current" />
          {statusBadge.label}
        </Badge>
        <Badge variant={handleBadge.variant}>
          <span className="mr-1 inline-block w-1.5 h-1.5 rounded-full bg-current" />
          {handleBadge.label}
        </Badge>
        <span className="text-xs text-muted-foreground ml-2">
          {detail.scenario_code}.{detail.check_name}
        </span>
      </div>
      <div className="text-xs text-muted-foreground">
        差异身份 (scenario={detail.scenario_code}, check={detail.check_name}, pair_segment={detail.pair_segment}, match_key_hash={detail.match_key_hash.slice(0, 8)}…)
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        {/* 主区 */}
        <div className="space-y-4">
          {/* 差异摘要 */}
          <Card>
            <CardHeader><CardTitle className="text-base">差异摘要</CardTitle></CardHeader>
            <CardContent>
              <div className="text-sm leading-relaxed">
                {detail.diff_desc || '（无摘要）'}
              </div>
              {detail.diff_amount_cent > 0 && (
                <div className="mt-2 text-sm text-muted-foreground">
                  差异金额：<span className="text-foreground font-medium">¥{centsToYuan(detail.diff_amount_cent)}</span>
                </div>
              )}
              {detail.diff_point > 0 && (
                <div className="mt-2 text-sm text-muted-foreground">
                  积分差额：<span className="text-foreground font-medium">{detail.diff_point}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 左右数据 KV */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <DataPanel
              title="左侧数据"
              dsCode={data?.anchors?.find((a) => a.side === 'left')?.ds_code}
              jsonData={detail.left_data_json}
              amountFieldSet={amountFieldSet}
            />
            <DataPanel
              title="右侧数据"
              dsCode={data?.anchors?.find((a) => a.side === 'right')?.ds_code}
              jsonData={detail.right_data_json}
              amountFieldSet={amountFieldSet}
            />
          </div>

          {/* 差异诊断 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ChevronDown className="w-4 h-4" />差异诊断 diff_diagnosis_json
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-xs bg-muted/50 p-3 rounded-md overflow-auto max-h-96 font-mono">
                {detail.diff_diagnosis_json ? prettyJson(detail.diff_diagnosis_json) : '（无诊断）'}
              </pre>
            </CardContent>
          </Card>

          {/* 流转历史 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ChevronDown className="w-4 h-4" />流转历史（状态机时间线）
              </CardTitle>
            </CardHeader>
            <CardContent>
              <StatusTimeline
                statusHistory={data?.status_history ?? []}
                handleHistory={data?.handle_history ?? []}
              />
            </CardContent>
          </Card>

          {/* 锚表关联行 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ChevronDown className="w-4 h-4" />锚表关联行 recon_detail_source_ref
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(data?.anchors ?? []).length === 0 ? (
                <div className="text-sm text-muted-foreground">暂无锚表行。</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>侧 side</TableHead>
                      <TableHead>数据源编码 ds_code</TableHead>
                      <TableHead>记录键 record_key</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.anchors ?? []).map((a, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Badge variant="default">{a.side === 'left' ? '左侧' : '右侧'}</Badge>
                        </TableCell>
                        <TableCell className="font-mono">{a.ds_code}</TableCell>
                        <TableCell className="font-mono">{a.record_key}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={fetchOneMut.isPending || fetchingAnchor === `${a.side}-${i}`}
                            onClick={() => {
                              setFetchingAnchor(`${a.side}-${i}`);
                              fetchOneMut.mutate({ id: numericId, side: a.side });
                            }}
                          >
                            <RefreshCw className="w-3 h-3 mr-1" />
                            {fetchingAnchor === `${a.side}-${i}` ? '重拉中...' : '单条重拉'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <div className="text-xs text-muted-foreground mt-2">
                单条重拉仅 db 类型数据源支持；触发后"已触发，下轮对账自动重判"。
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 右侧操作区 */}
        <div className="space-y-3">
          <Card>
            <CardHeader><CardTitle className="text-base">人工判定操作</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {handled ? (
                <>
                  <div className="text-xs text-muted-foreground">
                    当前已处理为 <b>{handleBadge.label}</b>，如需修改请先回退。
                  </div>
                  <Button variant="secondary" className="w-full" onClick={() => setRevertOpen(true)}>
                    <Undo2 className="w-4 h-4 mr-1" />回退为未处理
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="default" className="w-full" onClick={() => openHandleModal('handled')}>
                    标记已处理
                  </Button>
                  <Button variant="secondary" className="w-full" onClick={() => openHandleModal('ignored')}>
                    标记已忽略
                  </Button>
                  <Button variant="secondary" className="w-full" onClick={() => openHandleModal('false_positive')}>
                    标记误判
                  </Button>
                </>
              )}
              <div className="border-t my-3" />
              <Button
                variant="secondary"
                className="w-full"
                disabled={fetchOneMut.isPending}
                onClick={() => {
                  fetchOneMut.mutate({ id: numericId });
                }}
              >
                <RefreshCw className="w-4 h-4 mr-1" />
                {fetchOneMut.isPending ? '重拉中...' : '单条重拉（两侧）'}
              </Button>
              <div className="border-t my-3" />
              <div className="text-xs text-muted-foreground">
                人工判定只写 handle_status，不覆盖技术状态 status；两者正交，引擎下一轮照常流转。
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* 人工处理 Dialog */}
      <Dialog open={handleModal !== null} onOpenChange={(o) => !o && setHandleModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              标记为 {handleModal ? HANDLE_BADGE[handleModal].label : ''}
            </DialogTitle>
            <DialogDescription>
              写 recon_diff_handle（handle_status, operator, remark），差异退出池、退出报告范围；不覆盖技术状态 status。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-sm font-medium">备注 remark *</label>
              <Textarea
                className="mt-1"
                rows={3}
                placeholder="判定理由（必填）"
                value={handleForm.remark}
                onChange={(e) => setHandleForm((f) => ({ ...f, remark: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium">操作人 operator</label>
              <Input
                className="mt-1"
                placeholder="请输入操作人"
                value={handleForm.operator}
                onChange={(e) => setHandleForm((f) => ({ ...f, operator: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setHandleModal(null)}>取消</Button>
            <Button
              disabled={!(handleForm.remark ?? '').trim() || handleMut.isPending}
              onClick={() => {
                if (handleModal) {
                  handleMut.mutate({ id: numericId, body: { ...handleForm, handle_status: handleModal } });
                }
              }}
            >
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 回退 Dialog */}
      <Dialog open={revertOpen} onOpenChange={setRevertOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>回退为未处理</DialogTitle>
            <DialogDescription>差异将恢复未处理状态，可重新进行人工判定。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-sm font-medium">备注 remark</label>
              <Textarea
                className="mt-1"
                rows={3}
                placeholder="回退理由"
                value={revertForm.remark}
                onChange={(e) => setRevertForm((f) => ({ ...f, remark: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium">操作人 operator</label>
              <Input
                className="mt-1"
                placeholder="请输入操作人"
                value={revertForm.operator}
                onChange={(e) => setRevertForm((f) => ({ ...f, operator: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRevertOpen(false)}>取消</Button>
            <Button
              disabled={revertMut.isPending}
              onClick={() => revertMut.mutate({ id: numericId, body: revertForm })}
            >
              确认回退
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 左右数据 KV 面板（金额字段高亮） */
function DataPanel({
  title,
  dsCode,
  jsonData,
  amountFieldSet,
}: {
  title: string;
  dsCode?: string;
  jsonData?: string;
  amountFieldSet: Set<string>;
}) {
  let obj: Record<string, unknown> = {};
  if (jsonData) {
    try {
      obj = JSON.parse(jsonData) as Record<string, unknown>;
    } catch {
      obj = { _raw: jsonData };
    }
  }
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          {dsCode && <Badge variant="default">{dsCode}</Badge>}
        </div>
        <div className="text-xs text-muted-foreground">金额单位：元（台账原始值）</div>
      </CardHeader>
      <CardContent>
        {Object.keys(obj).length === 0 ? (
          <div className="text-sm text-muted-foreground">（无数据，可能为单边缺失）</div>
        ) : (
          <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
            {Object.entries(obj).map(([k, v]) => {
              const isAmount = amountFieldSet.has(k);
              return (
                <div key={k} className="contents">
                  <div className="text-muted-foreground">{k}{isAmount && <span className="ml-1 text-xs text-blue-600">[金额]</span>}</div>
                  <div className={isAmount ? 'font-mono font-semibold text-foreground' : 'font-mono'}>
                    {String(v)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
