import { useCallback, useMemo } from 'react';

const STORAGE_PREFIX = 'ai-entity-mapping';

/**
 * 用户实体映射学习 Hook（localStorage 持久化）。
 * 记录用户 HITL 选择：field × originalValue → candidateId。
 * 后续相同输入直接跳过 HITL，自动回填。
 */
export function useEntityMapping(userId: string | undefined) {
  const getKey = useCallback(
    (field: string) => `${STORAGE_PREFIX}-${userId}-${field}`,
    [userId],
  );

  const getMapping = useCallback(
    (field: string, originalValue: string): string | undefined => {
      if (!userId) return undefined;
      const key = getKey(field);
      try {
        const stored = localStorage.getItem(key);
        if (stored) {
          const map = JSON.parse(stored) as Record<string, string>;
          return map[originalValue];
        }
      } catch {
        // ignore parse errors
      }
      return undefined;
    },
    [userId, getKey],
  );

  const saveMapping = useCallback(
    (field: string, originalValue: string, candidateId: string) => {
      if (!userId) return;
      const key = getKey(field);
      try {
        const stored = localStorage.getItem(key);
        const map: Record<string, string> = stored ? JSON.parse(stored) : {};
        map[originalValue] = candidateId;
        localStorage.setItem(key, JSON.stringify(map));
      } catch {
        // ignore write errors
      }
    },
    [userId, getKey],
  );

  return useMemo(() => ({ getMapping, saveMapping }), [getMapping, saveMapping]);
}
