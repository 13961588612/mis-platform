/**
 * iqd-enhance-page.tsx — 问数「知识与规则」（W2/W4 + 指令，路径 /iqd/enhance）。
 *
 * <p>六个 Tab：
 * <ul>
 *   <li>脱敏规则（iqd_mask_rule CRUD，W2）</li>
 *   <li>行级维度注册表（iqd_row_scope_dimension CRUD，W2）</li>
 *   <li>字典同步（mis_dept_scope / mis_store_scope 手动触发 + 状态，W2）</li>
 *   <li>样本对（iqd_sql_pair CRUD，W4 few-shot；**T04e MR-08：SQL 框升级 CodeMirror 6**）</li>
 *   <li>知识/术语（iqd_knowledge CRUD + S-07 导入 + 增强推送，W4；**T04e MR-09：增「关联对象」列**；
 *       **布局与样本对 Tab 同构**：筛选栏 + 表格 + 新增/编辑弹窗，保存不再走内联表单）</li>
 *   <li>指令（iqd_knowledge kind=instruction；原独立「指令下发」页并入）</li>
 * </ul>
 *
 * <h2>权限码（核实自 `sys_api ⋈ sys_menu_api ⋈ sys_menu` seed，非文档猜测）</h2>
 * `iqd:mask:view|save`（V73:92568-92570）、`iqd:dimension:view|save`（V73:92571-92573）、
 * `iqd:scope:view|sync`（V73:92574/92575）、`iqd:enhance:view|save|sync`（V74:92578-92585）、
 * **`iqd:enhance:manage`（V78:92586/92587 —— `sql-pairs/translate` + `/trial`；常被文档漏写）**。
 *
 * <p><b>T04e A-04</b>：**仅替换 SQL 文本框为 CodeMirror 6**，**不动** v1.10 的
 * 「DB 类型下拉 → 转化 → 试运行 → 保存」交互。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pencil, Plus, RefreshCw, Save, Send, Trash2, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/common/page-header';
import { ProjectSwitcher } from './components/shared/ProjectSwitcher';
import { useActiveProjectId } from './hooks/useActiveProject';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  deleteIqdDimension,
  deleteIqdKnowledge,
  deleteIqdMaskRule,
  deleteIqdSqlPair,
  importIqdKnowledgeS07,
  listIqdDictSyncStatus,
  listIqdDimensions,
  listIqdKnowledge,
  listIqdMaskRules,
  listIqdSqlPairs,
  pushIqdEnhancements,
  saveIqdDimension,
  saveIqdKnowledge,
  saveIqdMaskRule,
  saveIqdSqlPair,
  syncIqdDimension,
  translateSqlPair,
  trialSqlPair,
  type IqdDictSyncStatus,
  type IqdKnowledge,
  type IqdMaskRule,
  type IqdScopeDimension,
  type IqdSqlPair,
  type IqdTrialResult,
} from '@/lib/api/iqd';
import { SyncStatusBar } from './components/SyncStatusBar';
import { SqlEditor } from './components/enhance/SqlEditor';
import {
  ENHANCE_TAB_VIEW_PERMISSIONS,
  S07_IMPORT_READY,
  canTriggerS07Import,
  classifyS07Import,
  resolveAllowedTab,
  s07ButtonTitle,
  type S07ImportOutcome,
} from './components/enhance/enhanceUtils';
import { ENHANCE_PERMISSIONS } from './components/enhance/enhanceUtils';
import { usePermission } from '@/hooks/use-permission';
import { summarizeRelatedItemKeys } from './components/shared/relatedItemKeys';
import { InstructionPanel } from './components/instruction/InstructionPanel';

type Tab = 'mask' | 'dimension' | 'sync' | 'sqlpair' | 'knowledge' | 'instruction';

const TAB_KEYS: Tab[] = ['mask', 'dimension', 'sync', 'sqlpair', 'knowledge', 'instruction'];

function parseTab(raw: string | null): Tab {
  if (raw && (TAB_KEYS as string[]).includes(raw)) return raw as Tab;
  return 'mask';
}

export const IQD_ENHANCE_PAGE_PATH = '/iqd/enhance';
export const IQD_ENHANCE_PAGE_TITLE = '知识与规则';

const RULE_LABEL: Record<string, string> = {
  phone: '手机号',
  idcard: '身份证',
  email: '邮箱',
  amount: '金额',
  full: '全遮蔽',
  custom: '自定义',
};

const MATCH_LABEL: Record<string, string> = {
  column_name: '列名',
  regex: '正则',
  semantic_tag: '语义标签',
};

const PREDICATE_LABEL: Record<string, string> = {
  PATH_PREFIX: '部门路径（PATH_PREFIX）',
  ENUM: '扁平枚举（ENUM）',
  FAIL_CLOSED: '失败关闭（FAIL_CLOSED）',
};

const KNOWLEDGE_KIND_LABEL: Record<string, string> = {
  term: '术语',
  metric_definition: '口径定义',
  synonym: '同义词',
};

const SYNC_LABEL: Record<string, string> = {
  pending: '待同步',
  synced: '已同步',
  failed: '失败',
};

const DIALECT_LABEL: Record<string, string> = {
  oracle: 'Oracle',
  mysql: 'MySQL',
  postgres: 'PostgreSQL',
  clickhouse: 'ClickHouse',
};

export function IqdEnhancePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasPermission } = usePermission();

  /**
   * 页面级权限闸门（开发清单第 4 项）。
   *
   * <p>本页 6 个 Tab 分属**不同权限码**（mask / dimension / scope / enhance），
   * 故不能用单一“页面码”一刀切：按 Tab 判定。无权的 Tab **不出现、也不发数据请求**（否则
   * 一个 Tab 缺码的 40300 会因 `Promise.all` 把整页拉黑）。
   */
  const canViewTab = useCallback(
    (t: Tab) => hasPermission(ENHANCE_TAB_VIEW_PERMISSIONS[t]),
    [hasPermission],
  );
  /** 请求的 Tab 无权 → 回退到第一个有权 Tab；全无权 → `null`（渲染拒绝态）。 */
  const allowedTab = useMemo(
    () => resolveAllowedTab(parseTab(searchParams.get('tab')), canViewTab),
    [searchParams, canViewTab],
  );
  const tab: Tab = allowedTab ?? 'mask';

  const canMaskSave = hasPermission(ENHANCE_PERMISSIONS.maskSave);
  const canDimensionSave = hasPermission(ENHANCE_PERMISSIONS.dimensionSave);
  const canScopeSync = hasPermission(ENHANCE_PERMISSIONS.scopeSync);
  const canPairSave = hasPermission(ENHANCE_PERMISSIONS.enhanceSave);
  const canKnowledgeSave = hasPermission(ENHANCE_PERMISSIONS.enhanceSave);
  const canKnowledgeSync = hasPermission(ENHANCE_PERMISSIONS.enhanceSync);

  const [instructionCount, setInstructionCount] = useState(0);
  const [maskRules, setMaskRules] = useState<IqdMaskRule[]>([]);
  const [dimensions, setDimensions] = useState<IqdScopeDimension[]>([]);
  const [syncStatus, setSyncStatus] = useState<IqdDictSyncStatus[]>([]);
  const [sqlPairs, setSqlPairs] = useState<IqdSqlPair[]>([]);
  const [knowledge, setKnowledge] = useState<IqdKnowledge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 脱敏规则草稿
  const [maskName, setMaskName] = useState('');
  const [maskMatch, setMaskMatch] = useState('column_name');
  const [maskPattern, setMaskPattern] = useState('');
  const [maskRule, setMaskRule] = useState('full');
  const [maskReplacement, setMaskReplacement] = useState('');

  // 维度草稿
  const [dimCode, setDimCode] = useState('');
  const [dimName, setDimName] = useState('');
  const [dimPredicate, setDimPredicate] = useState('PATH_PREFIX');
  const [dimColumn, setDimColumn] = useState('');
  const [dimHeader, setDimHeader] = useState('');
  const [dimDictTable, setDimDictTable] = useState('');

  // 样本对查询条件与弹窗状态（W4 / v1.10 方言转化 + 试运行）
  const [pairKeyword, setPairKeyword] = useState('');
  const [pairDialectFilter, setPairDialectFilter] = useState('all');
  const [pairDialogOpen, setPairDialogOpen] = useState(false);
  const [pairEditing, setPairEditing] = useState<IqdSqlPair | null>(null);

  // 知识/术语查询条件与弹窗状态（W4；**与样本对同构**：筛选栏 + 表格 + 编辑弹窗）
  const [kbKeyword, setKbKeyword] = useState('');
  const [kbKindFilter, setKbKindFilter] = useState('all');
  const [kbDialogOpen, setKbDialogOpen] = useState(false);
  const [kbEditing, setKbEditing] = useState<IqdKnowledge | null>(null);

  // S-07 导入（T04e ③：能力位点 + 结果状态化；A6 未就绪 → 按钮置灰）
  const [s07Importing, setS07Importing] = useState(false);
  const [s07Outcome, setS07Outcome] = useState<S07ImportOutcome | null>(null);

  // 项目（= wren context）统一取自共享 store（与其他问数页一致）
  const connectionId = useActiveProjectId();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 按权限只拉有权 Tab 的数据：无权的 Tab 压根不发请求，
      // 避免一个 40300 因 Promise.all 把整页拉黑。
      const wantMask = hasPermission(ENHANCE_TAB_VIEW_PERMISSIONS.mask);
      const wantDimension = hasPermission(ENHANCE_TAB_VIEW_PERMISSIONS.dimension);
      const wantSync = hasPermission(ENHANCE_TAB_VIEW_PERMISSIONS.sync);
      const [m, d, st] = await Promise.all([
        wantMask ? listIqdMaskRules() : Promise.resolve([] as IqdMaskRule[]),
        wantDimension ? listIqdDimensions() : Promise.resolve([] as IqdScopeDimension[]),
        wantSync ? listIqdDictSyncStatus() : Promise.resolve([] as IqdDictSyncStatus[]),
      ]);
      setMaskRules(m);
      setDimensions(d);
      setSyncStatus(st);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [hasPermission]);

  useEffect(() => {
    void load();
  }, [load]);

  // 增强物料 Tab 懒加载：直接用当前项目（store）
  const ensureConnection = useCallback(async (): Promise<number | null> => {
    if (connectionId == null) {
      setError('请先选择项目');
      return null;
    }
    return connectionId;
  }, [connectionId]);

  const loadEnhance = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cid = await ensureConnection();
      if (cid == null) {
        setLoading(false);
        return;
      }
      const [pairs, knowledgeItems] = await Promise.all([
        listIqdSqlPairs(cid),
        listIqdKnowledge(cid),
      ]);
      setSqlPairs(pairs);
      setKnowledge(knowledgeItems);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载增强物料失败');
    } finally {
      setLoading(false);
    }
  }, [ensureConnection]);

  const switchTab = useCallback(
    (next: Tab) => {
      // 无权的 Tab 不可切换（Tab 按钮本已不渲染；此处为 URL 直达的兜底）。
      if (!canViewTab(next)) {
        return;
      }
      setSearchParams(
        (prev) => {
          const nextParams = new URLSearchParams(prev);
          if (next === 'mask') nextParams.delete('tab');
          else nextParams.set('tab', next);
          return nextParams;
        },
        { replace: true },
      );
      if (
        (next === 'sqlpair' || next === 'knowledge') &&
        sqlPairs.length === 0 &&
        knowledge.length === 0
      ) {
        void loadEnhance();
      }
    },
    [canViewTab, knowledge.length, loadEnhance, setSearchParams, sqlPairs.length],
  );

  const onInstructionCountChange = useCallback((count: number) => {
    setInstructionCount(count);
  }, []);

  const saveMask = useCallback(async () => {
    if (!maskName.trim() || !maskPattern.trim()) {
      setError('规则名与匹配模式不能为空');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveIqdMaskRule({
        name: maskName.trim(),
        match_type: maskMatch,
        pattern: maskPattern,
        rule: maskRule,
        replacement:
          maskRule === 'custom' && maskReplacement.trim() ? maskReplacement.trim() : null,
        priority: 0,
        enabled: true,
      });
      setMaskName('');
      setMaskPattern('');
      setMaskReplacement('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存脱敏规则失败');
    } finally {
      setSaving(false);
    }
  }, [maskName, maskMatch, maskPattern, maskRule, maskReplacement, load]);

  const removeMask = useCallback(
    async (id: number | undefined) => {
      if (id == null) return;
      setError(null);
      try {
        await deleteIqdMaskRule(id);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : '删除脱敏规则失败');
      }
    },
    [load],
  );

  const saveDimension = useCallback(async () => {
    if (!dimCode.trim()) {
      setError('维度码不能为空');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveIqdDimension({
        dimension_code: dimCode.trim(),
        dimension_name: dimName.trim() || dimCode.trim(),
        predicate_type: dimPredicate,
        column_name: dimColumn.trim() || `${dimCode.trim()}_id`,
        header_name: dimHeader.trim() || `X-Mis-${dimCode.trim()}`,
        dict_table: dimDictTable.trim() || undefined,
        auto_mode: true,
        enabled: true,
        sort: 0,
      });
      setDimCode('');
      setDimName('');
      setDimColumn('');
      setDimHeader('');
      setDimDictTable('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存维度失败');
    } finally {
      setSaving(false);
    }
  }, [dimCode, dimName, dimPredicate, dimColumn, dimHeader, dimDictTable, load]);

  const removeDimension = useCallback(
    async (id: number | undefined) => {
      if (id == null) return;
      setError(null);
      try {
        await deleteIqdDimension(id);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : '删除维度失败');
      }
    },
    [load],
  );

  const runSync = useCallback(
    async (dimensionCode: string) => {
      setError(null);
      try {
        await syncIqdDimension(dimensionCode);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : '字典同步失败');
      }
    },
    [load],
  );

  // ================= W4 样本对（Dialog 驱动）/ 知识 =================

  // 样本对编辑弹窗：新增/编辑共用；转化、试运行、保存均由弹窗内部完成。
  const openPairDialog = useCallback((row: IqdSqlPair | null) => {
    setPairEditing(row);
    setPairDialogOpen(true);
  }, []);

  const closePairDialog = useCallback(() => {
    setPairDialogOpen(false);
    setPairEditing(null);
  }, []);

  const handlePairSaved = useCallback(async () => {
    await loadEnhance();
    setPairDialogOpen(false);
    setPairEditing(null);
  }, [loadEnhance]);

  // 客户端过滤：按问题关键词（模糊）+ 方言
  const filteredPairs = useMemo(() => {
    const kw = pairKeyword.trim().toLowerCase();
    return sqlPairs.filter((p) => {
      const matchKw = kw === '' || (p.question ?? '').toLowerCase().includes(kw);
      const matchDialect =
        pairDialectFilter === 'all' || (p.source_dialect ?? '') === pairDialectFilter;
      return matchKw && matchDialect;
    });
  }, [pairDialectFilter, pairKeyword, sqlPairs]);

  const removePair = useCallback(
    async (id: number | undefined) => {
      if (id == null) return;
      setError(null);
      try {
        await deleteIqdSqlPair(id);
        await loadEnhance();
      } catch (e) {
        setError(e instanceof Error ? e.message : '删除样本对失败');
      }
    },
    [loadEnhance],
  );

  // 知识/术语编辑弹窗：新增/编辑共用（保存、启用态与关联清单的保留都在弹窗内完成）
  const openKnowledgeDialog = useCallback((row: IqdKnowledge | null) => {
    setKbEditing(row);
    setKbDialogOpen(true);
  }, []);

  const closeKnowledgeDialog = useCallback(() => {
    setKbDialogOpen(false);
    setKbEditing(null);
  }, []);

  const handleKnowledgeSaved = useCallback(async () => {
    await loadEnhance();
    setKbDialogOpen(false);
    setKbEditing(null);
  }, [loadEnhance]);

  /** 客户端过滤：标题/内容关键词（模糊）+ 知识类型（与样本对同构）。 */
  const filteredKnowledge = useMemo(() => {
    const kw = kbKeyword.trim().toLowerCase();
    return knowledge.filter((k) => {
      const haystack = `${k.title ?? ''}\n${k.content ?? ''}`.toLowerCase();
      const matchKw = kw === '' || haystack.includes(kw);
      const matchKind = kbKindFilter === 'all' || k.kind === kbKindFilter;
      return matchKw && matchKind;
    });
  }, [kbKindFilter, kbKeyword, knowledge]);

  const removeKnowledgeItem = useCallback(
    async (id: number | undefined) => {
      if (id == null) return;
      setError(null);
      try {
        await deleteIqdKnowledge(id);
        await loadEnhance();
      } catch (e) {
        setError(e instanceof Error ? e.message : '删除知识失败');
      }
    },
    [loadEnhance],
  );

  const importS07 = useCallback(async () => {
    const cid = await ensureConnection();
    if (cid == null) return;
    setError(null);
    setS07Importing(true);
    try {
      const result = await importIqdKnowledgeS07(cid);
      // 状态化：**不把「未就绪空导入」显示成成功**（后端骨架会回 message 含「未就绪」）
      setS07Outcome(classifyS07Import(result, null));
      await loadEnhance();
    } catch (e) {
      setS07Outcome(classifyS07Import(null, e instanceof Error ? e.message : 'S-07 导入失败'));
    } finally {
      setS07Importing(false);
    }
  }, [ensureConnection, loadEnhance]);

  const pushEnhance = useCallback(async () => {
    const cid = await ensureConnection();
    if (cid == null) return;
    setError(null);
    try {
      const result = await pushIqdEnhancements(cid);
      const pairCount = Number(result.sql_pair_count ?? 0);
      const kbCount = Number(result.knowledge_count ?? 0);
      setError(
        `待推送物料：样本对 ${pairCount} 条、知识 ${kbCount} 条（Worker 经 context build 同步）`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '增强推送失败');
    }
  }, [ensureConnection]);

  // 无权的 Tab 不渲染（页面级闸门；避免点进去才 40300）。
  const allTabs: Array<{ key: Tab; label: string }> = [
    { key: 'mask', label: `脱敏规则（${maskRules.length}）` },
    { key: 'dimension', label: `行级维度（${dimensions.length}）` },
    { key: 'sync', label: '字典同步' },
    { key: 'sqlpair', label: `样本对（${sqlPairs.length}）` },
    { key: 'knowledge', label: `知识/术语（${knowledge.length}）` },
    { key: 'instruction', label: `指令（${instructionCount}）` },
  ];
  const tabs = allTabs.filter((t) => canViewTab(t.key));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={IQD_ENHANCE_PAGE_TITLE}
        description="脱敏规则、行级维度、样本对、知识术语与问数指令；保存后可同步至 WrenAI。"
        breadcrumbs={buildAppBreadcrumbs({ app: 'agent', title: IQD_ENHANCE_PAGE_TITLE })}
        actions={
          <div className="flex items-center gap-2">
            <ProjectSwitcher />
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              刷新
            </Button>
          </div>
        }
      />

      <SyncStatusBar connectionId={connectionId} />

      {allowedTab === null ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-[13px] text-muted-foreground">
          当前账号无「知识与规则」任一子页的查看权限 （iqd:mask:view / iqd:dimension:view /
          iqd:scope:view / iqd:enhance:view）。
        </div>
      ) : (
        <>
          <div className="mb-3 flex gap-1 border-b">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                className={cn(
                  'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                  tab === t.key
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
                onClick={() => switchTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {error ? (
            <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              {error}
            </div>
          ) : null}

          <div
            className={cn(
              'min-h-0 flex-1',
              tab === 'instruction' ? 'flex flex-col overflow-hidden' : 'overflow-auto',
            )}
          >
            {/* ================= 脱敏规则 ================= */}
            {tab === 'mask' ? (
              <div className="space-y-3">
                <div className="rounded-md border border-primary/25 bg-primary/5 p-3 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">全局生效（不随项目切换）</span>
                  ：脱敏规则是全平台唯一规则源，对所有项目的问数结果统一生效；切换上方「项目」不会改变这里的规则。
                  优先级：字段显式 <code>mask_rule</code> &gt; <code>sensitive_level=high</code> 按类型推断 &gt; 本表规则匹配。
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <div className="mb-2 text-sm font-medium">新增脱敏规则</div>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
                    <Input
                      placeholder="规则名（如 phone）"
                      value={maskName}
                      onChange={(e) => setMaskName(e.target.value)}
                    />
                    <select
                      className="h-9 rounded-md border border-input bg-card px-[0.7rem] text-sm"
                      value={maskMatch}
                      onChange={(e) => setMaskMatch(e.target.value)}
                    >
                      {Object.entries(MATCH_LABEL).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                    <Input
                      placeholder="匹配 pattern（列名 / 正则）"
                      value={maskPattern}
                      onChange={(e) => setMaskPattern(e.target.value)}
                    />
                    <select
                      className="h-9 rounded-md border border-input bg-card px-[0.7rem] text-sm"
                      value={maskRule}
                      onChange={(e) => setMaskRule(e.target.value)}
                    >
                      {Object.entries(RULE_LABEL).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-2">
                      {maskRule === 'custom' ? (
                        <Input
                          placeholder="替换值"
                          value={maskReplacement}
                          onChange={(e) => setMaskReplacement(e.target.value)}
                        />
                      ) : null}
                      <Button
                        size="sm"
                        onClick={() => void saveMask()}
                        disabled={saving || !canMaskSave}
                      >
                        <Save className="h-4 w-4" />
                        保存
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border bg-card">
                  <table className="w-full border-separate border-spacing-0 bg-table-surface text-left text-sm">
                    <thead className="border-b-2 border-foreground/20 bg-table-header text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-bold">名称</th>
                        <th className="px-3 py-2 font-bold">匹配方式</th>
                        <th className="px-3 py-2 font-bold">pattern</th>
                        <th className="px-3 py-2 font-bold">规则</th>
                        <th className="px-3 py-2 font-bold">优先级</th>
                        <th className="px-3 py-2 font-bold">启用</th>
                        <th className="w-14 px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {maskRules.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                            暂无脱敏规则
                          </td>
                        </tr>
                      ) : (
                        maskRules.map((r) => (
                          <tr
                            key={r.name}
                            className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe"
                          >
                            <td className="px-3 py-2 font-mono text-xs">{r.name}</td>
                            <td className="px-3 py-2 text-xs">
                              {MATCH_LABEL[r.match_type] ?? r.match_type}
                            </td>
                            <td className="max-w-[18rem] truncate px-3 py-2 font-mono text-xs">
                              {r.pattern}
                            </td>
                            <td className="px-3 py-2 text-xs">{RULE_LABEL[r.rule] ?? r.rule}</td>
                            <td className="px-3 py-2 text-xs">{r.priority ?? 0}</td>
                            <td className="px-3 py-2 text-xs">
                              {r.enabled ? (
                                <span className="text-success">启用</span>
                              ) : (
                                <span className="text-muted-foreground">停用</span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                onClick={() => void removeMask(r.id)}
                                disabled={!canMaskSave}
                                title={canMaskSave ? '删除' : '需 iqd:mask:save'}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {/* ================= 维度注册表 ================= */}
            {tab === 'dimension' ? (
              <div className="space-y-3">
                <div className="rounded-md border border-primary/25 bg-primary/5 p-3 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">全局注册表（不随项目切换）</span>
                  ：行级维度是平台级定义（dept / store 等），对本页所有项目通用；切换上方「项目」不影响这里。
                  其字典同步会扇出到<b>所有启用「字典同步」的数据源</b>（见「字典同步」Tab），
                  <code>dict_table</code> 为空表示复用主数据、无需同步。
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <div className="mb-2 text-sm font-medium">新增维度</div>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
                    <Input
                      placeholder="维度码（dept）"
                      value={dimCode}
                      onChange={(e) => setDimCode(e.target.value)}
                    />
                    <Input
                      placeholder="维度名（部门）"
                      value={dimName}
                      onChange={(e) => setDimName(e.target.value)}
                    />
                    <select
                      className="h-9 rounded-md border border-input bg-card px-[0.7rem] text-sm"
                      value={dimPredicate}
                      onChange={(e) => setDimPredicate(e.target.value)}
                    >
                      <option value="PATH_PREFIX">PATH_PREFIX</option>
                      <option value="ENUM">ENUM</option>
                    </select>
                    <Input
                      placeholder="条件列（dept_id）"
                      value={dimColumn}
                      onChange={(e) => setDimColumn(e.target.value)}
                    />
                    <Input
                      placeholder="请求头（X-Mis-Dept-Scope）"
                      value={dimHeader}
                      onChange={(e) => setDimHeader(e.target.value)}
                    />
                    <Input
                      placeholder="字典表（mis_dept_scope）"
                      value={dimDictTable}
                      onChange={(e) => setDimDictTable(e.target.value)}
                    />
                  </div>
                  <div className="mt-2">
                    <Button
                      size="sm"
                      onClick={() => void saveDimension()}
                      disabled={saving || !canDimensionSave}
                    >
                      <Plus className="h-4 w-4" />
                      新增维度
                    </Button>
                  </div>
                </div>

                <div className="rounded-lg border bg-card">
                  <table className="w-full border-separate border-spacing-0 bg-table-surface text-left text-sm">
                    <thead className="border-b-2 border-foreground/20 bg-table-header text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-bold">维度码</th>
                        <th className="px-3 py-2 font-bold">维度名</th>
                        <th className="px-3 py-2 font-bold">策略</th>
                        <th className="px-3 py-2 font-bold">条件列</th>
                        <th className="px-3 py-2 font-bold">请求头</th>
                        <th className="px-3 py-2 font-bold">字典表</th>
                        <th className="px-3 py-2 font-bold">启用</th>
                        <th className="w-14 px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {dimensions.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                            暂无维度（内置 dept/store 种子见 V71）
                          </td>
                        </tr>
                      ) : (
                        dimensions.map((d) => (
                          <tr
                            key={d.dimension_code}
                            className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe"
                          >
                            <td className="px-3 py-2 font-mono text-xs">{d.dimension_code}</td>
                            <td className="px-3 py-2 text-xs">{d.dimension_name}</td>
                            <td className="px-3 py-2 text-xs">
                              {PREDICATE_LABEL[d.predicate_type] ?? d.predicate_type}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">{d.column_name}</td>
                            <td className="px-3 py-2 font-mono text-xs">{d.header_name}</td>
                            <td className="px-3 py-2 font-mono text-xs">{d.dict_table ?? '—'}</td>
                            <td className="px-3 py-2 text-xs">
                              {d.enabled ? (
                                <span className="text-success">启用</span>
                              ) : (
                                <span className="text-muted-foreground">停用</span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                onClick={() => void removeDimension(d.id)}
                                disabled={!canDimensionSave}
                                title={canDimensionSave ? '删除' : '需 iqd:dimension:save'}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {/* ================= 字典同步 ================= */}
            {tab === 'sync' ? (
              <div className="space-y-3">
                <div className="rounded-md border border-info/30 bg-info/5 p-3 text-xs text-muted-foreground">
                  <p className="leading-relaxed">
                    中心每日 03:30 全量同步（IqdScopeSyncJobService）。此处可手动触发单维度同步；
                    同步完成后发变更事件，Worker 缓存按桶失效。同步失败该连接行级降级
                    ENUM/FAIL_CLOSED（45204，不静默放行）。
                  </p>
                </div>
                <div className="rounded-lg border bg-card">
                  <table className="w-full border-separate border-spacing-0 bg-table-surface text-left text-sm">
                    <thead className="border-b-2 border-foreground/20 bg-table-header text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-bold">维度</th>
                        <th className="px-3 py-2 font-bold">状态</th>
                        <th className="px-3 py-2 font-bold">消息</th>
                        <th className="px-3 py-2 font-bold">更新时间</th>
                        <th className="w-28 px-3 py-2 font-bold">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {syncStatus.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                            暂无同步记录（维度字典复用主数据或尚未同步）
                          </td>
                        </tr>
                      ) : (
                        syncStatus.map((s) => (
                          <tr
                            key={s.dimension}
                            className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe"
                          >
                            <td className="px-3 py-2 font-mono text-xs">{s.dimension}</td>
                            <td className="px-3 py-2 text-xs">
                              <Badge
                                variant={
                                  s.status === 'ok'
                                    ? 'default'
                                    : s.status === 'partial'
                                      ? 'secondary'
                                      : 'destructive'
                                }
                              >
                                {s.status}
                              </Badge>
                            </td>
                            <td
                              className="max-w-[24rem] truncate px-3 py-2 text-xs text-muted-foreground"
                              title={s.message}
                            >
                              {s.message ?? '—'}
                            </td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">
                              {s.updated_at ?? '—'}
                            </td>
                            <td className="px-3 py-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void runSync(s.dimension)}
                                disabled={!canScopeSync}
                                title={canScopeSync ? undefined : '需 iqd:scope:sync'}
                              >
                                触发同步
                              </Button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {syncStatus.length === 0 ? (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void runSync('dept')}
                      disabled={!canScopeSync}
                      title={canScopeSync ? undefined : '需 iqd:scope:sync'}
                    >
                      触发 dept 同步
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void runSync('store')}
                      disabled={!canScopeSync}
                      title={canScopeSync ? undefined : '需 iqd:scope:sync'}
                    >
                      触发 store 同步
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* ================= 样本对（W4）================= */}
            {tab === 'sqlpair' ? (
              <div className="space-y-3">
                {/* 查询条件 */}
                <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
                  <Input
                    className="h-9 w-full sm:w-64"
                    placeholder="按问题关键词过滤"
                    value={pairKeyword}
                    onChange={(e) => setPairKeyword(e.target.value)}
                  />
                  <select
                    className="h-9 rounded-md border border-input bg-card px-2.5 text-sm"
                    value={pairDialectFilter}
                    onChange={(e) => setPairDialectFilter(e.target.value)}
                    aria-label="方言筛选"
                  >
                    <option value="all">全部方言</option>
                    <option value="oracle">Oracle</option>
                    <option value="mysql">MySQL</option>
                    <option value="postgres">PostgreSQL</option>
                    <option value="clickhouse">ClickHouse</option>
                  </select>
                  <Button size="sm" onClick={() => openPairDialog(null)} disabled={saving}>
                    <Plus className="h-4 w-4" />
                    新增
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void loadEnhance()}
                    disabled={loading}
                  >
                    <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                    刷新
                  </Button>
                </div>

                {/* 查询结果 */}
                <div className="rounded-lg border bg-card">
                  <table className="w-full border-separate border-spacing-0 bg-table-surface text-left text-sm">
                    <thead className="border-b-2 border-foreground/20 bg-table-header text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-bold">问题</th>
                        <th className="px-3 py-2 font-bold">方言</th>
                        <th className="px-3 py-2 font-bold">SQL</th>
                        <th className="px-3 py-2 font-bold">状态</th>
                        <th className="px-3 py-2 font-bold">Wren ref</th>
                        <th className="w-[7rem] px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPairs.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                            暂无样本对
                          </td>
                        </tr>
                      ) : (
                        filteredPairs.map((p) => (
                          <tr
                            key={p.id}
                            className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe"
                          >
                            <td
                              className="max-w-[14rem] truncate px-3 py-2 text-xs"
                              title={p.question}
                            >
                              {p.question}
                            </td>
                            <td className="px-3 py-2 text-xs">
                              {DIALECT_LABEL[p.source_dialect ?? ''] ?? p.source_dialect}
                            </td>
                            <td
                              className="max-w-[24rem] truncate px-3 py-2 font-mono text-xs"
                              title={p.wren_sql}
                            >
                              {p.wren_sql}
                            </td>
                            <td className="px-3 py-2 text-xs">
                              <Badge
                                variant={
                                  p.sync_status === 'synced'
                                    ? 'default'
                                    : p.sync_status === 'failed'
                                      ? 'destructive'
                                      : 'secondary'
                                }
                              >
                                {SYNC_LABEL[p.sync_status ?? ''] ?? p.sync_status}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">{p.wren_ref_id ?? '—'}</td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8"
                                  onClick={() => openPairDialog(p)}
                                  disabled={!canPairSave}
                                >
                                  编辑
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                  onClick={() => void removePair(p.id)}
                                  disabled={!canPairSave}
                                  title={canPairSave ? '删除' : '需 iqd:enhance:save'}
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

                <IqdSqlPairDialog
                  open={pairDialogOpen}
                  initial={pairEditing}
                  onClose={closePairDialog}
                  onSaved={handlePairSaved}
                  ensureConnection={ensureConnection}
                />
              </div>
            ) : null}

            {/* ================= 知识/术语（W4；布局对齐样本对：筛选栏 + 表格 + 弹窗）================= */}
            {tab === 'knowledge' ? (
              <div className="space-y-3">
                {/* 查询条件 + 动作（**布局与样本对 Tab 一致**；新增/编辑走右侧弹窗） */}
                <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
                  <Input
                    className="h-9 w-full sm:w-64"
                    placeholder="按标题/内容关键词过滤"
                    value={kbKeyword}
                    onChange={(e) => setKbKeyword(e.target.value)}
                  />
                  <select
                    className="h-9 rounded-md border border-input bg-card px-2.5 text-sm"
                    value={kbKindFilter}
                    onChange={(e) => setKbKindFilter(e.target.value)}
                    aria-label="知识类型筛选"
                  >
                    <option value="all">全部类型</option>
                    {Object.entries(KNOWLEDGE_KIND_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    onClick={() => openKnowledgeDialog(null)}
                    disabled={saving || !canKnowledgeSave}
                  >
                    <Plus className="h-4 w-4" />
                    新增
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void loadEnhance()}
                    disabled={loading}
                  >
                    <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                    刷新
                  </Button>
                  {/* S-07 术语导入（T04e ③）：A6 未就绪 → 置灰 + tooltip（**诚实显示不可用**，不假装可用） */}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={() => void importS07()}
                    disabled={
                      !canKnowledgeSave || !canTriggerS07Import(S07_IMPORT_READY, s07Importing)
                    }
                    title={s07ButtonTitle(S07_IMPORT_READY)}
                  >
                    <Upload className="h-3.5 w-3.5" />
                    S-07 术语导入
                  </Button>
                  {!S07_IMPORT_READY ? (
                    <span className="text-[11px] text-muted-foreground">
                      S-07 未就绪（架构 A6 待确认）：当前仅支持本地录入
                    </span>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={() => void pushEnhance()}
                    disabled={!canKnowledgeSync}
                    title={canKnowledgeSync ? undefined : '需 iqd:enhance:sync'}
                  >
                    <Send className="h-3.5 w-3.5" />
                    增强推送
                  </Button>
                </div>

                {s07Outcome && s07Outcome.label ? (
                  <p
                    className={cn(
                      'text-[12px]',
                      s07Outcome.state === 'failed'
                        ? 'text-destructive'
                        : s07Outcome.state === 'imported'
                          ? 'text-success'
                          : 'text-muted-foreground',
                    )}
                  >
                    {s07Outcome.label}
                  </p>
                ) : null}

                <div className="rounded-lg border bg-card">
                  <table className="w-full border-separate border-spacing-0 bg-table-surface text-left text-sm">
                    <thead className="border-b-2 border-foreground/20 bg-table-header text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-bold">类型</th>
                        <th className="px-3 py-2 font-bold">标题</th>
                        <th className="px-3 py-2 font-bold">内容</th>
                        <th className="px-3 py-2 font-bold">关联对象</th>
                        <th className="px-3 py-2 font-bold">来源</th>
                        <th className="px-3 py-2 font-bold">状态</th>
                        <th className="w-[7rem] px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredKnowledge.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                            {knowledge.length === 0 ? '暂无知识条目' : '没有匹配的知识条目'}
                          </td>
                        </tr>
                      ) : (
                        filteredKnowledge.map((k) => {
                          const related = summarizeRelatedItemKeys(k.related_item_keys);
                          return (
                            <tr
                              key={k.id}
                              className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe"
                            >
                              <td className="px-3 py-2 text-xs">
                                {KNOWLEDGE_KIND_LABEL[k.kind] ?? k.kind}
                              </td>
                              <td
                                className="max-w-[14rem] truncate px-3 py-2 text-xs"
                                title={k.title}
                              >
                                {k.title}
                              </td>
                              <td
                                className="max-w-[24rem] truncate px-3 py-2 text-xs text-muted-foreground"
                                title={k.content ?? ''}
                              >
                                {k.content ?? '—'}
                              </td>
                              {/* 关联对象（T04e ②/MR-09）：wire 为 JSON 字符串数组；空 = 全连接通用 */}
                              <td className="px-3 py-2 text-xs" title={related.keys.join('、')}>
                                {related.isGlobal ? (
                                  <span className="text-muted-foreground">全连接通用</span>
                                ) : (
                                  <span className="font-mono">{related.count} 项</span>
                                )}
                              </td>
                              <td className="px-3 py-2 font-mono text-xs">{k.source ?? 'local'}</td>
                              <td className="px-3 py-2 text-xs">
                                <div className="flex items-center gap-1">
                                  <Badge
                                    variant={
                                      k.sync_status === 'synced'
                                        ? 'default'
                                        : k.sync_status === 'failed'
                                          ? 'destructive'
                                          : 'secondary'
                                    }
                                  >
                                    {SYNC_LABEL[k.sync_status ?? ''] ?? k.sync_status}
                                  </Badge>
                                  {/* 启用态可在弹窗里改；停用条目在列表里要看得见（否则改完没反馈） */}
                                  {k.enabled === false ? (
                                    <Badge variant="outline">已停用</Badge>
                                  ) : null}
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-1">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8"
                                    onClick={() => openKnowledgeDialog(k)}
                                    disabled={!canKnowledgeSave}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                    编辑
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                    onClick={() => void removeKnowledgeItem(k.id)}
                                    disabled={!canKnowledgeSave}
                                    title={canKnowledgeSave ? '删除' : '需 iqd:enhance:save'}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                <IqdKnowledgeDialog
                  open={kbDialogOpen}
                  initial={kbEditing}
                  onClose={closeKnowledgeDialog}
                  onSaved={handleKnowledgeSaved}
                  ensureConnection={ensureConnection}
                />
              </div>
            ) : null}

            {/* ================= 指令（原独立页并入）================= */}
            {tab === 'instruction' ? (
              <InstructionPanel onCountChange={onInstructionCountChange} />
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

// ================= 样本对编辑弹窗（新增 / 编辑 / 转化 / 试运行）=================

interface IqdSqlPairDialogProps {
  open: boolean;
  initial: IqdSqlPair | null;
  onClose: () => void;
  onSaved: () => void;
  ensureConnection: () => Promise<number | null>;
}

function IqdSqlPairDialog({
  open,
  initial,
  onClose,
  onSaved,
  ensureConnection,
}: IqdSqlPairDialogProps) {
  const { hasPermission } = usePermission();
  // 转化与试运行用 iqd:enhance:manage（V78:92586/92587），与保存用的
  // iqd:enhance:save 不同（曾因未闸门而“前端放行、后端 40300”）。
  const canManage = hasPermission(ENHANCE_PERMISSIONS.enhanceManage);
  const canSave = hasPermission(ENHANCE_PERMISSIONS.enhanceSave);
  const [question, setQuestion] = useState('');
  const [sourceDialect, setSourceDialect] = useState('oracle');
  const [nativeSql, setNativeSql] = useState('');
  const [wrenSql, setWrenSql] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [trialResult, setTrialResult] = useState<IqdTrialResult | null>(null);
  const [remark, setRemark] = useState('');
  const [translating, setTranslating] = useState(false);
  const [trialing, setTrialing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 打开时按 initial 预填（编辑为行数据，新增为 null）
  useEffect(() => {
    if (!open) return;
    setQuestion(initial?.question ?? '');
    setSourceDialect(initial?.source_dialect ?? 'oracle');
    setNativeSql(initial?.native_sql ?? '');
    setWrenSql(initial?.wren_sql ?? '');
    setWarnings([]);
    setTrialResult(null);
    setRemark(initial?.remark ?? '');
    setError(null);
  }, [open, initial]);

  // v1.10 方言转化：调 BFF 翻译回填可编辑 wren_sql
  const translate = useCallback(async () => {
    if (!nativeSql.trim()) {
      setError('请先输入原生 SQL');
      return;
    }
    setTranslating(true);
    setError(null);
    setWarnings([]);
    try {
      const res = await translateSqlPair({ db_type: sourceDialect, native_sql: nativeSql });
      setWrenSql(res.wren_sql || '');
      setWarnings(res.warnings || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '样本对翻译失败');
    } finally {
      setTranslating(false);
    }
  }, [nativeSql, sourceDialect]);

  // v1.10 试运行：调 BFF 在 WrenAI 引擎侧执行转化后的 wren_sql
  const trial = useCallback(async () => {
    if (!wrenSql.trim()) {
      setError('请先转化或手填 wren_sql');
      return;
    }
    setTrialing(true);
    setError(null);
    try {
      const res = await trialSqlPair({ wren_sql: wrenSql });
      setTrialResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : '样本对试运行失败');
    } finally {
      setTrialing(false);
    }
  }, [wrenSql]);

  const save = useCallback(async () => {
    if (!question.trim() || !nativeSql.trim() || !wrenSql.trim()) {
      setError('问题、原生 SQL 与转化后 wren_sql 均不能为空');
      return;
    }
    const cid = await ensureConnection();
    if (cid == null) return;
    setSaving(true);
    setError(null);
    try {
      await saveIqdSqlPair({
        id: initial?.id ?? null,
        connection_id: cid,
        question: question.trim(),
        source_dialect: sourceDialect,
        native_sql: nativeSql,
        wren_sql: wrenSql.trim(),
        remark: remark.trim() || null,
        enabled: true,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存样本对失败');
    } finally {
      setSaving(false);
    }
  }, [ensureConnection, initial, onSaved, question, remark, sourceDialect, nativeSql, wrenSql]);

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent className="flex max-h-[90vh] w-full max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="mx-0 mt-0 rounded-none border-b border-border/60 bg-[hsl(var(--dialog-header-bg))] px-4 py-3 pr-10">
          <DialogTitle className="text-[14px]">
            {initial?.id != null ? '编辑样本对' : '新增样本对'}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">问题</span>
            <Input
              placeholder="问题（如：本月各渠道销售额？）"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">关系库类型</span>
            <Select value={sourceDialect} onValueChange={setSourceDialect}>
              <SelectTrigger>
                <SelectValue placeholder="选择关系库类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="oracle">Oracle</SelectItem>
                <SelectItem value="mysql">MySQL</SelectItem>
                <SelectItem value="postgres">PostgreSQL</SelectItem>
                <SelectItem value="clickhouse">ClickHouse</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">原生 SQL（支持多行）</span>
            {/* T04e MR-08：SQL 框升级 CodeMirror 6（懒加载 + 高亮；不可用时自动降级 Textarea） */}
            <SqlEditor
              value={nativeSql}
              onChange={(next) => setNativeSql(next)}
              placeholder="原生 SQL（源方言，如 Oracle/MySQL 写法；可多行）"
              height={240}
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void translate()}
                disabled={translating || !canManage || !nativeSql.trim()}
                title={canManage ? undefined : '需 iqd:enhance:manage'}
              >
                <Send className="h-4 w-4" />
                {translating ? '转化中…' : '转化'}
              </Button>
              {warnings.length > 0 ? (
                <span className="text-xs text-amber-600">
                  翻译存在 {warnings.length} 条告警，请检查或手改 wren_sql
                </span>
              ) : null}
            </div>
            {warnings.length > 0 ? (
              <ul className="list-disc space-y-1 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              转化结果（wren_sql，可编辑，支持多行）
            </span>
            {/* T04e MR-08：同上，CodeMirror 6（不可用时自动降级 Textarea） */}
            <SqlEditor
              value={wrenSql}
              onChange={(next) => setWrenSql(next)}
              placeholder="点「转化」后回填，或直接手写 WrenAI 方言 SQL（可多行）"
              height={240}
            />
            <Button
              size="sm"
              variant="secondary"
              className="w-fit"
              onClick={() => void trial()}
              disabled={trialing || !canManage || !wrenSql.trim()}
              title={canManage ? undefined : '需 iqd:enhance:manage'}
            >
              <Send className="h-4 w-4" />
              {trialing ? '试运行中…' : '试运行'}
            </Button>
            {trialResult ? (
              <div className="rounded-md border border-border bg-card p-2 text-xs">
                {trialResult.error ? (
                  <div className="mb-1 text-destructive">执行错误：{trialResult.error}</div>
                ) : (
                  <div className="mb-1 text-emerald-600">执行成功</div>
                )}
                <div className="text-muted-foreground">
                  列：{(trialResult.columns || []).length} ｜ 行：
                  {(trialResult.rows || []).length} ｜ 耗时：{trialResult.duration_ms} ms
                </div>
                {trialResult.columns && trialResult.columns.length > 0 ? (
                  <div className="mt-1 font-mono">
                    [
                    {trialResult.columns
                      .map((c) =>
                        typeof c === 'object' && c !== null
                          ? String((c as { name?: string }).name ?? JSON.stringify(c))
                          : String(c),
                      )
                      .join(', ')}
                    ]
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">备注</span>
            <Input
              placeholder="备注（可空）"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
            />
          </div>

          {error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter className="mx-0 mb-0 rounded-none border-t border-border/60 px-4 py-3">
          <Button size="sm" variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={saving || !canSave}>
            <Save className="h-4 w-4" />
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================= 知识/术语编辑弹窗（新增 / 编辑）=================

interface IqdKnowledgeDialogProps {
  open: boolean;
  initial: IqdKnowledge | null;
  onClose: () => void;
  onSaved: () => void;
  ensureConnection: () => Promise<number | null>;
}

/**
 * 知识/术语「新增 · 编辑」弹窗（**与样本对弹窗同构**：字段在弹窗内、保存即关闭）。
 *
 * <p>字段：类型 / 标题 / 内容 / 启用。**关联对象（`related_item_keys`）本弹窗不编辑**，
 * 但保存时**原样带回** —— 否则 `PUT /knowledge/{id}` 会把它覆盖成 `null`（该清单归属建模台，
 * T04e ②）。
 */
export function IqdKnowledgeDialog({
  open,
  initial,
  onClose,
  onSaved,
  ensureConnection,
}: IqdKnowledgeDialogProps) {
  const { hasPermission } = usePermission();
  const canSave = hasPermission(ENHANCE_PERMISSIONS.enhanceSave);
  const [kind, setKind] = useState('term');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [enabled, setEnabled] = useState(true);
  /** 原样带回的关联清单（本弹窗不编辑） */
  const [relatedKeys, setRelatedKeys] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 打开时按 initial 预填（编辑为行数据，新增为 null）
  useEffect(() => {
    if (!open) return;
    setKind(initial?.kind ?? 'term');
    setTitle(initial?.title ?? '');
    setContent(initial?.content ?? '');
    setEnabled(initial?.enabled ?? true);
    setRelatedKeys(initial?.related_item_keys ?? null);
    setError(null);
  }, [open, initial]);

  const save = useCallback(async () => {
    if (!title.trim()) {
      setError('标题/术语不能为空');
      return;
    }
    const cid = await ensureConnection();
    if (cid == null) return;
    setSaving(true);
    setError(null);
    try {
      // 带 id → PUT /knowledge/{id}（可改类型/标题）；不带 → POST 幂等 upsert
      await saveIqdKnowledge({
        id: initial?.id ?? undefined,
        connection_id: cid,
        kind,
        title: title.trim(),
        content: content.trim() || null,
        related_item_keys: relatedKeys,
        enabled,
      });
      onSaved();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : initial?.id != null
            ? '更新知识条目失败'
            : '保存知识条目失败',
      );
    } finally {
      setSaving(false);
    }
  }, [content, enabled, ensureConnection, initial, kind, onSaved, relatedKeys, title]);

  const related = summarizeRelatedItemKeys(relatedKeys);

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent className="flex max-h-[90vh] w-full max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="mx-0 mt-0 rounded-none border-b border-border/60 bg-[hsl(var(--dialog-header-bg))] px-4 py-3 pr-10">
          <DialogTitle className="text-[14px]">
            {initial?.id != null ? `编辑知识条目 #${initial.id}` : '新增知识/术语/口径'}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">类型</span>
            <Select value={kind} onValueChange={setKind}>
              {/* 弹窗内各控件显式加高：默认 h-9 在弹窗里显小（用户反馈「内容组件太矮」） */}
              <SelectTrigger className="h-11">
                <SelectValue placeholder="选择知识类型" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(KNOWLEDGE_KIND_LABEL).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">标题/术语</span>
            <Input
              className="h-11"
              placeholder="标题/术语（如：销售额）"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">内容/口径说明（可空）</span>
            <Textarea
              className="min-h-[18rem] leading-relaxed"
              placeholder="口径说明、同义词等（可空）"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={12}
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span className="text-xs text-muted-foreground">启用（同步后对问数生效）</span>
          </div>

          {/* 关联对象归属建模台：这里只读展示，保存时原样带回 */}
          <p className="text-[11px] text-muted-foreground">
            关联对象：{related.isGlobal ? '全连接通用' : `${related.count} 项`}
            （由建模台维护，本弹窗不修改）
          </p>

          {error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter className="mx-0 mb-0 rounded-none border-t border-border/60 px-4 py-3">
          <Button size="sm" variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={saving || !canSave}>
            <Save className="h-4 w-4" />
            {initial?.id != null ? '保存修改' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default IqdEnhancePage;
