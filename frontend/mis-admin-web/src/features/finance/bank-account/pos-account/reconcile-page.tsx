import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  listDecideBatches,
  merchantSummary,
  storeSummary,
} from './api/pos-account-api';
import { ReconcileCreateDialog } from './components/reconcile-create-dialog';
import { ReconcileMerchantExceptionDialog } from './components/reconcile-merchant-exception-dialog';
import { ReconcileMerchantMatchedDialog } from './components/reconcile-merchant-matched-dialog';
import { ReconcileStoreExceptionDialog } from './components/reconcile-store-exception-dialog';
import { ReconcileStoreMatchedDialog } from './components/reconcile-store-matched-dialog';
import { fmtAmt, useOper } from './lib/pos-account-shared';
import { cell, sortStoreRows, type BillRow } from './lib/reconcile-helpers';

type BatchOption = { id: string; label: string };

type StoreDialog =
  | { kind: 'exception'; shopCode: string; shopName: string }
  | { kind: 'matched'; shopCode: string; shopName: string }
  | null;

type MerchantDialog =
  | { kind: 'exception'; merchantNo: string; merchantName: string }
  | { kind: 'matched'; merchantNo: string; merchantName: string }
  | null;

export function ReconcilePage() {
  const { operId, operName } = useOper();

  const [batchOptions, setBatchOptions] = useState<BatchOption[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [storeRows, setStoreRows] = useState<BillRow[]>([]);
  const [merchantRows, setMerchantRows] = useState<BillRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [storeDialog, setStoreDialog] = useState<StoreDialog>(null);
  const [merchantDialog, setMerchantDialog] = useState<MerchantDialog>(null);

  const loadBatches = useCallback(async () => {
    const list = await listDecideBatches();
    const opts = (list || []).map((b) => {
      const name = cell(b, 'batchName').trim();
      const prefix = name ? `${name} | ` : '';
      return {
        id: String(b.batchId),
        label: `${prefix}批次${b.batchId} | ${cell(b, 'createTime')} | ${cell(b, 'createOperName')}`,
      };
    });
    setBatchOptions(opts);
    if (!selectedBatchId && opts[0]) {
      setSelectedBatchId(opts[0].id);
    }
    return opts;
  }, [selectedBatchId]);

  const loadSummaries = useCallback(async (batchId: string) => {
    if (!batchId) {
      setStoreRows([]);
      setMerchantRows([]);
      return;
    }
    try {
      const [stores, merchants] = await Promise.all([
        storeSummary(batchId),
        merchantSummary(batchId),
      ]);
      setStoreRows(sortStoreRows(stores || []));
      setMerchantRows(merchants || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载汇总失败');
      setStoreRows([]);
      setMerchantRows([]);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      const opts = await loadBatches();
      const bid = selectedBatchId || opts[0]?.id || '';
      if (bid && !selectedBatchId) setSelectedBatchId(bid);
      await loadSummaries(bid || selectedBatchId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载批次失败');
    } finally {
      setLoading(false);
    }
  }, [loadBatches, loadSummaries, selectedBatchId]);

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时拉取批次与汇总
  }, []);

  useEffect(() => {
    if (selectedBatchId) loadSummaries(selectedBatchId);
  }, [selectedBatchId, loadSummaries]);

  const batchId = selectedBatchId;

  const storeDialogProps = useMemo(() => {
    if (!storeDialog || !batchId) return null;
    return { batchId, ...storeDialog };
  }, [storeDialog, batchId]);

  const merchantDialogProps = useMemo(() => {
    if (!merchantDialog || !batchId) return null;
    return { batchId, ...merchantDialog };
  }, [merchantDialog, batchId]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 md:p-6">
      <PageHeader
        title="对账处理"
        description="商场与银行账单对账、手工匹配（财务辅助 · 银行账目 · POS对账）"
      />

      <div className="flex flex-wrap items-end gap-2 border-b border-dashed pb-3">
        <div className="min-w-[280px] flex-1 space-y-1">
          <label className="text-xs text-muted-foreground">对账批次</label>
          <Select value={selectedBatchId} onValueChange={setSelectedBatchId}>
            <SelectTrigger>
              <SelectValue placeholder="请选择对账批次" />
            </SelectTrigger>
            <SelectContent>
              {batchOptions.map((o) => (
                <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" onClick={refreshAll} disabled={loading}>
          <RefreshCw className="mr-1 h-4 w-4" />
          加载对账数据
        </Button>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          新建对账
        </Button>
      </div>

      <Tabs defaultValue="store" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="h-8 w-fit">
          <TabsTrigger value="store" className="text-xs">门店帐</TabsTrigger>
          <TabsTrigger value="merchant" className="text-xs">商户帐</TabsTrigger>
        </TabsList>

        <TabsContent value="store" className="mt-2 min-h-0 flex-1 overflow-auto">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">批次</TableHead>
                  <TableHead className="text-xs">门店号</TableHead>
                  <TableHead className="text-xs">门店名</TableHead>
                  <TableHead className="text-xs">自动笔数</TableHead>
                  <TableHead className="text-xs">自动商场</TableHead>
                  <TableHead className="text-xs">自动银行</TableHead>
                  <TableHead className="text-xs">人工笔数</TableHead>
                  <TableHead className="text-xs">人工商场</TableHead>
                  <TableHead className="text-xs">人工银行</TableHead>
                  <TableHead className="text-xs">未匹配笔数</TableHead>
                  <TableHead className="text-xs">未匹配商场</TableHead>
                  <TableHead className="text-xs w-[160px]">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {storeRows.map((r) => (
                  <TableRow key={cell(r, 'shopCode')}>
                    <TableCell className="text-xs">{cell(r, 'batchId')}</TableCell>
                    <TableCell className="text-xs">{cell(r, 'shopCode')}</TableCell>
                    <TableCell className="text-xs">{cell(r, 'shopName')}</TableCell>
                    <TableCell className="text-xs">{cell(r, 'autoTxnCnt')}</TableCell>
                    <TableCell className="text-xs">{fmtAmt(r.autoMallAmt)}</TableCell>
                    <TableCell className="text-xs">{fmtAmt(r.autoBankAmt)}</TableCell>
                    <TableCell className="text-xs">{cell(r, 'manualTxnCnt')}</TableCell>
                    <TableCell className="text-xs">{fmtAmt(r.manualMallAmt)}</TableCell>
                    <TableCell className="text-xs">{fmtAmt(r.manualBankAmt)}</TableCell>
                    <TableCell className="text-xs">{cell(r, 'unmatchedTxnCnt')}</TableCell>
                    <TableCell className="text-xs">{fmtAmt(r.unmatchedMallAmt)}</TableCell>
                    <TableCell className="space-x-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-amber-600"
                        onClick={() =>
                          setStoreDialog({
                            kind: 'exception',
                            shopCode: cell(r, 'shopCode'),
                            shopName: cell(r, 'shopName'),
                          })
                        }
                      >
                        异常处理
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() =>
                          setStoreDialog({
                            kind: 'matched',
                            shopCode: cell(r, 'shopCode'),
                            shopName: cell(r, 'shopName'),
                          })
                        }
                      >
                        查看对账
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {storeRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center text-muted-foreground">
                      请选择对账批次后查看
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="merchant" className="mt-2 min-h-0 flex-1 overflow-auto">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">批次</TableHead>
                  <TableHead className="text-xs">商户号</TableHead>
                  <TableHead className="text-xs">商户名</TableHead>
                  <TableHead className="text-xs">自动笔数</TableHead>
                  <TableHead className="text-xs">自动金额</TableHead>
                  <TableHead className="text-xs">人工笔数</TableHead>
                  <TableHead className="text-xs">人工金额</TableHead>
                  <TableHead className="text-xs">未匹配笔数</TableHead>
                  <TableHead className="text-xs">未匹配金额</TableHead>
                  <TableHead className="text-xs w-[160px]">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {merchantRows.map((r) => (
                  <TableRow key={cell(r, 'merchantNo')}>
                    <TableCell className="text-xs">{cell(r, 'batchId')}</TableCell>
                    <TableCell className="text-xs">{cell(r, 'merchantNo')}</TableCell>
                    <TableCell className="text-xs">{cell(r, 'merchantName')}</TableCell>
                    <TableCell className="text-xs">{cell(r, 'autoCnt')}</TableCell>
                    <TableCell className="text-xs">{fmtAmt(r.autoAmt)}</TableCell>
                    <TableCell className="text-xs">{cell(r, 'manualCnt')}</TableCell>
                    <TableCell className="text-xs">{fmtAmt(r.manualAmt)}</TableCell>
                    <TableCell className="text-xs">{cell(r, 'unmatchedCnt')}</TableCell>
                    <TableCell className="text-xs">{fmtAmt(r.unmatchedAmt)}</TableCell>
                    <TableCell className="space-x-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-amber-600"
                        onClick={() =>
                          setMerchantDialog({
                            kind: 'exception',
                            merchantNo: cell(r, 'merchantNo'),
                            merchantName: cell(r, 'merchantName'),
                          })
                        }
                      >
                        异常处理
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() =>
                          setMerchantDialog({
                            kind: 'matched',
                            merchantNo: cell(r, 'merchantNo'),
                            merchantName: cell(r, 'merchantName'),
                          })
                        }
                      >
                        查看对账
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {merchantRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground">
                      请选择对账批次后查看
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      <ReconcileCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        operId={operId}
        operName={operName}
        onCreated={(id) => {
          setSelectedBatchId(String(id));
          refreshAll();
        }}
      />

      {storeDialogProps?.kind === 'exception' && (
        <ReconcileStoreExceptionDialog
          open
          onOpenChange={(open) => !open && setStoreDialog(null)}
          batchId={storeDialogProps.batchId}
          shopCode={storeDialogProps.shopCode}
          shopName={storeDialogProps.shopName}
          operId={operId}
          operName={operName}
          onSaved={() => loadSummaries(batchId)}
        />
      )}
      {storeDialogProps?.kind === 'matched' && (
        <ReconcileStoreMatchedDialog
          open
          onOpenChange={(open) => !open && setStoreDialog(null)}
          batchId={storeDialogProps.batchId}
          shopCode={storeDialogProps.shopCode}
          shopName={storeDialogProps.shopName}
          operId={operId}
          operName={operName}
          onDemolished={() => loadSummaries(batchId)}
        />
      )}

      {merchantDialogProps?.kind === 'exception' && (
        <ReconcileMerchantExceptionDialog
          open
          onOpenChange={(open) => !open && setMerchantDialog(null)}
          batchId={merchantDialogProps.batchId}
          merchantNo={merchantDialogProps.merchantNo}
          merchantName={merchantDialogProps.merchantName}
          operId={operId}
          operName={operName}
          onSaved={() => loadSummaries(batchId)}
        />
      )}
      {merchantDialogProps?.kind === 'matched' && (
        <ReconcileMerchantMatchedDialog
          open
          onOpenChange={(open) => !open && setMerchantDialog(null)}
          batchId={merchantDialogProps.batchId}
          merchantNo={merchantDialogProps.merchantNo}
          merchantName={merchantDialogProps.merchantName}
          operId={operId}
          operName={operName}
          onDemolished={() => loadSummaries(batchId)}
        />
      )}
    </div>
  );
}
