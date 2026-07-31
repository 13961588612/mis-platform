/**
 * EntitySelectView — A2UI `entity-select` 组件。
 *
 * 渲染后端 ui_render(component="entity-select", props={...}) 下发的实体选择卡片，
 * 对应「AI Skill 表单填充引擎（FormFill）× Agent 平台」整合的 HITL 实体选择环节：
 * - 后端下发若干候选实体（candidates），用户点选其一 → confirm
 * - 或手动输入覆盖值 → manual
 * - 或取消本次填充 → cancel
 *
 * 选择结果经 props.actions.onEntitySelect 回调（由 A2uiRenderer 注入，
 * 经 chatStore.entitySelectSender 落到 WS entity_select 入站消息）。
 *
 * 安全：所有文本经 React 转义渲染，绝不使用 dangerouslySetInnerHTML。
 */

import { useMemo, useState } from "react";
import { clsx } from "../../utils/format";
import type { A2UIComponentProps } from "./types";

/** 单个候选实体。 */
interface Candidate {
  id?: string;
  displayName?: string;
  name?: string;
  label?: string;
  [key: string]: unknown;
}

export function EntitySelectView({ props, actions }: A2UIComponentProps): JSX.Element {
  const resumeToken =
    typeof props.resumeToken === "string" ? props.resumeToken : "";
  const field = typeof props.field === "string" ? props.field : "";
  const prompt =
    typeof props.prompt === "string" ? props.prompt : "请选择一个候选实体";
  const originalValue =
    typeof props.originalValue === "string" ? props.originalValue : "";
  const namespace =
    typeof props.namespace === "string" ? props.namespace : "";

  const candidates = useMemo<Candidate[]>(() => {
    if (!Array.isArray(props.candidates)) {
      return [];
    }
    return props.candidates
      .filter(
        (raw): raw is Candidate =>
          typeof raw === "object" && raw != null,
      )
      .map((c) => c as Candidate);
  }, [props.candidates]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [manualText, setManualText] = useState<string>("");
  const [responding, setResponding] = useState(false);

  const resolveCandidateLabel = (c: Candidate): string =>
    c.displayName ?? c.name ?? c.label ?? c.id ?? "(未命名)";

  const handleConfirm = (candidate: Candidate): void => {
    const id = candidate.id;
    if (!id || responding) {
      return;
    }
    setSelectedId(id);
    setResponding(true);
    actions?.onEntitySelect?.({
      resumeToken,
      selectedCandidate: candidate as Record<string, unknown>,
      action: "confirm",
    });
  };

  const handleManual = (): void => {
    if (responding) {
      return;
    }
    const value = manualText.trim();
    if (value.length === 0) {
      return;
    }
    setResponding(true);
    actions?.onEntitySelect?.({
      resumeToken,
      selectedCandidate: { id: value, displayName: value },
      action: "manual",
    });
  };

  const handleCancel = (): void => {
    if (responding) {
      return;
    }
    setResponding(true);
    actions?.onEntitySelect?.({
      resumeToken,
      action: "cancel",
    });
  };

  return (
    <div className="my-2 mx-auto max-w-[85%] rounded-lg border-2 border-primary-200 bg-primary-50/50 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-600 text-xs text-white">
          ⚑
        </span>
        <span className="text-sm font-semibold text-primary-700">表单填充 · 实体选择</span>
      </div>

      <h4 className="mb-1 text-sm font-medium text-surface-dark">{prompt}</h4>

      {(field || originalValue) && (
        <p className="mb-3 text-xs text-surface-dark/60">
          {field && <span>字段：{field}</span>}
          {field && originalValue && <span className="mx-1">·</span>}
          {originalValue && <span>当前值：{originalValue}</span>}
        </p>
      )}

      {candidates.length > 0 ? (
        <ul className="mb-3 space-y-2">
          {candidates.map((candidate) => {
            const id = candidate.id ?? `candidate-${resolveCandidateLabel(candidate)}`;
            const isSelected = selectedId === id;
            return (
              <li key={id}>
                <button
                  type="button"
                  disabled={responding}
                  onClick={() => handleConfirm(candidate)}
                  className={clsx(
                    "w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
                    "disabled:cursor-not-allowed disabled:opacity-60",
                    isSelected
                      ? "border-primary-500 bg-primary-100 text-primary-800"
                      : "border-surface-light bg-white text-surface-dark hover:border-primary-300",
                  )}
                >
                  {resolveCandidateLabel(candidate)}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mb-3 text-xs text-surface-dark/40">
          无可选项，请手动输入或取消。
        </p>
      )}

      <div className="mb-3">
        <label className="mb-1 block text-xs font-medium text-surface-dark/70">
          手动输入覆盖值
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={manualText}
            disabled={responding}
            onChange={(e) => setManualText(e.target.value)}
            placeholder="输入自定义值"
            className={clsx(
              "flex-1 rounded-md border border-surface-light bg-white px-3 py-2 text-sm text-surface-dark",
              "focus:border-primary-400 focus:outline-none",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          />
          <button
            type="button"
            disabled={responding || manualText.trim().length === 0}
            onClick={handleManual}
            className={clsx(
              "rounded-md px-4 py-2 text-sm font-medium text-white transition-colors",
              "bg-primary-600 hover:bg-primary-700",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            提交
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={responding}
          onClick={handleCancel}
          className={clsx(
            "flex-1 rounded-md px-4 py-2 text-sm font-medium text-white transition-colors",
            "bg-gray-400 hover:bg-gray-500",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {responding ? "处理中..." : "取消"}
        </button>
      </div>

      {namespace.length > 0 && (
        <div className="mt-2 text-[10px] text-surface-dark/30">
          来源：{namespace}
        </div>
      )}
    </div>
  );
}

export default EntitySelectView;
