import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  deleteStoreMatches,
  matchedBankForMall,
  matchedMall,
} from '../api/pos-account-api';
import { fmtAmt } from '../lib/pos-account-shared';
import {
  cell,
  MATCH_TYPE_OPTIONS,
  parseMatchDetailResponse,
  rowId,
  type BillRow,
} from '../lib/reconcile-helpers';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: number | string;
  shopCode: string;
  shopName: string;
  operId: string;
  operName: string;
  onDemolished: () => void;
};

export function ReconcileStoreMatchedDialog({
  open,
  onOpenChange,
  batchId,
  shopCode,
  shopName,
  operId,
  operName,
  onDemolished,
}: Props) {
  const [sktFilter, setSktFilter] = useState('');
  const [jlbhFilter, setJlbhFilter] = useState('');
  const [matchTypeFilter, setMatchTypeFilter] = useState('');
  const [mallRows, setMallRows] = useState<BillRow[]>([]);
  const [currentMallId, setCurrentMallId] = useState('');
  const [groupMallRows, setGroupMallRows] = useState<BillRow[]>([]);
  const [bankRows, setBankRows] = useState<BillRow[]>([]);
  const [groupId, setGroupId] = useState<string | number | null>(null);
  const [matchType, setMatchType] = useState('');
  const [matchTypeName, setMatchTypeName] = useState('');
  const [matchTime, setMatchTime] = useState('');
  const [memo, setMemo] = useState('');
  const [detailOperName, setDetailOperName] = useState('');

  const clearDetail = () => {
    setCurrentMallId('');
    setGroupMallRows([]);
    setBankRows([]);
    setGroupId(null);
    setMatchType('');
    setMatchTypeName('');
    setMatchTime('');
    setMemo('');
    setDetailOperName('');
  };

  const loadMall = useCallback(() => {
    clearDetail();
    const param: Record<string, unknown> = {};
    if (sktFilter.trim()) param.sktno = sktFilter.trim();
    if (jlbhFilter.trim()) param.jlbh = jlbhFilter.trim();
    if (matchTypeFilter) param.matchType = matchTypeFilter;

    matchedMall(batchId, shopCode, param)
      .then((rows) => setMallRows(rows || []))
      .catch(() => setMallRows([]));
  }, [batchId, shopCode, sktFilter, jlbhFilter, matchTypeFilter]);

  useEffect(() => {
    if (!open) return;
    setSktFilter('');
    setJlbhFilter('');
    setMatchTypeFilter('');
    clearDetail();
    matchedMall(batchId, shopCode, {})
      .then((rows) => setMallRows(rows || []))
      .catch(() => setMallRows([]));
  }, [open, batchId, shopCode]);

  const onMallClick = (row: BillRow) => {
    const id = rowId(row);
    setCurrentMallId(id);
    matchedBankForMall(batchId, shopCode, row.id as string | number)
      .then((data) => {
        const parsed = parseMatchDetailResponse(data);
        setGroupId(parsed.groupId);
        setGroupMallRows(parsed.malls);
        setBankRows(parsed.banks);
        setMatchType(parsed.matchType);
        setMatchTypeName(parsed.matchTypeName);
        setMatchTime(parsed.matchTime);
        setMemo(parsed.memo);
        setDetailOperName(parsed.operName);
      })
      .catch(() => {
        setGroupMallRows([]);
        setBankRows([]);
      });
  };

  const demolish = async () => {
    if (!currentMallId) return;
    const mallCnt = groupMallRows.length || 1;
    const bankCnt = bankRows.length;
    const tip = `确认拆除分组 ${groupId ?? '-'}？将释放同组商场流水 ${mallCnt} 笔、银行流水 ${bankCnt} 笔。`;
    if (!window.confirm(tip)) return;

    try {
      await deleteStoreMatches(batchId, shopCode, {
        mallBillIds: [currentMallId],
        operId,
        operName,
      });
      toast.success('已拆除匹配');
      loadMall();
      onDemolished();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '拆除失败');
    }
  };

  const BillTable = ({
    rows,
    amountKey,
    emptyText,
  }: {
    rows: BillRow[];
    amountKey: string;
    emptyText: string;
  }) => (
    <div className="max-h-[120px] overflow-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">ID</TableHead>
            <TableHead className="text-xs">款台/终端</TableHead>
            <TableHead className="text-xs">时间</TableHead>
            <TableHead className="text-xs">金额</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-xs text-muted-foreground">
                {emptyText}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => (
              <TableRow key={rowId(r)}>
                <TableCell className="text-xs">{rowId(r)}</TableCell>
                <TableCell className="text-xs">
                  {cell(r, 'sktno') || cell(r, 'terminalNo')}
                </TableCell>
                <TableCell className="text-xs">{cell(r, 'jysj') || cell(r, 'tranTime')}</TableCell>
                <TableCell className="text-xs">{fmtAmt(r[amountKey])}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>已对账流水 — {shopCode} {shopName}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-2">
          <Input
            className="h-8 w-28 text-xs"
            placeholder="收款台号"
            value={sktFilter}
            onChange={(e) => setSktFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadMall()}
          />
          <Input
            className="h-8 w-28 text-xs"
            placeholder="小票号"
            value={jlbhFilter}
            onChange={(e) => setJlbhFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadMall()}
          />
          <Select
            value={matchTypeFilter || '__all__'}
            onValueChange={(v) => setMatchTypeFilter(v === '__all__' ? '' : v)}
          >
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue placeholder="核对类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部</SelectItem>
              {MATCH_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={loadMall}>查询</Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSktFilter('');
              setJlbhFilter('');
              setMatchTypeFilter('');
              clearDetail();
              matchedMall(batchId, shopCode, {})
                .then((rows) => setMallRows(rows || []))
                .catch(() => setMallRows([]));
            }}
          >
            全部
          </Button>
        </div>

        <p className="text-sm font-medium">已对账商场流水（点击一行查看同分组明细）</p>
        <div className="max-h-[280px] overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">分组</TableHead>
                <TableHead className="text-xs">ID</TableHead>
                <TableHead className="text-xs">款台</TableHead>
                <TableHead className="text-xs">小票</TableHead>
                <TableHead className="text-xs">时间</TableHead>
                <TableHead className="text-xs">金额</TableHead>
                <TableHead className="text-xs">核对类型</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mallRows.map((r) => {
                const id = rowId(r);
                return (
                  <TableRow
                    key={id}
                    className={cn(
                      'cursor-pointer',
                      id === currentMallId && 'bg-primary/10',
                    )}
                    onClick={() => onMallClick(r)}
                  >
                    <TableCell className="text-xs">{cell(r, 'groupId')}</TableCell>
                    <TableCell className="text-xs">{id}</TableCell>
                    <TableCell className="text-xs">{cell(r, 'sktno')}</TableCell>
                    <TableCell className="text-xs">{cell(r, 'jlbh')}</TableCell>
                    <TableCell className="text-xs">{cell(r, 'jysj')}</TableCell>
                    <TableCell className="text-xs">{fmtAmt(r.skje)}</TableCell>
                    <TableCell
                      className={cn(
                        'text-xs',
                        r.matchType === 'manual' ? 'text-amber-600' : 'text-green-600',
                      )}
                    >
                      {cell(r, 'matchTypeName') || '-'}
                    </TableCell>
                  </TableRow>
                );
              })}
              {mallRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    暂无已对账商场流水
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="rounded-md bg-muted/50 p-3 text-xs">
          {currentMallId ? (
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <span>分组号：<strong>{groupId ?? '-'}</strong></span>
              <span>
                匹配方式：
                <strong className={matchType === 'manual' ? 'text-amber-600' : 'text-green-600'}>
                  {matchTypeName || '-'}
                </strong>
              </span>
              <span>对账时间：<strong>{matchTime || '-'}</strong></span>
              {detailOperName && <span>处理人：<strong>{detailOperName}</strong></span>}
              <span>说明：<strong>{memo || '-'}</strong></span>
            </div>
          ) : (
            <span className="text-muted-foreground">请先在上方选中一笔商场流水</span>
          )}
        </div>

        <p className="text-sm font-medium">
          同分组商场流水{groupId != null ? `（分组 ${groupId}）` : ''}
        </p>
        <BillTable
          rows={groupMallRows}
          amountKey="skje"
          emptyText={currentMallId ? '无同分组商场流水' : '请选择商场流水'}
        />

        <p className="text-sm font-medium">
          同分组银行流水{groupId != null ? `（分组 ${groupId}）` : ''}
        </p>
        <BillTable
          rows={bankRows}
          amountKey="bankAmount"
          emptyText={
            currentMallId ? '无关联银行流水（可能为仅商场侧挂起）' : '请选择商场流水'
          }
        />

        <DialogFooter>
          <Button variant="destructive" disabled={!currentMallId} onClick={demolish}>
            拆除当前分组匹配
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
