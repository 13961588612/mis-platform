/**
 * 技能权限页（UI#2，路径 `/agent/skills/permissions`，V19 菜单 `92038`）。
 *
 * <p>覆盖 §4.3 #1 取 Skill 列表 / #10 读授权 / #11 存授权 / #12 拉角色（在 `AgentRolePicker` 内）。
 *
 * <p>左侧选 Skill，右侧按**目标 App** 选 `sys_role`。授权对象是 IAM 的角色，
 * 不是 YAML 里的 `coordinator|worker` —— 这两个"角色"同名但毫无关系（ui.md §3.1 已警示）。
 *
 * <p>两处必须出现在界面上的提示（否则会被当缺陷提报）：
 *   1. 执行码 `ai:skill:{id}:run` 明示（运营需要拿它去别处对账）；
 *   2. `permissionCodeRegistered === false` 时的补建提示（§5.4 方案 A：懒注册可能失败）；
 *   3. 跨 App 语义说明 —— 在 `AgentRolePicker` 内。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, KeyRound, RefreshCw, Save, Search } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { SubmitButton } from '@/components/common/submit-button';
import { PermissionGate } from '@/components/auth/permission-gate';
import { usePermission } from '@/hooks/use-permission';
import { AgentPageShell } from '../components/agent-page-shell';
import { AgentRolePicker } from '../components/agent-role-picker';
import { AgentStatusBadge } from '../components/agent-status-badge';
import { getSkillGrants, listSkills, saveSkillGrants } from '../api/agent-ops-api';
import { agentErrorMessage } from '../types';
import type { Skill, SkillGrant } from '../types';

/** 执行码格式（§5.4，Java / Python 两端必须生成完全一致的串）。 */
function runPermissionCode(skillId: string): string {
  return `ai:skill:${skillId}:run`;
}

