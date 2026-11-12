import { Loader2, Plus, Search, Trash2 } from 'lucide-react';
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
import {
  getSktDetail,
  listBanks,
  queryPendingSktMarks,
  saveSktMark,
  type BankOption,
} from '../api/pos-account-api';
import { OWNER_TYPE_OPTIONS, useOper } from '../lib/pos-account-shared';
import { ShopCodeChips } from './shop-code-chips';

type TerminalRow = {
  bankId: number | null;
  code: string;
  remark: string;
  sourceType: number;
};

type SktRow = {
  shopCode: string;
  shopName?: string;
  sktno: string;
  alreadyExists: boolean;
  hasTerminal: boolean;
};

function toBool(v: unknown): boolean {
  return v === true || v === 1;
}

export function SktMarkPanel() {
  const oper = useOper();
  const [shopCodes, setShopCodes] = useState<string[]>([]);
  const [rows, setRows] = useState<SktRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [banks, setBanks] = useState<BankOption[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    sktno: '',
    shopCode: '',
    shopName: '',
    ownerType: 1,
    terminals: [] as TerminalRow[],
  });

  useEffect(() => {
    void listBanks()
      .then(setBanks)
      .catch(() => setBanks([]));
  }, []);

  const queryPage = useCallback(async () => {
    if (!shopCodes.length) {
      toast.error('请至少选择一个门店');
      return;
    }
    setLoading(true);
    try {
      const list = await queryPendingSktMarks({ shopCodes });
      setRows(
        (list || []).map((r) => ({
          shopCode: String(r.shopCode ?? ''),
          shopName: r.shopName != null ? String(r.shopName) : '',
          sktno: String(r.sktno ?? ''),
          alreadyExists: toBool(r.alreadyExists),
          hasTerminal: toBool(r.hasTerminal),
        })),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '查询失败');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [shopCodes]);

  const handleMark = async (item: SktRow) => {
    setForm({
      sktno: item.sktno,
      shopCode: item.shopCode,
      shopName: item.shopName || '',
      ownerType: 1,
      terminals: [],
    });
    setDialogOpen(true);

    if (item.alreadyExists) {
      try {
        const d = await getSktDetail(item.sktno);
        if (!d) return;
        setForm((prev) => ({
          ...prev,
          ownerType: Number(d.ownerType) || 1,
          terminals: ((d.terminals as Record<string, unknown>[]) || []).map((t) => ({
            bankId: t.bankId != null ? Number(t.bankId) : null,
            code: String(t.code ?? ''),
            remark: String(t.remark ?? ''),
            sourceType: t.sourceType != null ? Number(t.sourceType) : 1,
          })),
        }));
      } catch {
        // 新建态
      }
    }
  };

  const addTerminalRow = () => {
    setForm((prev) => ({
      ...prev,
      terminals: [...prev.terminals, { bankId: null, code: '', remark: '', sourceType: 1 }],
    }));
  };

  const removeTerminalRow = (idx: number) => {
    setForm((prev) => ({
      ...prev,
      terminals: prev.terminals.filter((_, i) => i !== idx),
    }));
  };

  const updateTerminalRow = (idx: number, patch: Partial<TerminalRow>) => {
    setForm((prev) => ({
      ...prev,
      terminals: prev.terminals.map((t, i) => (i === idx ? { ...t, ...patch } : t)),
    }));
  };

  const confirmSave = async () => {
    if (!form.ownerType) {
      toast.error('请选择款台类型');
      return;
    }
    const terminals = form.terminals
      .filter((t) => t.bankId && t.code.trim())
      .map((t) => ({
        bankId: t.bankId!,
        code: t.code.trim(),
        remark: t.remark || '',
        sourceType: t.sourceType ?? 1,
      }));

    if (form.ownerType === 1 && terminals.length === 0) {
      toast.error('大POS必须至少绑定一个终端');
      return;
    }

    setSaving(true);
    try {
      await saveSktMark({
        sktno: form.sktno,
        shopCode: form.shopCode,
        ownerType: form.ownerType,
        terminals,
        operId: oper.operId,
        operName: oper.operName,
      });
      toast.success('保存成功');
      setDialogOpen(false);
      await queryPage();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="shrink-0 border-b border-dashed border-border pb-3">
        <div className="flex flex-wrap items-end gap-3">
          <span className="mb-1 text-sm text-muted-foreground">数据范围：最近 10 个对账批次</span>
          <div className="flex min-w-[240px] flex-col gap-1">
            <span className="text-xs text-muted-foreground">门店（必选）</span>
            <ShopCodeChips value={shopCodes} onChange={setShopCodes} placeholder="门店必选" />
          </div>
          <Button type="button" className="mb-0.5" onClick={() => void queryPage()} disabled={loading}>
            {loading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Search className="mr-1 h-4 w-4" />}
            查询
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">门店号</TableHead>
              <TableHead className="w-[140px]">门店名</TableHead>
              <TableHead className="w-[120px]">收款台号</TableHead>
              <TableHead className="w-[100px]">款台状态</TableHead>
              <TableHead className="w-[100px]">对应终端</TableHead>
              <TableHead className="w-[120px]">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                  加载中…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  请选择门店后查询
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={`${row.shopCode}_${row.sktno}`}>
                  <TableCell>{row.shopCode}</TableCell>
                  <TableCell>{row.shopName}</TableCell>
                  <TableCell>{row.sktno}</TableCell>
                  <TableCell>{row.alreadyExists ? '已存在' : '不存在'}</TableCell>
                  <TableCell>{row.hasTerminal ? '有' : '无'}</TableCell>
                  <TableCell>
                    <Button type="button" variant="link" className="h-auto p-0" onClick={() => void handleMark(row)}>
                      标记/修改
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              款台标记 — {form.sktno}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {form.shopCode} {form.shopName}
              </span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-muted-foreground">款台类型</span>
              <Select
                value={String(form.ownerType)}
                onValueChange={(v) => setForm((prev) => ({ ...prev, ownerType: Number(v) }))}
              >
                <SelectTrigger className="w-full max-w-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OWNER_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)}>
                      {opt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">终端列表</span>
              <Button type="button" size="sm" variant="outline" onClick={addTerminalRow}>
                <Plus className="mr-1 h-4 w-4" />
                增加终端
              </Button>
            </div>

            {form.terminals.map((t, idx) => (
              <div
                key={idx}
                className="flex flex-wrap items-end gap-3 border-b border-dashed border-border/60 pb-3"
              >
                <div className="flex min-w-[180px] flex-col gap-1">
                  <span className="text-xs text-muted-foreground">银行</span>
                  <Select
                    value={t.bankId != null ? String(t.bankId) : undefined}
                    onValueChange={(v) => updateTerminalRow(idx, { bankId: Number(v) })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择银行" />
                    </SelectTrigger>
                    <SelectContent>
                      {banks.map((b) => (
                        <SelectItem key={b.id} value={String(b.id)}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex min-w-[160px] flex-col gap-1">
                  <span className="text-xs text-muted-foreground">终端号</span>
                  <Input value={t.code} onChange={(e) => updateTerminalRow(idx, { code: e.target.value })} />
                </div>
                <div className="flex min-w-[180px] flex-1 flex-col gap-1">
                  <span className="text-xs text-muted-foreground">备注</span>
                  <Input value={t.remark} onChange={(e) => updateTerminalRow(idx, { remark: e.target.value })} />
                </div>
                <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => removeTerminalRow(idx)}>
                  <Trash2 className="mr-1 h-4 w-4" />
                  删除
                </Button>
              </div>
            ))}

            {form.ownerType === 1 && form.terminals.length === 0 ? (
              <p className="text-sm text-destructive">大POS必须至少绑定一个终端</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              取消
            </Button>
            <Button type="button" onClick={() => void confirmSave()} disabled={saving}>
              {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              确认保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
