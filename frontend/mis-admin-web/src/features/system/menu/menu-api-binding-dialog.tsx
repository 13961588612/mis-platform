/**
 * 菜单「关联 API」绑定弹层。
 *
 * <p>按「模块 → 接口树」勾选接口，已绑定接口回显勾选态；保存走
 * {@code PUT /menus/{menuId}/apis} 全量替换（勾选集即最终集合，未勾选即解绑）。
 *
 * <p>仅 {@code type === 'api'} 叶子可绑定；分组（catalog）提供半选/全选语义：
 * 全选=勾选该分组下全部接口叶子，半选=部分勾选，取消=移除该分组下全部叶子。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { fetchModuleApiTree, fetchModules } from '@/lib/api/modules';
import { fetchMenuApis, replaceMenuApis } from '@/lib/api/menus';
import type { ModuleApiNode, ModuleItem } from '@/types/api';

const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

interface MenuApiBindingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 目标菜单 id。 */
  menuId: string;
  /** 目标菜单名称（标题展示）。 */
  menuName: string;
  /** 保存成功后回调（父级重拉菜单树刷新 apiList）。 */
  onSaved: () => void;
}

interface TriStateCheckboxProps {
  checked: boolean;
  indeterminate: boolean;
  disabled?: boolean;
  onChange: () => void;
}

