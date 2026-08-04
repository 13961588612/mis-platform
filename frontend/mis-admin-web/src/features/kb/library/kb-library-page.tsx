import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil, Plus, Settings2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/common/page-header';
import { PermissionGate } from '@/components/auth/permission-gate';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { EnabledBadge, SecrecyBadge } from '../components/kb-badges';
import {
  createLibrary,
  deleteLibrary,
  listCategories,
  listLibraries,
  updateLibrary,
} from '../api/kb-api';
import { useKbStore } from '../stores/use-kb-store';
import type { KbCategory, KbLibrary, KbRagSettings } from '../types';
import { KB_SECRECY_OPTIONS, formatTime } from '../types';

const fieldLabel = 'mb-[0.4rem] block text-sm font-medium text-foreground';
const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

interface LibraryForm {
  categoryId: string;
  name: string;
  secrecy: string;
  status: string;
  owner: string;
  topK: string;
  scoreThreshold: string;
  rerank: boolean;
  embeddingModel: string;
  retrievalMethod: string;
}

const EMPTY_FORM: LibraryForm = {
  categoryId: '',
  name: '',
  secrecy: 'internal',
  status: '1',
  owner: '',
  topK: '5',
  scoreThreshold: '0.2',
  rerank: false,
  embeddingModel: '',
  retrievalMethod: 'hybrid',
};

/**
 * 表单 → RAG 设置。
 *
 * <p>L-08 给 `KbRagSettings` 新增了切片方法/切片长度/分隔符/空结果策略四项，
 * Wave A（WA-01）又加了向量相似度权重。但本页的新增/编辑抽屉**只维护基础五项**
 * ——完整参数在「知识库详情 → RAG 设置」页维护。因此这里必须把 `base`
 * （编辑对象的现有设置）里的这些字段原样带回，
 * 否则一次「改个名字」就会把详情页调好的切片参数与权重悄悄清空。
 *
 * @param form 表单值
 * @param base 编辑前的现有设置；新建时传 null（由服务端回填默认值）
 */
function toSettings(form: LibraryForm, base: KbRagSettings | null): KbRagSettings {
  const topK = Number(form.topK);
  const threshold = Number(form.scoreThreshold);
  return {
    topK: Number.isFinite(topK) && topK > 0 ? topK : null,
    scoreThreshold: Number.isFinite(threshold) ? threshold : null,
    rerank: form.rerank,
    embeddingModel: form.embeddingModel.trim() || null,
    retrievalMethod: form.retrievalMethod.trim() || null,
    chunkMethod: base?.chunkMethod ?? null,
    chunkTokenNum: base?.chunkTokenNum ?? null,
    separator: base?.separator ?? null,
    emptyResultStrategy: base?.emptyResultStrategy ?? null,
    vectorSimilarityWeight: base?.vectorSimilarityWeight ?? null,
  };
}

/**
 * 知识库管理页。
 *
 * <p>左侧按分类过滤，右侧列出可见知识库；创建/编辑内含 RAG 设置（topK/阈值/rerank/嵌入模型/检索方式）。
 * `rerank` 开关按引擎能力 `rerankSupported` 灰化——能力由 S-04 引擎能力接口给出。
 */
