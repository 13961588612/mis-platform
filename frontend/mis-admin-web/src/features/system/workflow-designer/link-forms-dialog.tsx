/**
 * 流程定义列表 ·「关联表单」弹窗。
 *
 * <p>左：可选表单（可搜索；已占用其他流程的不出现）；右：本流程已选表单。
 * 规则：一个表单只能关联一个流程；一个流程可关联多个表单。
 * 保存走 `PUT .../supported-forms`，不经编排弹窗。
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { fetchDefinitions, updateSupportedForms, type WfDefinition } from '@/lib/api/workflow';
import { useFormCatalog, type FormOption } from './form-catalog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export interface LinkFormsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  definition: WfDefinition;
  tenantId?: string;
  onSaved?: () => void;
}

export function LinkFormsDialog({
  open,
  onOpenChange,
  definition,
  tenantId = '1',
  onSaved,
}: LinkFormsDialogProps) {
  const { options, loading, notice } = useFormCatalog(tenantId);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [occupiedByOther, setOccupiedByOther] = useState<Map<string, string>>(new Map());
  const [loadingBindings, setLoadingBindings] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected([...(definition.supportedFormCodes ?? [])]);
    setQuery('');
    let cancelled = false;
    setLoadingBindings(true);
    void (async () => {
      try {
        const page = await fetchDefinitions(tenantId, 1, 200);
        if (cancelled) return;
        const map = new Map<string, string>();
        for (const d of page.list ?? []) {
          if (d.id === definition.id) continue;
          for (const code of d.supportedFormCodes ?? []) {
            if (code && !map.has(code)) map.set(code, d.name);
          }
        }
        setOccupiedByOther(map);
      } catch {
        if (!cancelled) setOccupiedByOther(new Map());
      } finally {
        if (!cancelled) setLoadingBindings(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, definition.id, definition.supportedFormCodes, tenantId]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const q = query.trim().toLowerCase();

  const available = useMemo(() => {
    return options.filter((o) => {
      if (selectedSet.has(o.code)) return false;
      if (occupiedByOther.has(o.code)) return false;
      if (!q) return true;
      return o.code.toLowerCase().includes(q) || o.name.toLowerCase().includes(q);
    });
  }, [options, selectedSet, occupiedByOther, q]);

  const selectedOptions = useMemo(() => {
    const byCode = new Map(options.map((o) => [o.code, o]));
    return selected.map((code) => {
      const hit = byCode.get(code);
      return hit ?? ({ code, name: code } satisfies FormOption);
    });
  }, [selected, options]);

  function add(code: string) {
    setSelected((prev) => (prev.includes(code) ? prev : [...prev, code]));
  }

  function remove(code: string) {
    setSelected((prev) => prev.filter((c) => c !== code));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateSupportedForms(definition.id, tenantId, selected);
      toast.success('关联表单已保存');
      onOpenChange(false);
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '关联表单失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>关联表单</DialogTitle>
          <DialogDescription>
            流程「{definition.name}」· 一个表单只能关联一个流程，本流程可关联多个表单
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex min-h-[280px] flex-col rounded-md border">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="text-[13px] font-medium">可选表单</span>
              <span className="text-[11px] text-muted-foreground">{available.length}</span>
            </div>
            <div className="border-b px-2 py-1.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索表单名称或编码"
                  className="h-8 pl-7"
                  aria-label="搜索可选表单"
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-1.5">
              {loading || loadingBindings ? (
                <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">加载中…</p>
              ) : available.length === 0 ? (
                <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">
                  {q ? '无匹配表单' : '暂无可选表单'}
                </p>
              ) : (
                available.map((o) => (
                  <button
                    key={o.code}
                    type="button"
                    data-testid="available-form"
                    onClick={() => add(o.code)}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {o.name}
                      <span className="ml-1 font-mono text-[11px] text-muted-foreground">({o.code})</span>
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="flex min-h-[280px] flex-col rounded-md border">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="text-[13px] font-medium">已选表单</span>
              <span className="text-[11px] text-muted-foreground">{selectedOptions.length}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-1.5">
              {selectedOptions.length === 0 ? (
                <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">尚未关联表单</p>
              ) : (
                selectedOptions.map((o) => (
                  <div
                    key={o.code}
                    data-testid="selected-form"
                    className={cn(
                      'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm',
                      'hover:bg-accent',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => remove(o.code)}
                      className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label={`移除 ${o.code}`}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <span className="min-w-0 flex-1 truncate">
                      {o.name}
                      <span className="ml-1 font-mono text-[11px] text-muted-foreground">({o.code})</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => remove(o.code)}
                      className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label={`删除 ${o.code}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {notice ? <p className="text-[11px] text-warning">{notice}</p> : null}

        <DialogFooter>
          <Button size="sm" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" disabled={saving || loading} onClick={() => void handleSave()}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default LinkFormsDialog;
