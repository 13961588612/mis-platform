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
import {
  createDecideBatch,
  listEnabledMerchants,
  listPullBatches,
} from '../api/pos-account-api';
import { yesterdayStr } from '../lib/pos-account-shared';
import { cell, rowId, type BillRow } from '../lib/reconcile-helpers';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  operId: string;
  operName: string;
  onCreated: (batchId: number | string) => void;
};

export function ReconcileCreateDialog({
  open,
  onOpenChange,
  operId,
  operName,
  onCreated,
}: Props) {
  const [batchName, setBatchName] = useState('');
  const [mallDate, setMallDate] = useState(yesterdayStr());
  const [dataBatchId, setDataBatchId] = useState('');
  const [pullOptions, setPullOptions] = useState<{ id: string; label: string }[]>([]);
  const [merchants, setMerchants] = useState<BillRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBatchName('');
    setMallDate(yesterdayStr());
    setSaving(false);

    listPullBatches()
      .then((list) => {
        const opts = (list || []).map((b) => ({
          id: String(b.batchId),
          label: `#${b.batchId} | ${cell(b, 'startDate')} ~ ${cell(b, 'endDate')} | 创建${cell(b, 'createTime')}`,
        }));
        setPullOptions(opts);
        setDataBatchId(opts[0]?.id ?? '');
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : '加载银行批次失败'));

    listEnabledMerchants()
      .then((list) => {
        const rows = (list || []).slice().sort((a, b) =>
          cell(a, 'merchantName').localeCompare(cell(b, 'merchantName'), 'zh-CN'),
        );
        setMerchants(rows);
        setSelected(new Set(rows.map((m) => cell(m, 'merchantNo'))));
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : '加载商户失败'));
  }, [open]);

  const toggleMerchant = (no: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(no);
      else next.delete(no);
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    if (checked) {
      setSelected(new Set(merchants.map((m) => cell(m, 'merchantNo'))));
    } else {
      setSelected(new Set());
    }
  };

  const submit = async () => {
    const name = batchName.trim();
    if (!name) {
      toast.error('请输入批次名称');
      return;
    }
    if (name.length > 200) {
      toast.error('批次名称不能超过200个字符');
      return;
    }
    if (!mallDate) {
      toast.error('请选择商场流水日期');
      return;
    }
    if (!dataBatchId) {
      toast.error('请选择银行流水批次');
      return;
    }
    if (selected.size === 0) {
      toast.error('请至少选择一个商户');
      return;
    }

    setSaving(true);
    try {
      const data = await createDecideBatch({
        batchName: name,
        mallDate,
        dataBatchId: Number(dataBatchId),
        merchantNos: Array.from(selected),
        operId,
        operName,
      });
      toast.success(`新建对账成功，批次 ${data?.batchId ?? ''}`);
      onOpenChange(false);
      const newId = data?.batchId;
      if (newId != null && newId !== '') onCreated(newId as string | number);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '新建失败');
    } finally {
      setSaving(false);
    }
  };

  const allChecked = merchants.length > 0 && selected.size === merchants.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>新建对账</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1 space-y-1">
            <label className="text-xs text-muted-foreground">批次名称</label>
            <Input
              value={batchName}
              onChange={(e) => setBatchName(e.target.value)}
              placeholder="必填，便于下拉识别"
              maxLength={200}
            />
          </div>
          <div className="w-[160px] space-y-1">
            <label className="text-xs text-muted-foreground">商场流水日期</label>
            <Input type="date" value={mallDate} onChange={(e) => setMallDate(e.target.value)} />
          </div>
          <div className="min-w-[240px] flex-1 space-y-1">
            <label className="text-xs text-muted-foreground">银行流水批次</label>
            <Select value={dataBatchId} onValueChange={setDataBatchId}>
              <SelectTrigger>
                <SelectValue placeholder="请选择PULL批次" />
              </SelectTrigger>
              <SelectContent>
                {pullOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">参与核算商户（默认全选 status=1）：</p>
        <div className="max-h-[360px] overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={(e) => toggleAll(e.target.checked)}
                    aria-label="全选商户"
                  />
                </TableHead>
                <TableHead>商户号</TableHead>
                <TableHead>商户名</TableHead>
                <TableHead>渠道</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {merchants.map((m) => {
                const no = cell(m, 'merchantNo');
                return (
                  <TableRow key={rowId(m) || no}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={selected.has(no)}
                        onChange={(e) => toggleMerchant(no, e.target.checked)}
                      />
                    </TableCell>
                    <TableCell className="text-xs">{no}</TableCell>
                    <TableCell className="text-xs">{cell(m, 'merchantName')}</TableCell>
                    <TableCell className="text-xs">{cell(m, 'channelType')}</TableCell>
                  </TableRow>
                );
              })}
              {merchants.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    暂无启用商户
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? '提交中…' : '提交'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