/** 支持半选态的原生 checkbox（半选通过 DOM indeterminate 表达）。 */
function TriStateCheckbox({ checked, indeterminate, disabled = false, onChange }: TriStateCheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate && !checked;
    }
  }, [checked, indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="h-3.5 w-3.5 cursor-pointer accent-primary"
      checked={checked}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

/** 收集子树内全部接口叶子 id（不含分组）。 */
function collectApiIds(nodes: ModuleApiNode[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (n.type === 'api') {
      out.push(n.id);
    } else {
      out.push(...collectApiIds(n.children ?? []));
    }
  }
  return out;
}

export function MenuApiBindingDialog({
  open,
  onOpenChange,
  menuId,
  menuName,
  onSaved,
}: MenuApiBindingDialogProps) {
  const [modules, setModules] = useState<ModuleItem[]>([]);
  const [selectedModuleId, setSelectedModuleId] = useState<string>('');
  const [apiTree, setApiTree] = useState<ModuleApiNode[]>([]);
  const [checkedApiIds, setCheckedApiIds] = useState<Set<string>>(new Set());
  const [collapsedCatalogIds, setCollapsedCatalogIds] = useState<Set<string>>(new Set());
  const [loadingInitial, setLoadingInitial] = useState(false);
  const [loadingTree, setLoadingTree] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadInitial = useCallback(async () => {
    setLoadingInitial(true);
    try {
      const [moduleList, bound] = await Promise.all([
        fetchModules(),
        fetchMenuApis(menuId),
      ]);
      setModules(moduleList);
      setCheckedApiIds(new Set(bound.map((b) => String(b.apiId))));
      if (moduleList.length > 0) {
        const firstId = String(moduleList[0].id);
        setSelectedModuleId(firstId);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载绑定数据失败');
    } finally {
      setLoadingInitial(false);
    }
  }, [menuId]);

  useEffect(() => {
    if (open) {
      void loadInitial();
    } else {
      // 关闭时复位，避免下次打开残留旧数据
      setModules([]);
      setSelectedModuleId('');
      setApiTree([]);
      setCheckedApiIds(new Set());
      setCollapsedCatalogIds(new Set());
    }
  }, [open, loadInitial]);

  const loadTree = useCallback(async (moduleId: string) => {
    setLoadingTree(true);
    try {
      setApiTree(await fetchModuleApiTree(moduleId));
      setCollapsedCatalogIds(new Set());
    } catch (e) {
      setApiTree([]);
      toast.error(e instanceof Error ? e.message : '加载接口树失败');
    } finally {
      setLoadingTree(false);
    }
  }, []);

  useEffect(() => {
    if (open && selectedModuleId) {
      void loadTree(selectedModuleId);
    }
  }, [open, selectedModuleId, loadTree]);

  /** 分组勾选态：全部子叶子已勾 / 部分已勾。 */
  const catalogState = useCallback(
    (node: ModuleApiNode): { checked: boolean; indeterminate: boolean } => {
      const ids = collectApiIds(node.children ?? []);
      if (ids.length === 0) return { checked: false, indeterminate: false };
      const checkedCount = ids.filter((id) => checkedApiIds.has(id)).length;
      return {
        checked: checkedCount === ids.length,
        indeterminate: checkedCount > 0 && checkedCount < ids.length,
      };
    },
    [checkedApiIds],
  );

  function toggleApi(id: string): void {
    setCheckedApiIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleCatalog(node: ModuleApiNode): void {
    const ids = collectApiIds(node.children ?? []);
    if (ids.length === 0) return;
    const allChecked = ids.every((id) => checkedApiIds.has(id));
    setCheckedApiIds((prev) => {
      const next = new Set(prev);
      if (allChecked) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function toggleCollapse(id: string): void {
    setCollapsedCatalogIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearChecked(): void {
    setCheckedApiIds(new Set());
  }

  async function handleSave(): Promise<void> {
    setSaving(true);
    try {
      await replaceMenuApis(menuId, [...checkedApiIds]);
      toast.success('已保存绑定');
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  const renderTree = useCallback(
    (nodes: ModuleApiNode[], depth: number): React.ReactNode => {
      return nodes.map((node) => {
        const isCatalog = node.type === 'catalog';
        const hasChildren = (node.children?.length ?? 0) > 0;
        const collapsed = collapsedCatalogIds.has(node.id);
        if (isCatalog) {
          const state = catalogState(node);
          return (
            <div key={node.id}>
              <div
                className="flex items-center gap-1.5 rounded px-2 py-1 text-sm hover:bg-accent/50"
                style={{ paddingLeft: 8 + depth * 16 }}
              >
                <button
                  type="button"
                  className={cn(
                    'inline-flex items-center rounded p-0.5 text-muted-foreground hover:text-foreground',
                    !hasChildren && 'invisible',
                  )}
                  onClick={() => hasChildren && toggleCollapse(node.id)}
                  aria-label={collapsed ? '展开分组' : '折叠分组'}
                >
                  {collapsed ? (
                    <ChevronRight className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </button>
                <TriStateCheckbox
                  checked={state.checked}
                  indeterminate={state.indeterminate}
                  disabled={!hasChildren}
                  onChange={() => toggleCatalog(node)}
                />
                <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium text-foreground">{node.name}</span>
              </div>
              {hasChildren && !collapsed ? renderTree(node.children ?? [], depth + 1) : null}
            </div>
          );
        }
        // 接口叶子
        const checked = checkedApiIds.has(node.id);
        return (
          <label
            key={node.id}
            className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-sm hover:bg-accent/50"
            style={{ paddingLeft: 8 + depth * 16 }}
          >
            <span className="inline-block w-3.5 shrink-0" />
            <TriStateCheckbox checked={checked} indeterminate={false} onChange={() => toggleApi(node.id)} />
            <span
              className={cn(
                'shrink-0 rounded px-1.5 py-0.5 text-[0.65rem] font-semibold',
                node.httpMethod
                  ? 'bg-muted text-muted-foreground'
                  : 'text-muted-foreground',
              )}
            >
              {node.httpMethod ?? '—'}
            </span>
            <span className="min-w-0 flex-1 truncate">{node.name}</span>
            {node.pathPattern ? (
              <code className="hidden shrink-0 font-mono text-xs text-muted-foreground sm:inline">
                {node.pathPattern}
              </code>
            ) : null}
          </label>
        );
      });
    },
    [checkedApiIds, collapsedCatalogIds, catalogState],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>绑定 API — {menuName}</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="w-56 shrink-0">
              <label className="mb-[0.35rem] block text-sm font-medium text-foreground">
                选择模块
              </label>
              <select
                className={selectClass}
                value={selectedModuleId}
                disabled={loadingInitial || modules.length === 0}
                onChange={(e) => setSelectedModuleId(e.target.value)}
              >
                <option value="">请选择模块</option>
                {modules.map((m) => (
                  <option key={m.id} value={String(m.id)}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 self-end pb-1 text-xs text-muted-foreground">
              已勾选 <span className="font-semibold text-foreground">{checkedApiIds.size}</span> 个接口
              {checkedApiIds.size > 0 ? (
                <button
                  type="button"
                  className="ml-2 rounded px-1.5 py-0.5 text-muted-foreground underline-offset-2 hover:bg-accent hover:text-foreground"
                  onClick={clearChecked}
                >
                  清空
                </button>
              ) : null}
            </div>
          </div>

          <div className="min-h-[16rem] flex-1 overflow-auto rounded-md border p-2">
            {loadingInitial ? (
              <div className="flex h-full items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                加载绑定数据…
              </div>
            ) : modules.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">暂无可绑定模块</p>
            ) : !selectedModuleId ? (
              <p className="py-12 text-center text-sm text-muted-foreground">请先选择模块</p>
            ) : loadingTree ? (
              <div className="flex h-full items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                加载接口树…
              </div>
            ) : apiTree.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">该模块下暂无接口</p>
            ) : (
              <div className="space-y-0.5">{renderTree(apiTree, 0)}</div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={saving || loadingInitial} onClick={() => void handleSave()}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
