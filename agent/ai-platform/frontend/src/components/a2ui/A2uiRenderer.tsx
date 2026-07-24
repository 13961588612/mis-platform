/**
 * A2uiRenderer — 根据 ui.render 事件渲染对应 A2UI 组件（DEP-8 真实渲染器）。
 *
 * - 组件名未登记 → 安全回退卡片（展示组件名 + props JSON，绝不 dangerouslySetInnerHTML）。
 * - props 经 camelizeKeys 归一化（后端 snake_case → 前端 camelCase）。
 * - actions 由前端注入（审批/提交回调），后端只给「描述」（A2UI 契约）。
 *
 * 与 backend/src/runtime/events.py::A2UI_COMPONENTS 双向登记（DEP-9）：
 * 两端组件名严格一致；注册表见同目录 registry.ts。
 */

import { useMemo } from "react";
import { camelizeKeys } from "../../utils/cardAdapter";
import { useChatStore } from "../../store/chatStore";
import { getA2uiComponent, isKnownA2uiComponent } from "./registry";
import type { A2UIComponentName, A2UIComponentProps, A2UIRender } from "./types";

export function A2uiRenderer({ render }: { render: A2UIRender }): JSX.Element {
  const approvalSender = useChatStore((s) => s.approvalSender);
  const component = render.component;
  const props = useMemo(
    () => camelizeKeys(render.props ?? {}) as Record<string, unknown>,
    [render.props],
  );

  // 前端注入动作回调（后端不提供函数，仅声明语义）
  const actions = useMemo(() => {
    if (component === "approval-card") {
      const resolveId = (data?: Record<string, unknown>): string =>
        (typeof data?.approvalId === "string" && data.approvalId) ||
        (typeof props.approvalId === "string" ? props.approvalId : "");
      return {
        onApprove: (data?: Record<string, unknown>) => {
          const id = resolveId(data);
          if (id && approvalSender) approvalSender(id, "approved");
        },
        onReject: (data?: Record<string, unknown>) => {
          const id = resolveId(data);
          if (id && approvalSender) approvalSender(id, "rejected");
        },
      };
    }
    if (component === "form-sheet") {
      return {
        onSubmit: (data: Record<string, unknown>) => {
          // 表单提交：前端回显（如需落库可在此接入对应接口）
          console.info("[A2UI] form-sheet submit", data);
        },
      };
    }
    return undefined;
  }, [component, props.approvalId, approvalSender]);

  const Comp = getA2uiComponent(component);

  if (!Comp || !isKnownA2uiComponent(component)) {
    return (
      <div className="my-2 mx-auto max-w-[90%] rounded-lg border border-dashed border-surface-light bg-surface-muted/30 p-3 text-xs text-surface-dark/50">
        <div className="font-medium text-surface-dark/70">
          未知 A2UI 组件：{component}
        </div>
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all">
          {JSON.stringify(render.props ?? {}, null, 2)}
        </pre>
      </div>
    );
  }

  const componentProps: A2UIComponentProps = {
    component: component as A2UIComponentName,
    props,
    actions,
  };
  return <Comp {...componentProps} />;
}

export default A2uiRenderer;