export function KbLibraryPage() {
  const [categories, setCategories] = useState<KbCategory[]>([]);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [libraries, setLibraries] = useState<KbLibrary[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<KbLibrary | null>(null);
  const [form, setForm] = useState<LibraryForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const navigate = useNavigate();
  const capabilities = useKbStore((s) => s.capabilities);
  const refreshEngine = useKbStore((s) => s.refreshEngine);
  // QA P2-A：`!== false` 在 capabilities 未加载 / rerankSupported 为 null 时 fail-open，
  // 改 `=== true`，使「能力未确认」与「明确不支持」一致按不可用处理。
  const rerankSupported = capabilities?.rerankSupported === true;

  const loadCategories = useCallback(async () => {
    try {
      setCategories(await listCategories());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载分类失败');
    }
  }, []);

  const loadLibraries = useCallback(async (cid: number | null) => {
    setLoading(true);
    try {
      setLibraries(await listLibraries(cid));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载知识库失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCategories();
    if (!capabilities) void refreshEngine();
  }, [loadCategories, refreshEngine, capabilities]);

  useEffect(() => {
    void loadLibraries(categoryId);
  }, [categoryId, loadLibraries]);

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, categoryId: categoryId == null ? '' : String(categoryId) });
    setOpen(true);
  }

  function openEdit(lib: KbLibrary) {
    setEditing(lib);
    setForm({
      categoryId: lib.categoryId == null ? '' : String(lib.categoryId),
      name: lib.name,
      secrecy: lib.secrecy || 'internal',
      status: String(lib.status ?? 1),
      owner: lib.owner == null ? '' : String(lib.owner),
      topK: lib.settings?.topK == null ? '5' : String(lib.settings.topK),
      scoreThreshold:
        lib.settings?.scoreThreshold == null ? '0.2' : String(lib.settings.scoreThreshold),
      rerank: lib.settings?.rerank === true,
      embeddingModel: lib.settings?.embeddingModel ?? '',
      retrievalMethod: lib.settings?.retrievalMethod ?? 'hybrid',
    });
    setOpen(true);
  }

  async function onSave() {
    if (!form.name.trim()) {
      toast.warning('请填写知识库名称');
      return;
    }
    if (!editing && form.categoryId === '') {
      toast.warning('请选择所属分类');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateLibrary(editing.id, {
          name: form.name.trim(),
          secrecy: form.secrecy,
          status: Number(form.status) || 0,
          settings: toSettings(form, editing.settings),
        });
      } else {
        await createLibrary({
          categoryId: Number(form.categoryId),
          name: form.name.trim(),
          secrecy: form.secrecy,
          owner: form.owner.trim() === '' ? null : Number(form.owner),
          settings: toSettings(form, null),
        });
      }
      toast.success('已保存');
      setOpen(false);
      await loadLibraries(categoryId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(lib: KbLibrary) {
    if (!window.confirm(`删除知识库「${lib.name}」？其下文档与索引将一并移除。`)) return;
    try {
      await deleteLibrary(lib.id);
      toast.success('已删除');
      await loadLibraries(categoryId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4 md:p-5">
      <PageHeader
        title="知识库管理"
        description="知识库是检索的最小授权单元；可见性 = 公开∧启用 ∪ 授权 − 停用，由服务端裁定。"
        actions={
          <PermissionGate permission="kb:library:add">
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              新增知识库
            </Button>
          </PermissionGate>
        }
      />

      <div className="flex min-h-0 flex-1 gap-3">
        <aside className="w-56 shrink-0 overflow-auto rounded-lg border bg-card p-2">
          <button
            type="button"
            className={`mb-0.5 w-full truncate rounded-md px-2 py-1.5 text-left text-sm ${
              categoryId == null ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-accent'
            }`}
            onClick={() => setCategoryId(null)}
          >
            全部分类
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`mb-0.5 w-full truncate rounded-md px-2 py-1.5 text-left text-sm ${
                categoryId === c.id ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-accent'
              }`}
              onClick={() => setCategoryId(c.id)}
            >
              {c.name}
              {c.enabled === 0 ? <span className="ml-1 text-xs text-muted-foreground">(停用)</span> : null}
            </button>
          ))}
        </aside>

        <div className="min-w-0 flex-1 overflow-auto rounded-lg border bg-table-surface">
          <table className="w-full bg-table-surface text-left text-sm">
            <thead className="sticky top-0 z-10 border-b-2 border-foreground/20 bg-table-header text-muted-foreground backdrop-blur">
              <tr>
                <th className="px-3 py-2 font-bold">名称</th>
                <th className="px-3 py-2 font-bold">密级</th>
                <th className="px-3 py-2 font-bold">状态</th>
                <th className="px-3 py-2 font-bold">文档数</th>
                <th className="px-3 py-2 font-bold">topK</th>
                <th className="px-3 py-2 font-bold">引擎</th>
                <th className="px-3 py-2 font-bold">更新时间</th>
                <th className="px-3 py-2 font-bold">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                    加载中…
                  </td>
                </tr>
              ) : libraries.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                    暂无可见知识库
                  </td>
                </tr>
              ) : (
                libraries.map((lib) => (
                  <tr
                    key={lib.id}
                    className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe hover:bg-table-hover"
                  >
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="max-w-[18rem] truncate text-left text-primary hover:underline"
                        title="查看详情"
                        onClick={() => navigate(`/kb/libraries/${lib.id}`)}
                      >
                        {lib.name}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <SecrecyBadge secrecy={lib.secrecy} />
                    </td>
                    <td className="px-3 py-2">
                      <EnabledBadge enabled={lib.status} />
                    </td>
                    <td className="px-3 py-2 tabular-nums">{lib.docCount ?? 0}</td>
                    <td className="px-3 py-2 tabular-nums">{lib.settings?.topK ?? '-'}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{lib.engineType ?? '-'}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{formatTime(lib.updatedAt)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                          onClick={() => navigate(`/kb/libraries/${lib.id}`)}
                        >
                          <Settings2 className="h-3 w-3" />
                          详情
                        </button>
                        <PermissionGate permission="kb:library:edit">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                            onClick={() => openEdit(lib)}
                          >
                            <Pencil className="h-3 w-3" />
                            编辑
                          </button>
                        </PermissionGate>
                        <PermissionGate permission="kb:library:delete">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-destructive hover:bg-destructive/10"
                            onClick={() => void onDelete(lib)}
                          >
                            <Trash2 className="h-3 w-3" />
                            删除
                          </button>
                        </PermissionGate>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex w-full flex-col sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{editing ? '编辑知识库' : '新增知识库'}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 space-y-3 overflow-auto py-4">
            {!editing ? (
              <div>
                <label className={fieldLabel}>所属分类 *</label>
                <select
                  className={selectClass}
                  value={form.categoryId}
                  onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
                >
                  <option value="">请选择</option>
                  {categories.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div>
              <label className={fieldLabel}>名称 *</label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className={fieldLabel}>密级 *</label>
              <select
                className={selectClass}
                value={form.secrecy}
                onChange={(e) => setForm((f) => ({ ...f, secrecy: e.target.value }))}
              >
                {KB_SECRECY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                「公开」且启用的知识库对全员可见；其余需在「权限」页显式授权。
              </p>
            </div>
            {editing ? (
              <div>
                <label className={fieldLabel}>状态</label>
                <select
                  className={selectClass}
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                >
                  <option value="1">启用</option>
                  <option value="0">停用</option>
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  停用后即便已授权也不可见（停用优先级最高）。
                </p>
              </div>
            ) : (
              <div>
                <label className={fieldLabel}>责任人用户 ID</label>
                <Input
                  value={form.owner}
                  onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))}
                  placeholder="留空则默认当前用户"
                />
              </div>
            )}

            <div className="rounded-md border border-dashed p-3">
              <p className="mb-2 text-sm font-medium">RAG 设置</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={fieldLabel}>topK</label>
                  <Input
                    value={form.topK}
                    onChange={(e) => setForm((f) => ({ ...f, topK: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={fieldLabel}>相似度阈值</label>
                  <Input
                    value={form.scoreThreshold}
                    onChange={(e) => setForm((f) => ({ ...f, scoreThreshold: e.target.value }))}
                  />
                </div>
              </div>
              <div className="mt-3">
                <label className={fieldLabel}>检索方式</label>
                <select
                  className={selectClass}
                  value={form.retrievalMethod}
                  onChange={(e) => setForm((f) => ({ ...f, retrievalMethod: e.target.value }))}
                >
                  <option value="hybrid">混合检索</option>
                  <option value="vector">向量检索</option>
                  <option value="keyword">关键词检索</option>
                </select>
              </div>
              <div className="mt-3">
                <label className={fieldLabel}>嵌入模型</label>
                <Input
                  value={form.embeddingModel}
                  onChange={(e) => setForm((f) => ({ ...f, embeddingModel: e.target.value }))}
                  placeholder="留空使用引擎默认"
                />
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={form.rerank}
                  disabled={!rerankSupported}
                  onChange={(e) => setForm((f) => ({ ...f, rerank: e.target.checked }))}
                />
                启用重排（rerank）
                {!rerankSupported ? (
                  <span className="text-xs text-muted-foreground">当前引擎不支持</span>
                ) : null}
              </label>
              <p className="mt-2 text-xs text-muted-foreground">
                切片方法、切片长度、分隔符、空结果策略在「详情 → RAG 设置」中维护，此处保存不会覆盖。
              </p>
            </div>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button disabled={saving} onClick={() => void onSave()}>
              保存
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
