import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Plus, Search, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  confirmSktImport,
  disableSkt,
  downloadBlob,
  downloadSktTemplate,
  getSktDetail,
  listBanks,
  previewSktImport,
  querySkt,
  updateSkt,
  type BankOption,
} from './api/pos-account-api';
import { ShopCodeChips } from './components/shop-code-chips';
import {
  OWNER_TYPE_OPTIONS,
  STATUS_MAP,
  useOper,
} from './lib/pos-account-shared';

const OWNER_TYPE_MAP: Record<number, string> = Object.fromEntries(
  OWNER_TYPE_OPTIONS.map((o) => [o.value, o.name]),
);

type SktTerminal = {
  bankId?: number;
  bankName?: string;
  code?: string;
  remark?: string;
  sourceType?: number;
};

type SktRow = {
  sktno: string;
  shopCode?: string;
  shopName?: string;
  ownerType?: number;
  terminals?: SktTerminal[];
  status?: number;
  lastOperTime?: string;
  lastOperName?: string;
};

type TerminalFormRow = {
  bankId: number | null;
  code: string;
  remark: string;
  sourceType: number;
};

type EditForm = {
  sktno: string;
  ownerType: number | null;
  terminals: TerminalFormRow[];
};

type ImportPreviewRow = Record<string, unknown>;

const PAGE_SIZE_OPTIONS = [10, 20, 50];

const IMPORT_SUCCESS_COLUMNS: { key: string; label: string; width?: string }[] = [
  { key: 'rowNum', label: '行号', width: 'w-[70px]' },
  { key: 'sktno', label: '收款台号' },
  { key: 'ownerTypeName', label: '款台类型' },
  { key: 'bankName', label: '银行' },
  { key: 'code', label: '终端号' },
  { key: 'remark', label: '备注' },
  { key: 'message', label: '说明' },
];

const IMPORT_ERROR_COLUMNS: { key: string; label: string; width?: string }[] = [
  { key: 'rowNum', label: '行号', width: 'w-[70px]' },
  { key: 'raw', label: '原始内容' },
  { key: 'message', label: '错误信息' },
];

function ownerTypeLabel(v: unknown): string {
  const n = Number(v);
  return OWNER_TYPE_MAP[n] ?? String(v ?? '');
}

function mapTerminalsFromDetail(list: unknown): TerminalFormRow[] {
  return ((list as SktTerminal[]) || []).map((t) => ({
    bankId: t.bankId != null ? Number(t.bankId) : null,
    code: t.code ?? '',
    remark: t.remark ?? '',
    sourceType: t.sourceType != null ? Number(t.sourceType) : 1,
  }));
}

function cellText(row: ImportPreviewRow, key: string): string {
  const v = row[key];
  return v == null ? '' : String(v);
}

