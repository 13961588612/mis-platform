/**
 * skill-manage-page.tsx — Skill 管理页（T10，从 旧版独立前端 SkillManagePage 迁移）。
 *
 * <p>功能等价迁移（skill.py 后端端点）+ shadcn 统一：
 * - 统计卡（总/已启用/已停用）+ 分类/状态筛选 + 分页
 * - 启停 / 删除（写操作经 bff-actions → BFF，403 内联 PermissionErrorBanner；
 *   权限码 `agent:skill:manage`，操作按钮经 PermissionGate 门控）
 * - 详情弹窗展示技能完整配置
 *
 * <p>UI 规范：表格吸顶单层滚动、圆角 4px、表头 13px、无内层 padding。
 */

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { StatCard } from '@/components/common/stat-card';
import { PermissionGate } from '@/components/auth/permission-gate';
import { PermissionErrorBanner } from '@/components/a2ui/PermissionErrorBanner';
import type { BffActionError } from '@/lib/a2ui/types';
import {
  deleteSkill,
  disableSkill,
  enableSkill,
  fetchSkillStats,
  listSkills,
  SKILL_CATEGORY_LABELS,
  SKILL_STATUS_LABELS,
  type Skill,
  type SkillCategory,
  type SkillStats,
  type SkillStatus,
} from './services/skill-admin';

const selectClass =
  'h-9 w-full rounded border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

const CATEGORIES: SkillCategory[] = [
  'finance',
  'retail',
  'department_store',
  'hr',
  'property',
  'crm',
  'valuecard',
  'built_in',
];

const PAGE_SIZE = 20;

/** 技能状态徽标变体。 */
function statusVariant(status: SkillStatus): 'success' | 'secondary' | 'destructive' {
  switch (status) {
    case 'active':
      return 'success';
    case 'inactive':
      return 'secondary';
    default:
      return 'destructive';
  }
}

