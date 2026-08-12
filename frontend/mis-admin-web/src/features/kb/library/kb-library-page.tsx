import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, ArchiveRestore, ClipboardList, Pencil, Plus, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { PermissionGate } from '@/components/auth/permission-gate';
import { SortIndicator } from '@/components/common/sort-indicator';
import { useClientSort } from '@/components/common/use-client-sort';
import { useColumnWidths, type ResizableColumn } from '@/components/common/use-column-widths';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { EnabledBadge, SecrecyBadge } from '../components/kb-badges';
import { KbLibraryDeleteDialog } from './kb-library-delete-dialog';
import { KbLibraryUnarchiveDialog } from './kb-library-unarchive-dialog';
import { createLibrary, listCategories, listLibraries, listManageableCategoryIds, updateLibrary } from '../api/kb-api';
import {
  CategoryTreeCell,
  flattenCategoryTree,
  initialExpandedSet,
} from '../category/kb-category-tree';
import { useKbStore } from '../stores/use-kb-store';
import type { KbCategory, KbLibrary, KbRagSettings } from '../types';
import { KB_ENGINE_SYNC_STATUS_META, KB_SECRECY_OPTIONS, formatTime } from '../types';
import { SHEET_FORM_BODY, SHEET_FORM_FIELD, SHEET_FORM_LABEL } from '@/components/common/sheet-form-styles';

