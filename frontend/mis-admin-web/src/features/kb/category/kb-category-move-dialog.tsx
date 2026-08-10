import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { moveCategory } from '../api/kb-api';
import { buildCategoryOptions, descendantIds, type CategoryOption } from './kb-category-tree';
import type { KbCategory } from '../types';

/** 目标候选 = 全树选项 + 前端置灰标记（自身/后代/管辖外）。 */
interface TargetOption extends CategoryOption {
  disabled: boolean;
}

export interface KbCategoryMoveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 待移动节点；null = 关闭态（不渲染内容）。 */
  node: KbCategory | null;
  /** 全量分类（含自身，用于排除后代）。 */
  categories: KbCategory[];
  /** 本人可管理的节点 id 集合（目标只能选管辖内节点）。 */
  manageableIds: Set<number>;
  /** 移动成功后回调（父级刷新）。 */
  onMoved: () => void | Promise<void>;
}

/**
 * 移动分类节点弹窗（知识库域一期，T05 / Q8）。
 *
 * <p><b>目标过滤口径</b>（与后端 {@code NodeAdminResolver.assertCanMove} 一致）：
 * <ul>
 *   <li>目标必须<b>在本人管辖内</b>（{@code manageableIds}），否则后端抛 40312；</li>
 *   <li>目标<b>不能是自己或自己的后代</b>（否则构成环，后端抛 40933）；</li>
 *   <li>选择「作为根分类」= {@code newParentId: null}，只需能管节点自身。</li>
 * </ul>
 *
 * <p>前端把明显非法项直接置灰/剔除，减少后端往返；最终判定仍以 mis-kb 为准
 * （双闸门：权限码 + 管辖）。
 */
export function KbCategoryMoveDialog({
  open,
  onOpenChange,
  node,
  categories,
  manageableIds,
  onMoved,
}: KbCategoryMoveDialogProps) {
  const [target, setTarget] = useState('');
  const [saving, setSaving] = useState(false);

  // 打开时重置选择（空串 = 作为根分类）
  useEffect(() => {
    if (open) {
      setTarget('');
      setSaving(false);
    }
  }, [open, node]);

  /** 目标候选：全树选项 - 自身及后代（可管节点才可选，其余置灰不可选但保留展示说明）。 */
  const options = useMemo<TargetOption[]>(() => {
    if (node == null) return [];
    const excluded = descendantIds(categories, node.id);
    excluded.add(node.id);
    return buildCategoryOptions(categories, null).map((o) => ({
      ...o,
      disabled: excluded.has(o.id),
    }));
  }, [categories, node]);

  const targetError = useMemo<string | null>(() => {
    if (target === '') return null;
    const id = Number(target);
    const opt = options.find((o) => o.id === id);
    if (!opt) return '目标分类不存在';
    if (opt.disabled) return '不能移动到自身或其子分类下';
    if (!manageableIds.has(id)) return '目标分类不在您的管辖范围内';
    return null;
  }, [target, options, manageableIds]);

  async function onSave() {
    if (node == null || targetError != null) return;
    setSaving(true);
    try {
      const newParentId = target === '' ? null : Number(target);
      await moveCategory(node.id, newParentId);
      toast.success(newParentId == null ? '已移为根分类' : '已移动分类');
      onOpenChange(false);
      await onMoved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '移动分类失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRight className="h-4 w-4 text-primary" />
            移动分类：{node?.name ?? ''}
          </DialogTitle>
          <DialogDescription>
            选择目标父分类；管理范围 = 您可管理的节点。目标不能是自身或其子分类。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <p className="mb-1.5 text-sm font-medium text-foreground">目标上级分类</p>
            <select
              className="h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">（作为根分类）</option>
              {options.map((o) => (
                <option key={o.id} value={String(o.id)} disabled={o.disabled}>
                  {'　'.repeat(o.depth)}
                  {o.name}
                  {!manageableIds.has(o.id) ? '（管辖外）' : ''}
                </option>
              ))}
            </select>
          </div>

          {targetError ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {targetError}
            </p>
          ) : null}

          <p className="rounded-md bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            提示：目标仅限「本人可管理」的节点；移动到管辖外会被拒绝（40312），
            移到自己后代下会被拒绝（40933）。移动后子树整体迁移，子分类与知识库归属不变。
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={targetError != null || saving} onClick={() => void onSave()}>
            {saving ? '移动中…' : '确认移动'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
