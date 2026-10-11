/**
 * 右侧属性面板（P7）。
 *
 * <p>选中节点时编辑节点属性（名称/审批人规则/超时/条件）；未选节点时编辑流程全局属性
 * （编码/名称/分类/**表单白名单多选**）。表单白名单正是「一个流程对接多个表单」的落地点。
 */
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MultiSelect } from '@/components/ui/multi-select';
import { cn } from '@/lib/utils';
import {
  missingFormCodes,
  parseFormCodes,
  serializeFormCodes,
  useFormCatalog,
  type FormOption,
} from './form-catalog';
import { useBizCategories } from './biz-category-catalog';
import type { WfFlowNode } from './types';

/**
 * 流程分类：租户通用业务分类 `biz_category` 邻接树下发的业务类型（软引用 `categoryId`）。
 * 旧 `WF_CATEGORIES` 硬编码枚举与 `wf_category` 均已废弃——分类由后端动态下发。
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

export function PropertyPanel({
  selected,
  flowMeta,
  onFlowMetaChange,
  onNodeChange,
  onDeleteNode,
}: PropertyPanelProps) {
  const { options: categoryOptions, loading: catLoading, error: catError } = useBizCategories('1');
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
            <select
              aria-label="分类"
              value={flowMeta.categoryId == null ? '' : String(flowMeta.categoryId)}
              onChange={(e) =>
                onFlowMetaChange({
                  ...flowMeta,
                  categoryId: e.target.value === '' ? null : Number(e.target.value),
                })
              }
              disabled={catLoading}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">未分类</option>
              {categoryOptions.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          {catError ? (
            <p className="text-[11px] text-warning">{catError}</p>
          ) : null}
          <Field label="说明">
            <Input value={flowMeta.description} onChange={(e) => onFlowMetaChange({ ...flowMeta, description: e.target.value })} className="h-8" />
          </Field>
          <FormWhitelistField
            supportedFormCodes={flowMeta.supportedFormCodes}
            onChange={(codes) => onFlowMetaChange({ ...flowMeta, supportedFormCodes: serializeFormCodes(codes) })}
          />
          <p className="text-[11px] text-muted-foreground">
            一个流程可绑定多个表单；启动实例时表单代码必须在此白名单内。
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

        {(data.kind === 'APPROVAL' || data.kind === 'ROUTING') && (
          <>
            <Field label="审批人规则（JSON）">
              <textarea
                value={data.assigneeRule}
                onChange={(e) => onNodeChange(selected.id, { assigneeRule: e.target.value })}
                rows={3}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 font-mono text-[12px]"
                placeholder='{"type":"FIXED","value":123}'
              />
            </Field>
            <p className="text-[11px] text-muted-foreground">
              支持 SELF / FIXED / USER_LIST / SUPERVISOR / ROLE / DEPT_LEADER
            </p>
          </>
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
              value={data.timeoutHours ?? ''}
              onChange={(e) => onNodeChange(selected.id, { timeoutHours: e.target.value ? Number(e.target.value) : null })}
              className="h-8"
            />
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

/**
 * 表单白名单：下拉多选（T4.6）。
 *
 * <p>候选项来自后端「已启用」清单与前端「已实现」清单的**交集**，不再允许手打字符串
 * ——手打能绕过任何前端校验，拼错了只能等保存时被后端拒。
 *
 * <p>⚠️ 后端不就绪时降级为「前端已实现清单」并打出可见提示，绝不白屏。
 */
export function FormWhitelistField({
  supportedFormCodes,
  onChange,
  tenantId = '1',
}: {
  supportedFormCodes: string;
  onChange: (codes: string[]) => void;
  tenantId?: string;
}) {
  const { options, loading, notice } = useFormCatalog(tenantId);
  const selected = parseFormCodes(supportedFormCodes);
  const missing = missingFormCodes(options, selected);
  const selectOptions = [
    ...options.map((o: FormOption) => ({ value: o.code, label: `${o.name}（${o.code}）` })),
    ...missing.map((code) => ({ value: code, label: `${code}（未注册或已停用）` })),
  ];

  return (
    <Field label="表单白名单">
      <MultiSelect
        options={selectOptions}
        value={selected}
        onChange={onChange}
        placeholder={loading ? '加载表单清单…' : '选择表单（可多选）'}
        disabled={loading}
      />
      {notice ? <p className="mt-1 text-[11px] text-warning">{notice}</p> : null}
      {missing.length > 0 ? (
        <p className="mt-1 text-[11px] text-destructive">
          已选中的 {missing.join('、')} 未注册或已停用，保存会被后端拒绝。
        </p>
      ) : null}
    </Field>
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
