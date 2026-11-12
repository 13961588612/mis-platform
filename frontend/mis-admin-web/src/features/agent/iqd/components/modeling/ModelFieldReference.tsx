/**
 * ModelFieldReference.tsx — Cube 编辑器右侧「挂靠模型字段清单」参考面板。
 *
 * <h2>为什么需要</h2>
 * 度量表达式与维度都要引用**挂靠模型的字段**（如 `SUM(dwd_ord.amount)`）。此前字段清单
 * 只藏在 CodeMirror 补全与维度下拉里，用户写表达式时看不到「这个模型到底有哪些字段」，
 * 只能凭记忆或反复点开下拉。本面板把所选模型的字段（名字 + 类型 + 主键标记）常驻在
 * 编辑器右侧，供**参考录入**；点击字段名复制其限定名，可直接粘进表达式。
 *
 * <h2>边界</h2>
 * 纯展示 + 复制，不做请求、不做校验；数据由父组件（`CubeEditor`）从已加载的 catalog
 * 节点派生传入。字段限定名口径与 `fieldOptions` / 维度下拉严格一致（`<model>.<column>`）。
 */
import { useCallback, useState } from 'react';
import { AlertCircle, Check, Copy } from 'lucide-react';

/** 一个可引用字段（限定名 + 类型 + 主键标记）。 */
export interface ModelField {
  /** 限定名（`orders.amount`）—— 与补全 / 维度下拉同一口径。 */
  qualified: string;
  /** 裸字段名（`amount`）。 */
  name: string;
  /** 物理类型（如 BIGINT / VARCHAR），未知为 null。 */
  dataType: string | null;
  /** 是否主键（前端仅作提示，权威在主键回填链路）。 */
  isPrimaryKey: boolean;
  /** 字段描述（目录里的 description；无则 null）。 */
  description: string | null;
}

export interface ModelFieldReferenceProps {
  /** 所选挂靠模型的展示名（为空表示未选择模型）。 */
  modelName: string | null;
  /** 该模型的字段清单。 */
  fields: ModelField[];
}

/** 复制文本到剪贴板（无 Clipboard API 时静默降级，不抛错）。 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 忽略：非安全上下文 / 权限拒绝时降级
  }
  return false;
}

/**
 * 字段清单参考面板。
 *
 * @param props 见 {@link ModelFieldReferenceProps}
 */
export function ModelFieldReference({ modelName, fields }: ModelFieldReferenceProps) {
  const [copied, setCopied] = useState<string | null>(null);

  const onCopy = useCallback(async (qualified: string) => {
    const ok = await copyText(qualified);
    if (ok) {
      setCopied(qualified);
      window.setTimeout(() => setCopied((prev) => (prev === qualified ? null : prev)), 1200);
    }
  }, []);

  const isEmpty = fields.length === 0;
  const heading = modelName ? `${modelName} 字段` : '模型字段';

  return (
    <aside className="flex min-h-0 flex-col rounded border border-border/60 bg-muted/20">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-2 py-1.5">
        <span className="truncate text-[12px] font-medium" title={modelName ?? undefined}>
          {heading}
        </span>
        {!isEmpty && (
          <span className="shrink-0 text-[11px] text-muted-foreground">{fields.length} 个</span>
        )}
      </div>

      {modelName === null || modelName === '' ? (
        <p className="flex items-start gap-1 px-2 py-2 text-[12px] text-muted-foreground">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          先选择「挂靠模型」，这里会列出它的字段供录入度量表达式参考。
        </p>
      ) : isEmpty ? (
        <p className="flex items-start gap-1 px-2 py-2 text-[12px] text-muted-foreground">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          该模型暂无字段（可能尚未从表导入列）。
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1.3fr)] gap-x-2 border-b border-border/40 px-1.5 py-1 text-[10px] font-medium text-muted-foreground">
            <span>字段</span>
            <span>类型</span>
            <span className="text-right">描述</span>
          </div>
          <ul className="min-h-0 flex-1 space-y-0.5 overflow-auto px-1.5 py-1.5">
          {fields.map((field) => (
            <li key={field.qualified}>
              {/* 三列：字段名(+PK) | 类型 | 描述（点击整行复制限定名） */}
              <button
                type="button"
                className="group grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1.3fr)] items-center gap-x-2 rounded px-1.5 py-1 text-left hover:bg-background"
                title={`点击复制 ${field.qualified}`}
                onClick={() => void onCopy(field.qualified)}
              >
                <span className="flex min-w-0 items-center gap-1">
                  <code className="truncate font-mono text-[12px]">{field.name}</code>
                  {field.isPrimaryKey && (
                    <span className="shrink-0 rounded border border-amber-500/50 px-1 text-[10px] text-amber-700">
                      PK
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-[10px] uppercase text-muted-foreground">
                  {field.dataType ?? '—'}
                </span>
                <span className="flex min-w-0 items-center justify-end gap-1">
                  <span
                    className="truncate text-[11px] text-muted-foreground"
                    title={field.description ?? undefined}
                  >
                    {field.description ?? ''}
                  </span>
                  {copied === field.qualified ? (
                    <Check className="h-3 w-3 shrink-0 text-success" />
                  ) : (
                    <Copy className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  )}
                </span>
              </button>
            </li>
          ))}
          </ul>
        </div>
      )}
    </aside>
  );
}

export default ModelFieldReference;
