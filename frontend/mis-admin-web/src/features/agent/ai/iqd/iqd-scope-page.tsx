/**
 * iqd-scope-page.tsx — 问数范围与表级 ACL（W2，路径 /ai/iqd/scope）。
 *
 * <p>双闸门配置面：范围策略（iqd_scope_policy，治理层 global/role/dept/user/store）
 * + 表级 ACL（iqd_table_acl，授权层 ask/manage + row_scope 行级条件）。
 * 数据源为 BFF 代理（权限码 iqd:scope:view/save / iqd:acl:view/save）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
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
  listIqdScopePolicies,
  saveIqdAcls,
  saveIqdScopePolicies,
  type IqdAcl,
  type IqdAclSavePayload,
  type IqdScopePolicy,
  type IqdScopePolicySavePayload,
} from '@/lib/api/iqd';

const SUBJECT_TYPE_LABEL: Record<string, string> = {
  global: '全局',
  role: '角色',
  dept: '部门',
  user: '用户',
  store: '门店',
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

function blankPolicyKey(): string {
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function blankAclKey(): string {
  return `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function IqdScopePage() {
  const [connectionId, setConnectionId] = useState<number | null>(null);
  const [policies, setPolicies] = useState<IqdScopePolicy[]>([]);
  const [acls, setAcls] = useState<IqdAcl[]>([]);
  const [policyDrafts, setPolicyDrafts] = useState<PolicyDraft[]>([]);
  const [aclDrafts, setAclDrafts] = useState<AclDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
      const validAcls = aclDrafts.filter((d) => d.item_key.trim() !== '' && d.subject_id.trim() !== '');
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

  const removeAcl = useCallback(
    async (draft: AclDraft) => {
      setAclDrafts((prev) => prev.filter((d) => d.key !== draft.key));
      if (draft.id != null) {
        setError(null);
        try {
          await deleteIqdAcl(draft.id);
        } catch (e) {
          setError(e instanceof Error ? e.message : '删除 ACL 失败');
        }
      }
    },
    [],
  );

  const policyCount = useMemo(
    () => policies.filter((p) => p.effective).length,
    [policies],
  );
  const aclCount = acls.length;

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
            <Button size="sm" onClick={() => void savePolicies()} disabled={saving || connectionId == null}>
              <Save className="h-4 w-4" />
              保存全部
            </Button>
          </div>
        }
      />

      {error ? (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
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
          <div className="flex min-h-0 flex-1 flex-col rounded-lg border bg-card">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <div className="flex items-center gap-2 text-sm font-medium">
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
                <thead className="border-b-2 border-foreground/20 bg-table-header text-muted-foreground">
                  <tr>
                    <th className="w-28 px-3 py-2 font-bold">主体类型</th>
                    <th className="w-32 px-3 py-2 font-bold">主体 ID</th>
                    <th className="px-3 py-2 font-bold">item_key</th>
                    <th className="w-20 px-3 py-2 font-bold">允许</th>
                    <th className="w-20 px-3 py-2 font-bold">生效</th>
                    <th className="w-48 px-3 py-2 font-bold">备注</th>
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
                            className="h-8 w-full rounded-md border border-input bg-card px-2 text-sm"
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
                        <td className="px-3 py-1.5">
                          <Input
                            className="h-8"
                            placeholder="global / 角色码 / 部门ID"
                            value={d.subject_id}
                            onChange={(e) => patchPolicy(d.key, { subject_id: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <Input
                            className="h-8 font-mono text-xs"
                            placeholder="pg_main.public.orders"
                            value={d.item_key}
                            onChange={(e) => patchPolicy(d.key, { item_key: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={d.allow}
                            onChange={(e) => patchPolicy(d.key, { allow: e.target.checked })}
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={d.effective}
                            onChange={(e) => patchPolicy(d.key, { effective: e.target.checked })}
                          />
                        </td>
                        <td className="px-3 py-1.5">
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
          <div className="flex min-h-0 flex-1 flex-col rounded-lg border bg-card">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="h-4 w-4 text-primary" />
                表级 ACL（{aclCount} 条）
              </div>
              <Button size="sm" variant="outline" onClick={addAcl}>
                <Plus className="h-4 w-4" />
                新增
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full border-separate border-spacing-0 bg-table-surface text-left text-sm">
                <thead className="border-b-2 border-foreground/20 bg-table-header text-muted-foreground">
                  <tr>
                    <th className="w-28 px-3 py-2 font-bold">主体类型</th>
                    <th className="w-32 px-3 py-2 font-bold">主体 ID</th>
                    <th className="px-3 py-2 font-bold">item_key</th>
                    <th className="w-24 px-3 py-2 font-bold">动作</th>
                    <th className="px-3 py-2 font-bold">row_scope（JSON）</th>
                    <th className="w-16 px-3 py-2 font-bold" />
                  </tr>
                </thead>
                <tbody>
                  {aclDrafts.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                        暂无表级 ACL
                      </td>
                    </tr>
                  ) : (
                    aclDrafts.map((d) => (
                      <tr
                        key={d.key}
                        className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe"
                      >
                        <td className="px-3 py-1.5">
                          <select
                            className="h-8 w-full rounded-md border border-input bg-card px-2 text-sm"
                            value={d.subject_type}
                            onChange={(e) => patchAcl(d.key, { subject_type: e.target.value })}
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
                        <td className="px-3 py-1.5">
                          <Input
                            className="h-8"
                            placeholder="角色码 / 部门ID / 用户ID"
                            value={d.subject_id}
                            onChange={(e) => patchAcl(d.key, { subject_id: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <Input
                            className="h-8 font-mono text-xs"
                            placeholder="pg_main.public.orders"
                            value={d.item_key}
                            onChange={(e) => patchAcl(d.key, { item_key: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <select
                            className="h-8 w-full rounded-md border border-input bg-card px-2 text-sm"
                            value={d.action}
                            onChange={(e) => patchAcl(d.key, { action: e.target.value })}
                          >
                            <option value="ask">ask</option>
                            <option value="manage">manage</option>
                          </select>
                        </td>
                        <td className="px-3 py-1.5">
                          <Textarea
                            className="h-8 min-h-[2rem] font-mono text-xs"
                            placeholder='{"dimension":"dept","scope":"dept_subtree"}'
                            value={d.row_scope}
                            onChange={(e) => patchAcl(d.key, { row_scope: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-1.5">
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
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-md border border-info/30 bg-info/5 p-3 text-xs text-muted-foreground">
            <p className="leading-relaxed">
              <Badge variant="secondary" className="mr-1">
                行级注入
              </Badge>
              row_scope 支持单维度对象（
              <code className="font-mono">{"{\"dimension\":\"dept\",\"scope\":\"dept_subtree\"}"}</code>
              ）与多维度数组（
              <code className="font-mono">{"{\"dimensions\":[...]}"}</code>
              ，AND 叠加）。维度须在「脱敏与维度」页注册。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default IqdScopePage;