export function AgentSkillsPermissionsPage() {
  const { hasPermission } = usePermission();
  const canGrant = hasPermission('agent:skill:grant');

  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');

  const [selectedId, setSelectedId] = useState<string>('');
  const [grant, setGrant] = useState<SkillGrant | null>(null);
  const [grantLoading, setGrantLoading] = useState(false);
  const [grantError, setGrantError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** 右侧编辑态（与已加载的 grant 分离，便于判断"有未保存改动"）。 */
  const [appCode, setAppCode] = useState<SkillGrant['target_app_code']>('system');
  const [roleIds, setRoleIds] = useState<number[]>([]);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listSkills();
      setSkills(list);
      setSelectedId((prev) => (prev && list.some((s) => s.id === prev) ? prev : (list[0]?.id ?? '')));
    } catch (e) {
      setError(agentErrorMessage(e, '获取技能列表失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  const loadGrant = useCallback(async () => {
    if (!selectedId) {
      setGrant(null);
      return;
    }
    setGrantLoading(true);
    setGrantError(null);
    try {
      const data = await getSkillGrants(selectedId);
      setGrant(data);
      setAppCode(data.target_app_code ?? 'system');
      setRoleIds(data.role_ids ?? []);
    } catch (e) {
      setGrant(null);
      setGrantError(agentErrorMessage(e, '获取技能授权失败'));
    } finally {
      setGrantLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void loadGrant();
  }, [loadGrant]);

  const filteredSkills = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return skills;
    return skills.filter(
      (s) => s.name.toLowerCase().includes(kw) || s.id.toLowerCase().includes(kw),
    );
  }, [skills, keyword]);

  const selectedSkill = useMemo(
    () => skills.find((s) => s.id === selectedId) ?? null,
    [skills, selectedId],
  );

  /** 目标 App 变了或角色集合变了都算未保存改动。 */
  const dirty = useMemo(() => {
    if (!grant) return false;
    if (grant.target_app_code !== appCode) return true;
    const before = [...(grant.role_ids ?? [])].sort((a, b) => a - b);
    const after = [...roleIds].sort((a, b) => a - b);
    return before.length !== after.length || before.some((v, i) => v !== after[i]);
  }, [grant, appCode, roleIds]);

  async function onSave(): Promise<void> {
    if (!selectedId) return;
    setSaving(true);
    try {
      const saved = await saveSkillGrants(selectedId, {
        skill_id: selectedId,
        permission_code: grant?.permission_code ?? runPermissionCode(selectedId),
        target_app_code: appCode,
        role_ids: roleIds,
      });
      setGrant(saved);
      setAppCode(saved.target_app_code ?? appCode);
      setRoleIds(saved.role_ids ?? roleIds);
      toast.success('授权已保存');
    } catch (e) {
      toast.error(agentErrorMessage(e, '保存技能授权失败'));
    } finally {
      setSaving(false);
    }
  }

  const permissionCode = grant?.permission_code ?? (selectedId ? runPermissionCode(selectedId) : '');
  const codeMissing = grant?.permissionCodeRegistered === false;

  const headerActions = (
    <Button size="sm" variant="outline" onClick={() => void loadSkills()} disabled={loading}>
      <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
      刷新
    </Button>
  );

  return (
    <AgentPageShell
      title="技能权限"
      description="技能执行码的角色授权。授权对象是 IAM 角色，与 YAML 里的 coordinator/worker 无关。"
      permission="agent:skill:grant"
      actions={headerActions}
      loading={loading && skills.length === 0}
      error={error}
      onRetry={() => void loadSkills()}
      empty={!loading && !error && skills.length === 0}
      emptyText="技能池为空"
      emptyHint="请先在「技能池」注册技能，再来此页为其执行码分配角色。"
    >
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[20rem_1fr]">
        {/* 左：Skill 列表 */}
        <Card className="flex min-h-0 flex-col overflow-hidden">
          <div className="border-b p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="搜索技能名称或 ID"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {filteredSkills.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">没有匹配的技能</p>
            ) : (
              <ul className="divide-y">
                {filteredSkills.map((skill) => {
                  const active = skill.id === selectedId;
                  return (
                    <li key={skill.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(skill.id)}
                        className={cn(
                          'flex w-full flex-col items-start gap-1 px-3 py-2.5 text-left hover:bg-accent/50',
                          active && 'bg-accent',
                        )}
                      >
                        <span className="flex w-full items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">
                            {skill.name}
                          </span>
                          <AgentStatusBadge kind="skillStatus" value={skill.status} />
                        </span>
                        <span className="w-full truncate font-mono text-xs text-muted-foreground">
                          {skill.id}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>

        {/* 右：授权编辑 */}
        <Card className="flex min-h-0 flex-col overflow-hidden">
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
            {!selectedSkill ? (
              <p className="py-10 text-center text-sm text-muted-foreground">请先在左侧选择一个技能</p>
            ) : (
              <>
                <div>
                  <h3 className="text-base font-semibold">{selectedSkill.name}</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {selectedSkill.description}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">
                  <KeyRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="text-muted-foreground">执行码</span>
                  <span className="break-all font-mono font-medium text-foreground">
                    {permissionCode}
                  </span>
                </div>

                {codeMissing ? (
                  <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-muted-foreground">
                    <AlertTriangle className="mt-[0.1rem] h-3.5 w-3.5 shrink-0 text-warning" />
                    <p className="leading-relaxed">
                      该执行码尚未在权限中心注册（创建技能时的懒注册未成功）。
                      在此保存授权会<span className="font-medium text-foreground">顺带补建</span>
                      该码；若保存后此提示仍在，请联系管理员检查权限中心连通性
                      —— 码不存在时运行期一律 fail-closed 拒绝执行。
                    </p>
                  </div>
                ) : null}

                {grantError ? (
                  <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
                    <span className="break-all">{grantError}</span>
                    <Button size="sm" variant="outline" onClick={() => void loadGrant()}>
                      重试
                    </Button>
                  </div>
                ) : null}

                <div className="min-h-0 flex-1">
                  <AgentRolePicker
                    appCode={appCode}
                    onAppCodeChange={setAppCode}
                    selectedRoleIds={roleIds}
                    onSelectedRoleIdsChange={setRoleIds}
                    disabled={!canGrant || grantLoading}
                  />
                </div>

                <div className="flex items-center justify-end gap-2 border-t pt-3">
                  {dirty ? (
                    <span className="mr-auto text-xs text-warning">有未保存的改动</span>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!dirty || saving}
                    onClick={() => void loadGrant()}
                  >
                    放弃修改
                  </Button>
                  <PermissionGate permission="agent:skill:grant">
                    <SubmitButton
                      size="sm"
                      loading={saving}
                      disabled={!dirty || grantLoading}
                      onClick={() => void onSave()}
                    >
                      <Save className="h-4 w-4" />
                      保存授权
                    </SubmitButton>
                  </PermissionGate>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AgentPageShell>
  );
}
