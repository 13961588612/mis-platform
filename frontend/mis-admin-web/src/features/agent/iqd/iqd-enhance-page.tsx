/**
 * iqd-enhance-page.tsx — 问数增强物料（W2/W4，路径 /iqd/enhance）。
 *
 * <p>五个 Tab：
 * <ul>
 *   <li>脱敏规则（iqd_mask_rule CRUD，W2）</li>
 *   <li>行级维度注册表（iqd_row_scope_dimension CRUD，W2）</li>
 *   <li>字典同步（mis_dept_scope / mis_store_scope 手动触发 + 状态，W2）</li>
 *   <li>样本对（iqd_sql_pair CRUD，W4 few-shot）</li>
 *   <li>知识/术语（iqd_knowledge CRUD + S-07 导入 + 增强推送，W4）</li>
 * </ul>
 * 数据源为 BFF 代理（权限码 iqd:mask:* / iqd:dimension:* / iqd:scope:sync /
 * iqd:enhance:view|save|sync）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Save, Send, Trash2, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  deleteIqdDimension,
  deleteIqdKnowledge,
  getIqdConfig,
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

type Tab = 'mask' | 'dimension' | 'sync' | 'sqlpair' | 'knowledge';

export const IQD_ENHANCE_PAGE_PATH = '/iqd/enhance';

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
  const [tab, setTab] = useState<Tab>('mask');
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

  // 知识草稿（W4）
  const [kbKind, setKbKind] = useState('term');
  const [kbTitle, setKbTitle] = useState('');
  const [kbContent, setKbContent] = useState('');

  // 主连接 id（增强物料均挂主连接）
  const [connectionId, setConnectionId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [m, d, s] = await Promise.all([
        listIqdMaskRules(),
        listIqdDimensions(),
        listIqdDictSyncStatus(),
      ]);
      setMaskRules(m);
      setDimensions(d);
      setSyncStatus(s);
      // 取主连接 id（供同步状态条使用；连接未配置时状态条显示「尚未同步」）
      try {
        const cfg = await getIqdConfig();
        setConnectionId(cfg.id ?? null);
      } catch {
        setConnectionId(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 增强物料 Tab 懒加载：需要 connection_id（从连接配置取主连接）
  const ensureConnection = useCallback(async (): Promise<number | null> => {
    if (connectionId != null) return connectionId;
    try {
      const cfg = await import('@/lib/api/iqd').then((m) => m.getIqdConfig());
      const cid = cfg.id ?? null;
      setConnectionId(cid);
      return cid;
    } catch {
      setError('获取问数连接失败');
      return null;
    }
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
      setTab(next);
      if ((next === 'sqlpair' || next === 'knowledge') && sqlPairs.length === 0 && knowledge.length === 0) {
        void loadEnhance();
      }
    },
    [knowledge.length, loadEnhance, sqlPairs.length],
  );

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
        replacement: maskRule === 'custom' && maskReplacement.trim() ? maskReplacement.trim() : null,
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
      const matchDialect = pairDialectFilter === 'all' || (p.source_dialect ?? '') === pairDialectFilter;
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

  const saveKnowledgeItem = useCallback(async () => {
    if (!kbTitle.trim()) {
      setError('标题不能为空');
      return;
    }
    const cid = await ensureConnection();
    if (cid == null) return;
    setSaving(true);
    setError(null);
    try {
      await saveIqdKnowledge({
        connection_id: cid,
        kind: kbKind,
        title: kbTitle.trim(),
        content: kbContent.trim() || null,
        enabled: true,
      });
      setKbTitle('');
      setKbContent('');
      await loadEnhance();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存知识失败');
    } finally {
      setSaving(false);
    }
  }, [ensureConnection, kbContent, kbKind, kbTitle, loadEnhance]);

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
    try {
      const result = await importIqdKnowledgeS07(cid);
      setError(`S-07 导入完成：${String(result.message ?? '')}`);
      await loadEnhance();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'S-07 导入失败');
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
      setError(`待推送物料：样本对 ${pairCount} 条、知识 ${kbCount} 条（Worker 经 context build 同步）`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '增强推送失败');
    }
  }, [ensureConnection]);

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'mask', label: `脱敏规则（${maskRules.length}）` },
    { key: 'dimension', label: `行级维度（${dimensions.length}）` },
    { key: 'sync', label: '字典同步' },
    { key: 'sqlpair', label: `样本对（${sqlPairs.length}）` },
    { key: 'knowledge', label: `知识/术语（${knowledge.length}）` },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="脱敏与维度"
        description="脱敏规则（唯一出口）、行级范围维度注册表、字典同步。"
        breadcrumbs={buildAppBreadcrumbs({ app: 'agent', title: '脱敏与维度' })}
        actions={
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            刷新
          </Button>
        }
      />

      <SyncStatusBar connectionId={connectionId} />

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

      <div className="min-h-0 flex-1 overflow-auto">
        {/* ================= 脱敏规则 ================= */}
        {tab === 'mask' ? (
          <div className="space-y-3">
            <div className="rounded-lg border bg-card p-3">
              <div className="mb-2 text-sm font-medium">新增脱敏规则</div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
                <Input placeholder="规则名（如 phone）" value={maskName} onChange={(e) => setMaskName(e.target.value)} />
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
                  <Button size="sm" onClick={() => void saveMask()} disabled={saving}>
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
                        <td className="px-3 py-2 text-xs">{MATCH_LABEL[r.match_type] ?? r.match_type}</td>
                        <td className="max-w-[18rem] truncate px-3 py-2 font-mono text-xs">{r.pattern}</td>
                        <td className="px-3 py-2 text-xs">{RULE_LABEL[r.rule] ?? r.rule}</td>
                        <td className="px-3 py-2 text-xs">{r.priority ?? 0}</td>
                        <td className="px-3 py-2 text-xs">
                          {r.enabled ? <span className="text-success">启用</span> : <span className="text-muted-foreground">停用</span>}
                        </td>
                        <td className="px-3 py-2">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => void removeMask(r.id)}
                            title="删除"
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
            <div className="rounded-lg border bg-card p-3">
              <div className="mb-2 text-sm font-medium">新增维度</div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
                <Input placeholder="维度码（dept）" value={dimCode} onChange={(e) => setDimCode(e.target.value)} />
                <Input placeholder="维度名（部门）" value={dimName} onChange={(e) => setDimName(e.target.value)} />
                <select
                  className="h-9 rounded-md border border-input bg-card px-[0.7rem] text-sm"
                  value={dimPredicate}
                  onChange={(e) => setDimPredicate(e.target.value)}
                >
                  <option value="PATH_PREFIX">PATH_PREFIX</option>
                  <option value="ENUM">ENUM</option>
                </select>
                <Input placeholder="条件列（dept_id）" value={dimColumn} onChange={(e) => setDimColumn(e.target.value)} />
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
                <Button size="sm" onClick={() => void saveDimension()} disabled={saving}>
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
                        <td className="px-3 py-2 text-xs">{PREDICATE_LABEL[d.predicate_type] ?? d.predicate_type}</td>
                        <td className="px-3 py-2 font-mono text-xs">{d.column_name}</td>
                        <td className="px-3 py-2 font-mono text-xs">{d.header_name}</td>
                        <td className="px-3 py-2 font-mono text-xs">{d.dict_table ?? '—'}</td>
                        <td className="px-3 py-2 text-xs">
                          {d.enabled ? <span className="text-success">启用</span> : <span className="text-muted-foreground">停用</span>}
                        </td>
                        <td className="px-3 py-2">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => void removeDimension(d.id)}
                            title="删除"
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
                          <Badge variant={s.status === 'ok' ? 'default' : s.status === 'partial' ? 'secondary' : 'destructive'}>
                            {s.status}
                          </Badge>
                        </td>
                        <td className="max-w-[24rem] truncate px-3 py-2 text-xs text-muted-foreground" title={s.message}>
                          {s.message ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{s.updated_at ?? '—'}</td>
                        <td className="px-3 py-2">
                          <Button size="sm" variant="outline" onClick={() => void runSync(s.dimension)}>
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
                <Button size="sm" variant="outline" onClick={() => void runSync('dept')}>
                  触发 dept 同步
                </Button>
                <Button size="sm" variant="outline" onClick={() => void runSync('store')}>
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
              <Button size="sm" variant="outline" onClick={() => void loadEnhance()} disabled={loading}>
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
                        <td className="max-w-[14rem] truncate px-3 py-2 text-xs" title={p.question}>
                          {p.question}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {DIALECT_LABEL[p.source_dialect ?? ''] ?? p.source_dialect}
                        </td>
                        <td className="max-w-[24rem] truncate px-3 py-2 font-mono text-xs" title={p.wren_sql}>
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
                            >
                              编辑
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => void removePair(p.id)}
                              title="删除"
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

        {/* ================= 知识/术语（W4）================= */}
        {tab === 'knowledge' ? (
          <div className="space-y-3">
            <div className="rounded-lg border bg-card p-3">
              <div className="mb-2 text-sm font-medium">新增知识/术语/口径</div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <select
                  className="h-9 w-full shrink-0 rounded-md border border-input bg-card px-2.5 text-sm sm:w-[7.5rem]"
                  value={kbKind}
                  onChange={(e) => setKbKind(e.target.value)}
                  aria-label="知识类型"
                >
                  {Object.entries(KNOWLEDGE_KIND_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                <Input
                  className="min-w-0 flex-1"
                  placeholder="标题/术语"
                  value={kbTitle}
                  onChange={(e) => setKbTitle(e.target.value)}
                />
                <Button
                  size="sm"
                  className="h-9 shrink-0 px-3"
                  onClick={() => void saveKnowledgeItem()}
                  disabled={saving}
                >
                  <Save className="h-4 w-4" />
                  保存
                </Button>
              </div>
              <div className="mt-2">
                <Textarea
                  placeholder="内容/口径说明（可空）"
                  value={kbContent}
                  onChange={(e) => setKbContent(e.target.value)}
                  rows={2}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" className="h-8" onClick={() => void importS07()}>
                <Upload className="h-3.5 w-3.5" />
                S-07 术语导入
              </Button>
              <Button size="sm" variant="outline" className="h-8" onClick={() => void pushEnhance()}>
                <Send className="h-3.5 w-3.5" />
                增强推送
              </Button>
              <Button size="sm" variant="outline" className="h-8" onClick={() => void loadEnhance()}>
                <RefreshCw className="h-3.5 w-3.5" />
                刷新
              </Button>
            </div>

            <div className="rounded-lg border bg-card">
              <table className="w-full border-separate border-spacing-0 bg-table-surface text-left text-sm">
                <thead className="border-b-2 border-foreground/20 bg-table-header text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-bold">类型</th>
                    <th className="px-3 py-2 font-bold">标题</th>
                    <th className="px-3 py-2 font-bold">内容</th>
                    <th className="px-3 py-2 font-bold">来源</th>
                    <th className="px-3 py-2 font-bold">状态</th>
                    <th className="w-14 px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {knowledge.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                        暂无知识条目
                      </td>
                    </tr>
                  ) : (
                    knowledge.map((k) => (
                      <tr
                        key={k.id}
                        className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe"
                      >
                        <td className="px-3 py-2 text-xs">
                          {KNOWLEDGE_KIND_LABEL[k.kind] ?? k.kind}
                        </td>
                        <td className="max-w-[14rem] truncate px-3 py-2 text-xs" title={k.title}>
                          {k.title}
                        </td>
                        <td className="max-w-[24rem] truncate px-3 py-2 text-xs text-muted-foreground" title={k.content ?? ''}>
                          {k.content ?? '—'}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{k.source ?? 'local'}</td>
                        <td className="px-3 py-2 text-xs">
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
                        </td>
                        <td className="px-3 py-2">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => void removeKnowledgeItem(k.id)}
                            title="删除"
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
      </div>
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
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial?.id != null ? '编辑样本对' : '新增样本对'}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
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
            <span className="text-xs text-muted-foreground">原生 SQL</span>
            <Textarea
              placeholder="原生 SQL（源方言，如 Oracle/MySQL 写法）"
              value={nativeSql}
              onChange={(e) => setNativeSql(e.target.value)}
              rows={3}
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void translate()}
                disabled={translating || !nativeSql.trim()}
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
            <span className="text-xs text-muted-foreground">转化结果（wren_sql，可编辑）</span>
            <Textarea
              placeholder="点「转化」后回填，或直接手写 WrenAI 方言 SQL"
              value={wrenSql}
              onChange={(e) => setWrenSql(e.target.value)}
              rows={3}
            />
            <Button
              size="sm"
              variant="secondary"
              className="w-fit"
              onClick={() => void trial()}
              disabled={trialing || !wrenSql.trim()}
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
                    [{trialResult.columns
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
            <Input placeholder="备注（可空）" value={remark} onChange={(e) => setRemark(e.target.value)} />
          </div>

          {error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button size="sm" variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={saving}>
            <Save className="h-4 w-4" />
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default IqdEnhancePage;
