import { ChevronLeft, ChevronRight, RefreshCw, Search, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  type BankOption,
  confirmTerminalImport,
  deleteTerminal,
  downloadBlob,
  downloadTerminalTemplate,
  listBanks,
  previewTerminalImport,
  queryTerminals,
  updateTerminal,
} from './api/pos-account-api';
import { ShopCodeChips } from './components/shop-code-chips';
import {
  OWNER_TYPE_MAP_SHORT,
  SOURCE_TYPE_MAP,
  STATUS_MAP,
  useOper,
} from './lib/pos-account-shared';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

type TerminalRow = {
  bankId?: number;
  bankName?: string;
  terminalCode?: string;
  sourceType?: number;
  sktno?: string;
  ownerType?: number;
  shopCode?: string;
  shopName?: string;
  remark?: string;
  status?: number;
  lastOperName?: string;
  lastOperTime?: string;
};

type ImportSuccessRow = {
  rowNum?: number;
  bankId?: number;
  bankName?: string;
  code?: string;
  sourceType?: number;
  sourceTypeName?: string;
  remark?: string;
  action?: string;
  message?: string;
};

type ImportErrorRow = {
  rowNum?: number;
  raw?: string;
  message?: string;
};

function rowKey(row: TerminalRow): string {
  return `${row.bankId ?? ''}_${row.terminalCode ?? ''}`;
}

