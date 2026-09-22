/**
 * MeasureDimensionList.tsx — Cube 的 metrics/dimensions 列表编辑器（v1.11 MR-06；T03c）。
 *
 * <h2>职责</h2>
 * 只管**列表的增删改 UI**：不做请求、不做校验（校验在 `cubeUtils.validateCubeDraft`，
 * 由父组件 `CubeEditor` 统一跑）、不持服务端真值（值由父组件受控传入）。
 *
 * <h2>两个刻意的实现选择</h2>
 * <ol>
 *   <li><b>行用 `rowId` 作 React key，而不是 index / name</b>：
 *       用 index：删中间一行会让 CodeMirror 实例与内容错位；
 *       用 name：在名称输入框里每按一个键 key 就变 → 编辑器整个重挂（光标丢失、IME 打断）。
 *       `rowId` 在草稿里生成、**提交时由 `toMeasures/toDimensions` 剥掉**（wire 里没有它）。</li>
 *   <li><b>度量表达式用 `useCodeMirror`，并强制 `error` → `<Textarea>` 兜底</b>：
 *       编辑器是可选增强（懒加载 + 依赖可能缺失），**绝不能让「编辑器挂了」=「建不了 Cube」**。
 *       兜底范例与 `RelationshipDialog` 的 `ConditionEditor` 一致。</li>
 * </ol>
 *
 * <h2>可用性</h2>
 * 维度用**下拉**而非自由输入：维度按定义就是「引用模型里已存在的字段」，
 * 下拉能把「引用了不存在的字段」这类 42200/42201 挡在提交之前。
 */
import { AlertCircle, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCodeMirror } from '../../hooks/useCodeMirror';
import {
  emptyDimensionRow,
  emptyMeasureRow,
  type DimensionRow,
  type MeasureRow,
} from './cubeUtils';

/** `MeasureDimensionList` Props。 */
export interface MeasureDimensionListProps {
  measures: MeasureRow[];
  dimensions: DimensionRow[];
  /** 所选模型的字段（限定名 `orders.amount`）；同时作补全源与维度下拉数据源。 */
  fieldOptions: string[];
  /** 只读（查看既有 Cube 时禁用全部编辑；见 `CubeEditor` 的 edit 模式说明）。 */
  readOnly?: boolean;
  onMeasuresChange: (next: MeasureRow[]) => void;
  onDimensionsChange: (next: DimensionRow[]) => void;
}

