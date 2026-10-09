/**
 * `FormShell` 审批套壳（方案 Q3 全节）。
 *
 * ## 它是「外壳管流转，表单管渲染」里的「表单」那一半
 *
 * `process-shell.tsx:7` 的注释写着「外壳管流转（顶部进度条 + 底部动态审批栏）；
 * 表单管渲染」。本组件就是被塞进外壳左栏（`lg:col-span-2`）的那个「表单」位置。
 *
 * ## 三条硬约束，改动前必读
 *
 * 1. **只读态不实例化业务组件**。
 *    本组件的 props 里**没有 component、没有 FormProps**，
 *    只读分支直接渲染 `ReadOnlyFormView`。所以「传readOnly=true 让组件自己克制」
 *    这条路在审批页上物理不存在 —— 依赖每个业务作者都写对`if (readOnly) return`
 *    是靠不住的，人一定会忘。
 *
 * 2. **ErrorBoundary 只包表单，不包审批栏**。
 *    审批栏在 `process-shell.tsx` 里、**本组件之外**，所以表单炸了同意/驳回依然可点。
 *    这是方案 §3.3 的硬要求（「套壳出问题不能阻断审批」），不是优化。
 *
 * 3. **单层滚动**（方案 §3.1）。
 *    `process-shell.tsx:193` 的容器已经是 `overflow-auto`，
 *    本组件**刻意不加** `overflow-auto`/`max-h`，让长表单跟随外层网格一起滚。
 *    加了就会出现嵌套滚动条，鼠标滚轮在内层「滚不动」的老问题。
 */
import * as React from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { FormErrorBoundary } from './form-error-boundary';
import { ReadOnlyFormView } from './read-only-form-view';
import { hasFormLoader, loadFormEntry } from './forms/form-loaders';
import { resolveForm } from './registry';
import type { FormFieldSchema } from './types';

export interface FormShellProps {
  /** 流程实例记录的 `started_form_code`。 */
  formCode: string | null | undefined;
  /** 后端 `form_data` 原始串（`ProcessDetailVO.formData` 是 String 不是 JsonNode）。 */
  formData: string | null | undefined;
  /**
   * 覆盖 schema。优先于注册表里的 `entry.fields`——
   * 用于「同一表单在不同流程版本下字段集不同」的场景。
   */
  fields?: FormFieldSchema[];
  /** 流程实例 ID（透给只读视图的业务扩展位，本套壳本身不用）。 */
  instanceId?: string;
  /** 业务对象 ID。 */
  businessId?: string;
  /** 重新拉数据。表单降级卡上的「重新加载」会调它（并顺带重试加载表单实现）。 */
  onRetry?: () => void;
  /** 「有数据但 schema 为空」时的空态文案。 */
  emptyText?: string;
  className?: string;
}

export function FormShell({
  formCode,
  formData,
  fields,
  onRetry,
  emptyText,
  className,
}: FormShellProps) {
  /**
   * 「正在下载表单实现」状态。
   *
   * ⚠️ 这一段不是为了好看，是**为了不误报**：
   * 首次渲染时注册表必然是空的（表单 chunk 还没下载），
   * 若同步直出`not-registered`，运维会看到一张**假的**
   * 「前端未注册」黄色告警卡 —— 而代码就在前端，只是还没到。
   * 那是发版信号，被误报一次就没人再信它了。
   *
   * 用 `settledCode` 而不是 boolean：切换实例（formCode 变）时要能重新等待，
   * 而同一个 code 加载失败后**不能**反复重试（否则死循环）。
   */
  const [settledCode, setSettledCode] = React.useState<string | null>(null);
  const needsLoad = !!formCode && !resolveForm(formCode) && hasFormLoader(formCode);
  const loading = needsLoad && settledCode !== formCode;

  React.useEffect(() => {
    if (!needsLoad || settledCode === formCode) return;
    let cancelled = false;
    //失败不抛：chunk 下载失败时降级为 not-registered，审批页仍可用
    void loadFormEntry(formCode!).finally(() => {
      if (!cancelled) setSettledCode(formCode);
    });
    return () => {
      cancelled = true;
    };
  }, [formCode, needsLoad, settledCode]);

  const handleRetry = React.useCallback(() => {
    // 重试既要把「加载失败」状态清掉（让骨架屏再转一次），也要让调用方重拉数据
    setSettledCode(null);
    onRetry?.();
  }, [onRetry]);

  return (
    <section data-testid="form-shell" aria-label="业务表单" className={className}>
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-[13px] font-semibold">业务表单</h3>
        {formCode ? (
          <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{formCode}</code>
        ) : null}
      </div>

      {/*
        ErrorBoundary 在**本组件内部**、审批栏**外部**。
        顺序不能颠倒：把它挪到 process-shell 外层就会连审批栏一起挡掉。
      */}
      <FormErrorBoundary formCode={formCode} rawData={formData} onRetry={handleRetry}>
        {loading ? (
          <div className="flex flex-col gap-3" data-testid="form-shell-loading" aria-busy="true">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        ) : (
          <ReadOnlyFormView
            formCode={formCode}
            formData={formData}
            fields={fields}
            onRetry={handleRetry}
            emptyText={emptyText}
          />
        )}
      </FormErrorBoundary>
    </section>
  );
}