export function TerminalsPage() {
  const { operId, operName } = useOper();

  const [banks, setBanks] = useState<BankOption[]>([]);
  const [shopCodes, setShopCodes] = useState<string[]>([]);
  const [bankIds, setBankIds] = useState<number[]>([]);
  const [terminalCode, setTerminalCode] = useState('');
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [applied, setApplied] = useState<{
    shopCodes: string[];
    bankIds: number[];
    terminalCode: string;
  } | null>(null);

  const [rows, setRows] = useState<TerminalRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    oldBankId: null as number | null,
    oldCode: '',
    bankId: null as number | null,
    code: '',
    sktno: '',
    remark: '',
    shopCode: '',
    sourceType: null as number | null,
  });
  const [editSubmitting, setEditSubmitting] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteRow, setDeleteRow] = useState<TerminalRow | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importShopCode, setImportShopCode] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importFileName, setImportFileName] = useState('');
  const [importPreviewed, setImportPreviewed] = useState(false);
  const [importTab, setImportTab] = useState('success');
  const [importSuccessRows, setImportSuccessRows] = useState<ImportSuccessRow[]>([]);
  const [importErrorRows, setImportErrorRows] = useState<ImportErrorRow[]>([]);
  const [importPreviewing, setImportPreviewing] = useState(false);
  const [importConfirming, setImportConfirming] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void listBanks()
      .then(setBanks)
      .catch(() => {
        setBanks([]);
        toast.error('加载银行列表失败');
      });
  }, []);

  const fetchPage = useCallback(async () => {
    if (!applied?.shopCodes.length) return;
    setLoading(true);
    try {
      const params: Record<string, unknown> = {
        shopCodes: applied.shopCodes,
        pageNum,
        pageSize,
      };
      if (applied.bankIds.length) params.bankIds = applied.bankIds;
      const code = applied.terminalCode.trim();
      if (code) params.terminalCode = code;

      const res = await queryTerminals(params);
      setTotal(res?.total ?? 0);
      setRows((res?.rows ?? []) as TerminalRow[]);
    } catch (e) {
      setRows([]);
      setTotal(0);
      toast.error(e instanceof Error ? e.message : '查询失败');
    } finally {
      setLoading(false);
    }
  }, [applied, pageNum, pageSize]);

  useEffect(() => {
    if (!applied) return;
    void fetchPage();
  }, [applied, pageNum, pageSize, fetchPage]);

  const handleQuery = () => {
    if (!shopCodes.length) {
      toast.error('请至少选择一个门店');
      return;
    }
    setApplied({ shopCodes, bankIds, terminalCode });
    setPageNum(1);
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const openEdit = (row: TerminalRow) => {
    setEditForm({
      oldBankId: row.bankId != null ? Number(row.bankId) : null,
      oldCode: row.terminalCode ?? '',
      bankId: row.bankId != null ? Number(row.bankId) : null,
      code: row.terminalCode ?? '',
      sktno: row.sktno ?? '',
      remark: row.remark ?? '',
      shopCode: row.shopCode ?? '',
      sourceType: row.sourceType ?? null,
    });
    setEditOpen(true);
  };

  const confirmEdit = async () => {
    const form = editForm;
    if (!form.bankId) {
      toast.error('请选择银行');
      return;
    }
    if (!form.code.trim()) {
      toast.error('请输入终端号');
      return;
    }
    setEditSubmitting(true);
    try {
      await updateTerminal({
        oldBankId: form.oldBankId,
        oldCode: form.oldCode,
        bankId: form.bankId,
        code: form.code.trim(),
        sktno: form.sktno.trim(),
        remark: form.remark,
        shopCode: form.shopCode || undefined,
        sourceType: form.sourceType,
        operId,
        operName,
      });
      toast.success('修改成功');
      setEditOpen(false);
      void fetchPage();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '修改失败');
    } finally {
      setEditSubmitting(false);
    }
  };

  const openDelete = (row: TerminalRow) => {
    setDeleteRow(row);
    setDeleteOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteRow) return;
    setDeleteSubmitting(true);
    try {
      await deleteTerminal({
        bankId: deleteRow.bankId,
        code: deleteRow.terminalCode,
        operId,
        operName,
      });
      toast.success('删除成功');
      setDeleteOpen(false);
      setDeleteRow(null);
      void fetchPage();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    } finally {
      setDeleteSubmitting(false);
    }
  };

  const resetImport = () => {
    setImportFile(null);
    setImportFileName('');
    setImportPreviewed(false);
    setImportTab('success');
    setImportSuccessRows([]);
    setImportErrorRows([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const openImport = () => {
    setImportShopCode('');
    resetImport();
    setImportOpen(true);
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImportFile(file);
      setImportFileName(file.name);
      setImportPreviewed(false);
      setImportSuccessRows([]);
      setImportErrorRows([]);
      setImportTab('success');
    } else {
      setImportFile(null);
      setImportFileName('');
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const blob = await downloadTerminalTemplate();
      downloadBlob(blob, '独立终端导入模板.xlsx');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '下载模板失败');
    }
  };

  const doPreview = async () => {
    if (!importShopCode.trim()) {
      toast.error('请输入门店号');
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
      formData.append('sourceType', '2');
      if (operId) formData.append('operId', operId);
      if (operName) formData.append('operName', operName);

      const res = await previewTerminalImport(formData);
      const success = res?.successRows ?? [];
      const errors = res?.errorRows ?? [];
      setImportSuccessRows(success as ImportSuccessRow[]);
      setImportErrorRows(errors as ImportErrorRow[]);
      setImportPreviewed(true);
      setImportTab(success.length === 0 && errors.length > 0 ? 'error' : 'success');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '预览失败');
    } finally {
      setImportPreviewing(false);
    }
  };

  const confirmImport = async () => {
    const items = importSuccessRows
      .map((r) => ({
        bankId: r.bankId,
        code: r.code,
        remark: r.remark ?? '',
        action: r.action,
      }))
      .filter((it) => it.bankId != null && it.code);

    if (!items.length) {
      toast.error('没有可导入的成功行');
      return;
    }

    setImportConfirming(true);
    try {
      await confirmTerminalImport({
        shopCode: importShopCode.trim(),
        sourceType: 2,
        items,
        operId,
        operName,
      });
      toast.success('导入成功');
      setImportOpen(false);
      if (applied) void fetchPage();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导入确认失败');
    } finally {
      setImportConfirming(false);
    }
  };

  const onBankMultiChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = Array.from(e.target.selectedOptions).map((opt) => Number(opt.value));
    setBankIds(selected.filter((id) => !Number.isNaN(id)));
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 md:p-6">
      <PageHeader
        title="终端管理"
        description="银行 POS 终端维护、导入与查询（财务辅助 · 银行账目 · POS对账）"
      />

      {/* 筛选区 */}
      <div className="flex flex-wrap items-end gap-3 border-b border-dashed border-border pb-3">
        <div className="flex min-w-[220px] flex-col gap-1">
          <span className="text-xs text-muted-foreground">门店</span>
          <ShopCodeChips value={shopCodes} onChange={setShopCodes} placeholder="门店必选，回车添加" />
        </div>
        <div className="flex min-w-[180px] flex-col gap-1">
          <span className="text-xs text-muted-foreground">银行（多选 Ctrl+点击）</span>
          <select
            multiple
            className="h-auto min-h-[4.5rem] w-full rounded-md border border-input bg-card px-2 py-1 text-sm"
            value={bankIds.map(String)}
            onChange={onBankMultiChange}
          >
            {banks.map((b) => (
              <option key={b.id} value={String(b.id)}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-[160px] flex-col gap-1">
          <span className="text-xs text-muted-foreground">终端号</span>
          <Input
            value={terminalCode}
            placeholder="请输入终端号"
            onChange={(e) => setTerminalCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleQuery();
            }}
          />
        </div>
        <div className="flex gap-2 pb-0.5">
          <Button size="sm" onClick={handleQuery} disabled={loading}>
            <Search className="h-4 w-4" />
            查询
          </Button>
          <Button size="sm" variant="outline" onClick={openImport}>
            <Upload className="h-4 w-4" />
            独立终端导入
          </Button>
        </div>
      </div>

      {/* 表格 */}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-table-surface">
        <table className="w-full min-w-[1100px] border-separate border-spacing-0 text-left text-sm">
          <thead className="sticky top-0 z-10 border-b-2 border-foreground/20 bg-table-header text-muted-foreground">
            <tr>
              <th className="px-2 py-2 font-bold">银行编号</th>
              <th className="px-2 py-2 font-bold">银行名</th>
              <th className="px-2 py-2 font-bold">终端号</th>
              <th className="px-2 py-2 font-bold">终端类型</th>
              <th className="px-2 py-2 font-bold">收款台号</th>
              <th className="px-2 py-2 font-bold">收款台类型</th>
              <th className="px-2 py-2 font-bold">门店号</th>
              <th className="px-2 py-2 font-bold">门店名</th>
              <th className="max-w-[160px] px-2 py-2 font-bold">备注</th>
              <th className="px-2 py-2 font-bold">状态</th>
              <th className="px-2 py-2 font-bold">最后修改人</th>
              <th className="px-2 py-2 font-bold">最后修改时间</th>
              <th className="px-2 py-2 font-bold">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-3 py-10 text-center text-muted-foreground">
                  加载中…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-3 py-10 text-center text-muted-foreground">
                  {applied ? '暂无数据' : '请选择门店后点击查询'}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const st = row.sourceType;
                const ot = row.ownerType;
                const status = row.status;
                return (
                  <tr
                    key={rowKey(row)}
                    className="border-b border-border/50 bg-table-row even:bg-table-stripe hover:bg-table-hover"
                  >
                    <td className="px-2 py-1.5">{row.bankId ?? ''}</td>
                    <td className="px-2 py-1.5">{row.bankName ?? ''}</td>
                    <td className="px-2 py-1.5 font-mono text-xs">{row.terminalCode ?? ''}</td>
                    <td className="px-2 py-1.5">
                      {st != null ? SOURCE_TYPE_MAP[st] ?? st : ''}
                    </td>
                    <td className="px-2 py-1.5">{row.sktno ?? ''}</td>
                    <td className="px-2 py-1.5">
                      {ot != null ? OWNER_TYPE_MAP_SHORT[ot] ?? ot : ''}
                    </td>
                    <td className="px-2 py-1.5">{row.shopCode ?? ''}</td>
                    <td className="max-w-[140px] truncate px-2 py-1.5" title={row.shopName ?? ''}>
                      {row.shopName ?? ''}
                    </td>
                    <td className="max-w-[160px] truncate px-2 py-1.5" title={row.remark ?? ''}>
                      {row.remark ?? ''}
                    </td>
                    <td className="px-2 py-1.5">
                      {status != null ? (
                        <Badge variant={status === 1 ? 'default' : 'secondary'}>
                          {STATUS_MAP[status] ?? status}
                        </Badge>
                      ) : (
                        ''
                      )}
                    </td>
                    <td className="px-2 py-1.5">{row.lastOperName ?? ''}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs text-muted-foreground">
                      {row.lastOperTime ?? ''}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          className="text-xs text-primary hover:underline"
                          onClick={() => openEdit(row)}
                        >
                          修改
                        </button>
                        <button
                          type="button"
                          className="text-xs text-destructive hover:underline"
                          onClick={() => openDelete(row)}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground">
        <span>
          共 {total} 条 · 第 {pageNum} / {totalPages} 页
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            disabled={loading || !applied}
            onClick={() => void fetchPage()}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </Button>
          <label className="flex items-center gap-1">
            每页
            <select
              className="h-7 rounded-md border border-input bg-card px-1.5 text-xs"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number.parseInt(e.target.value, 10));
                setPageNum(1);
              }}
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            disabled={pageNum <= 1 || loading || !applied}
            onClick={() => setPageNum((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            上一页
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            disabled={pageNum >= totalPages || loading || !applied}
            onClick={() => setPageNum((p) => p + 1)}
          >
            下一页
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* 修改弹窗 */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>修改终端</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1">
              <span className="text-xs text-muted-foreground">银行</span>
              <select
                className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
                value={editForm.bankId != null ? String(editForm.bankId) : ''}
                onChange={(e) =>
                  setEditForm((f) => ({
                    ...f,
                    bankId: e.target.value ? Number(e.target.value) : null,
                  }))
                }
              >
                <option value="">请选择银行</option>
                {banks.map((b) => (
                  <option key={b.id} value={String(b.id)}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <span className="text-xs text-muted-foreground">款台号</span>
              <Input
                value={editForm.sktno}
                placeholder="请输入款台号"
                onChange={(e) => setEditForm((f) => ({ ...f, sktno: e.target.value }))}
              />
            </div>
            <div className="grid gap-1">
              <span className="text-xs text-muted-foreground">终端号</span>
              <Input
                value={editForm.code}
                placeholder="请输入终端号"
                onChange={(e) => setEditForm((f) => ({ ...f, code: e.target.value }))}
              />
            </div>
            <div className="grid gap-1">
              <span className="text-xs text-muted-foreground">备注</span>
              <Input
                value={editForm.remark}
                placeholder="请输入备注（可选）"
                onChange={(e) => setEditForm((f) => ({ ...f, remark: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditOpen(false)} disabled={editSubmitting}>
              取消
            </Button>
            <Button onClick={() => void confirmEdit()} disabled={editSubmitting}>
              {editSubmitting ? '提交中…' : '确认修改'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>确定要删除以下终端吗？此操作不可恢复。</p>
            <p>
              银行：<strong>{deleteRow?.bankName}</strong>
            </p>
            <p>
              终端号：<strong>{deleteRow?.terminalCode}</strong>
            </p>
            <p>
              门店：
              <strong>
                {deleteRow?.shopCode} {deleteRow?.shopName}
              </strong>
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)} disabled={deleteSubmitting}>
              取消
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={deleteSubmitting}>
              {deleteSubmitting ? '删除中…' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 独立终端导入 */}
      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          setImportOpen(open);
          if (!open) resetImport();
        }}
      >
        <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>独立终端导入</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            <div className="flex flex-wrap items-end gap-4">
              <div className="grid min-w-[200px] gap-1">
                <span className="text-xs text-muted-foreground">门店</span>
                <Input
                  value={importShopCode}
                  placeholder="请输入门店号"
                  disabled={importPreviewed}
                  onChange={(e) => setImportShopCode(e.target.value)}
                />
              </div>
              <div className="grid min-w-[160px] gap-1">
                <span className="text-xs text-muted-foreground">类型</span>
                <Input value="团购中心" disabled />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              模板列：银行名（表头含支持的银行名称）、终端号、终端类型(团购中心)、备注。
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xls,.xlsx"
                className="hidden"
                onChange={onFileChange}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={importPreviewed}
                onClick={() => fileInputRef.current?.click()}
              >
                选择文件
              </Button>
              <span className="max-w-[200px] truncate text-xs text-muted-foreground">
                {importFileName || '未选择文件'}
              </span>
              <Button
                size="sm"
                disabled={!importFile || !importShopCode.trim() || importPreviewed || importPreviewing}
                onClick={() => void doPreview()}
              >
                {importPreviewing ? '预览中…' : '预览'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!importFile && !importPreviewed && !importFileName}
                onClick={resetImport}
              >
                清理并重选
              </Button>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="ml-auto"
                onClick={() => void handleDownloadTemplate()}
              >
                下载模板
              </Button>
            </div>

            <Tabs value={importTab} onValueChange={setImportTab}>
              <TabsList>
                <TabsTrigger value="success">成功页（{importSuccessRows.length}）</TabsTrigger>
                <TabsTrigger value="error">错误页（{importErrorRows.length}）</TabsTrigger>
              </TabsList>
              <TabsContent value="success">
                <div className="max-h-[280px] overflow-auto rounded-md border">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1.5">行号</th>
                        <th className="px-2 py-1.5">银行</th>
                        <th className="px-2 py-1.5">终端号</th>
                        <th className="px-2 py-1.5">终端类型</th>
                        <th className="px-2 py-1.5">备注</th>
                        <th className="px-2 py-1.5">动作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importSuccessRows.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                            暂无成功数据，请选择文件后预览
                          </td>
                        </tr>
                      ) : (
                        importSuccessRows.map((item, idx) => (
                          <tr key={item.rowNum ?? idx} className="border-t border-border/50">
                            <td className="px-2 py-1">{item.rowNum ?? ''}</td>
                            <td className="px-2 py-1">{item.bankName ?? ''}</td>
                            <td className="px-2 py-1 font-mono text-xs">{item.code ?? ''}</td>
                            <td className="px-2 py-1">
                              {item.sourceTypeName ??
                                (item.sourceType != null
                                  ? SOURCE_TYPE_MAP[item.sourceType] ?? item.sourceType
                                  : '')}
                            </td>
                            <td className="max-w-[120px] truncate px-2 py-1" title={item.remark ?? ''}>
                              {item.remark ?? ''}
                            </td>
                            <td className="px-2 py-1 text-xs">
                              {(item.action === 'update' ? '更新' : '新增') +
                                (item.message ? `：${item.message}` : '')}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </TabsContent>
              <TabsContent value="error">
                <div className="max-h-[280px] overflow-auto rounded-md border">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1.5">行号</th>
                        <th className="px-2 py-1.5">原始内容</th>
                        <th className="px-2 py-1.5">错误信息</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importErrorRows.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                            暂无错误数据
                          </td>
                        </tr>
                      ) : (
                        importErrorRows.map((item, idx) => (
                          <tr key={item.rowNum ?? idx} className="border-t border-border/50">
                            <td className="px-2 py-1">{item.rowNum ?? ''}</td>
                            <td className="max-w-[240px] truncate px-2 py-1" title={item.raw ?? ''}>
                              {item.raw ?? ''}
                            </td>
                            <td className="px-2 py-1 text-destructive">{item.message ?? ''}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </TabsContent>
            </Tabs>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setImportOpen(false)} disabled={importConfirming}>
              取消
            </Button>
            <Button
              disabled={!importPreviewed || importSuccessRows.length === 0 || importConfirming}
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