/** metrics / dimensions 列表编辑器。 */
export function MeasureDimensionList({
  measures,
  dimensions,
  fieldOptions,
  readOnly = false,
  onMeasuresChange,
  onDimensionsChange,
}: MeasureDimensionListProps) {
  const patchMeasure = (rowId: string, patch: Partial<MeasureRow>) => {
    onMeasuresChange(measures.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)));
  };
  const patchDimension = (rowId: string, patch: Partial<DimensionRow>) => {
    onDimensionsChange(
      dimensions.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)),
    );
  };

  return (
    <div className="space-y-4">
      {/* ---------------- measures ---------------- */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-[13px]">
            度量（measures）
            <span className="ml-1 text-[11px] text-muted-foreground">
              聚合语义：问数命中 Cube 时按它出指标
            </span>
          </Label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-[12px]"
            disabled={readOnly}
            onClick={() => onMeasuresChange([...measures, emptyMeasureRow()])}
          >
            <Plus className="h-3 w-3" />
            添加度量
          </Button>
        </div>

        {measures.length === 0 && (
          <p className="rounded border border-dashed border-border/60 px-2 py-2 text-[12px] text-muted-foreground">
            还没有度量。Cube 必须至少有一个度量（如 <code>总销售额 = SUM(orders.amount)</code>），
            否则无法聚合。
          </p>
        )}

        {measures.map((row, index) => (
          <div key={row.rowId} className="rounded border border-border/60 p-2">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[12px] text-muted-foreground">度量 {index + 1}</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                title="删除该度量"
                disabled={readOnly}
                onClick={() => onMeasuresChange(measures.filter((item) => item.rowId !== row.rowId))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={row.name}
                readOnly={readOnly}
                onChange={(event) => patchMeasure(row.rowId, { name: event.target.value })}
                placeholder="名称（如 总销售额）"
                className="h-8 text-[13px]"
              />
              <Input
                value={row.format}
                readOnly={readOnly}
                onChange={(event) => patchMeasure(row.rowId, { format: event.target.value })}
                placeholder="格式（可选，如 #,##0.00）"
                className="h-8 text-[13px]"
              />
            </div>
            <div className="mt-2 space-y-1">
              <span className="text-[12px] text-muted-foreground">聚合表达式</span>
              <MeasureExpressionEditor
                value={row.expression}
                fields={fieldOptions}
                readOnly={readOnly}
                onChange={(next) => patchMeasure(row.rowId, { expression: next })}
              />
            </div>
          </div>
        ))}
      </section>

      {/* ---------------- dimensions ---------------- */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-[13px]">
            维度（dimensions）
            <span className="ml-1 text-[11px] text-muted-foreground">引用模型字段，作为聚合的分组键</span>
          </Label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-[12px]"
            disabled={readOnly || fieldOptions.length === 0}
            title={fieldOptions.length === 0 ? '请先选择挂靠模型' : undefined}
            onClick={() => onDimensionsChange([...dimensions, emptyDimensionRow()])}
          >
            <Plus className="h-3 w-3" />
            添加维度
          </Button>
        </div>

        {dimensions.length === 0 && (
          <p className="rounded border border-dashed border-border/60 px-2 py-2 text-[12px] text-muted-foreground">
            还没有维度（可选）。维度决定「按什么分组」（如按 <code>orders.store_id</code> 看各门店销售额）。
          </p>
        )}

        {dimensions.map((row, index) => (
          <div key={row.rowId} className="flex items-center gap-2 rounded border border-border/60 p-2">
            <Input
              value={row.name}
              readOnly={readOnly}
              onChange={(event) => patchDimension(row.rowId, { name: event.target.value })}
              placeholder={`维度 ${index + 1} 名称`}
              className="h-8 w-40 shrink-0 text-[13px]"
            />
            <Select
              value={row.refModelField === '' ? undefined : row.refModelField}
              disabled={readOnly || fieldOptions.length === 0}
              onValueChange={(value) => patchDimension(row.rowId, { refModelField: value })}
            >
              <SelectTrigger className="h-8 flex-1 text-[13px]">
                <SelectValue placeholder="选择引用的模型字段…" />
              </SelectTrigger>
              <SelectContent>
                {fieldOptions.map((field) => (
                  <SelectItem key={field} value={field} className="text-[12px]">
                    {field}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-destructive"
              title="删除该维度"
              disabled={readOnly}
              onClick={() =>
                onDimensionsChange(dimensions.filter((item) => item.rowId !== row.rowId))
              }
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}

        {fieldOptions.length === 0 && (
          <p className="flex items-center gap-1 text-[12px] text-amber-700">
            <AlertCircle className="h-3 w-3" />
            尚未选择挂靠模型（或该模型没有字段），维度暂时无法添加。
          </p>
        )}
      </section>
    </div>
  );
}

/**
 * 度量表达式编辑器：`useCodeMirror` + **`error` 时强制 `<Textarea>` 兜底**。
 *
 * <p>编辑器不可用的原因包括「动态 import 失败（依赖缺失 / CSP）」与「容器未挂载」；
 * 无论哪种，这里都必须给一个能输入的输入框 —— 否则用户「建不了 Cube」，而这是 M-G2 主路径。
 */
function MeasureExpressionEditor({
  value,
  fields,
  readOnly,
  onChange,
}: {
  value: string;
  fields: string[];
  readOnly: boolean;
  onChange: (next: string) => void;
}) {
  const editor = useCodeMirror({ value, onChange, fields, readOnly, height: 90 });

  if (editor.error) {
    return (
      <div className="space-y-1">
        <Textarea
          value={value}
          readOnly={readOnly}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-[60px] text-[13px]"
          placeholder="如 SUM(orders.amount)"
        />
        <p className="text-[11px] text-muted-foreground">
          代码编辑器不可用（{editor.error}），已降级为纯文本输入。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div
        ref={editor.containerRef}
        className="overflow-hidden rounded border border-border/60 bg-background px-2"
      />
      {editor.loading && (
        <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          编辑器加载中…
        </p>
      )}
      {editor.degraded && (
        <p className="text-[11px] text-muted-foreground">
          SQL 高亮不可用（依赖缺失），已降级为纯文本编辑。
        </p>
      )}
    </div>
  );
}

export default MeasureDimensionList;
