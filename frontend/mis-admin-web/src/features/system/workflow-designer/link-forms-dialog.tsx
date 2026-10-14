/**
 * 流程定义列表 ·「查看关联表单」（只读反查）。
 *
 * <p>V149 起关联真相源在 {@code form_definition}；本弹窗仅展示已挂到本流程的表单，
 * 维护请到「表单注册」。DTO {@code supportedFormCodes} 为后端反查投影。
 */
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { WfDefinition } from '@/lib/api/workflow';
import { useFormCatalog, type FormOption } from './form-catalog';

export interface LinkFormsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  definition: WfDefinition;
  tenantId?: string;
  /** @deprecated 只读弹窗不再保存 */
  onSaved?: () => void;
}

export function LinkFormsDialog({
  open,
  onOpenChange,
  definition,
  tenantId = '1',
}: LinkFormsDialogProps) {
  const { options, loading } = useFormCatalog(tenantId);
  const codes = definition.supportedFormCodes ?? [];

  const linked = useMemo(() => {
    const byCode = new Map(options.map((o) => [o.code, o]));
    return codes.map((code) => {
      const hit = byCode.get(code);
      return hit ?? ({ code, name: code } satisfies FormOption);
    });
  }, [codes, options]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>关联表单</DialogTitle>
          <DialogDescription>
            流程「{definition.name}」· 只读反查；请在「表单注册」中维护关联（NONE / 本地 / 外部）
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[200px] rounded-md border">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-[13px] font-medium">已关联表单</span>
            <span className="text-[11px] text-muted-foreground">{linked.length}</span>
          </div>
          <div className="max-h-[320px] overflow-auto p-1.5">
            {loading ? (
              <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">加载中…</p>
            ) : linked.length === 0 ? (
              <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">
                暂无关联表单。请到系统管理 → 表单注册中选择本流程。
              </p>
            ) : (
              linked.map((o) => (
                <div
                  key={o.code}
                  data-testid="selected-form"
                  className="rounded-sm px-2 py-1.5 text-sm"
                >
                  <span className="min-w-0 truncate">
                    {o.name}
                    <span className="ml-1 font-mono text-[11px] text-muted-foreground">({o.code})</span>
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            size="sm"
            variant="outline"
            data-testid="link-forms-close"
            onClick={() => onOpenChange(false)}
          >
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default LinkFormsDialog;
