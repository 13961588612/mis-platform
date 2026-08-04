import { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/page-header';
import { PermissionGate } from '@/components/auth/permission-gate';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { KbLibraryPicker } from '../components/kb-library-picker';
import {
  KbSubjectSelector,
  type KbSubjectSelection,
} from '../components/kb-subject-selector';
import { grantAcl, listAcls, revokeAcl } from '../api/kb-api';
import type { KbAcl } from '../types';
import {
  KB_ACL_ACTION_OPTIONS,
  aclActionLabel,
  formatTime,
  subjectTypeLabel,
} from '../types';

const fieldLabel = 'mb-[0.4rem] block text-sm font-medium text-foreground';
const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

/**
 * 知识库权限（ACL）管理页。
 *
 * <p>可见性规则由 mis-kb 裁定：可见 = (公开 ∧ 启用) ∪ ACL(用户/角色/部门 read) − 停用。
 * 本页只负责授权项的增删与展示，不在前端复算可见性。
 *
 * <p>X-02 修复：动作枚举改为后端真实取值 `read|manage|acl`。修复前前端列的是
 * `read|write|admin`，选「读写」「管理」提交必被 mis-kb 拒绝——一个纯前端造出来的死路。
 *
 * <p>I-03：主体不再手填 ID，改用 {@link KbSubjectSelector} 选人 / 选角色 / 选部门树。
 */
export function KbPermissionPage() {
  const [libraryId, setLibraryId] = useState<number | null>(null);
  const [acls, setAcls] = useState<KbAcl[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [subjectType, setSubjectType] = useState('role');
  const [subject, setSubject] = useState<KbSubjectSelection | null>(null);
  const [action, setAction] = useState('read');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (id: number | null) => {
    if (id == null) {
      setAcls([]);
      return;
    }
    setLoading(true);
    try {
      setAcls(await listAcls(id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载授权失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(libraryId);
  }, [libraryId, load]);

  function openCreate() {
    if (libraryId == null) {
      toast.warning('请先选择知识库');
      return;
    }
    setSubjectType('role');
    setSubject(null);
    setAction('read');
    setOpen(true);
  }

  async function onSave() {
    if (libraryId == null) return;
    if (subject == null) {
      toast.warning('请选择授权主体');
      return;
    }
    setSaving(true);
    try {
      await grantAcl(libraryId, {
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        action,
      });
      toast.success('已授权');
      setOpen(false);
      await load(libraryId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '授权失败');
    } finally {
      setSaving(false);
    }
  }

  async function onRevoke(acl: KbAcl) {
    if (
      !window.confirm(
        `撤销 ${subjectTypeLabel(acl.subjectType)} #${acl.subjectId} 的「${aclActionLabel(acl.action)}」授权？`,
      )
    ) {
      return;
    }
    try {
      await revokeAcl(acl.id);
      toast.success('已撤销');
      await load(libraryId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '撤销失败');
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4 md:p-5">
      <PageHeader
        title="知识库权限"
        description="按用户 / 角色 / 部门授予知识库访问权；服务端据此裁定检索可见范围。"
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={loading || libraryId == null}
              onClick={() => void load(libraryId)}
            >
              <RefreshCw className="h-4 w-4" />
              刷新
            </Button>
            <PermissionGate permission="kb:acl:grant">
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                新增授权
              </Button>
            </PermissionGate>
          </div>
        }
      />

      <Alert className="mb-3">
        <AlertTitle>可见性规则</AlertTitle>
        <AlertDescription>
          可见 =（密级为「公开」且状态启用的知识库） ∪（当前用户 / 其角色 / 其所属部门被显式授予
          read 的知识库） −（状态停用的知识库）。停用优先级最高，授权也无法覆盖。
        </AlertDescription>
      </Alert>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">知识库</span>
        <div className="w-72">
          <KbLibraryPicker value={libraryId} onChange={setLibraryId} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-table-surface">
        <table className="w-full bg-table-surface text-left text-sm">
          <thead className="sticky top-0 z-10 border-b-2 border-foreground/20 bg-table-header text-muted-foreground backdrop-blur">
            <tr>
              <th className="px-3 py-2 font-bold">主体类型</th>
              <th className="px-3 py-2 font-bold">主体 ID</th>
              <th className="px-3 py-2 font-bold">权限</th>
              <th className="px-3 py-2 font-bold">授权时间</th>
              <th className="px-3 py-2 font-bold">操作</th>
            </tr>
          </thead>
          <tbody>
            {libraryId == null ? (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">
                  请先选择知识库
                </td>
              </tr>
            ) : loading ? (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">
                  加载中…
                </td>
              </tr>
            ) : acls.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">
                  暂无授权（若知识库密级为「公开」且启用，则默认全员可见）
                </td>
              </tr>
            ) : (
              acls.map((acl) => (
                <tr
                  key={acl.id}
                  className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe hover:bg-table-hover"
                >
                  <td className="px-3 py-2">{subjectTypeLabel(acl.subjectType)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{acl.subjectId}</td>
                  <td className="px-3 py-2">{aclActionLabel(acl.action)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {formatTime(acl.createdAt)}
                  </td>
                  <td className="px-3 py-2">
                    <PermissionGate permission="kb:acl:revoke">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-destructive hover:bg-destructive/10"
                        onClick={() => void onRevoke(acl)}
                      >
                        <Trash2 className="h-3 w-3" />
                        撤销
                      </button>
                    </PermissionGate>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex w-full flex-col sm:max-w-md">
          <SheetHeader>
            <SheetTitle>新增授权</SheetTitle>
          </SheetHeader>
          <div className="flex-1 space-y-3 overflow-auto py-4">
            <div>
              <label className={fieldLabel}>授权主体 *</label>
              <KbSubjectSelector
                subjectType={subjectType}
                onSubjectTypeChange={setSubjectType}
                value={subject}
                onChange={setSubject}
              />
            </div>
            <div>
              <label className={fieldLabel}>权限 *</label>
              <select
                className={selectClass}
                value={action}
                onChange={(e) => setAction(e.target.value)}
              >
                {KB_ACL_ACTION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                检索可见性仅取决于 read；manage 用于文档与配置的写操作，acl 可再授权他人。
              </p>
            </div>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button disabled={saving || subject == null} onClick={() => void onSave()}>
              保存
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
