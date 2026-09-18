import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
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
  storeManualMatch,
  unmatchedBankForStore,
  unmatchedMall,
} from '../api/pos-account-api';
import { fmtAmt } from '../lib/pos-account-shared';
import {
  cell,
  isBalanced,
  parseBanksMerchantsResponse,
  rowId,
  sumField,
  type BillRow,
} from '../lib/reconcile-helpers';

const MAX_MALL = 10;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: number | string;
  shopCode: string;
  shopName: string;
  operId: string;
  operName: string;
  onSaved: () => void;
};

export function ReconcileStoreExceptionDialog({
  open,
  onOpenChange,
  batchId,
  shopCode,
  shopName,
  operId,
  operName,
  onSaved,
}: Props) {
  const [sktFilter, setSktFilter] = useState('');
  const [terminalFilter, setTerminalFilter] = useState('');
  const [mallRows, setMallRows] = useState<BillRow[]>([]);
  const [bankRows, setBankRows] = useState<BillRow[]>([]);
  const [merchants, setMerchants] = useState<BillRow[]>([]);
  const [selectedMall, setSelectedMall] = useState<Set<string>>(new Set());
  const [selectedBank, setSelectedBank] = useState<Set<string>>(new Set());
  const [memo, setMemo] = useState('');

  const loadMall = useCallback(() => {
    unmatchedMall(batchId, shopCode, { sktno: sktFilter.trim() || undefined })
      .then((rows) => setMallRows(rows || []))
      .catch((e) => toast.error(e instanceof Error ? e.message : '加载商场流水失败'));
  }, [batchId, shopCode, sktFilter]);

  const loadBank = useCallback(
    (byTerminal: boolean) => {
      const param: Record<string, unknown> = {};
      if (byTerminal) {
        const terminalNo = terminalFilter.trim();
        if (terminalNo) {
          param.terminalNo = terminalNo;
        } else {
          const sktnos = mallRows
            .filter((r) => selectedMall.has(rowId(r)))
            .map((r) => cell(r, 'sktno'))
            .filter(Boolean);
          const unique = [...new Set(sktnos)];
          if (unique.length === 0) {
            toast.error('请先在左侧选中商场流水，或输入终端号再过滤');
            return;
          }
          param.sktnos = unique;
        }
      }
      unmatchedBankForStore(batchId, shopCode, param)
        .then((data) => {
          const parsed = parseBanksMerchantsResponse(data);
          setBankRows(parsed.banks);
          setMerchants(parsed.merchants);
        })
        .catch((e) => toast.error(e instanceof Error ? e.message : '加载银行流水失败'));
    },
    [batchId, shopCode, terminalFilter, mallRows, selectedMall],
  );

  useEffect(() => {
    if (!open) return;
    setSktFilter('');
    setTerminalFilter('');
    setSelectedMall(new Set());
    setSelectedBank(new Set());
    setMemo('');
    setMerchants([]);
    unmatchedMall(batchId, shopCode, {})
      .then((rows) => setMallRows(rows || []))
      .catch(() => setMallRows([]));
    unmatchedBankForStore(batchId, shopCode, {})
      .then((data) => {
        const parsed = parseBanksMerchantsResponse(data);
        setBankRows(parsed.banks);
        setMerchants(parsed.merchants);
      })
      .catch(() => setBankRows([]));
  }, [open, batchId, shopCode]);

  const mallSelectedRows = useMemo(
    () => mallRows.filter((r) => selectedMall.has(rowId(r))),
    [mallRows, selectedMall],
  );
  const bankSelectedRows = useMemo(
    () => bankRows.filter((r) => selectedBank.has(rowId(r))),
    [bankRows, selectedBank],
  );

  const leftSum = sumField(mallSelectedRows, 'skje');
  const rightSum = sumField(bankSelectedRows, 'bankAmount');
  const balanced =
    bankSelectedRows.length > 0 && isBalanced(leftSum, rightSum);

  const toggleMall = (id: string, checked: boolean) => {
    setSelectedMall((prev) => {
      const next = new Set(prev);
      if (checked) {
        if (next.size >= MAX_MALL) {
          toast.error('左侧最多同时选中10行');
          return prev;
        }
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const toggleBank = (id: string, checked: boolean) => {
    setSelectedBank((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const save = async () => {
    if (mallSelectedRows.length === 0) {
      toast.error('请至少选择一笔商场流水');
      return;
    }
    if ((!bankSelectedRows.length || !balanced) && !memo.trim()) {
      toast.error('未选择银行流水或金额不平衡时必须填写备注');
      return;
    }
    const tip =
      `商场笔数 ${mallSelectedRows.length}，金额 ${fmtAmt(leftSum)}；` +
      `银行笔数 ${bankSelectedRows.length}，金额 ${fmtAmt(rightSum)}` +
      (balanced ? '（平衡）' : '（不平衡/无银行，将按备注挂起）');
    if (!window.confirm(`${tip}\n\n确认保存人工匹配？`)) return;

    try {
      await storeManualMatch(batchId, shopCode, {
        mallBillIds: mallSelectedRows.map((r) => r.id as string | number),
        bankBillIds: bankSelectedRows.map((r) => r.id as string | number),
        memo,
        operId,
        operName,
      });
      toast.success('保存成功');
      setSelectedMall(new Set());
      setSelectedBank(new Set());
      setMemo('');
      loadMall();
      loadBank(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            门店帐异常处理 — {shopCode} {shopName}
          </DialogTitle>
        </DialogHeader>

        <div className="text-xs text-muted-foreground">
          对应商户：
          {merchants.length > 0
            ? merchants
                .map(
                  (m) =>
                    `${cell(m, 'merchantNo')}${cell(m, 'merchantName') ? `(${cell(m, 'merchantName')})` : ''}`,
                )
                .join('、')
            : '无（请检查 MERCHANT_MALL_CONFIG）'}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">未匹配商场流水（多选，最多10行）</span>
              <Input
                className="h-8 w-28 text-xs"
                placeholder="款台号过滤"
                value={sktFilter}
                onChange={(e) => setSktFilter(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadMall()}
              />
              <Button size="sm" variant="outline" onClick={loadMall}>过滤</Button>
            </div>
            <div className="max-h-[320px] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead className="text-xs">ID</TableHead>
                    <TableHead className="text-xs">款台</TableHead>
                    <TableHead className="text-xs">小票</TableHead>
                    <TableHead className="text-xs">时间</TableHead>
                    <TableHead className="text-xs">金额</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mallRows.map((r) => {
                    const id = rowId(r);
                    return (
                      <TableRow key={id}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={selectedMall.has(id)}
                            onChange={(e) => toggleMall(id, e.target.checked)}
                          />
                        </TableCell>
                        <TableCell className="text-xs">{id}</TableCell>
                        <TableCell className="text-xs">{cell(r, 'sktno')}</TableCell>
                        <TableCell className="text-xs">{cell(r, 'jlbh')}</TableCell>
                        <TableCell className="text-xs">{cell(r, 'jysj')}</TableCell>
                        <TableCell className="text-xs">{fmtAmt(r.skje)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <p className="mt-1 text-xs">已选商场金额合计：{fmtAmt(leftSum)}</p>
          </div>

          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">未匹配银行流水（多选）</span>
              <Input
                className="h-8 w-28 text-xs"
                placeholder="终端号"
                value={terminalFilter}
                onChange={(e) => setTerminalFilter(e.target.value)}
              />
              <Button size="sm" onClick={() => loadBank(true)}>按终端过滤</Button>
              <Button size="sm" variant="outline" onClick={() => loadBank(false)}>全部</Button>
            </div>
            <div className="max-h-[320px] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead className="text-xs">ID</TableHead>
                    <TableHead className="text-xs">商户</TableHead>
                    <TableHead className="text-xs">终端</TableHead>
                    <TableHead className="text-xs">时间</TableHead>
                    <TableHead className="text-xs">金额</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bankRows.map((r) => {
                    const id = rowId(r);
                    return (
                      <TableRow key={id}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={selectedBank.has(id)}
                            onChange={(e) => toggleBank(id, e.target.checked)}
                          />
                        </TableCell>
                        <TableCell className="text-xs">{id}</TableCell>
                        <TableCell className="text-xs">{cell(r, 'merchantNo')}</TableCell>
                        <TableCell className="text-xs">{cell(r, 'terminalNo')}</TableCell>
                        <TableCell className="text-xs">{cell(r, 'tranTime')}</TableCell>
                        <TableCell className="text-xs">{fmtAmt(r.bankAmount)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <p className="mt-1 text-xs">
              已选银行金额合计：{fmtAmt(rightSum)}
              <span className={cn(balanced ? 'text-green-600' : 'text-destructive')}>
                {balanced ? '（已平衡）' : '（未平衡）'}
              </span>
            </p>
          </div>
        </div>

        <Textarea
          placeholder="备注"
          rows={2}
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
          <Button onClick={save}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
