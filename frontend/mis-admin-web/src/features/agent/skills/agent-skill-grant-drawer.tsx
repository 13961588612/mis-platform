/**
 * 技能授权抽屉（技能池「设置权限」）：按目标 App 勾选 IAM 角色，写入 `ai:skill:{id}:run`。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { SubmitButton } from '@/components/common/submit-button';
import { PermissionGate } from '@/components/auth/permission-gate';
import { usePermission } from '@/hooks/use-permission';
import { AgentRolePicker } from '../components/agent-role-picker';
import { getSkillGrants, saveSkillGrants } from '../api/agent-ops-api';
import { agentErrorMessage } from '../types';
import type { SkillGrant } from '../types';

function runPermissionCode(skillId: string): string {
  return `ai:skill:${skillId}:run`;
}

export function AgentSkillGrantDrawer({
  skillId,
  skillName,
  open,
  onClose,
}: {
  skillId: string | null;
  skillName?: string;
  open: boolean;
  onClose: () => void;
}) {
  const { hasPermission } = usePermission();
  const canGrant = hasPermission('agent:skill:grant');

  const [grant, setGrant] = useState<SkillGrant | null>(null);
  const [grantLoading, setGrantLoading] = useState(false);
  const [grantError, setGrantError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [appCode, setAppCode] = useState<SkillGrant['target_app_code']>('system');
  const [roleIds, setRoleIds] = useState<number[]>([]);

  const loadGrant = useCallback(async () => {
    if (!open || !skillId) {
      setGrant(null);
      return;
    }
    setGrantLoading(true);
    setGrantError(null);
    try {
      const data = await getSkillGrants(skillId);
      setGrant(data);
      setAppCode(data.target_app_code ?? 'system');
      setRoleIds(data.role_ids ?? []);
    } catch (e) {
      setGrant(null);
      setGrantError(agentErrorMessage(e, '获取技能授权失败'));
    } finally {
      setGrantLoading(false);
    }
  }, [open, skillId]);

  useEffect(() => {
    void loadGrant();
  }, [loadGrant]);

  const dirty = useMemo(() => {
    if (!grant) return false;
    if (grant.target_app_code !== appCode) return true;
    const before = [...(grant.role_ids ?? [])].sort((a, b) => a - b);
    const after = [...roleIds].sort((a, b) => a - b);
    return before.length !== after.length || before.some((v, i) => v !== after[i]);
  }, [grant, appCode, roleIds]);

  async function onSave(): Promise<void> {
    if (!skillId) return;
    setSaving(true);
    try {
      const saved = await saveSkillGrants(skillId, {
        skill_id: skillId,
        permission_code: grant?.permission_code ?? runPermissionCode(skillId),
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

  const permissionCode = grant?.permission_code ?? (skillId ? runPermissionCode(skillId) : '');
  const codeMissing = grant?.permissionCodeRegistered === false;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="z-[60] flex w-full flex-col sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>设置权限</SheetTitle>
          <SheetDescription>
            选择哪些 IAM 角色（组）可以使用此技能。
            {skillName ? ` 当前：${skillName}` : null}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-5 py-4">
          {!skillId ? (
            <p className="text-sm text-muted-foreground">未选择技能</p>
          ) : grantLoading && grant == null && !grantError ? (
            <p className="text-sm text-muted-foreground">加载授权中…</p>
          ) : (
            <>
              <div className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs">
                执行码 {permissionCode}
              </div>
              {codeMissing ? (
                <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-warning">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>执行码尚未在 IAM 注册。保存授权时会顺带补建；若仍失败请检查 BFF 日志。</span>
                </div>
              ) : null}
              {grantError ? (
                <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
                  <span className="break-all">{grantError}</span>
                  <Button size="sm" variant="outline" onClick={() => void loadGrant()}>
                    重试
                  </Button>
                </div>
              ) : (
                <div className="min-h-0 flex-1">
                  <AgentRolePicker
                    appCode={appCode}
                    onAppCodeChange={setAppCode}
                    selectedRoleIds={roleIds}
                    onSelectedRoleIdsChange={setRoleIds}
                    disabled={!canGrant || grantLoading}
                  />
                </div>
              )}
            </>
          )}
        </div>

        <SheetFooter className="justify-end">
          {dirty ? <span className="mr-auto text-xs text-warning">有未保存的改动</span> : null}
          <Button size="sm" variant="outline" onClick={onClose}>
            关闭
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!dirty || saving || !skillId}
            onClick={() => void loadGrant()}
          >
            放弃修改
          </Button>
          <PermissionGate permission="agent:skill:grant">
            <SubmitButton
              size="sm"
              loading={saving}
              disabled={!dirty || grantLoading || !skillId}
              onClick={() => void onSave()}
            >
              <Save className="h-4 w-4" />
              保存授权
            </SubmitButton>
          </PermissionGate>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
