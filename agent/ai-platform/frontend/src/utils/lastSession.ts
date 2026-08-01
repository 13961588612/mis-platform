/**
 * Persist last chat session(s) so Copilot / Chat can restore on reopen.
 *
 * Isolation:
 * - keyed by userId (no cross-account leakage)
 * - per-agent session refs (switching agents restores that agent's last chat)
 */

const STORAGE_PREFIX = "aip.lastSessions.v2:";

export interface LastSessionRef {
  sessionId: string;
  agentId: string;
  updatedAt: number;
}

interface LastSessionStore {
  /** Most recently active agent for this user. */
  lastAgentId: string | null;
  /** agentId → last session. */
  byAgent: Record<string, LastSessionRef>;
}

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

function emptyStore(): LastSessionStore {
  return { lastAgentId: null, byAgent: {} };
}

function readStore(userId: string): LastSessionStore {
  if (!userId || typeof localStorage === "undefined") {
    return emptyStore();
  }
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) {
      // migrate v1 single-ref if present
      const legacy = localStorage.getItem(`aip.lastSession.v1:${userId}`);
      if (legacy) {
        const parsed = JSON.parse(legacy) as Partial<LastSessionRef>;
        if (parsed.sessionId && parsed.agentId) {
          const migrated: LastSessionStore = {
            lastAgentId: parsed.agentId,
            byAgent: {
              [parsed.agentId]: {
                sessionId: parsed.sessionId,
                agentId: parsed.agentId,
                updatedAt:
                  typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
              },
            },
          };
          localStorage.setItem(storageKey(userId), JSON.stringify(migrated));
          return migrated;
        }
      }
      return emptyStore();
    }
    const parsed = JSON.parse(raw) as Partial<LastSessionStore>;
    const byAgent =
      parsed.byAgent && typeof parsed.byAgent === "object" ? parsed.byAgent : {};
    return {
      lastAgentId: typeof parsed.lastAgentId === "string" ? parsed.lastAgentId : null,
      byAgent,
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(userId: string, store: LastSessionStore): void {
  if (!userId || typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(store));
  } catch {
    /* ignore */
  }
}

/** Most recently updated session across agents (for first open). */
export function loadLastSession(userId: string): LastSessionRef | null {
  const store = readStore(userId);
  if (store.lastAgentId && store.byAgent[store.lastAgentId]) {
    return store.byAgent[store.lastAgentId];
  }
  let best: LastSessionRef | null = null;
  for (const ref of Object.values(store.byAgent)) {
    if (!ref?.sessionId || !ref.agentId) continue;
    if (!best || ref.updatedAt > best.updatedAt) {
      best = ref;
    }
  }
  return best;
}

/** Last session for a specific agent. */
export function loadLastSessionForAgent(
  userId: string,
  agentId: string,
): LastSessionRef | null {
  if (!agentId) {
    return null;
  }
  const ref = readStore(userId).byAgent[agentId];
  if (!ref?.sessionId) {
    return null;
  }
  return ref;
}

export function saveLastSession(
  userId: string,
  sessionId: string,
  agentId: string,
): void {
  if (!userId || !sessionId || !agentId) {
    return;
  }
  const store = readStore(userId);
  store.lastAgentId = agentId;
  store.byAgent[agentId] = {
    sessionId,
    agentId,
    updatedAt: Date.now(),
  };
  writeStore(userId, store);
}

/** Clear one agent's last session, or all if agentId omitted. */
export function clearLastSession(userId: string, agentId?: string): void {
  if (!userId) {
    return;
  }
  if (!agentId) {
    try {
      localStorage.removeItem(storageKey(userId));
    } catch {
      /* ignore */
    }
    return;
  }
  const store = readStore(userId);
  delete store.byAgent[agentId];
  if (store.lastAgentId === agentId) {
    const remaining = Object.values(store.byAgent);
    store.lastAgentId =
      remaining.sort((a, b) => b.updatedAt - a.updatedAt)[0]?.agentId ?? null;
  }
  writeStore(userId, store);
}
