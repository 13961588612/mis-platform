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
  deleteMerchantMatches,
  matchedBankForMerchant,
  matchedMallForBank,
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
  merchantNo: string;
  merchantName: string;
  operId: string;
  operName: string;
  onDemolished: () => void;
};

export function ReconcileMerchantMatchedDialog({
  open,
  onOpenChange,
  batchId,
  merchantNo,
  merchantName,
  operId,
  operName,
  onDemolished,
}: Props) {
  const [terminalFilter, setTerminalFilter] = useState('');
  const [orderFilter, setOrderFilter] = useState('');
  const [matchTypeFilter, setMatchTypeFilter] = useState('');
  const [bankRows, setBankRows] = useState<BillRow[]>([]);
  const [currentBankId, setCurrentBankId] = useState('');
  const [groupBankRows, setGroupBankRows] = useState<BillRow[]>([]);
  const [mallRows, setMallRows] = useState<BillRow[]>([]);
  const [groupId, setGroupId] = useState<string | number | null>(null);
  const [matchType, setMatchType] = useState('');
  const [matchTypeName, setMatchTypeName] = useState('');
  const [matchTime, setMatchTime] = useState('');
  const [memo, setMemo] = useState('');
  const [detailOperName, setDetailOperName] = useState('');

  const clearDetail = () => {
    setCurrentBankId('');
    setGroupBankRows([]);
    setMallRows([]);
    setGroupId(null);
    setMatchType('');
    setMatchTypeName('');
    setMatchTime('');
    setMemo('');
    setDetailOperName('');
  };

  const loadBanks = useCallback(() => {
    clearDetail();
    const param: Record<string, unknown> = {};
    if (terminalFilter.trim()) param.terminalNo = terminalFilter.trim();
    if (orderFilter.trim()) param.channelOrderNo = orderFilter.trim();
    if (matchTypeFilter) param.matchType = matchTypeFilter;

    matchedBankForMerchant(batchId, merchantNo, param)
      .then((rows) => setBankRows(rows || []))
      .catch(() => setBankRows([]));
  }, [batchId, merchantNo, terminalFilter, orderFilter, matchTypeFilter]);

  useEffect(() => {
    if (!open) return;
    setTerminalFilter('');
    setOrderFilter('');
    setMatchTypeFilter('');
    clearDetail();
    matchedBankForMerchant(batchId, merchantNo, {})
      .then((rows) => setBankRows(rows || []))
      .catch(() => setBankRows([]));
  }, [open, batchId, merchantNo]);

  const onBankClick = (row: BillRow) => {
    const id = rowId(row);
    setCurrentBankId(id);
    matchedMallForBank(batchId, merchantNo, row.id as string | number)
      .then((data) => {
        const parsed = parseMatchDetailResponse(data);
        setGroupId(parsed.groupId);
        setGroupBankRows(parsed.banks);
        setMallRows(parsed.malls);
        setMatchType(parsed.matchType);
        setMatchTypeName(parsed.matchTypeName);
        setMatchTime(parsed.matchTime);
        setMemo(parsed.memo);
        setDetailOperName(parsed.operName);
      })
      .catch(() => {
        setGroupBankRows([]);
        setMallRows([]);
      });
  };

  const demolish = async () => {
    if (!currentBankId) return;
    const bankCnt = groupBankRows.length || 1;
    const mallCnt = mallRows.length;
    const tip = `确认拆除分组 ${groupId ?? '-'}？将释放同组银行流水 ${bankCnt} 笔、商场流水 ${mallCnt} 笔。`;
    if (!window.confirm(tip)) return;

    try {
      await deleteMerchantMatches(batchId, merchantNo, {
        bankBillIds: [currentBankId],
        operId,
        operName,
      });
      toast.success('已拆除匹配');
      loadBanks();
      onDemolished();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '拆除失败');
    }
  };

  const MiniTable = ({
    rows,
    kind,
    emptyText,
  }: {
    rows: BillRow[];
    kind: 'bank' | 'mall';
    emptyText: string;
  }) => (
    <div className="max-h-[120px] overflow-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">ID</TableHead>
            <TableHead className="text-xs">{kind === 'bank' ? '终端' : '款台'}</TableHead>
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
                  {kind === 'bank' ? cell(r, 'terminalNo') : cell(r, 'sktno')}
                </TableCell>
                <TableCell className="text-xs">
                  {kind === 'bank' ? cell(r, 'tranTime') : cell(r, 'jysj')}
                </TableCell>
                <TableCell className="text-xs">
                  {fmtAmt(kind === 'bank' ? r.bankAmount : r.skje)}
                </TableCell>
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
          <DialogTitle>商户已对账 — {merchantNo} {merchantName}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-2">
          <Input
            className="h-8 w-28 text-xs"
            placeholder="终端号"
            value={terminalFilter}
            onChange={(e) => setTerminalFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadBanks()}
          />
          <Input
            className="h-8 w-28 text-xs"
            placeholder="订单号"
            value={orderFilter}
            onChange={(e) => setOrderFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadBanks()}
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
          <Button size="sm" onClick={loadBanks}>查询</Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setTerminalFilter('');
              setOrderFilter('');
              setMatchTypeFilter('');
              clearDetail();
              matchedBankForMerchant(batchId, merchantNo, {})
                .then((rows) => setBankRows(rows || []))
                .catch(() => setBankRows([]));
            }}
          >
            全部
          </Button>
        </div>

        <p className="text-sm font-medium">已对账银行流水（点击一行查看同分组明细）</p>
        <div className="max-h-[280px] overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">分组</TableHead>
                <TableHead className="text-xs">ID</TableHead>
                <TableHead className="text-xs">终端</TableHead>
                <TableHead className="text-xs">时间</TableHead>
                <TableHead className="text-xs">金额</TableHead>
                <TableHead className="text-xs">订单号</TableHead>
                <TableHead className="text-xs">核对类型</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bankRows.map((r) => {
                const id = rowId(r);
                return (
                  <TableRow
                    key={id}
                    className={cn('cursor-pointer', id === currentBankId && 'bg-primary/10')}
                    onClick={() => onBankClick(r)}
                  >
                    <TableCell className="text-xs">{cell(r, 'groupId')}</TableCell>
                    <TableCell className="text-xs">{id}</TableCell>
                    <TableCell className="text-xs">{cell(r, 'terminalNo')}</TableCell>
                    <TableCell className="text-xs">{cell(r, 'tranTime')}</TableCell>
                    <TableCell className="text-xs">{fmtAmt(r.bankAmount)}</TableCell>
                    <TableCell className="text-xs">{cell(r, 'channelOrderNo')}</TableCell>
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
              {bankRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    暂无已对账银行流水
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="rounded-md bg-muted/50 p-3 text-xs">
          {currentBankId ? (
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
            <span className="text-muted-foreground">请先在上方选中一笔银行流水</span>
          )}
        </div>

        <p className="text-sm font-medium">
          同分组银行流水{groupId != null ? `（分组 ${groupId}）` : ''}
        </p>
        <MiniTable
          rows={groupBankRows}
          kind="bank"
          emptyText={currentBankId ? '无同分组银行流水' : '请选择银行流水'}
        />

        <p className="text-sm font-medium">
          同分组商场流水{groupId != null ? `（分组 ${groupId}）` : ''}
        </p>
        <MiniTable
          rows={mallRows}
          kind="mall"
          emptyText={
            currentBankId ? '无关联商场流水（可能为仅银行侧挂起）' : '请选择银行流水'
          }
        />

        <DialogFooter>
          <Button variant="destructive" disabled={!currentBankId} onClick={demolish}>
            拆除当前分组匹配
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