export function SktPage() {
  const { operId, operName } = useOper();

  const [shopCodes, setShopCodes] = useState<string[]>([]);
  const [sktno, setSktno] = useState('');
  const [ownerTypes, setOwnerTypes] = useState<number[]>([]);
  const [terminalCode, setTerminalCode] = useState('');
  const [bankIds, setBankIds] = useState<number[]>([]);
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [banks, setBanks] = useState<BankOption[]>([]);
  const [rows, setRows] = useState<SktRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editForm, setEditForm] = useState<EditForm>({
    sktno: '',
    ownerType: null,
    terminals: [],
  });

  const [disableOpen, setDisableOpen] = useState(false);
  const [disableRow, setDisableRow] = useState<SktRow | null>(null);
  const [disableSaving, setDisableSaving] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importShopCode, setImportShopCode] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importFileName, setImportFileName] = useState('');
  const [importPreviewed, setImportPreviewed] = useState(false);
  const [importTab, setImportTab] = useState('success');
  const [importSuccessRows, setImportSuccessRows] = useState<ImportPreviewRow[]>([]);
  const [importErrorRows, setImportErrorRows] = useState<ImportPreviewRow[]>([]);
  const [importItems, setImportItems] = useState<unknown[]>([]);
  const [importPreviewing, setImportPreviewing] = useState(false);
  const [importConfirming, setImportConfirming] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listBanks()
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
      const param: Record<string, unknown> = {
        shopCodes,
        pageNum,
        pageSize,
      };
      const trimmedSktno = sktno.trim();
      if (trimmedSktno) param.sktno = trimmedSktno;
      if (ownerTypes.length) param.ownerTypes = ownerTypes;
      const trimmedTerminal = terminalCode.trim();
      if (trimmedTerminal) param.terminalCode = trimmedTerminal;
      if (bankIds.length) param.bankIds = bankIds;

      const res = await querySkt(param);
      setTotal(res?.total ?? 0);
      setRows((res?.rows as SktRow[]) ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '查询失败');
    } finally {
      setLoading(false);
    }
  }, [bankIds, ownerTypes, pageNum, pageSize, shopCodes, sktno, terminalCode]);

  const handleSearch = () => {
    if (pageNum !== 1) {
      setPageNum(1);
    } else {
      void queryPage();
    }
  };

  useEffect(() => {
    if (shopCodes.length) {
      void queryPage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 分页变更时复用当前筛选
  }, [pageNum, pageSize]);

  const toggleOwnerType = (value: number, checked: boolean) => {
    setOwnerTypes((prev) =>
      checked ? (prev.includes(value) ? prev : [...prev, value]) : prev.filter((v) => v !== value),
    );
  };

  const handleBankFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = Array.from(e.target.selectedOptions).map((o) => Number(o.value));
    setBankIds(selected.filter((id) => !Number.isNaN(id)));
  };

  const openEdit = async (item: SktRow) => {
    try {
      const detail = await getSktDetail(item.sktno);
      const d = (detail || item) as SktRow;
      setEditForm({
        sktno: d.sktno,
        ownerType: d.ownerType != null ? Number(d.ownerType) : null,
        terminals: mapTerminalsFromDetail(d.terminals),
      });
    } catch {
      setEditForm({
        sktno: item.sktno,
        ownerType: item.ownerType != null ? Number(item.ownerType) : null,
        terminals: mapTerminalsFromDetail(item.terminals),
      });
    }
    setEditOpen(true);
  };

  const addTerminalRow = () => {
    setEditForm((f) => ({
      ...f,
      terminals: [...f.terminals, { bankId: null, code: '', remark: '', sourceType: 1 }],
    }));
  };

  const removeTerminalRow = (idx: number) => {
    setEditForm((f) => ({
      ...f,
      terminals: f.terminals.filter((_, i) => i !== idx),
    }));
  };

  const updateTerminalRow = (idx: number, patch: Partial<TerminalFormRow>) => {
    setEditForm((f) => ({
      ...f,
      terminals: f.terminals.map((row, i) => (i === idx ? { ...row, ...patch } : row)),
    }));
  };

  const confirmEdit = async () => {
    const form = editForm;
    if (!form.ownerType) {
      toast.error('请选择款台类型');
      return;
    }

    const terminals = (form.terminals || [])
      .filter((t) => t.bankId && t.code.trim() !== '')
      .map((t) => ({
        bankId: t.bankId,
        code: t.code.trim(),
        remark: t.remark || '',
        sourceType: t.sourceType != null ? t.sourceType : 1,
      }));

    if (form.ownerType === 1 && terminals.length === 0) {
      toast.error('大POS必须至少绑定一个终端');
      return;
    }

    for (let i = 0; i < (form.terminals || []).length; i++) {
      const t = form.terminals[i];
      const partial = t.bankId || t.code.trim();
      const complete = t.bankId && t.code.trim();
      if (partial && !complete) {
        toast.error(`请完整填写第${i + 1}行终端的银行与终端号`);
        return;
      }
    }

    setEditSaving(true);
    try {
      await updateSkt({
        sktno: form.sktno,
        ownerType: form.ownerType,
        terminals,
        operId,
        operName,
      });
      toast.success('保存成功');
      setEditOpen(false);
      await queryPage();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setEditSaving(false);
    }
  };

  const openDisable = (row: SktRow) => {
    setDisableRow(row);
    setDisableOpen(true);
  };

  const confirmDisable = async () => {
    if (!disableRow?.sktno) return;
    setDisableSaving(true);
    try {
      await disableSkt(disableRow.sktno, { operId, operName });
      toast.success('停用成功');
      setDisableOpen(false);
      setDisableRow(null);
      await queryPage();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '停用失败');
    } finally {
      setDisableSaving(false);
    }
  };

  const resetImportState = () => {
    setImportFile(null);
    setImportFileName('');
    setImportPreviewed(false);
    setImportTab('success');
    setImportSuccessRows([]);
    setImportErrorRows([]);
    setImportItems([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const openImport = () => {
    setImportShopCode('');
    resetImportState();
    setImportOpen(true);
  };

  const onImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImportFile(file);
      setImportFileName(file.name);
      setImportPreviewed(false);
      setImportSuccessRows([]);
      setImportErrorRows([]);
      setImportItems([]);
      setImportTab('success');
    } else {
      setImportFile(null);
      setImportFileName('');
    }
  };

  const downloadTemplate = async () => {
    try {
      const blob = await downloadSktTemplate();
      downloadBlob(blob, '收款台导入模板.xlsx');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '下载模板失败');
    }
  };

  const doPreview = async () => {
    if (!importShopCode.trim()) {
      toast.error('请选择门店');
      return;
    }
    if (!importFile) {
      toast.error('请先选择文件');
      return;
    }
    setImportPreviewing(true);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      formData.append('shopCode', importShopCode.trim());
      const res = await previewSktImport(formData);
      const success = (res?.successRows as ImportPreviewRow[]) ?? [];
      const errors = (res?.errorRows as ImportPreviewRow[]) ?? [];
      setImportSuccessRows(success);
      setImportErrorRows(errors);
      setImportItems((res?.items as unknown[]) ?? []);
      setImportPreviewed(true);
      setImportTab(success.length === 0 && errors.length > 0 ? 'error' : 'success');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '预览失败');
    } finally {
      setImportPreviewing(false);
    }
  };

  const confirmImport = async () => {
    if (!importItems.length) {
      toast.error('没有可导入的数据');
      return;
    }
    setImportConfirming(true);
    try {
      await confirmSktImport({
        shopCode: importShopCode.trim(),
        items: importItems,
        operId,
        operName,
      });
      toast.success('导入成功');
      setImportOpen(false);
      if (shopCodes.length) {
        await queryPage();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导入确认失败');
    } finally {
      setImportConfirming(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(pageNum, totalPages);
  const rangeStart = total ? (safePage - 1) * pageSize + 1 : 0;
  const rangeEnd = total ? Math.min(safePage * pageSize, total) : 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 md:p-6">
      <PageHeader
        title="收款台管理"
        description="收款台维护、导入与停用（财务辅助 · 银行账目 · POS对账）"
      />

      {/* 筛选区 */}
      <div className="shrink-0 space-y-3 border-b border-dashed border-border pb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-[240px] flex-col gap-1">
            <span className="text-xs text-muted-foreground">门店</span>
            <ShopCodeChips value={shopCodes} onChange={setShopCodes} placeholder="门店必选" />
          </div>

          <div className="flex min-w-[160px] flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="sktno-filter">
              款台号
            </label>
            <Input
              id="sktno-filter"
              value={sktno}
              placeholder="请输入款台号"
              onChange={(e) => setSktno(e.target.value)}
            />
          </div>

          <div className="flex min-w-[160px] flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="terminal-code-filter">
              终端号
            </label>
            <Input
              id="terminal-code-filter"
              value={terminalCode}
              placeholder="请输入终端号"
              onChange={(e) => setTerminalCode(e.target.value)}
            />
          </div>

          <div className="flex min-w-[200px] flex-col gap-1">
            <span className="text-xs text-muted-foreground">银行</span>
            <select
              multiple
              className="min-h-[72px] w-full rounded-md border border-input bg-card px-2 py-1 text-sm"
              value={bankIds.map(String)}
              onChange={handleBankFilterChange}
            >
              {banks.map((b) => (
                <option key={b.id} value={String(b.id)}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <span className="text-xs text-muted-foreground">款台类型</span>
          {OWNER_TYPE_OPTIONS.map((opt) => (
            <label key={opt.value} className="inline-flex cursor-pointer items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-primary"
                checked={ownerTypes.includes(opt.value)}
                onChange={(e) => toggleOwnerType(opt.value, e.target.checked)}
              />
              {opt.name}
            </label>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={handleSearch} disabled={loading}>
            <Search className="mr-1 h-4 w-4" />
            查询
          </Button>
          <Button type="button" variant="secondary" onClick={openImport}>
            <Upload className="mr-1 h-4 w-4" />
            导入
          </Button>
        </div>
      </div>

      {/* 表格 */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border">
        <div className="min-h-0 flex-1 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px] border-l-0">门店号</TableHead>
                <TableHead className="w-[120px]">款台号</TableHead>
                <TableHead className="w-[140px]">款台类型</TableHead>
                <TableHead className="w-[220px]">终端信息</TableHead>
                <TableHead className="w-[90px]">状态</TableHead>
                <TableHead className="w-[170px]">最后修改时间</TableHead>
                <TableHead className="w-[110px]">最后修改人</TableHead>
                <TableHead className="w-[140px]">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    加载中…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    暂无数据，请选择门店后查询
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.sktno}>
                    <TableCell className="border-l-0">{row.shopCode ?? ''}</TableCell>
                    <TableCell>{row.sktno}</TableCell>
                    <TableCell>{ownerTypeLabel(row.ownerType)}</TableCell>
                    <TableCell>
                      {row.terminals?.length ? (
                        <div className="space-y-0.5 py-1 leading-snug">
                          {row.terminals.map((t, idx) => (
                            <div key={idx} className="whitespace-nowrap text-sm">
                              {t.bankName} {t.code}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={row.status === 1 ? 'default' : 'secondary'}
                        className={cn(row.status === 1 && 'bg-green-600 hover:bg-green-600')}
                      >
                        {STATUS_MAP[Number(row.status)] ?? row.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{row.lastOperTime ?? ''}</TableCell>
                    <TableCell>{row.lastOperName ?? ''}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Button type="button" variant="link" size="sm" className="h-auto px-1" onClick={() => void openEdit(row)}>
                          修改
                        </Button>
                        {row.status === 1 ? (
                          <Button
                            type="button"
                            variant="link"
                            size="sm"
                            className="h-auto px-1 text-destructive"
                            onClick={() => openDisable(row)}
                          >
                            停用
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
          <div className="text-[0.8125rem] text-muted-foreground">
            共 <b className="font-semibold text-foreground">{total}</b> 条，当前{' '}
            {total ? `${rangeStart}-${rangeEnd}` : '0'}
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={safePage <= 1 || loading}
              onClick={() => setPageNum((p) => Math.max(1, p - 1))}
            >
              上一页
            </Button>
            <span className="px-2 text-sm text-muted-foreground">
              {safePage} / {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={safePage >= totalPages || loading}
              onClick={() => setPageNum((p) => Math.min(totalPages, p + 1))}
            >
              下一页
            </Button>
          </div>
          <div className="flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
            <label htmlFor="skt-page-size">每页</label>
            <select
              id="skt-page-size"
              className="h-8 rounded-md border border-input bg-card px-2 text-[0.8125rem] text-foreground"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPageNum(1);
              }}
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} 条
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* 修改弹窗 */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] max-w-[720px] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>修改收款台</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">款台号</label>
                <Input value={editForm.sktno} disabled />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">款台类型</label>
                <select
                  className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
                  value={editForm.ownerType ?? ''}
                  onChange={(e) =>
                    setEditForm((f) => ({
                      ...f,
                      ownerType: e.target.value ? Number(e.target.value) : null,
                    }))
                  }
                >
                  <option value="">请选择</option>
                  {OWNER_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">终端列表</span>
              <Button type="button" variant="outline" size="sm" onClick={addTerminalRow}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                增加终端
              </Button>
            </div>

            {editForm.terminals.map((t, idx) => (
              <div
                key={idx}
                className="flex flex-wrap items-end gap-2 border-b border-dashed border-border pb-3"
              >
                <div className="min-w-[140px] flex-1 space-y-1">
                  <label className="text-xs text-muted-foreground">银行</label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
                    value={t.bankId ?? ''}
                    onChange={(e) =>
                      updateTerminalRow(idx, {
                        bankId: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                  >
                    <option value="">请选择</option>
                    {banks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-[120px] flex-1 space-y-1">
                  <label className="text-xs text-muted-foreground">终端号</label>
                  <Input
                    value={t.code}
                    placeholder="终端号"
                    onChange={(e) => updateTerminalRow(idx, { code: e.target.value })}
                  />
                </div>
                <div className="min-w-[120px] flex-1 space-y-1">
                  <label className="text-xs text-muted-foreground">备注</label>
                  <Input
                    value={t.remark}
                    placeholder="备注"
                    onChange={(e) => updateTerminalRow(idx, { remark: e.target.value })}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => removeTerminalRow(idx)}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  删除
                </Button>
              </div>
            ))}

            {editForm.ownerType === 1 && editForm.terminals.length === 0 ? (
              <p className="text-sm text-destructive">大POS必须至少绑定一个终端</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
              取消
            </Button>
            <Button type="button" onClick={() => void confirmEdit()} disabled={editSaving}>
              {editSaving ? '保存中…' : '确认保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 停用确认 */}
      <Dialog open={disableOpen} onOpenChange={setDisableOpen}>
        <DialogContent className="max-w-[450px]">
          <DialogHeader>
            <DialogTitle className="text-destructive">确认停用</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>确定要停用以下收款台吗？</p>
            <p>
              门店：
              <strong>
                {disableRow?.shopCode} {disableRow?.shopName}
              </strong>
            </p>
            <p>
              款台号：<strong>{disableRow?.sktno}</strong>
            </p>
            <p>
              款台类型：<strong>{ownerTypeLabel(disableRow?.ownerType)}</strong>
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDisableOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void confirmDisable()}
              disabled={disableSaving}
            >
              {disableSaving ? '处理中…' : '确认停用'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 导入弹窗 */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-h-[90vh] max-w-[900px] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>收款台导入</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="max-w-[280px] space-y-1">
              <label className="text-xs text-muted-foreground">门店</label>
              <Input
                value={importShopCode}
                disabled={importPreviewed}
                placeholder="请输入门店号"
                onChange={(e) => setImportShopCode(e.target.value)}
              />
            </div>

            <p className="text-sm text-muted-foreground">
              模板列：收款台号、款台类型（大POS/租借PAD/租户自有PAD，字母大小写不敏感）、银行、终端编号、说明/备注。
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xls,.xlsx"
                className="hidden"
                onChange={onImportFileChange}
              />
              <Button
                type="button"
                variant="outline"
                disabled={importPreviewed}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="mr-1 h-4 w-4" />
                选择文件
              </Button>
              <span className="max-w-[160px] truncate text-sm">
                {importFileName || <span className="text-muted-foreground">未选择文件</span>}
              </span>
              <Button
                type="button"
                disabled={!importFile || !importShopCode.trim() || importPreviewed || importPreviewing}
                onClick={() => void doPreview()}
              >
                {importPreviewing ? '预览中…' : '预览'}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!importFile && !importPreviewed && !importFileName}
                onClick={resetImportState}
              >
                清理并重选
              </Button>
              <Button type="button" variant="link" className="ml-auto" onClick={() => void downloadTemplate()}>
                <Download className="mr-1 h-4 w-4" />
                下载模板
              </Button>
            </div>

            <Tabs value={importTab} onValueChange={setImportTab}>
              <TabsList>
                <TabsTrigger value="success">成功页（{importSuccessRows.length}）</TabsTrigger>
                <TabsTrigger value="error">错误页（{importErrorRows.length}）</TabsTrigger>
              </TabsList>
              <TabsContent value="success">
                <div className="mt-2 overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {IMPORT_SUCCESS_COLUMNS.map((col) => (
                          <TableHead key={col.key} className={col.width}>
                            {col.label}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importSuccessRows.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={IMPORT_SUCCESS_COLUMNS.length}
                            className="py-6 text-center text-muted-foreground"
                          >
                            暂无成功数据，请选择文件后预览
                          </TableCell>
                        </TableRow>
                      ) : (
                        importSuccessRows.map((row, idx) => (
                          <TableRow key={String(row.rowNum ?? idx)}>
                            {IMPORT_SUCCESS_COLUMNS.map((col) => (
                              <TableCell key={col.key}>{cellText(row, col.key)}</TableCell>
                            ))}
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>
              <TabsContent value="error">
                <div className="mt-2 overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {IMPORT_ERROR_COLUMNS.map((col) => (
                          <TableHead key={col.key} className={col.width}>
                            {col.label}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importErrorRows.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={IMPORT_ERROR_COLUMNS.length}
                            className="py-6 text-center text-muted-foreground"
                          >
                            暂无错误数据
                          </TableCell>
                        </TableRow>
                      ) : (
                        importErrorRows.map((row, idx) => (
                          <TableRow key={String(row.rowNum ?? idx)}>
                            {IMPORT_ERROR_COLUMNS.map((col) => (
                              <TableCell key={col.key}>{cellText(row, col.key)}</TableCell>
                            ))}
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setImportOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              disabled={!importPreviewed || !importItems.length || importConfirming}
              onClick={() => void confirmImport()}
            >
              {importConfirming ? '导入中…' : '确认导入'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
