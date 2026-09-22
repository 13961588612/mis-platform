/**
 * iqd-scope-page.tsx — 问数范围与表级 ACL（W2，路径 /iqd/scope）。
 *
 * <p>双闸门配置面：范围策略（iqd_scope_policy，治理层 global/role/dept/user/store）
 * + 表级 ACL（iqd_table_acl，授权层 ask/manage + row_scope 行级条件）。
 * 数据源为 BFF 代理（权限码 iqd:scope:view/save / iqd:acl:view/save）。
 *
 * <p><b>T04c / MR-12（行级维度可视化展示）</b>：在表级 ACL 授权矩阵中，把 `row_scope`
 * 配置的**行级维度**以**维度徽标**形式展示（一期 dept + store 双维度，一表可多维度 AND 叠加）；
 * 点击徽标单元格展开，按维度/策略形态展示注入谓词预览（`PATH_PREFIX` / `ENUM`）与
 * 「模拟角色 WHERE 片段」预览（后端无专用端点 → **降级为前端推导的示意片段**）。
 *
 * <p>纯逻辑（解析 / 徽标判定 / 谓词构造 / 列名对齐 / 错误码分流）下沉到
 * `./components/scope/rowScopeUtils`（已单测，见 `rowScopeUtils.test.ts`）。
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, RefreshCw, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePermission } from '@/hooks/use-permission';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { Badge } from '@/components/ui/badge';
import {
  deleteIqdAcl,
  getIqdConfig,
  listIqdAcls,
  listIqdDimensions,
  listIqdScopePolicies,
  saveIqdAcls,
  saveIqdScopePolicies,
  type IqdAcl,
  type IqdAclSavePayload,
  type IqdScopeDimension,
  type IqdScopePolicy,
  type IqdScopePolicySavePayload,
} from '@/lib/api/iqd';
import {
  ANCHOR_PLACEHOLDER,
  SCOPE_PERMISSIONS,
  buildPredicatePreview,
  buildSimulatedWherePreview,
  combinePredicatesAnd,
  describeScopeError,
  dimensionBadge,
  parseRowScope,
  readApiError,
  summarizeRowScope,
  type DimensionTone,
  type PredicatePreview,
  type RowScopeInstance,
} from './components/scope/rowScopeUtils';

const SUBJECT_TYPE_LABEL: Record<string, string> = {
  global: '全局',
  role: '角色',
  dept: '部门',
  user: '用户',
  store: '门店',
};

/** 徽标色调 → Badge 变体（走主题变量，不硬编码颜色）。 */
const TONE_VARIANT: Record<DimensionTone, 'default' | 'info' | 'outline'> = {
  primary: 'default',
  accent: 'info',
  muted: 'outline',
};

export const IQD_SCOPE_PAGE_PATH = '/iqd/scope';

interface PolicyDraft {
  key: string;
  subject_type: string;
  subject_id: string;
  item_key: string;
  allow: boolean;
  effective: boolean;
  remark: string;
}

interface AclDraft {
  key: string;
  subject_type: string;
  subject_id: string;
  item_key: string;
  action: string;
  row_scope: string;
  id?: number;
}

/** 展开面板里的示意实参（锚点 path / 门店集合），key = `${draft.key}::${dimension}`。 */
interface SampleInput {
  path: string;
  values: string;
}