/** 标签与控件间距由外层 field 的 space-y-1.5 统一，避免上下半区疏密不一致。 */
const fieldLabel = SHEET_FORM_LABEL;
const fieldStack = SHEET_FORM_FIELD;
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
    // kb_settings_model_chunk：库级重排模型 id 只在详情页维护，此处原样带回
    rerankModelId: base?.rerankModelId ?? null,
    // 企业级增强一期 KE-06/KE-07：OCR/overlap 只在详情页维护（引擎不支持时仅落库），
    // 此处必须原样带回——否则一次「改个名字」就会把详情页调好的 OCR 参数悄悄清空。
    ocrEnabled: base?.ocrEnabled ?? null,
    ocrLanguage: base?.ocrLanguage ?? null,
    chunkOverlapTokenNum: base?.chunkOverlapTokenNum ?? null,
    // 图谱开关（Wave B GraphRAG PoC，T02）：只在详情页维护，此处原样带回——
    // 否则一次「改个名字」就会把详情页开启的知识图谱悄悄关掉。
    // kgBuildStatus/kgBuildMessage 由服务端维护，前端不提交（类型上可选）。
    useKnowledgeGraph: base?.useKnowledgeGraph ?? null,
    // RAPTOR（Wave C，T02）：同样只在详情页维护，此处原样带回——
    // 否则一次「改个名字」就会把详情页开启的 RAPTOR 建树悄悄关掉。
    // raptorBuildStatus/raptorBuildMessage 由服务端维护，前端不提交（类型上可选）。
    useRaptor: base?.useRaptor ?? null,
    raptorMaxTokenNum: base?.raptorMaxTokenNum ?? null,
    raptorThreshold: base?.raptorThreshold ?? null,
    raptorMaxCluster: base?.raptorMaxCluster ?? null,
    raptorPrompt: base?.raptorPrompt ?? null,
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
  /** 左侧分类树的展开节点集合；首次加载后由 initialExpandedSet 置为「全展开」。 */
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set<number>());
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [libraries, setLibraries] = useState<KbLibrary[]>([]);
  const [loading, setLoading] = useState(false);
  /**
   * KBP-06：管理页库列表默认走「仅我可管理」（主理人 W 决策）——关闭后回落现状全量。
   *
   * <p>开启时列表以 {@code scope=manageable} 由服务端收敛（分类管辖 ∪ kb_acl.manage），
   * 左侧分类树同步约束到管辖分类（含导航祖先），避免「看得到但动不了」的库混进来。
   */
  const [onlyManageable, setOnlyManageable] = useState(true);
  /** 本人可管理的分类 id 集合（onlyManageable 开启时约束左侧分类树；拉取失败回落空集）。 */
  const [manageableCategoryIds, setManageableCategoryIds] = useState<Set<number>>(
    () => new Set<number>(),
  );
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<KbLibrary | null>(null);
  const [form, setForm] = useState<LibraryForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  /** 归档 / 删除对话框的目标库；null = 关闭（T05，替代原 window.confirm）。 */
  const [deleting, setDeleting] = useState<KbLibrary | null>(null);
  /** 取消归档对话框的目标库；null = 关闭（P1-T2）。 */
  const [unarchiving, setUnarchiving] = useState<KbLibrary | null>(null);

  const navigate = useNavigate();

  /* 列宽 + 表头排序（一次性加载，前端排序无分页副作用） */
  const LIB_COLS = useMemo<ResizableColumn[]>(
    () => [
      { key: 'name', label: '名称' },
      { key: 'secrecy', label: '密级' },
      { key: 'status', label: '状态' },
      { key: 'docCount', label: '文档数' },
      { key: 'topK', label: 'topK' },
      { key: 'engineType', label: '建库引擎' },
      { key: 'engineSyncStatus', label: '引擎同步' },
      { key: 'updatedAt', label: '更新时间' },
      { key: '__ops__', label: '操作', locked: true },
    ],
    [],
  );
  const { widthOf, startResize, hasCustom, reset } = useColumnWidths(LIB_COLS, 'mis-kb-library-table-widths');
  const getSortValue = useCallback(
    (row: KbLibrary, key: string) => (key === 'topK' ? row.settings?.topK : row[key as keyof KbLibrary]),
    [],
  );
  const { sorted: sortedLibraries, sortKey, sortDir, toggleSort } = useClientSort(libraries, getSortValue);
  const capabilities = useKbStore((s) => s.capabilities);
  const refreshEngine = useKbStore((s) => s.refreshEngine);
  const modelPool = useKbStore((s) => s.modelPool);
  const refreshModels = useKbStore((s) => s.refreshModels);
  const invalidateLibraries = useKbStore((s) => s.invalidateLibraries);
  // QA P2-A：`!== false` 在 capabilities 未加载 / rerankSupported 为 null 时 fail-open，
  // 改 `=== true`，使「能力未确认」与「明确不支持」一致按不可用处理。
  const rerankSupported = capabilities?.rerankSupported === true;
  // kb_settings_model_chunk：池可用才展示下拉；不可用/未加载一律按「不可判定」回落自由文本
  const embeddingPool = modelPool?.available === true ? modelPool.embedding ?? [] : null;
  const poolDegraded = modelPool != null && modelPool.available !== true;

  const loadCategories = useCallback(async () => {
    try {
      const list = await listCategories();
      setCategories(list);
      // 首次加载时全部展开；后续刷新保留用户已折叠的节点（与分类管理页口径一致）
      setExpanded((prev) => (prev.size === 0 ? initialExpandedSet(list) : prev));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载分类失败');
    }
  }, []);

  const loadLibraries = useCallback(async (cid: number | null, manageable: boolean) => {
    setLoading(true);
    try {
      setLibraries(await listLibraries(cid, manageable ? 'manageable' : null));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载知识库失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadManageableIds = useCallback(async () => {
    try {
      const ids = await listManageableCategoryIds();
      setManageableCategoryIds(new Set(ids));
    } catch {
      // 拉不到管辖范围不阻断页面：列表仍按 scope=manageable 由服务端收敛，
      // 左侧分类树回落「全部分类」（宁可多显示也不误藏可管理库）
      setManageableCategoryIds(new Set());
    }
  }, []);

  useEffect(() => {
    void loadCategories();
    if (!capabilities) void refreshEngine();
  }, [loadCategories, refreshEngine, capabilities]);

  useEffect(() => {
    if (onlyManageable) void loadManageableIds();
  }, [onlyManageable, loadManageableIds]);

  useEffect(() => {
    void loadLibraries(categoryId, onlyManageable);
  }, [categoryId, onlyManageable, loadLibraries]);

  /* 左侧分类树：扁平数组 → 带 depth 的可见行（折叠节点的后代不产出） */
  const categoryRows = useMemo(() => {
    const rows = flattenCategoryTree(categories, expanded);
    if (!onlyManageable) return rows;
    // 管辖模式：只保留「可管理节点」+「通向可管理节点的祖先」——树保持可导航，
    // 但不可管理的旁支不出现，避免用户点进去看一个必然空/越权的分类
    if (manageableCategoryIds.size === 0) return rows;
    const byId = new Map(categories.map((c) => [c.id, c] as const));
    return rows.filter(({ category }) => {
      if (manageableCategoryIds.has(category.id)) return true;
      // category 是否为某个可管理节点的祖先
      for (const manageableId of manageableCategoryIds) {
        let cur: number | null = manageableId;
        const seen = new Set<number>();
        while (cur != null && !seen.has(cur)) {
          seen.add(cur);
          if (cur === category.id) return true;
          cur = byId.get(cur)?.parentId ?? null;
        }
      }
      return false;
    });
  }, [categories, expanded, onlyManageable, manageableCategoryIds]);
  /** 拥有子节点的分类 id 集合——决定该行是否渲染展开/折叠 chevron。 */
  const branchIds = useMemo(() => {
    const set = new Set<number>();
    for (const c of categories) {
      if (c.parentId != null) set.add(c.parentId);
    }
    return set;
  }, [categories]);

  /** 展开/折叠单个节点；必须返回新的 Set 引用，否则 React 不会重渲染。 */
  function toggleCategoryNode(id: number): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * 抽屉「所属分类」下拉的可选分类（KBP-03：只列当前用户管辖的分类，含子树）。
   *
   * <p>{@code manageableCategoryIds} 即服务端 {@code resolveManageableCategoryIds}
   * 返回的「授权节点子树并集」，已含全部后代；非管辖分类不出现、不可选作建库目标。
   * 管辖未开启 / 管辖范围拉取失败时回落全量（现状行为，服务层 {@code assertNodeManage}
   * 兜底防越权）。
   */
  const manageableCategoryOptions = useMemo(() => {
    if (!onlyManageable || manageableCategoryIds.size === 0) return categories;
    return categories.filter((c) => manageableCategoryIds.has(c.id));
  }, [categories, onlyManageable, manageableCategoryIds]);

  /**
   * 选中分类并确保它在树上可见（沿途祖先全部展开）。
   *
   * <p>只用于**程序化**选中（如新建知识库后自动切到目标分类）——目标分类可能藏在
   * 折叠子树里，直接 setCategoryId 会「右侧列表变了但左侧看不出选了谁」。
   * 用户手动点击选中的节点本来就可见，无需 reveal。
   */
  function selectCategoryAndReveal(id: number): void {
    setCategoryId(id);
    setExpanded((prev) => {
      const byId = new Map(categories.map((c) => [c.id, c] as const));
      const next = new Set(prev);
      const seen = new Set<number>([id]);
      let changed = false;
      let cur = byId.get(id)?.parentId ?? null;
      // seen 兼作环保护：脏数据成环时不至于死循环
      while (cur != null && byId.has(cur) && !seen.has(cur)) {
        seen.add(cur);
        if (!next.has(cur)) {
          next.add(cur);
          changed = true;
        }
        cur = byId.get(cur)?.parentId ?? null;
      }
      return changed ? next : prev;
    });
  }

  /**
   * 选中分类被折叠祖先藏起来时，返回「最近的可见祖先」id，否则 null。
   *
   * <p>用户折叠父节点后选中行会从树上消失，此时右侧仍在按这个看不见的分类过滤，
   * 而「全部分类」也不高亮 —— 界面上没有任何线索。标记该祖先来兜底。
   * 这里不自动展开：用户刚做的折叠动作不应被程序悄悄撤销。
   */
  const hiddenSelectionAncestorId = useMemo<number | null>(() => {
    if (categoryId == null) return null;
    const visible = new Set(categoryRows.map((r) => r.category.id));
    if (visible.has(categoryId)) return null;
    const byId = new Map(categories.map((c) => [c.id, c] as const));
    if (!byId.has(categoryId)) return null; // 选中的分类已不存在，交给别处处理
    const seen = new Set<number>([categoryId]);
    let cur = byId.get(categoryId)?.parentId ?? null;
    while (cur != null && !seen.has(cur)) {
      seen.add(cur);
      if (visible.has(cur)) return cur;
      cur = byId.get(cur)?.parentId ?? null;
    }
    return null;
  }, [categoryId, categoryRows, categories]);

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, categoryId: categoryId == null ? '' : String(categoryId) });
    // kb_settings_model_chunk：创建向导需要模型池，打开时显式刷新（60s TTL 内后端不重打引擎）
    void refreshModels();
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
        const createdCategoryId = Number(form.categoryId);
        await createLibrary({
          categoryId: createdCategoryId,
          name: form.name.trim(),
          secrecy: form.secrecy,
          owner: form.owner.trim() === '' ? null : Number(form.owner),
          settings: toSettings(form, null),
        });
        // 左侧分类筛选若与新建库不一致，切到目标分类；否则本页列表会「成功但看不见」
        // reveal：目标分类可能藏在折叠子树里（抽屉下拉是全量扁平的，不受展开态约束）
        if (categoryId !== createdCategoryId) {
          selectCategoryAndReveal(createdCategoryId);
        }
      }
      toast.success('已保存');
      setOpen(false);
      invalidateLibraries();
      // 分类未变时 effect 不会重跑，需显式刷新本页列表
      if (editing || categoryId === Number(form.categoryId) || form.categoryId === '') {
        await loadLibraries(categoryId, onlyManageable);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  /**
   * 归档 / 删除完成回调。
   *
   * <p>刻意**不**在这里弹 toast：文案由对话框按后端回执渲染（归档 ≠ 删除，
   * 这层再补一句「已删除」就把回执里那句「未删除引擎数据」盖掉了）。
   */
  async function onDeleteDone() {
    invalidateLibraries();
    await loadLibraries(categoryId, onlyManageable);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="知识库管理"
        description="知识库是检索的最小授权单元；可见性 = 公开∧启用 ∪ 授权 − 停用，由服务端裁定。"
        breadcrumbs={buildAppBreadcrumbs({ app: 'kb', title: '知识库管理' })}
        actions={
          <>
            {/* 企业级增强一期 KE-02：快捷入口跳转系统监控-操作日志并按 module=知识库 预筛选
                （权限码 monitor:operlog:list，对齐 V2 菜单 302 操作日志页） */}
            <PermissionGate permission="monitor:operlog:list">
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate('/monitor/oper-log?module=' + encodeURIComponent('知识库'))}
              >
                <ClipboardList className="h-4 w-4" />
                操作日志
              </Button>
            </PermissionGate>
            <PermissionGate permission="kb:library:add">
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                新增知识库
              </Button>
            </PermissionGate>
          </>
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
          {categoryRows.map(({ category, depth }) => (
            <div
              key={category.id}
              role="button"
              tabIndex={0}
              aria-pressed={categoryId === category.id}
              title={
                category.id === hiddenSelectionAncestorId
                  ? '当前筛选的分类在此折叠子树内，展开可见'
                  : undefined
              }
              className={cn(
                'mb-0.5 w-full cursor-pointer overflow-hidden rounded-md px-2 py-1.5 text-left text-sm',
                categoryId === category.id
                  ? 'bg-primary/10 font-medium text-primary'
                  : 'hover:bg-accent',
                category.id === hiddenSelectionAncestorId && 'ring-1 ring-inset ring-primary/40',
              )}
              // chevron 是行内的 <button>，点它只切换展开态，不应连带切换筛选分类。
              // 这里用 closest('button') 而非 e.target !== e.currentTarget：点击的 target
              // 可能是行内任意后代（名称 span、图标 svg），用 !== 会把「点名称选中」这种
              // 合法操作也一并挡掉，整行几乎点不动。
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('button') != null) return;
                setCategoryId(category.id);
              }}
              // 键盘事件同样会从 chevron 冒泡上来：若不判定来源就 preventDefault，
              // 会连 <button> 的原生激活（Enter 的 click、Space 的 keyup→click）一起取消，
              // 导致「焦点在 chevron 按回车 → 不展开却切了筛选」。
              // 这里可以用 !==（无需与上面对称）：keydown 的 target 恒为当前焦点元素，
              // 非行容器即子按钮，不存在「点在文字上」这种中间态；且它对以后行内新增的
              // 任何可交互子元素自动免疫。
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setCategoryId(category.id);
                }
              }}
            >
              <CategoryTreeCell
                category={category}
                depth={depth}
                expanded={expanded.has(category.id)}
                hasChildren={branchIds.has(category.id)}
                onToggle={() => toggleCategoryNode(category.id)}
                manageable={false}
                // 选中态颜色必须落在最内层：CategoryTreeCell 的名称 span 自带
                // text-foreground，会盖掉行容器上的 text-primary
                renderName={(c) => (
                  <span className={cn(categoryId === c.id && 'font-medium text-primary')}>
                    {c.name}
                    {c.enabled === 0 ? (
                      <span className="ml-1 text-xs text-muted-foreground">(停用)</span>
                    ) : null}
                    {c.id === hiddenSelectionAncestorId ? (
                      <span className="ml-1 text-xs text-primary">· 含当前筛选</span>
                    ) : null}
                  </span>
                )}
              />
            </div>
          ))}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {/* KBP-06：管理页库列表默认「仅我可管理」（服务端 scope=manageable 收敛） */}
          <div className="flex items-center justify-between gap-3 px-1">
            <label
              className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground"
              title="开启后列表只显示您可管理的知识库（分类管辖 ∪ 库级管理授权），由服务端收敛数据范围"
            >
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                checked={onlyManageable}
                onChange={(e) => {
                  const next = e.target.checked;
                  setOnlyManageable(next);
                  // 切到管辖模式时，若当前分类不在管辖内，回落「全部分类」，
                  // 避免右侧列表恒空且看不出原因
                  if (next && categoryId != null && !manageableCategoryIds.has(categoryId)) {
                    setCategoryId(null);
                  }
                }}
              />
              仅看我可管理的
            </label>
            <span className="text-xs text-muted-foreground">
              {onlyManageable ? '数据范围：我可管理的知识库' : '数据范围：全部可见知识库'}
            </span>
          </div>
          <div className="relative min-w-0 flex-1 overflow-auto rounded-lg border bg-table-surface">
          {hasCustom ? (
            <button
              type="button"
              onClick={reset}
              className="absolute right-3 top-3 z-20 rounded-md bg-card px-2 py-0.5 text-xs text-muted-foreground shadow-sm hover:text-foreground"
            >
              重置列宽
            </button>
          ) : null}
          <table className="w-full table-fixed border-separate border-spacing-0 bg-table-surface text-left text-sm">
            <thead className="border-b-2 border-foreground/20 bg-table-header text-muted-foreground">
              <tr>
                {LIB_COLS.map((c, ci) => {
                  const active = sortKey === c.key;
                  return (
                    <th
                      key={c.key}
                      style={{ width: widthOf(c.key) }}
                      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      className={cn(
                        'overflow-hidden whitespace-nowrap px-3 py-2 font-bold',
                        ci > 0 && 'border-l border-border/60',
                        c.locked && 'text-right',
                      )}
                    >
                      {c.locked ? (
                        c.label
                      ) : (
                        <button
                          type="button"
                          onClick={() => toggleSort(c.key)}
                          className={cn(
                            'flex w-full items-center gap-1 text-left font-bold',
                            active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {c.label}
                          <SortIndicator state={active ? sortDir : 'none'} />
                        </button>
                      )}
                      {!c.locked ? (
                        <span
                          role="separator"
                          aria-label={`调整${c.label}列宽`}
                          onMouseDown={(e) => startResize(e, c.key)}
                          className="absolute right-0 top-0 h-full w-[3px] cursor-col-resize"
                        />
                      ) : null}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">
                    加载中…
                  </td>
                </tr>
              ) : libraries.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">
                    {onlyManageable
                      ? '暂无您可管理的知识库——请联系管理员在「分类 → 管理员」给您分配管辖范围，或授予库级管理权限'
                      : '暂无可见知识库'}
                  </td>
                </tr>
              ) : (
                sortedLibraries.map((lib) => (
                  <tr
                    key={lib.id}
                    className={cn(
                      'border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe hover:bg-table-hover',
                      // 已归档行整体降饱和：一眼看出「这个库不参与检索了」
                      lib.archivedAt != null && 'opacity-60',
                    )}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          className="max-w-[16rem] truncate text-left text-primary hover:underline"
                          title="查看详情"
                          onClick={() => navigate(`/kb/libraries/${lib.id}`)}
                        >
                          {lib.name}
                        </button>
                        {lib.archivedAt != null ? (
                          <Badge variant="secondary" title={`归档于 ${formatTime(lib.archivedAt)}`}>
                            已归档
                          </Badge>
                        ) : null}
                      </div>
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
                    <td className="px-3 py-2">
                      {(() => {
                        // 老后端不返回该字段时按「未对账」展示，不留空白
                        const meta =
                          KB_ENGINE_SYNC_STATUS_META[lib.engineSyncStatus ?? 0] ??
                          KB_ENGINE_SYNC_STATUS_META[0];
                        const checked = formatTime(lib.engineCheckedAt);
                        return (
                          <span
                            title={`${meta.hint}${checked === '-' ? '' : `（对账于 ${checked}）`}`}
                          >
                            <Badge variant={meta.variant}>{meta.label}</Badge>
                          </span>
                        );
                      })()}
                    </td>
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
                        {/* Q9：菜单项改叫「归档」——默认动作确实只是归档，
                            叫「删除」会让人以为引擎侧数据已经清掉。权限码不变。
                            P1-T2：已归档行改显「取消归档」，把引擎名与状态一起回滚。 */}
                        {lib.archivedAt != null ? (
                          <PermissionGate permission="kb:library:edit">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                              onClick={() => setUnarchiving(lib)}
                            >
                              <ArchiveRestore className="h-3 w-3" />
                              取消归档
                            </button>
                          </PermissionGate>
                        ) : (
                          <PermissionGate permission="kb:library:delete">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-destructive hover:bg-destructive/10"
                              onClick={() => setDeleting(lib)}
                            >
                              <Archive className="h-3 w-3" />
                              归档
                            </button>
                          </PermissionGate>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        </div>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex w-full flex-col sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{editing ? '编辑知识库' : '新增知识库'}</SheetTitle>
          </SheetHeader>
          <div className={cn(SHEET_FORM_BODY)}>
            {/* 上半基础字段：行距与下方 RAG 区统一为 space-y-3 / 标签-控件 space-y-1.5 */}
            <div className="space-y-3">
              {!editing ? (
                <div className={fieldStack}>
                  <label className={fieldLabel}>所属分类 *</label>
                  <select
                    className={selectClass}
                    value={form.categoryId}
                    onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
                  >
                    <option value="">请选择</option>
                    {manageableCategoryOptions.map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  {onlyManageable && manageableCategoryOptions.length === 0 ? (
                    <p className="text-xs text-amber-600">
                      您暂无可管辖的分类——请联系管理员在「分类 → 管理员」中给您分配管辖范围
                    </p>
                  ) : onlyManageable ? (
                    <p className="text-xs text-muted-foreground">
                      仅列出您可管辖的分类（含子分类）
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className={fieldStack}>
                <label className={fieldLabel}>名称 *</label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className={fieldStack}>
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
                <p className="text-xs text-muted-foreground">
                  「公开」且启用的知识库对全员可见；其余需在「权限」页显式授权。
                </p>
              </div>
              {editing ? (
                <div className={fieldStack}>
                  <label className={fieldLabel}>状态</label>
                  <select
                    className={selectClass}
                    value={form.status}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                  >
                    <option value="1">启用</option>
                    <option value="0">停用</option>
                  </select>
                  <p className="text-xs text-muted-foreground">
                    停用后即便已授权也不可见（停用优先级最高）。
                  </p>
                </div>
              ) : (
                <div className={fieldStack}>
                  <label className={fieldLabel}>责任人用户 ID</label>
                  <Input
                    value={form.owner}
                    onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))}
                    placeholder="留空则默认当前用户"
                  />
                </div>
              )}
            </div>

            <div className="space-y-3 rounded-md border border-dashed p-3">
              <p className="text-sm font-medium">RAG 设置</p>
              <div className="grid grid-cols-2 gap-3">
                <div className={fieldStack}>
                  <label className={fieldLabel}>topK</label>
                  <Input
                    value={form.topK}
                    onChange={(e) => setForm((f) => ({ ...f, topK: e.target.value }))}
                  />
                </div>
                <div className={fieldStack}>
                  <label className={fieldLabel}>相似度阈值</label>
                  <Input
                    value={form.scoreThreshold}
                    onChange={(e) => setForm((f) => ({ ...f, scoreThreshold: e.target.value }))}
                  />
                </div>
              </div>
              <div className={fieldStack}>
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
              <div className={fieldStack}>
                <label className={fieldLabel}>嵌入模型</label>
                {editing ? (
                  <Input
                    value={form.embeddingModel}
                    disabled
                    placeholder="留空使用引擎默认"
                    title="嵌入模型在创建后不可修改"
                  />
                ) : embeddingPool != null && embeddingPool.length > 0 ? (
                  <select
                    className={selectClass}
                    value={form.embeddingModel}
                    onChange={(e) => setForm((f) => ({ ...f, embeddingModel: e.target.value }))}
                  >
                    <option value="">引擎默认（留空）</option>
                    {embeddingPool.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                        {m.dimension != null || m.language != null
                          ? `（${[m.dimension, m.language].filter(Boolean).join('·')}）`
                          : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="space-y-1.5">
                    <Input
                      value={form.embeddingModel}
                      onChange={(e) => setForm((f) => ({ ...f, embeddingModel: e.target.value }))}
                      placeholder="留空使用引擎默认"
                    />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-amber-600">
                        {poolDegraded
                          ? `模型池不可用：${modelPool?.degradedReason ?? '未知原因'}。可手动填写模型 ID 或重试。`
                          : '模型池加载中…'}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void refreshModels()}
                      >
                        重试
                      </Button>
                    </div>
                  </div>
                )}
                {editing ? (
                  <p className="text-xs text-muted-foreground">嵌入模型在创建后不可修改。</p>
                ) : null}
              </div>
              <label className="flex items-center gap-2 text-sm">
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
              <p className="text-xs text-muted-foreground">
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

      <KbLibraryDeleteDialog
        library={deleting}
        capabilities={capabilities}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
        onDone={() => void onDeleteDone()}
      />

      <KbLibraryUnarchiveDialog
        library={unarchiving}
        onOpenChange={(next) => {
          if (!next) setUnarchiving(null);
        }}
        onDone={() => void onDeleteDone()}
      />
    </div>
  );
}
