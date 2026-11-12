import { ChevronLeft, ChevronRight, Loader2, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { queryTerminalLogs } from '../api/pos-account-api';
import {
  DEAL_TYPE_MAP,
  DEAL_TYPE_OPTIONS,
  OWNER_TYPE_MAP_SHORT,
  SOURCE_TYPE_MAP,
  STATUS_MAP,
  todayStr,
} from '../lib/pos-account-shared';
import { ShopCodeChips } from './shop-code-chips';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

function mapVal(map: Record<number, string>, v: unknown): string {
  if (v == null || v === '') return '';
  const n = Number(v);
  return map[n] ?? String(v);
}

export function TerminalLogPanel() {
  const [shopCodes, setShopCodes] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [dealTypes, setDealTypes] = useState<number[]>([]);
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const queryPage = useCallback(
    async (opts?: { page?: number; size?: number }) => {
      const nextPage = opts?.page ?? pageNum;
      const nextSize = opts?.size ?? pageSize;
      setLoading(true);
      try {
        const params: Record<string, unknown> = {
          pageNum: nextPage,
          pageSize: nextSize,
        };
        if (shopCodes.length) params.shopCodes = shopCodes;
        if (startDate) params.startDate = startDate;
        if (endDate) params.endDate = endDate;
        if (dealTypes.length) params.dealTypes = dealTypes;

        const res = await queryTerminalLogs(params);
        setTotal(res.total ?? 0);
        setRows(res.rows ?? []);
        if (opts?.page != null) setPageNum(opts.page);
        if (opts?.size != null) setPageSize(opts.size);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '查询失败');
        setRows([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [dealTypes, endDate, pageNum, pageSize, shopCodes, startDate],
  );

  useEffect(() => {
    void queryPage({ page: 1 });
    // 仅挂载时自动查询
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleDealType = (value: number) => {
    setDealTypes((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  };

  const handleSearch = () => {
    setPageNum(1);
    void queryPage({ page: 1 });
  };

  const handlePageChange = (next: number) => {
    setPageNum(next);
    void queryPage({ page: next });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="shrink-0 border-b border-dashed border-border pb-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-[240px] flex-col gap-1">
            <span className="text-xs text-muted-foreground">门店</span>
            <ShopCodeChips value={shopCodes} onChange={setShopCodes} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">打标开始</span>
            <Input
              type="date"
              className="h-9 w-[150px]"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">打标结束</span>
            <Input
              type="date"
              className="h-9 w-[150px]"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <div className="flex min-w-[280px] flex-1 flex-col gap-1">
            <span className="text-xs text-muted-foreground">打标类型</span>
            <div className="flex flex-wrap gap-1">
              {DEAL_TYPE_OPTIONS.map((opt) => {
                const active = dealTypes.includes(opt.value);
                return (
                  <Button
                    key={opt.value}
                    type="button"
                    size="sm"
                    variant={active ? 'default' : 'outline'}
                    className="h-7 text-xs"
                    onClick={() => toggleDealType(opt.value)}
                  >
                    {opt.name}
                  </Button>
                );
              })}
            </div>
          </div>
          <Button type="button" className="mb-0.5" onClick={handleSearch} disabled={loading}>
            {loading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Search className="mr-1 h-4 w-4" />}
            查询
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[80px]">ID</TableHead>
              <TableHead className="w-[100px]">门店号</TableHead>
              <TableHead className="w-[140px]">门店名</TableHead>
              <TableHead className="w-[120px]">银行</TableHead>
              <TableHead className="w-[140px]">终端号</TableHead>
              <TableHead className="w-[120px]">收款台号</TableHead>
              <TableHead className="w-[120px]">款台类型</TableHead>
              <TableHead className="w-[110px]">终端类型</TableHead>
              <TableHead className="w-[130px]">打标类型</TableHead>
              <TableHead className="w-[80px]">状态</TableHead>
              <TableHead className="w-[110px]">操作人</TableHead>
              <TableHead className="w-[170px]">操作时间</TableHead>
              <TableHead className="min-w-[160px]">备注</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={13} className="h-24 text-center text-muted-foreground">
                  <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                  加载中…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={13} className="h-24 text-center text-muted-foreground">
                  暂无数据
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={String(row.id ?? `${row.shopCode}-${row.operTime}`)}>
                  <TableCell>{String(row.id ?? '')}</TableCell>
                  <TableCell>{String(row.shopCode ?? '')}</TableCell>
                  <TableCell>{String(row.shopName ?? '')}</TableCell>
                  <TableCell>{String(row.bankName ?? '')}</TableCell>
                  <TableCell>{String(row.terminalCode ?? '')}</TableCell>
                  <TableCell>{String(row.sktno ?? '')}</TableCell>
                  <TableCell>{mapVal(OWNER_TYPE_MAP_SHORT, row.ownerType)}</TableCell>
                  <TableCell>{mapVal(SOURCE_TYPE_MAP, row.sourceType)}</TableCell>
                  <TableCell>{mapVal(DEAL_TYPE_MAP, row.dealType)}</TableCell>
                  <TableCell>{mapVal(STATUS_MAP, row.status)}</TableCell>
                  <TableCell>{String(row.operName ?? '')}</TableCell>
                  <TableCell>{String(row.operTime ?? '')}</TableCell>
                  <TableCell className="max-w-[200px] truncate" title={String(row.remark ?? '')}>
                    {String(row.remark ?? '')}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground">
        <span>
          共 {total} 条 · 第 {pageNum} / {totalPages} 页
        </span>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1">
            每页
            <select
              className="h-7 rounded-md border border-input bg-card px-1.5 text-xs"
              value={pageSize}
              onChange={(e) => {
                const nextSize = Number.parseInt(e.target.value, 10);
                setPageNum(1);
                void queryPage({ page: 1, size: nextSize });
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
            disabled={pageNum <= 1 || loading}
            onClick={() => handlePageChange(pageNum - 1)}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            上一页
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            disabled={pageNum >= totalPages || loading}
            onClick={() => handlePageChange(pageNum + 1)}
          >
            下一页
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
