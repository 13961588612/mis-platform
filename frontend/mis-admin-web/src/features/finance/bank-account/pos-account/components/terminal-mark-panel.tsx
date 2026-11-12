import { Loader2, Search } from 'lucide-react';
import { useCallback, useState } from 'react';
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
  listSktByShop,
  queryPendingTerminalMarks,
  saveTerminalMark,
} from '../api/pos-account-api';
import { useOper } from '../lib/pos-account-shared';
import { ShopCodeChips } from './shop-code-chips';

const SOURCE_TYPE_OPTIONS = [
  { value: 1, name: '收款台' },
  { value: 2, name: '团购中心' },
] as const;

type TerminalMarkRow = {
  merchantId?: string;
  merchantNo: string;
  merchantName?: string;
  bankId: number;
  bankName?: string;
  terminalNo: string;
  alreadyExists: boolean;
  sourceType?: number;
  shopCode?: string;
  sktno?: string;
  remark?: string;
};

type SktOption = {
  sktno: string;
  label: string;
};

function toBool(v: unknown): boolean {
  return v === true || v === 1;
}

export function TerminalMarkPanel() {
  const oper = useOper();
  const [shopCodes, setShopCodes] = useState<string[]>([]);
  const [rows, setRows] = useState<TerminalMarkRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sktOptions, setSktOptions] = useState<SktOption[]>([]);
  const [form, setForm] = useState({
    bankId: null as number | null,
    bankName: '',
    code: '',
    sourceType: 2,
    shopCode: '',
    sktno: '',
    remark: '',
    merchantNo: '',
    merchantName: '',
  });

  const queryPage = useCallback(async () => {
    if (!shopCodes.length) {
      toast.error('请至少选择一个门店');
      return;
    }
    setLoading(true);
    try {
      const list = await queryPendingTerminalMarks({ shopCodes });
      setRows(
        (list || []).map((r) => ({
          merchantId: r.merchantId != null ? String(r.merchantId) : undefined,
          merchantNo: String(r.merchantNo ?? ''),
          merchantName: r.merchantName != null ? String(r.merchantName) : undefined,
          bankId: Number(r.bankId),
          bankName: r.bankName != null ? String(r.bankName) : undefined,
          terminalNo: String(r.terminalNo ?? ''),
          alreadyExists: toBool(r.alreadyExists),
          sourceType: r.sourceType != null ? Number(r.sourceType) : undefined,
          shopCode: r.shopCode != null ? String(r.shopCode) : undefined,
          sktno: r.sktno != null ? String(r.sktno) : undefined,
          remark: r.remark != null ? String(r.remark) : undefined,
        })),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '查询失败');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [shopCodes]);

  const loadSktOptions = async (shopCode: string) => {
    if (!shopCode) {
      setSktOptions([]);
      return;
    }
    try {
      const list = await listSktByShop(shopCode);
      setSktOptions(
        (list || []).map((s) => ({
          sktno: String(s.sktno ?? ''),
          label: `${s.sktno}${s.ownerType ? ` / 类型${s.ownerType}` : ''}`,
        })),
      );
    } catch {
      setSktOptions([]);
    }
  };

  const handleMark = (item: TerminalMarkRow) => {
    const sourceType = item.sourceType != null ? item.sourceType : 2;
    setForm({
      bankId: item.bankId,
      bankName: item.bankName || '',
      code: item.terminalNo,
      sourceType,
      shopCode: item.shopCode || '',
      sktno: item.sktno || '',
      remark: item.remark || '',
      merchantNo: item.merchantNo || '',
      merchantName: item.merchantName || '',
    });
    setSktOptions([]);
    setDialogOpen(true);
    if (sourceType === 1 && item.shopCode) {
      void loadSktOptions(item.shopCode);
    }
  };

  const onSourceTypeChange = (sourceType: number) => {
    setForm((prev) => {
      if (sourceType !== 1) {
        setSktOptions([]);
      } else if (prev.shopCode) {
        void loadSktOptions(prev.shopCode);
      }
      return {
        ...prev,
        sourceType,
        sktno: sourceType !== 1 ? '' : prev.sktno,
      };
    });
  };

  const onShopChange = (shopCode: string) => {
    setForm((prev) => ({ ...prev, shopCode, sktno: '' }));
    setSktOptions([]);
    if (shopCode) void loadSktOptions(shopCode);
  };

  const confirmSave = async () => {
    if (!form.sourceType) {
      toast.error('请选择用途');
      return;
    }
    if (form.sourceType === 1) {
      if (!form.shopCode) {
        toast.error('请选择门店');
        return;
      }
      if (!form.sktno) {
        toast.error('请选择已存在的收款台');
        return;
      }
    }

    setSaving(true);
    try {
      await saveTerminalMark({
        bankId: form.bankId,
        code: form.code,
        sourceType: form.sourceType,
        shopCode: form.shopCode || null,
        sktno: form.sourceType === 1 ? form.sktno : null,
        remark: form.remark || '',
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
              <TableHead className="w-[100px]">商户编号</TableHead>
              <TableHead className="w-[140px]">商户号</TableHead>
              <TableHead className="w-[160px]">商户名</TableHead>
              <TableHead className="w-[90px]">银行编号</TableHead>
              <TableHead className="w-[120px]">银行名</TableHead>
              <TableHead className="w-[140px]">终端号</TableHead>
              <TableHead className="w-[90px]">终端状态</TableHead>
              <TableHead className="w-[120px]">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                  加载中…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  请选择门店后查询
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={`${row.merchantNo}_${row.bankId}_${row.terminalNo}`}>
                  <TableCell>{row.merchantId ?? ''}</TableCell>
                  <TableCell>{row.merchantNo}</TableCell>
                  <TableCell>{row.merchantName ?? ''}</TableCell>
                  <TableCell>{row.bankId}</TableCell>
                  <TableCell>{row.bankName ?? ''}</TableCell>
                  <TableCell>{row.terminalNo}</TableCell>
                  <TableCell>{row.alreadyExists ? '已存在' : '不存在'}</TableCell>
                  <TableCell>
                    <Button type="button" variant="link" className="h-auto p-0" onClick={() => handleMark(row)}>
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
        <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>终端标记</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-muted-foreground">银行</span>
              <Input readOnly value={form.bankName} />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-muted-foreground">终端号</span>
              <Input readOnly value={form.code} />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-muted-foreground">用途</span>
              <Select
                value={String(form.sourceType)}
                onValueChange={(v) => onSourceTypeChange(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)}>
                      {opt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {form.sourceType === 1 ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm text-muted-foreground">门店</span>
                  <Select value={form.shopCode} onValueChange={onShopChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="选择门店以加载款台" />
                    </SelectTrigger>
                    <SelectContent>
                      {shopCodes.map((code) => (
                        <SelectItem key={code} value={code}>
                          {code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm text-muted-foreground">收款台</span>
                  <Select value={form.sktno} onValueChange={(v) => setForm((prev) => ({ ...prev, sktno: v }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="须选已存在款台" />
                    </SelectTrigger>
                    <SelectContent>
                      {sktOptions.map((s) => (
                        <SelectItem key={s.sktno} value={s.sktno}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <span className="text-sm text-muted-foreground">门店（可选）</span>
                <Select
                  value={form.shopCode || '__none__'}
                  onValueChange={(v) => setForm((prev) => ({ ...prev, shopCode: v === '__none__' ? '' : v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="可选" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">（不选）</SelectItem>
                    {shopCodes.map((code) => (
                      <SelectItem key={code} value={code}>
                        {code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-sm text-muted-foreground">备注</span>
              <Input value={form.remark} onChange={(e) => setForm((prev) => ({ ...prev, remark: e.target.value }))} />
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            商户：{form.merchantNo} {form.merchantName}
          </p>

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
