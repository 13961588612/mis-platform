/**
 * iqd-mapping-page.tsx — 问数「维度值映射」（MIS 部门/门店 → 数仓外部编码），路径 /iqd/mapping。
 *
 * <p>背景：X-Mis-Dept-Scope / X-Mis-Stores 携带的是 mis-platform 自己的部门 id（sys_dept.id）
 * 与门店 id；数仓业务表里存的是对方系统的部门/门店编码（如 org_dept_code / shop_no）。
 * 行级注入前必须先把 MIS 侧值翻译成「该连接对应数仓」的外部编码。
 *
 * <p>本页维护唯一真值表 `iqd_dimension_value_map`（按连接 + 维度）：
 * <ul>
 *   <li>连接切换复用 {@link ProjectSwitcher}（= 当前项目 / 问数连接）；</li>
 *   <li>维度切换（部门 / 门店，来自维度注册表）；</li>
 *   <li>列表 + 新增/编辑/删除；</li>
 *   <li>「解析预览」：输入若干 MIS 值 → 调后端 resolve，展示最终 external 列表与
 *       因无映射被丢弃的值（含 dept「向下找有映射的最上级」的裁剪结果）。</li>
 * </ul>
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, RefreshCw, Trash2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { ProjectSwitcher } from './components/shared/ProjectSwitcher';
import { useActiveProjectId } from './hooks/useActiveProject';
import {
  deleteIqdDimensionValueMap,
  listIqdDimensionValueMaps,
  listIqdDimensions,
  resolveIqdDimensionValues,
  saveIqdDimensionValueMap,
  type IqdDimensionResolveResult,
  type IqdDimensionValueMap,
  type IqdScopeDimension,
} from '@/lib/api/iqd';

const FALLBACK_DIMENSIONS: Array<{ code: string; label: string }> = [
  { code: 'dept', label: '部门' },
  { code: 'store', label: '门店' },
];

interface MapForm {
  id?: number;
  dimensionCode: string;
  misValue: string;
  externalValue: string;
  effective: boolean;
  coversSubtree: boolean;
  remark: string;
}

const EMPTY_FORM: MapForm = {
  dimensionCode: 'dept',
  misValue: '',
  externalValue: '',
  effective: true,
  coversSubtree: true,
  remark: '',
};

export function IqdMappingPage() {
  const connectionId = useActiveProjectId();
  const [dimensions, setDimensions] = useState<IqdScopeDimension[]>([]);
  const [dimensionCode, setDimensionCode] = useState('dept');
  const [rows, setRows] = useState<IqdDimensionValueMap[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<MapForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // 解析预览
  const [previewInput, setPreviewInput] = useState('');
  const [previewResult, setPreviewResult] = useState<IqdDimensionResolveResult | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const dimOptions = useMemo(() => {
    const fromRegistry = dimensions
      .filter((d) => d.dimension_code)
      .map((d) => ({ code: d.dimension_code, label: d.dimension_name || d.dimension_code }));
    return fromRegistry.length > 0 ? fromRegistry : FALLBACK_DIMENSIONS;
  }, [dimensions]);

  const load = useCallback(async () => {
    if (connectionId == null) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listIqdDimensionValueMaps(connectionId, dimensionCode);
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [connectionId, dimensionCode]);

  useEffect(() => {
    listIqdDimensions()
      .then((list) => setDimensions(list.filter((d) => d.enabled !== false)))
      .catch(() => setDimensions([]));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return rows;
    return rows.filter(
      (r) =>
        r.mis_value.toLowerCase().includes(kw) ||
        r.external_value.toLowerCase().includes(kw),
    );
  }, [rows, keyword]);

  const openCreate = () => {
    setForm({ ...EMPTY_FORM, dimensionCode });
    setDialogOpen(true);
  };

  const openEdit = (row: IqdDimensionValueMap) => {
    setForm({
      id: row.id,
      dimensionCode: row.dimension_code,
      misValue: row.mis_value,
      externalValue: row.external_value,
      effective: row.effective !== false,
      coversSubtree: row.covers_subtree !== false,
      remark: row.remark ?? '',
    });
    setDialogOpen(true);
  };

  const submit = async () => {
    if (connectionId == null) return;
    if (!form.misValue.trim() || !form.externalValue.trim()) {
      setError('MIS 值与数仓编码均不能为空');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveIqdDimensionValueMap({
        connection_id: connectionId,
        dimension_code: form.dimensionCode,
        mis_value: form.misValue.trim(),
        external_value: form.externalValue.trim(),
        effective: form.effective,
        covers_subtree: form.coversSubtree,
        remark: form.remark.trim() || null,
      });
      setDialogOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: IqdDimensionValueMap) => {
    if (row.id == null) return;
    try {
      await deleteIqdDimensionValueMap(row.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    }
  };

  const runPreview = async () => {
    if (connectionId == null) return;
    const values = previewInput
      .split(/[\s,，;；]+/)
      .map((v) => v.trim())
      .filter(Boolean);
    if (values.length === 0) {
      setError('请输入至少一个 MIS 值');
      return;
    }
    setPreviewing(true);
    setError(null);
    try {
      const res = await resolveIqdDimensionValues(connectionId, dimensionCode, values);
      setPreviewResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : '解析失败');
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PageHeader
        title="维度值映射"
        description="把 MIS 部门/门店编号映射到各数仓的部门/门店编码（行级范围注入取值来源）"
        breadcrumbs={buildAppBreadcrumbs({ app: 'agent', title: 'DimensionValueMapping' })}
        actions={<ProjectSwitcher />}
      />

      <div className="rounded border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
          <div className="flex items-center gap-1">
            {dimOptions.map((d) => (
              <Button
                key={d.code}
                size="sm"
                variant={dimensionCode === d.code ? 'default' : 'outline'}
                onClick={() => setDimensionCode(d.code)}
              >
                {d.label}
              </Button>
            ))}
          </div>
          <Input
            className="h-8 w-56"
            placeholder="按 MIS 值 / 数仓编码过滤"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="h-4 w-4" />
            刷新
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={openCreate} disabled={connectionId == null}>
              <Plus className="h-4 w-4" />
              新增映射
            </Button>
          </div>
        </div>

        {error ? <p className="px-3 py-2 text-xs text-destructive">{error}</p> : null}

        <div className="overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-left text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">维度</th>
                <th className="px-3 py-2 font-medium">MIS 值</th>
                <th className="px-3 py-2 font-medium">数仓编码</th>
                <th className="px-3 py-2 font-medium">覆盖下级</th>
                <th className="px-3 py-2 font-medium">状态</th>
                <th className="px-3 py-2 font-medium">备注</th>
                <th className="w-24 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                    {loading ? '加载中…' : '暂无映射（行级注入将 fail-closed）'}
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.id ?? `${r.mis_value}-${r.external_value}`} className="border-b">
                    <td className="px-3 py-2">{r.dimension_code}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.mis_value}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.external_value}</td>
                    <td className="px-3 py-2 text-xs">
                      {r.covers_subtree !== false ? '覆盖' : '平行'}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.effective !== false ? (
                        <span className="text-success">启用</span>
                      ) : (
                        <span className="text-muted-foreground">停用</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{r.remark ?? '—'}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" title="编辑" onClick={() => openEdit(r)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="删除"
                          className="text-destructive"
                          onClick={() => void remove(r)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded border bg-card p-3">
        <div className="mb-2 flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">解析预览</span>
          <span className="text-xs text-muted-foreground">
            输入 MIS 值（逗号/空格分隔）→ 查看最终限制范围
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="h-8 min-w-[16rem] flex-1"
            placeholder="例如：A001 A002 或 1001,1002"
            value={previewInput}
            onChange={(e) => setPreviewInput(e.target.value)}
          />
          <Button size="sm" onClick={() => void runPreview()} disabled={previewing || connectionId == null}>
            解析
          </Button>
        </div>
        {previewResult ? (
          <div className="mt-2 space-y-1 text-xs">
            <div>
              <span className="text-muted-foreground">最终范围：</span>
              {previewResult.resolved.length === 0 ? (
                <span className="text-destructive">空（fail-closed 45204）</span>
              ) : (
                previewResult.resolved.map((v) => (
                  <Badge key={v} variant="secondary" className="ml-1 rounded font-mono">
                    {v}
                  </Badge>
                ))
              )}
            </div>
            {previewResult.dropped.length > 0 ? (
              <div>
                <span className="text-muted-foreground">无映射被丢弃（无权限）：</span>
                {previewResult.dropped.map((v) => (
                  <Badge key={v} variant="outline" className="ml-1 rounded font-mono text-destructive">
                    {v}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? '编辑映射' : '新增映射'}</DialogTitle>
            <DialogDescription>
              一个 MIS 值可映射到多个数仓编码（1:N）；「覆盖下级」表示该编码代表整棵 MIS 子树。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>维度</Label>
              <div className="flex items-center gap-1">
                {dimOptions.map((d) => (
                  <Button
                    key={d.code}
                    type="button"
                    size="sm"
                    variant={form.dimensionCode === d.code ? 'default' : 'outline'}
                    onClick={() => setForm((f) => ({ ...f, dimensionCode: d.code }))}
                  >
                    {d.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Label>MIS 值（部门 id / 门店 id）</Label>
              <Input
                value={form.misValue}
                onChange={(e) => setForm((f) => ({ ...f, misValue: e.target.value }))}
                placeholder="例如：1001"
              />
            </div>
            <div className="space-y-1">
              <Label>数仓编码（该连接）</Label>
              <Input
                value={form.externalValue}
                onChange={(e) => setForm((f) => ({ ...f, externalValue: e.target.value }))}
                placeholder="例如：D001 / shop_no"
              />
            </div>
            <div className="flex items-center justify-between rounded border p-2">
              <div className="space-y-0.5">
                <Label>覆盖下级</Label>
                <p className="text-xs text-muted-foreground">
                  开启=父编码代表整棵 MIS 子树（裁剪后代）；关闭=平行编码（继续向下选）
                </p>
              </div>
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={form.coversSubtree}
                onChange={(e) => setForm((f) => ({ ...f, coversSubtree: e.target.checked }))}
              />
            </div>
            <div className="flex items-center justify-between rounded border p-2">
              <Label>启用</Label>
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={form.effective}
                onChange={(e) => setForm((f) => ({ ...f, effective: e.target.checked }))}
              />
            </div>
            <div className="space-y-1">
              <Label>备注（可选）</Label>
              <Input
                value={form.remark}
                onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void submit()} disabled={saving}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default IqdMappingPage;
