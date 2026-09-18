import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  merchantManualMatch,
  unmatchedBankForMerchant,
} from '../api/pos-account-api';
import { fmtAmt } from '../lib/pos-account-shared';
import { cell, rowId, type BillRow } from '../lib/reconcile-helpers';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: number | string;
  merchantNo: string;
  merchantName: string;
  operId: string;
  operName: string;
  onSaved: () => void;
};

export function ReconcileMerchantExceptionDialog({
  open,
  onOpenChange,
  batchId,
  merchantNo,
  merchantName,
  operId,
  operName,
  onSaved,
}: Props) {
  const [bankRows, setBankRows] = useState<BillRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [memo, setMemo] = useState('');

  useEffect(() => {
    if (!open) return;
    setSelectedId('');
    setMemo('');
    unmatchedBankForMerchant(batchId, merchantNo)
      .then((rows) => setBankRows(rows || []))
      .catch((e) => toast.error(e instanceof Error ? e.message : '加载失败'));
  }, [open, batchId, merchantNo]);

  const submit = async () => {
    if (!selectedId) {
      toast.error('请选择银行流水');
      return;
    }
    if (!memo.trim()) {
      toast.error('必须填写备注');
      return;
    }

    try {
      await merchantManualMatch(batchId, merchantNo, {
        bankBillIds: [selectedId],
        memo,
        operId,
        operName,
      });
      toast.success('提交成功');
      setSelectedId('');
      setMemo('');
      const rows = await unmatchedBankForMerchant(batchId, merchantNo);
      setBankRows(rows || []);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '提交失败');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            商户帐异常处理 — {merchantNo} {merchantName}
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">未核对银行流水（单选逐行提交，必须填备注）</p>
        <div className="max-h-[400px] overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead className="text-xs">ID</TableHead>
                <TableHead className="text-xs">商户号</TableHead>
                <TableHead className="text-xs">终端号</TableHead>
                <TableHead className="text-xs">交易时间</TableHead>
                <TableHead className="text-xs">金额</TableHead>
                <TableHead className="text-xs">订单号</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bankRows.map((r) => {
                const id = rowId(r);
                return (
                  <TableRow key={id}>
                    <TableCell>
                      <input
                        type="radio"
                        name="merchant-bank"
                        checked={selectedId === id}
                        onChange={() => setSelectedId(id)}
                      />
                    </TableCell>
                    <TableCell className="text-xs">{id}</TableCell>
                    <TableCell className="text-xs">{cell(r, 'merchantNo')}</TableCell>
                    <TableCell className="text-xs">{cell(r, 'terminalNo')}</TableCell>
                    <TableCell className="text-xs">{cell(r, 'tranTime')}</TableCell>
                    <TableCell className="text-xs">{fmtAmt(r.bankAmount)}</TableCell>
                    <TableCell className="text-xs">{cell(r, 'channelOrderNo')}</TableCell>
                  </TableRow>
                );
              })}
              {bankRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    暂无未核对银行流水
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <Textarea
          placeholder="备注（必填）"
          rows={2}
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
          <Button onClick={submit}>提交</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
