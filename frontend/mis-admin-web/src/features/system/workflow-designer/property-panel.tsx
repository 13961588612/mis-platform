/**
 * 右侧属性面板（P7）。
 *
 * <p>选中节点时编辑节点属性（名称/审批人规则/超时/条件）；未选节点时编辑流程全局属性
 * （编码/名称/分类/说明）。表单关联已移至列表「关联表单」弹窗，编排内不再编辑。
 */
import { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CategorySingleTreeSelect } from '@/components/common/category-single-tree-select';
import type { CategoryTreeNode } from '@/components/common/category-tree-select';
import { cn } from '@/lib/utils';
import { useBizCategoryTree } from './biz-category-catalog';
import { AssigneeRuleEditor } from './assignee-rule-editor';
import { TIMEOUT_PRESETS } from './timeout-presets';
import type { WfFlowNode } from './types';

export { TIMEOUT_PRESETS, formatTimeoutHours } from './timeout-presets';

/**
 * 流程分类：租户通用业务分类 `biz_category` 邻接树下发的业务类型（软引用 `categoryId`）。
 * 旧 `WF_CATEGORIES` 硬编码枚举与 `wf_category` 均已废弃——分类由后端动态下发；
 * 编排属性面板与表单编辑弹窗一致，使用分类下拉树单选。
 */
export interface FlowMeta {
  code: string;
  name: string;
  categoryId: number | null;
  description: string;
  supportedFormCodes: string;
}

export interface PropertyPanelProps {
  selected: WfFlowNode | null;
  flowMeta: FlowMeta;
  onFlowMetaChange: (meta: FlowMeta) => void;
  onNodeChange: (id: string, patch: Partial<WfFlowNode['data']>) => void;
  onDeleteNode: (id: string) => void;
}

/** 在分类树中查找某 id 是否存在（编辑时判断当前分类是否仍在候选树里）。 */
function treeHasId(nodes: CategoryTreeNode[], id: string): boolean {
  for (const n of nodes) {
    if (String(n.id) === id) return true;
    if (n.children?.length && treeHasId(n.children, id)) return true;
  }
  return false;
}