export function SkillManagePage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [stats, setStats] = useState<SkillStats>({ total: 0, active: 0, inactive: 0, byCategory: {}, bySource: {} });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bffError, setBffError] = useState<BffActionError | null>(null);
  const [filterCategory, setFilterCategory] = useState<'' | SkillCategory>('');
  const [filterStatus, setFilterStatus] = useState<'' | SkillStatus>('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [detail, setDetail] = useState<Skill | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await listSkills({
        page,
        pageSize: PAGE_SIZE,
        category: filterCategory,
        status: filterStatus,
      });
      setSkills(data.items);
      setTotal(data.total);
    } catch (err) {
      setSkills([]);
      setTotal(0);
      setError(err instanceof Error ? err.message : '获取 Skill 列表失败');
    } finally {
      setIsLoading(false);
    }
  }, [page, filterCategory, filterStatus]);

  const loadStats = useCallback(async (): Promise<void> => {
    setStats(await fetchSkillStats());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  /** 启停（写操作 → bff-actions，403 内联展示）。 */
  const handleToggleStatus = useCallback(
    async (skill: Skill): Promise<void> => {
      setBffError(null);
      const result = skill.status === 'active' ? await disableSkill(skill.skillId) : await enableSkill(skill.skillId);
      if (result.ok) {
        await load();
        await loadStats();
      } else {
        setBffError(result.error ?? null);
      }
    },
    [load, loadStats],
  );

  /** 删除（写操作 → bff-actions）。 */
  const handleDelete = useCallback(
    async (skill: Skill): Promise<void> => {
      if (!window.confirm(`确认删除 Skill "${skill.name}"（${skill.skillId}）吗？`)) {
        return;
      }
      setBffError(null);
      const result = await deleteSkill(skill.skillId);
      if (result.ok) {
        await load();
        await loadStats();
      } else {
        setBffError(result.error ?? null);
      }
    },
    [load, loadStats],
  );

  const headerActions = (
    <Button size="sm" variant="outline" onClick={() => void load()} disabled={isLoading}>
      <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
      刷新
    </Button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Skill 管理"
        description="管理 AI 技能的生命周期、分类与启停状态。"
        breadcrumbs={buildAppBreadcrumbs({ app: 'agent', title: 'Skill 管理' })}
        actions={headerActions}
      />

      {/* 统计卡 */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="总 Skill 数" value={stats.total} icon={Sparkles} />
        <StatCard label="已启用" value={stats.active} icon={Sparkles} />
        <StatCard label="已停用" value={stats.inactive} icon={Sparkles} />
      </div>

      {/* 筛选区 */}
      <div className="mb-3 flex flex-wrap items-end gap-3 rounded border bg-card p-3">
        <div className="w-44">
          <label className="mb-[0.4rem] block text-xs text-muted-foreground">分类</label>
          <select
            className={selectClass}
            value={filterCategory}
            onChange={(e) => {
              setFilterCategory(e.target.value as '' | SkillCategory);
              setPage(1);
            }}
          >
            <option value="">全部分类</option>
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {SKILL_CATEGORY_LABELS[cat]}
              </option>
            ))}
          </select>
        </div>
        <div className="w-40">
          <label className="mb-[0.4rem] block text-xs text-muted-foreground">状态</label>
          <select
            className={selectClass}
            value={filterStatus}
            onChange={(e) => {
              setFilterStatus(e.target.value as '' | SkillStatus);
              setPage(1);
            }}
          >
            <option value="">全部状态</option>
            <option value="active">启用</option>
            <option value="inactive">停用</option>
            <option value="deprecated">已废弃</option>
          </select>
        </div>
        <span className="pb-1.5 text-xs text-muted-foreground">共 {total} 条记录，第 {page} 页</span>
      </div>

      {/* 权限错误内联条（写操作 403，常驻非 toast） */}
      <div className="mb-3">
        <PermissionErrorBanner error={bffError} />
      </div>

      {/* 错误条 */}
      {error ? (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {/* 技能列表：表格吸顶单层滚动 */}
      <div className="min-h-0 flex-1 overflow-auto rounded border bg-card">
        <table className="w-full border-separate border-spacing-0 text-left text-sm">
          <thead className="sticky top-0 z-10 bg-table-header text-[13px] text-muted-foreground">
            <tr>
              {['Skill ID', '名称', '分类', '状态', '来源', '调用次数', '最后调用', '操作'].map((label, i) => (
                <th
                  key={label}
                  className={cn(
                    'whitespace-nowrap border-b border-border px-2.5 py-2 font-medium',
                    i > 0 && 'border-l border-border/60',
                  )}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={8} className="px-2.5 py-10 text-center text-sm text-muted-foreground">
                  加载中…
                </td>
              </tr>
            ) : skills.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-2.5 py-10 text-center text-sm text-muted-foreground">
                  暂无 Skill 数据
                </td>
              </tr>
            ) : (
              skills.map((skill) => (
                <tr key={skill.skillId} className="border-b border-border/50 last:border-0 hover:bg-muted/40">
                  <td className="whitespace-nowrap px-2.5 py-2">
                    <button
                      type="button"
                      className="font-mono text-xs text-primary hover:underline"
                      onClick={() => setDetail(skill)}
                    >
                      {skill.skillId}
                    </button>
                  </td>
                  <td className="max-w-[14rem] truncate px-2.5 py-2 font-medium" title={skill.description}>
                    {skill.name}
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-xs text-muted-foreground">
                    {SKILL_CATEGORY_LABELS[skill.category] ?? skill.category}
                  </td>
                  <td className="px-2.5 py-2">
                    <Badge variant={statusVariant(skill.status)}>{SKILL_STATUS_LABELS[skill.status]}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-xs text-muted-foreground">{skill.source}</td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-xs">{skill.callCount}</td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-xs text-muted-foreground">
                    {skill.lastCalledAt ? new Date(skill.lastCalledAt).toLocaleString() : '—'}
                  </td>
                  <td className="px-2.5 py-2">
                    <PermissionGate permission="agent:skill:manage">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="text-xs text-primary hover:underline"
                          onClick={() => void handleToggleStatus(skill)}
                        >
                          {skill.status === 'active' ? '停用' : '启用'}
                        </button>
                        <button
                          type="button"
                          className="text-xs text-destructive hover:underline"
                          onClick={() => void handleDelete(skill)}
                        >
                          删除
                        </button>
                      </div>
                    </PermissionGate>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      {total > PAGE_SIZE ? (
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">共 {total} 条记录，第 {page} 页</span>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              上一页
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page * PAGE_SIZE >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      ) : null}

      {/* 详情弹窗 */}
      {detail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-auto rounded bg-card p-4 shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Skill 详情</h3>
              <button
                type="button"
                aria-label="关闭"
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => setDetail(null)}
              >
                ×
              </button>
            </div>
            <dl className="space-y-2 text-sm">
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-xs text-muted-foreground">Skill ID</dt>
                <dd className="break-all font-mono text-xs">{detail.skillId}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-xs text-muted-foreground">名称</dt>
                <dd className="font-medium">{detail.name}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-xs text-muted-foreground">描述</dt>
                <dd className="whitespace-pre-wrap break-words text-muted-foreground">{detail.description || '—'}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-xs text-muted-foreground">分类</dt>
                <dd>{SKILL_CATEGORY_LABELS[detail.category] ?? detail.category}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-xs text-muted-foreground">状态</dt>
                <dd>
                  <Badge variant={statusVariant(detail.status)}>{SKILL_STATUS_LABELS[detail.status]}</Badge>
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-xs text-muted-foreground">标签</dt>
                <dd className="text-muted-foreground">{detail.tags.length > 0 ? detail.tags.join('、') : '—'}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-xs text-muted-foreground">版本</dt>
                <dd className="font-mono text-xs text-muted-foreground">{detail.version || '—'}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-xs text-muted-foreground">处理函数</dt>
                <dd className="break-all font-mono text-xs text-muted-foreground">{detail.handler || '—'}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-xs text-muted-foreground">超时</dt>
                <dd className="text-muted-foreground">{detail.timeout}s</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-xs text-muted-foreground">需审批</dt>
                <dd>{detail.requiresApproval ? '是' : '否'}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-xs text-muted-foreground">所需权限</dt>
                <dd className="break-all text-xs text-muted-foreground">
                  {detail.requiredPermissions.length > 0 ? detail.requiredPermissions.join('、') : '—'}
                </dd>
              </div>
              {detail.parameters && Object.keys(detail.parameters).length > 0 ? (
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-xs text-muted-foreground">参数</dt>
                  <dd>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded border bg-muted/40 p-2 text-[11px] text-muted-foreground">
                      {JSON.stringify(detail.parameters, null, 2)}
                    </pre>
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default SkillManagePage;
