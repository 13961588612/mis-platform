/**
 * 表单兜底卡（方案 §3.3 四级降级①② ③ + §3.4 组合表）。
 *
 * ⚠️ **不导出给业务方**：本组件只由 `form-shell.tsx` 内部调用。
 * 让业务方私自兜底会掩盖问题（业务组件自己吞掉错误 ⇒ 没人知道发版漏了什么）。
 *
 * 设计原则（方案 §3.3）：**必须解释原因 + 给出下一步**，不能只一句「加载失败」。
 *
 * ⚠️ **`not-registered` 用黄色不用红色**：那不是数据错，是配置缺（发版漏了）。
 * 且此场景下**审批栏必须依然可用**——套壳出问题绝不能阻断审批。
 */
import type { ReactNode } from 'react';
import { AlertTriangle, FileQuestion, RefreshCw, ScrollText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** 降级原因。决定文案与是否提供「重新加载」。 */
export type FormMissingReason =
  /** ① startedFormCode 为空/null：旧版本发起，或流程未启用业务表单。 */
  | 'no-code'
  /** ② form_data 为 null / "{}"：已登记但本次发起未提交数据。 */
  | 'empty-data'
  /** form_data 是非法 JSON 串：原始数据解析失败。 */
  | 'bad-json'
  /** ③ resolveForm 返回 null：后台有、前端没注册。 */
  | 'not-registered'
  /** 组件已注册但抛异常（ErrorBoundary 兜底）。 */
  | 'render-error';

const REASON_TEXT: Record<FormMissingReason, { title: (code?: string) => string; desc: (code?: string) => string }> = {
  'no-code': {
    title: () => '本流程实例未记录表单编码',
    desc: () => '可能由旧版本发起，或该流程未启用业务表单。可展开下方「查看流程信息」了解流程元信息。',
  },
  'empty-data': {
    title: (code) => `表单「${code ?? '未命名'}」已登记，但本次发起未提交任何数据`,
    desc: () => '如果预期是有数据的，请检查发起入口是否正确写入了 form_data。',
  },
  'bad-json': {
    title: (code) => `表单「${code ?? '未命名'}」的原始数据解析失败`,
    desc: () => '下方展示后端返回的原始文本，未做任何解析。可能是数据被人工改库写坏了。',
  },
  'not-registered': {
    title: (code) => `表单「${code ?? '未命名'}」尚未在前端注册`,
    desc: () => '该表单在后台已登记，但当前前端版本未包含对应组件。通常是前端发版漏了该表单。',
  },
  'render-error': {
    title: (code) => `表单「${code ?? '未命名'}」渲染异常`,
    desc: () => '业务表单组件抛出了异常，已隔离在此卡片内，不影响审批操作。请把下方原始数据与错误信息反馈给开发。',
  },
};

export interface FormMissingProps {
  reason: FormMissingReason;
  /** 流程实例的 formCode，用于文案与「查看原始数据」。 */
  formCode?: string | null;
  /** 后端表单中文名（若已知），用于 not-registered 的补充说明。 */
  formName?: string | null;
  /**
   * 原始数据文本。
   *
   * ⚠️ 传字符串即展示 `<pre>` 原文；传已解析对象则 pretty-print。
   * 留空则不展示「查看原始数据」。
   */
  rawData?: string | Record<string, unknown> | null;
  /** 渲染异常时的错误信息。 */
  errorMessage?: string | null;
  /** 提供则显示「重新加载」（用户可能刚从发版前的页面停留至今）。 */
  onRetry?: () => void;
  className?: string;
}

function renderRaw(raw: FormMissingProps['rawData']): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'string') return raw;
  try {
    return JSON.stringify(raw, null, 2);
  } catch {
    // 循环引用等极端情况：至少不因展示原文而二次抛错
    return '[无法序列化的数据]';
  }
}

export function FormMissing({
  reason,
  formCode,
  formName,
  rawData,
  errorMessage,
  onRetry,
  className,
}: FormMissingProps) {
  const text = REASON_TEXT[reason];
  const raw = renderRaw(rawData);
  const showRaw = raw.trim() !== '';

  // ① no-code 不是异常，是正常的历史数据 ⇒ 中性灰底；其余是黄色告警
  const isNeutral = reason === 'no-code';
  const Icon = isNeutral ? FileQuestion : AlertTriangle;

  return (
    <div
      role="alert"
      data-testid="form-missing"
      data-reason={reason}
      className={cn(
        'rounded-md border px-3 py-3',
        isNeutral ? 'border-border bg-muted/40' : 'border-warning/40 bg-warning/10',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', isNeutral ? 'text-muted-foreground' : 'text-warning')} />
        <div className="min-w-0 flex-1">
          <p className={cn('text-[13px] font-medium', isNeutral ? 'text-foreground' : 'text-warning')}>
            {text.title(formCode ?? undefined)}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{text.desc(formCode ?? undefined)}</p>

          {reason === 'not-registered' && formName ? (
            <p className="mt-1 text-[12px] text-muted-foreground">后台登记名称：{formName}</p>
          ) : null}

          {errorMessage ? (
            <p className="mt-2 text-[12px] text-destructive">错误信息：{errorMessage}</p>
          ) : null}

          {onRetry ? (
            <div className="mt-2.5">
              <Button type="button" size="sm" variant="outline" onClick={onRetry}>
                <RefreshCw className="h-3.5 w-3.5" />
                重新加载
              </Button>
            </div>
          ) : null}

          {showRaw ? (
            <details className="mt-2.5">
              <summary className="cursor-pointer text-[12px] text-muted-foreground">查看原始数据</summary>
              <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-card px-2 py-1.5 text-[11px] text-foreground">
                {raw}
              </pre>
            </details>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** 带图标的空态（供套壳在「有数据但 schema 为空」时用，避免与 FormMissing 混淆）。 */
export function FormEmptyHint({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-6 text-center">
      <ScrollText className="h-5 w-5 text-muted-foreground" />
      <p className="text-[13px] text-muted-foreground">{children}</p>
    </div>
  );
}