function blankPolicyKey(): string {
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function blankAclKey(): string {
  return `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 示意门店集合串（逗号 / 空格分隔）→ 去空字符串数组。 */
function parseSampleValues(text: string): string[] | null {
  const list = text
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter((item) => item !== '');
  return list.length > 0 ? list : null;
}

export function IqdScopePage() {
  const { hasPermission } = usePermission();
  const canViewDimensions = hasPermission(SCOPE_PERMISSIONS.dimensionView);

  const [connectionId, setConnectionId] = useState<number | null>(null);
  const [policies, setPolicies] = useState<IqdScopePolicy[]>([]);
  const [acls, setAcls] = useState<IqdAcl[]>([]);
  const [dimensions, setDimensions] = useState<IqdScopeDimension[]>([]);
  const [policyDrafts, setPolicyDrafts] = useState<PolicyDraft[]>([]);
  const [aclDrafts, setAclDrafts] = useState<AclDraft[]>([]);
  const [expandedAclKeys, setExpandedAclKeys] = useState<Set<string>>(new Set());
  const [sampleInputs, setSampleInputs] = useState<Record<string, SampleInput>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dimensionError, setDimensionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const dimensionMap = useMemo(() => {
    const map = new Map<string, IqdScopeDimension>();
    for (const dimension of dimensions) {
      map.set(dimension.dimension_code, dimension);
    }
    return map;
  }, [dimensions]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cfg = await getIqdConfig();
      if (cfg.id == null) {
        setConnectionId(null);
        setPolicies([]);
        setAcls([]);
        return;
      }
      setConnectionId(cfg.id);
      const [ps, as] = await Promise.all([listIqdScopePolicies(cfg.id), listIqdAcls(cfg.id)]);
      setPolicies(ps);
      setAcls(as);
      setPolicyDrafts(
        ps.map((p) => ({
          key: blankPolicyKey(),
          subject_type: p.subject_type,
          subject_id: p.subject_id,
          item_key: p.item_key,
          allow: p.allow ?? true,
          effective: p.effective ?? true,
          remark: p.remark ?? '',
        })),
      );
      setAclDrafts(
        as.map((a) => ({
          key: blankAclKey(),
          id: a.id,
          subject_type: a.subject_type,
          subject_id: a.subject_id,
          item_key: a.item_key,
          action: a.action,
          row_scope: a.row_scope ?? '',
        })),
      );
      setExpandedAclKeys(new Set());
      setSampleInputs({});
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  // 维度注册表（谓词预览的形态来源）：独立加载 + 独立错误面，避免拖垮主表。
  const loadDimensions = useCallback(async () => {
    if (!canViewDimensions) {
      setDimensions([]);
      setDimensionError(null);
      return;
    }
    try {
      const dims = await listIqdDimensions();
      setDimensions(dims);
      setDimensionError(null);
    } catch (e) {
      const { code, data, message } = readApiError(e);
      setDimensions([]);
      setDimensionError(describeScopeError(code, data, message));
    }
  }, [canViewDimensions]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadDimensions();
  }, [loadDimensions]);

  const addPolicy = useCallback(() => {
    setPolicyDrafts((prev) => [
      ...prev,
      {
        key: blankPolicyKey(),
        subject_type: 'role',
        subject_id: '',
        item_key: '',
        allow: true,
        effective: true,
        remark: '',
      },
    ]);
  }, []);

  const addAcl = useCallback(() => {
    setAclDrafts((prev) => [
      ...prev,
      {
        key: blankAclKey(),
        subject_type: 'role',
        subject_id: '',
        item_key: '',
        action: 'ask',
        row_scope: '',
      },
    ]);
  }, []);

  const patchPolicy = useCallback((key: string, patch: Partial<PolicyDraft>) => {
    setPolicyDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }, []);

  const patchAcl = useCallback((key: string, patch: Partial<AclDraft>) => {
    setAclDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }, []);

  const toggleExpanded = useCallback((key: string) => {
    setExpandedAclKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const patchSample = useCallback((key: string, patch: Partial<SampleInput>) => {
    setSampleInputs((prev) => {
      const base: SampleInput = prev[key] ?? { path: '', values: '' };
      return { ...prev, [key]: { ...base, ...patch } };
    });
  }, []);

  /** 把 `row_scope` 实例 + 示意实参合并后逐维度构造谓词预览。 */
  const buildDraftPreviews = useCallback(
    (draft: AclDraft, instances: RowScopeInstance[]): PredicatePreview[] =>
      instances.map((instance) => {
        const sample = sampleInputs[`${draft.key}::${instance.dimension}`];
        const merged: RowScopeInstance = {
          dimension: instance.dimension,
          scope: instance.scope,
          path: sample?.path.trim() ? sample.path.trim() : instance.path,
          values: sample?.values.trim() ? parseSampleValues(sample.values) : instance.values,
        };
        return buildPredicatePreview(merged, dimensionMap.get(instance.dimension) ?? null);
      }),
    [dimensionMap, sampleInputs],
  );

  const savePolicies = useCallback(async () => {
    if (connectionId == null) return;
    setSaving(true);
    setError(null);
    try {
      const valid = policyDrafts.filter((d) => d.item_key.trim() !== '');
      if (valid.length > 0) {
        const payload: IqdScopePolicySavePayload[] = valid.map((d) => ({
          subject_type: d.subject_type,
          subject_id: d.subject_id || 'global',
          item_key: d.item_key.trim(),
          allow: d.allow,
          effective: d.effective,
          remark: d.remark || undefined,
        }));
        await saveIqdScopePolicies(connectionId, payload);
      }
      const validAcls = aclDrafts.filter(
        (d) => d.item_key.trim() !== '' && d.subject_id.trim() !== '',
      );
      if (validAcls.length > 0) {
        const payload: IqdAclSavePayload[] = validAcls.map((d) => ({
          subject_type: d.subject_type,
          subject_id: d.subject_id.trim(),
          item_key: d.item_key.trim(),
          action: d.action,
          row_scope: d.row_scope.trim() ? d.row_scope.trim() : undefined,
        }));
        await saveIqdAcls(connectionId, payload);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [connectionId, policyDrafts, aclDrafts, load]);

  const removeAcl = useCallback(async (draft: AclDraft) => {
    setAclDrafts((prev) => prev.filter((d) => d.key !== draft.key));
    if (draft.id != null) {
      setError(null);
      try {
        await deleteIqdAcl(draft.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : '删除 ACL 失败');
      }
    }
  }, []);

  const policyCount = useMemo(() => policies.filter((p) => p.effective).length, [policies]);
  const aclCount = acls.length;
  const dimensionedAclCount = useMemo(
    () => aclDrafts.filter((d) => parseRowScope(d.row_scope).instances.length > 0).length,
    [aclDrafts],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="问数范围与权限"
        description="治理层范围策略 + 授权层表级 ACL（行级条件 row_scope 维度注入）。"
        breadcrumbs={buildAppBreadcrumbs({ app: 'agent', title: '问数范围与权限' })}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              刷新
            </Button>
            <Button
              size="sm"
              onClick={() => void savePolicies()}
              disabled={saving || connectionId == null}
            >
              <Save className="h-4 w-4" />
              保存全部
            </Button>
          </div>
        }
      />

      {error ? (
        <div className="mb-3 rounded border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {connectionId == null ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          尚未配置问数连接，请先到「语义模型」页保存连接。
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          {/* ---------------- 范围策略 ---------------- */}
          <div className="flex min-h-0 flex-1 flex-col rounded border bg-card">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <div className="flex items-center gap-2 text-[13px] font-medium">
                <ShieldCheck className="h-4 w-4 text-primary" />
                范围策略（{policyCount} 条生效）
              </div>
              <Button size="sm" variant="outline" onClick={addPolicy}>
                <Plus className="h-4 w-4" />
                新增
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full border-separate border-spacing-0 bg-table-surface text-left text-sm">
                <thead className="sticky top-0 z-10 border-b-2 border-foreground/20 bg-table-header text-[13px] text-muted-foreground">
                  <tr>
                    <th className="w-28 px-3 py-2 font-bold">主体类型</th>
                    <th className="border-l border-border/60 w-32 px-3 py-2 font-bold">主体 ID</th>
                    <th className="border-l border-border/60 px-3 py-2 font-bold">item_key</th>
                    <th className="border-l border-border/60 w-20 px-3 py-2 font-bold">允许</th>
                    <th className="border-l border-border/60 w-20 px-3 py-2 font-bold">生效</th>
                    <th className="border-l border-border/60 w-48 px-3 py-2 font-bold">备注</th>
                  </tr>
                </thead>
                <tbody>
                  {policyDrafts.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                        暂无范围策略
                      </td>
                    </tr>
                  ) : (
                    policyDrafts.map((d) => (
                      <tr
                        key={d.key}
                        className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe"
                      >
                        <td className="px-3 py-1.5">
                          <select
                            className="h-8 w-full rounded border border-input bg-card px-2 text-sm"
                            value={d.subject_type}
                            onChange={(e) => patchPolicy(d.key, { subject_type: e.target.value })}
                          >
                            {Object.entries(SUBJECT_TYPE_LABEL).map(([v, l]) => (
                              <option key={v} value={v}>
                                {l}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="border-l border-border/60 px-3 py-1.5">
                          <Input
                            className="h-8"
                            placeholder="global / 角色码 / 部门ID"
                            value={d.subject_id}
                            onChange={(e) => patchPolicy(d.key, { subject_id: e.target.value })}
                          />
                        </td>
                        <td className="border-l border-border/60 px-3 py-1.5">
                          <Input
                            className="h-8 font-mono text-xs"
                            placeholder="pg_main.public.orders"
                            value={d.item_key}
                            onChange={(e) => patchPolicy(d.key, { item_key: e.target.value })}
                          />
                        </td>
                        <td className="border-l border-border/60 px-3 py-1.5">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={d.allow}
                            onChange={(e) => patchPolicy(d.key, { allow: e.target.checked })}
                          />
                        </td>
                        <td className="border-l border-border/60 px-3 py-1.5">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={d.effective}
                            onChange={(e) => patchPolicy(d.key, { effective: e.target.checked })}
                          />
                        </td>
                        <td className="border-l border-border/60 px-3 py-1.5">
                          <Input
                            className="h-8 text-xs"
                            value={d.remark}
                            onChange={(e) => patchPolicy(d.key, { remark: e.target.value })}
                          />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ---------------- 表级 ACL ---------------- */}
          <div className="flex min-h-0 flex-1 flex-col rounded border bg-card">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <div className="flex items-center gap-2 text-[13px] font-medium">
                <ShieldCheck className="h-4 w-4 text-primary" />
                表级 ACL（{aclCount} 条 · {dimensionedAclCount} 条带行级维度）
              </div>
              <Button size="sm" variant="outline" onClick={addAcl}>
                <Plus className="h-4 w-4" />
                新增
              </Button>
            </div>
            {dimensionError ? (
              <div className="border-b border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
                维度注册表加载失败：{dimensionError}（谓词预览将降级为占位符）
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full border-separate border-spacing-0 bg-table-surface text-left text-sm">
                <thead className="sticky top-0 z-10 border-b-2 border-foreground/20 bg-table-header text-[13px] text-muted-foreground">
                  <tr>
                    <th className="w-28 px-3 py-2 font-bold">主体类型</th>
                    <th className="border-l border-border/60 w-32 px-3 py-2 font-bold">主体 ID</th>
                    <th className="border-l border-border/60 px-3 py-2 font-bold">item_key</th>
                    <th className="border-l border-border/60 w-24 px-3 py-2 font-bold">动作</th>
                    <th className="border-l border-border/60 w-40 px-3 py-2 font-bold">行级维度</th>
                    <th className="border-l border-border/60 px-3 py-2 font-bold">row_scope（JSON）</th>
                    <th className="border-l border-border/60 w-16 px-3 py-2 font-bold" />
                  </tr>
                </thead>
                <tbody>
                  {aclDrafts.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                        暂无表级 ACL
                      </td>
                    </tr>
                  ) : (
                    aclDrafts.map((d) => {
                      const parsed = parseRowScope(d.row_scope);
                      const summary = summarizeRowScope(d.row_scope);
                      const expanded = expandedAclKeys.has(d.key);
                      const previews = expanded ? buildDraftPreviews(d, parsed.instances) : [];
                      const combined = combinePredicatesAnd(previews);
                      const simulated = buildSimulatedWherePreview(previews);
                      return (
                        <Fragment key={d.key}>
                          <tr
                            className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe"
                          >
                            <td className="px-3 py-1.5">
                              <select
                                className="h-8 w-full rounded border border-input bg-card px-2 text-sm"
                                value={d.subject_type}
                                onChange={(e) =>
                                  patchAcl(d.key, { subject_type: e.target.value })
                                }
                              >
                                {Object.entries(SUBJECT_TYPE_LABEL)
                                  .filter(([v]) => v !== 'global')
                                  .map(([v, l]) => (
                                    <option key={v} value={v}>
                                      {l}
                                    </option>
                                  ))}
                              </select>
                            </td>
                            <td className="border-l border-border/60 px-3 py-1.5">
                              <Input
                                className="h-8"
                                placeholder="角色码 / 部门ID / 用户ID"
                                value={d.subject_id}
                                onChange={(e) => patchAcl(d.key, { subject_id: e.target.value })}
                              />
                            </td>
                            <td className="border-l border-border/60 px-3 py-1.5">
                              <Input
                                className="h-8 font-mono text-xs"
                                placeholder="pg_main.public.orders"
                                value={d.item_key}
                                onChange={(e) => patchAcl(d.key, { item_key: e.target.value })}
                              />
                            </td>
                            <td className="border-l border-border/60 px-3 py-1.5">
                              <select
                                className="h-8 w-full rounded border border-input bg-card px-2 text-sm"
                                value={d.action}
                                onChange={(e) => patchAcl(d.key, { action: e.target.value })}
                              >
                                <option value="ask">ask</option>
                                <option value="manage">manage</option>
                              </select>
                            </td>
                            <td className="border-l border-border/60 px-3 py-1.5 align-top">
                              <button
                                type="button"
                                onClick={() => toggleExpanded(d.key)}
                                className="flex w-full items-center gap-1 rounded border border-transparent px-1 py-0.5 text-left hover:border-border/60 hover:bg-accent/40"
                                title="点击展开行级谓词预览"
                              >
                                {expanded ? (
                                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                )}
                                {summary.parseError ? (
                                  <Badge
                                    variant="destructive"
                                    className="rounded"
                                    title={summary.parseError}
                                  >
                                    row_scope 解析失败
                                  </Badge>
                                ) : summary.badges.length === 0 ? (
                                  <span className="text-[11px] text-muted-foreground">—（全行可见）</span>
                                ) : (
                                  <span className="flex flex-wrap items-center gap-1">
                                    {summary.badges.map((badge, index) => (
                                      <span key={badge.code} className="inline-flex items-center gap-1">
                                        {index > 0 ? (
                                          <span className="text-[10px] font-medium text-muted-foreground">
                                            AND
                                          </span>
                                        ) : null}
                                        <Badge variant={TONE_VARIANT[badge.tone]} className="rounded">
                                          {badge.label}
                                        </Badge>
                                      </span>
                                    ))}
                                  </span>
                                )}
                              </button>
                            </td>
                            <td className="border-l border-border/60 px-3 py-1.5">
                              <Textarea
                                className="h-8 min-h-[2rem] font-mono text-xs"
                                placeholder='{"dimension":"dept","scope":"dept_subtree"}'
                                value={d.row_scope}
                                onChange={(e) => patchAcl(d.key, { row_scope: e.target.value })}
                              />
                            </td>
                            <td className="border-l border-border/60 px-3 py-1.5">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                onClick={() => void removeAcl(d)}
                                title="删除"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </td>
                          </tr>
                          {expanded ? (
                            <tr className="border-b border-border/50 bg-table-stripe">
                              <td colSpan={7} className="px-3 py-3">
                                <div className="flex flex-col gap-2">
                                  {parsed.error ? (
                                    <p className="text-xs text-destructive">{parsed.error}</p>
                                  ) : previews.length === 0 ? (
                                    <p className="text-xs text-muted-foreground">
                                      未配置行级维度（row_scope 为空）→ 该表全行可见。
                                    </p>
                                  ) : (
                                    <>
                                      {parsed.instances.map((instance, index) => {
                                        const preview = previews[index];
                                        return (
                                          <div
                                            key={`${instance.dimension}-${index}`}
                                            className="rounded border border-border/60 bg-card p-2"
                                          >
                                            <div className="flex flex-wrap items-center gap-2 text-[13px]">
                                              <Badge
                                                variant={TONE_VARIANT[dimensionBadge(instance.dimension).tone]}
                                                className="rounded"
                                              >
                                                {preview.label}
                                              </Badge>
                                              <span className="font-mono text-[11px] text-muted-foreground">
                                                {preview.predicateType} · 列 {preview.column || '—'} ·
                                                {` scope=${instance.scope || '—'}`}
                                              </span>
                                            </div>
                                            {preview.text ? (
                                              <pre className="mt-1 overflow-x-auto rounded bg-table-header px-2 py-1 font-mono text-xs text-foreground">
                                                {preview.text}
                                              </pre>
                                            ) : null}
                                            {preview.note ? (
                                              <p className="mt-1 text-[11px] text-muted-foreground">
                                                {preview.note}
                                              </p>
                                            ) : null}
                                            {preview.predicateType === 'PATH_PREFIX' ? (
                                              <Input
                                                className="mt-2 h-7 text-xs"
                                                placeholder={`示意锚点 path（如 /0/1/A/）→ 占位符 ${ANCHOR_PLACEHOLDER}`}
                                                value={
                                                  sampleInputs[`${d.key}::${instance.dimension}`]
                                                    ?.path ?? ''
                                                }
                                                onChange={(e) =>
                                                  patchSample(`${d.key}::${instance.dimension}`, {
                                                    path: e.target.value,
                                                  })
                                                }
                                              />
                                            ) : null}
                                            {preview.predicateType === 'ENUM' ? (
                                              <Input
                                                className="mt-2 h-7 text-xs"
                                                placeholder="示意门店集合（逗号分隔，如 S001,S002）"
                                                value={
                                                  sampleInputs[`${d.key}::${instance.dimension}`]
                                                    ?.values ?? ''
                                                }
                                                onChange={(e) =>
                                                  patchSample(`${d.key}::${instance.dimension}`, {
                                                    values: e.target.value,
                                                  })
                                                }
                                              />
                                            ) : null}
                                          </div>
                                        );
                                      })}
                                      <div className="rounded border border-border/60 bg-card p-2">
                                        <p className="text-[13px] font-medium">
                                          多维度 AND 叠加（{parsed.instances.length} 维）
                                        </p>
                                        <pre className="mt-1 overflow-x-auto rounded bg-table-header px-2 py-1 font-mono text-xs text-foreground">
                                          {combined || '（无谓词）'}
                                        </pre>
                                      </div>
                                      <div className="rounded border border-info/30 bg-info/5 p-2">
                                        <p className="flex items-center gap-2 text-[13px] font-medium">
                                          模拟角色 WHERE 片段预览
                                          <Badge variant="warning" className="rounded">
                                            示意 / 降级
                                          </Badge>
                                        </p>
                                        <pre className="mt-1 overflow-x-auto rounded bg-card px-2 py-1 font-mono text-xs text-foreground">
                                          {simulated.text || '（无谓词）'}
                                        </pre>
                                        <p className="mt-1 text-[11px] text-muted-foreground">
                                          {simulated.note}
                                        </p>
                                        {/* TODO(mr12-simulated-where-endpoint)：后端补「按 role_code + item_key 返回展开后 WHERE」
                                            的预览端点后，改走该端点（当前为前端推导的示意片段）。 */}
                                      </div>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded border border-info/30 bg-info/5 p-3 text-xs text-muted-foreground">
            <p className="leading-relaxed">
              <Badge variant="secondary" className="rounded">
                行级注入
              </Badge>
              row_scope 支持单维度对象（
              <code className="font-mono">{"{\"dimension\":\"dept\",\"scope\":\"dept_subtree\"}"}</code>
              ）与多维度数组（
              <code className="font-mono">{"{\"dimensions\":[...]}"}</code>
              ，AND 叠加）。维度须在「脱敏与维度」页注册（dept = PATH_PREFIX / store = ENUM）。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default IqdScopePage;
