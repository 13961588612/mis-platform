import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { KbSubjectSelector, type KbSubjectSelection } from '../components/kb-subject-selector';
import { grantCategoryAdmin, listCategoryAdmins, revokeCategoryAdmin } from '../api/kb-api';
import type { KbCategoryAdmin } from '../types';
import { formatTime, subjectTypeLabel } from '../types';

export interface KbCategoryAdminDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 目标分类节点；null = 关闭态（不渲染内容）。 */
  categoryId: number | null;
  /** 节点名，用于标题展示。 */
  categoryName: string;
  /** 变更成功后回调（父级刷新）。 */
  onChanged: () => void | Promise<void>;
}

/**
 * 分类节点管理员弹窗（知识库域一期，T05）。
 *
 * <p>展示「谁可以管理该节点子树」，支持添加三类主体（user/role/dept）与移除。
 * 管理范围口径与后端一致：授权某节点 = 管理以该节点为根的<b>整棵子树</b>。
 *
 * <p><b>双闸门提示</b>：本功能受功能权限码 {@code kb:category:manage} 与管辖校验
 * 双重门控（BFF 兜底判权 + mis-kb 服务层 assertNodeManage）。前端按钮已按
 * 权限码显隐，但管辖不足时后端仍会拒绝——弹窗内给出文案，避免用户误以为故障。
 */
export function KbCategoryAdminDialog({
  open,
  onOpenChange,
  categoryId,
  categoryName,
  onChanged,
}: KbCategoryAdminDialogProps) {
  const [admins, setAdmins] = useState<KbCategoryAdmin[]>([]);
  const [loading, setLoading] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [subjectType, setSubjectType] = useState('user');
  const [selection, setSelection] = useState<KbSubjectSelection | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (categoryId == null) return;
    setLoading(true);
    setError(null);
    try {
      setAdmins(await listCategoryAdmins(categoryId));
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载管理员列表失败');
      setAdmins([]);
    } finally {
      setLoading(false);
    }
  }, [categoryId]);

  useEffect(() => {
    if (!open || categoryId == null) return;
    setSubjectType('user');
    setSelection(null);
    setAdding(false);
    setRemovingId(null);
    void load();
  }, [open, categoryId, load]);

  async function onAdd() {
    if (categoryId == null || selection == null) return;
    setAdding(true);
    try {
      await grantCategoryAdmin(categoryId, {
        subjectType: selection.subjectType,
        subjectId: selection.subjectId,
      });
      toast.success(`已添加「${selection.subjectName}」为管理员`);
      setSelection(null);
      await load();
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '添加管理员失败');
    } finally {
      setAdding(false);
    }
  }

  async function onRemove(admin: KbCategoryAdmin) {
    if (!window.confirm(
      `移除管理员「${subjectTypeLabel(admin.subjectType)} #${admin.subjectId}」？\n` +
      '移除后该主体将失去对本节点子树的管辖；其名下已建子目录保留（仅失权）。',
    )) {
      return;
    }
    setRemovingId(admin.id);
    try {
      await revokeCategoryAdmin(admin.id);
      toast.success('已移除管理员');
      await load();
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '移除管理员失败');
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            分类管理员：{categoryName}
          </DialogTitle>
          <DialogDescription>
            管理范围 = 该节点整棵子树。被授权主体可在此子树下增删改分类与知识库。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          {/* 现有管理员列表 */}
          <div>
            <p className="mb-1.5 text-sm font-medium text-foreground">当前管理员</p>
            {loading ? (
              <div className="flex h-20 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                加载中…
              </div>
            ) : admins.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground">
                暂无管理员授权。默认仅全局管理员（TENANT_ADMIN 角色）可管本节点。
              </p>
            ) : (
              <ul className="max-h-44 space-y-1.5 overflow-auto rounded-md border bg-card p-1.5">
                {admins.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-foreground">
                        {subjectTypeLabel(a.subjectType)}
                        <span className="ml-1 text-muted-foreground">#{a.subjectId}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatTime(a.createdAt)}
                        {a.createdBy != null ? ` · 授权人 #${a.createdBy}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-destructive hover:bg-destructive/10"
                      disabled={removingId === a.id}
                      onClick={() => void onRemove(a)}
                    >
                      <Trash2 className="h-3 w-3" />
                      {removingId === a.id ? '移除中…' : '移除'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 添加管理员 */}
          <div>
            <p className="mb-1.5 flex items-center gap-1 text-sm font-medium text-foreground">
              <UserPlus className="h-3.5 w-3.5" />
              添加管理员
            </p>
            <KbSubjectSelector
              subjectType={subjectType}
              onSubjectTypeChange={setSubjectType}
              value={selection}
              onChange={setSelection}
            />
            <Button
              className="mt-2 w-full"
              disabled={selection == null || adding}
              onClick={() => void onAdd()}
            >
              {adding ? '添加中…' : '添加为管理员'}
            </Button>
          </div>

          <p className="rounded-md bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            提示：本功能受权限码「kb:category:manage」与管辖校验双重门控。若您能打开本弹窗
            但提交被拒绝，通常是管辖不足（需先由更上级管理员授权）；移除管理员不影响其名下
            已建子目录（仅失权）。
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