export function PropertyPanel({
  selected,
  flowMeta,
  onFlowMetaChange,
  onNodeChange,
  onDeleteNode,
}: PropertyPanelProps) {
  const { tree: categoryTree, loading: catLoading, error: catError } = useBizCategoryTree('1');
  // 编辑时若当前分类不在候选项里（分类被删/跨租户），补一条兜底提示，避免下拉显示空白。
  const categoryMissing = useMemo(() => {
    if (flowMeta.categoryId == null) return null;
    const key = String(flowMeta.categoryId);
    return treeHasId(categoryTree, key) ? null : key;
  }, [flowMeta.categoryId, categoryTree]);

  if (!selected) {
    return (
      <div className="flex h-full w-[280px] shrink-0 flex-col overflow-auto border-l bg-card p-3">
        <h3 className="mb-2 text-[13px] font-semibold">流程全局属性</h3>
        <div className="space-y-3">
          <Field label="流程编码">
            <Input value={flowMeta.code} onChange={(e) => onFlowMetaChange({ ...flowMeta, code: e.target.value })} placeholder="PUR_APPROVAL" className="h-8" />
          </Field>
          <Field label="流程名称">
            <Input value={flowMeta.name} onChange={(e) => onFlowMetaChange({ ...flowMeta, name: e.target.value })} placeholder="采购审批流程" className="h-8" />
          </Field>
          <Field label="分类">
            <CategorySingleTreeSelect
              ariaLabel="分类"
              tree={categoryTree}
              value={flowMeta.categoryId == null ? null : String(flowMeta.categoryId)}
              onChange={(id) =>
                onFlowMetaChange({
                  ...flowMeta,
                  categoryId: id == null ? null : Number(id),
                })
              }
              placeholder="未分类"
              disabled={catLoading}
              fallbackLabel={categoryMissing ? `分类#${categoryMissing}` : null}
              triggerClassName="h-8 min-h-8 py-1"
            />
          </Field>
          {catError ? (
            <p className="text-[11px] text-warning">{catError}</p>
          ) : null}
          <Field label="说明">
            <Input value={flowMeta.description} onChange={(e) => onFlowMetaChange({ ...flowMeta, description: e.target.value })} className="h-8" />
          </Field>
          <p className="text-[11px] text-muted-foreground">
            表单关联请在「表单注册」中维护（NONE / 本地 / 外部）；流程列表可「查看关联表单」，编排不改关联。
          </p>
        </div>
      </div>
    );
  }

  const { data } = selected;
  return (
    <div className="flex h-full w-[280px] shrink-0 flex-col overflow-auto border-l bg-card p-3">
      <h3 className="mb-2 text-[13px] font-semibold">节点属性</h3>
      <div className="space-y-3">
        <Field label="节点编码">
          <Input value={data.nodeCode} onChange={(e) => onNodeChange(selected.id, { nodeCode: e.target.value })} className="h-8" />
        </Field>
        <Field label="节点名称">
          <Input value={data.nodeName} onChange={(e) => onNodeChange(selected.id, { nodeName: e.target.value })} className="h-8" />
        </Field>

        {(data.kind === 'APPROVAL' || data.kind === 'ROUTING' || data.kind === 'CC') && (
          <AssigneeRuleEditor
            value={data.assigneeRule}
            nodeKind={data.kind}
            onChange={(json) => onNodeChange(selected.id, { assigneeRule: json })}
          />
        )}

        {data.kind === 'ROUTING' && (
          <Field label="会签策略">
            <select
              value={data.routingStrategy ?? 'ALL_PASS'}
              onChange={(e) =>
                onNodeChange(selected.id, { routingStrategy: e.target.value as 'ALL_PASS' | 'ANY_PASS' })
              }
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="ALL_PASS">全部通过（会签）</option>
              <option value="ANY_PASS">任一通过（或签）</option>
            </select>
          </Field>
        )}

        {data.kind === 'APPROVAL' && (
          <Field label="超时（小时）">
            <Input
              type="number"
              min={1}
              value={data.timeoutHours ?? ''}
              onChange={(e) =>
                onNodeChange(selected.id, {
                  timeoutHours: e.target.value ? Number(e.target.value) : null,
                })
              }
              className="h-8"
              aria-label="超时小时数"
            />
            <div className="mt-1.5 flex flex-wrap gap-1">
              {TIMEOUT_PRESETS.map((p) => {
                const active = data.timeoutHours === p.hours;
                return (
                  <button
                    key={p.label}
                    type="button"
                    data-testid="timeout-preset"
                    aria-pressed={active}
                    onClick={() => onNodeChange(selected.id, { timeoutHours: p.hours })}
                    className={cn(
                      'rounded border px-1.5 py-0.5 text-[11px] transition',
                      active
                        ? 'border-primary bg-primary/10 font-medium text-primary'
                        : 'border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              可手输小时，或点快捷：按 1 天=24 小时、1 月=30 天、1 年=365 天折算。
            </p>
          </Field>
        )}

        {data.kind === 'CONDITIONAL' && (
          <Field label="条件表达式">
            <Input
              value={data.conditionExpr ?? ''}
              onChange={(e) => onNodeChange(selected.id, { conditionExpr: e.target.value })}
              className="h-8 font-mono text-[12px]"
            />
          </Field>
        )}

        <button
          type="button"
          onClick={() => onDeleteNode(selected.id)}
          className={cn('mt-2 w-full rounded-md border border-destructive/40 py-1.5 text-[13px] text-destructive transition hover:bg-destructive/10')}
        >
          删除此节点
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1 block text-[12px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

export default PropertyPanel;
