/**
 * AgentSelector — Coordinator selection component (C4 / FR-FE-1, FR-FE-2).
 *
 * Fetches the list of available agents from the backend API
 * (GET /api/v1/agents) and exposes **only Coordinators** as chat entries.
 * Workers (mis-rag / mis-summary / mis-extract / crm-assistant) are
 * dispatched by the Coordinator and must never be user-selectable.
 *
 * Behaviour:
 * - Filter: state ∈ {running, paused} AND role === "coordinator".
 * - Auto-select the first Coordinator when nothing is selected yet
 *   (today that is mis-copilot — resolved by role, never hardcoded).
 * - Single Coordinator → hide the dropdown, render a plain badge instead.
 * - Multiple Coordinators → keep the native select.
 */

import React, { useCallback, useEffect, useState } from "react";
import { apiGet } from "../utils/api";
import { normalizeAgentList, type RawAgentSummary } from "../utils/agentAdapter";
import { isCoordinator } from "../utils/agentRole";
import { getAgentStateLabel, getAgentStateColor, clsx } from "../utils/format";
import type { AgentSummary, AgentState } from "../types/agent";

// ===== Types =====

/** Props for the AgentSelector component. */
interface AgentSelectorProps {
  /** Currently selected agent ID. */
  value: string | null;
  /** Callback when the selection changes. */
  onChange: (agentId: string) => void;
}

// ===== Component =====

/**
 * AgentSelector — Coordinator entry point for the chat panel.
 *
 * Fetches the agent list on mount, keeps only chat-ready Coordinators
 * and auto-selects the first one. Collapses to a static badge when the
 * deployment exposes exactly one Coordinator (the default MIS setup).
 */
export function AgentSelector({
  value,
  onChange,
}: AgentSelectorProps): JSX.Element {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch agent list
  useEffect(() => {
    let cancelled = false;

    const fetchAgents = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await apiGet<RawAgentSummary[]>("/agents");
        if (!cancelled) {
          // 1) chat-ready states, 2) Coordinator role only (FR-FE-1)
          const availableAgents = normalizeAgentList(data)
            .filter(
              (agent) => agent.state === "running" || agent.state === "paused",
            )
            .filter((agent) => isCoordinator(agent.role));
          setAgents(availableAgents);

          // Auto-select the first Coordinator if none selected (FR-FE-2)
          if (!value && availableAgents.length > 0) {
            onChange(availableAgents[0].agentId);
          }
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : "获取 Agent 列表失败";
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchAgents();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle change
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>): void => {
      onChange(e.target.value);
    },
    [onChange],
  );

  // ===== Single Coordinator: hide the dropdown, show a label + badge =====
  if (!isLoading && !error && agents.length === 1) {
    const only = agents[0];
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-surface-dark/80">
          {only.displayName || only.agentId}
        </span>
        <SelectedAgentBadge agents={agents} agentId={only.agentId} />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <label
        htmlFor="agent-selector"
        className="shrink-0 text-sm font-medium text-surface-dark/70"
      >
        Agent:
      </label>
      <select
        id="agent-selector"
        value={value ?? ""}
        onChange={handleChange}
        disabled={isLoading || !!error}
        className={clsx(
          "min-w-0 max-w-full flex-1 basis-[10rem] rounded-md border border-surface-light bg-white px-2 py-1.5 text-sm sm:max-w-[14rem] sm:px-3",
          "focus:outline-none focus:border-primary-400 focus:ring-1 focus:ring-primary-400",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        {isLoading && <option value="">加载中...</option>}
        {error && <option value="">加载失败</option>}
        {!isLoading && !error && agents.length === 0 && (
          <option value="">暂无可用 Agent</option>
        )}
        {!isLoading &&
          !error &&
          agents.map((agent: AgentSummary) => (
            <option key={agent.agentId} value={agent.agentId}>
              {agent.displayName} ({agent.state})
            </option>
          ))}
      </select>

      {/* State Badge：shrink-0，窄屏与下拉换行，避免压到右侧按钮 */}
      {value && agents.length > 0 && (
        <SelectedAgentBadge agents={agents} agentId={value} />
      )}
    </div>
  );
}

// ===== Selected Agent Badge =====

/** Display a state badge for the currently selected agent. */
function SelectedAgentBadge({
  agents,
  agentId,
}: {
  agents: AgentSummary[];
  agentId: string;
}): JSX.Element | null {
  const agent = agents.find((a) => a.agentId === agentId);
  if (!agent) {
    return null;
  }

  const stateLabel = getAgentStateLabel(agent.state as AgentState);
  const stateColor = getAgentStateColor(agent.state as AgentState);

  return (
    <span
      className={clsx(
        "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
        stateColor,
      )}
    >
      {stateLabel}
    </span>
  );
}

export default AgentSelector;
