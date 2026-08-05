/**
 * Agent role helpers (Coordinator–Worker scheduling, C4 / FR-FE-1).
 *
 * The chat entry point is converged to Coordinators only: Workers
 * (mis-rag / mis-summary / mis-extract / crm-assistant) are dispatched
 * by the Coordinator and must never appear in the user-facing selector.
 *
 * Filtering is role-based on purpose — never hardcode "mis-copilot",
 * so future multi-Coordinator setups keep working (design-c4.md §7.4).
 */

import type { AgentRole } from "../types/agent";

/** Role value that marks an Agent as a user-selectable chat entry. */
export const COORDINATOR_ROLE = "coordinator" as const;

/** Role value of a delegated executor (never user-selectable). */
export const WORKER_ROLE = "worker" as const;

/**
 * Whether the given role marks a Coordinator.
 *
 * Accepts a loose `string | undefined` so callers can pass raw API values
 * without narrowing first; unknown / missing roles are treated as non-
 * coordinator (fail-closed — a Worker must never leak into the selector).
 */
export function isCoordinator(role: string | undefined | null): boolean {
  return role === COORDINATOR_ROLE;
}

/**
 * Normalize an arbitrary backend role value to a known AgentRole.
 * Unknown / missing values degrade to "worker" (fail-closed).
 */
export function normalizeAgentRole(role: string | undefined | null): AgentRole {
  return role === COORDINATOR_ROLE ? COORDINATOR_ROLE : WORKER_ROLE;
}

export default isCoordinator;
