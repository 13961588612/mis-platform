/**
 * ApprovalCardView — A2UI `approval-card` 组件。
 *
 * 渲染后端 ui_render(component="approval-card", props={...}) 下发的审批卡片。
 * 纯展示 + 可选操作按钮；按钮调用 props.actions（由 A2uiRenderer 注入，
 * 经 chatStore.approvalSender 落到 WS 审批响应）。
 *
 * 安全：所有文本经 React 转义渲染，绝不使用 dangerouslySetInnerHTML。
 */

import { useState } from "react";
import { clsx } from "../../utils/format";
import type { A2UIComponentProps } from "./types";

interface ApprovalField {
  label?: string;
  value?: unknown;
}

export function ApprovalCardView({ props, actions }: A2UIComponentProps): JSX.Element {
  const title = typeof props.title === "string" ? props.title : "操作审批请求";
  const description = typeof props.description === "string" ? props.description : "";
  const approvalId = typeof props.approvalId === "string" ? props.approvalId : "";
  const fields = Array.isArray(props.fields)
    ? (props.fields as ApprovalField[])
    : [];
  const [responding, setResponding] = useState(false);

  const handleApprove = (): void => {
    setResponding(true);
    actions?.onApprove?.({ approvalId });
  };

  const handleReject = (): void => {
    setResponding(true);
    actions?.onReject?.({ approvalId });
  };

  return (
    <div className="my-2 mx-auto max-w-[75%] rounded-lg border-2 border-primary-200 bg-primary-50/50 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-600 text-xs text-white">
          !
        </span>
        <span className="text-sm font-semibold text-primary-700">需要审批</span>
      </div>

      <h4 className="mb-1 text-sm font-medium text-surface-dark">{title}</h4>
      {description && (
        <p className="mb-3 text-xs text-surface-dark/60">{description}</p>
      )}

      {fields.length > 0 && (
        <dl className="mb-3 space-y-1 text-xs text-surface-dark/70">
          {fields.map((f, i) => (
            <div key={i} className="flex gap-2">
              <dt className="font-medium">{f.label ?? ""}</dt>
              <dd>{String(f.value ?? "")}</dd>
            </div>
          ))}
        </dl>
      )}

      {approvalId && (
        <div className="mb-3 text-xs text-surface-dark/40">
          审批 ID:{" "}
          <code className="rounded bg-surface-muted px-1 py-0.5">
            {approvalId.slice(0, 12)}
          </code>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleApprove}
          disabled={responding}
          className={clsx(
            "flex-1 rounded-md px-4 py-2 text-sm font-medium text-white transition-colors",
            "bg-green-600 hover:bg-green-700",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {responding ? "处理中..." : "同意"}
        </button>
        <button
          type="button"
          onClick={handleReject}
          disabled={responding}
          className={clsx(
            "flex-1 rounded-md px-4 py-2 text-sm font-medium text-white transition-colors",
            "bg-red-600 hover:bg-red-700",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {responding ? "处理中..." : "拒绝"}
        </button>
      </div>
    </div>
  );
}

export default ApprovalCardView;
