import { useState, useCallback } from 'react';
import { executeSkillFill } from '../services/skill-api';
import { useEntityMapping } from './useEntityMapping';
import type { SkillExecuteRequest, SkillExecuteResponse, EntityCandidate } from '../types/skill-fill.types';

interface UseSkillFillOptions {
  userId?: string;
  onFillComplete?: (fields: Record<string, unknown>) => void;
  onManualSelect?: (field: string) => void;
}

/**
 * Skill 填充 Hook。
 * 封装 executeSkillFill 调用 + HITL 弹窗状态 + localStorage 映射学习。
 * 覆盖 success / hitl_required / manual_required / error 四种状态。
 */
export function useSkillFill(options: UseSkillFillOptions = {}) {
  const { userId, onFillComplete, onManualSelect } = options;
  const { getMapping, saveMapping } = useEntityMapping(userId);

  const [loading, setLoading] = useState(false);
  const [hitlOpen, setHitlOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [hitlPayload, setHitlPayload] = useState<SkillExecuteResponse['hitl']>(undefined);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(
    async (
      request: Omit<SkillExecuteRequest, 'resumeToken' | 'selectedCandidate'>,
    ) => {
      setLoading(true);
      setError(null);
      try {
        const response = await executeSkillFill(request);

        if (response.status === 'success') {
          onFillComplete?.(response.fields);
        } else if (response.status === 'hitl_required' && response.hitl) {
          // P0 简化：先检查 localStorage 是否有已保存的映射
          const mapped = getMapping(response.hitl.field, response.hitl.originalValue);
          if (mapped) {
            // 已有映射，直接回填
            onFillComplete?.({ [response.hitl.field]: mapped });
          } else {
            setHitlPayload(response.hitl);
            setHitlOpen(true);
          }
        } else if (response.status === 'manual_required') {
          setManualOpen(true);
        } else if (response.status === 'error') {
          setError(response.message || '执行失败');
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : '未知错误');
      } finally {
        setLoading(false);
      }
    },
    [onFillComplete, getMapping],
  );

  const handleHitlConfirm = useCallback(
    async (candidate: EntityCandidate) => {
      if (!hitlPayload) return;
      setHitlOpen(false);
      saveMapping(hitlPayload.field, hitlPayload.originalValue, String(candidate.id));
      // P0 简化：直接回填该字段，不调 resume（resume 留 P1）
      onFillComplete?.({ [hitlPayload.field]: candidate.id });
    },
    [hitlPayload, saveMapping, onFillComplete],
  );

  const handleHitlCancel = useCallback(() => {
    setHitlOpen(false);
    setHitlPayload(undefined);
  }, []);

  const handleManualSelect = useCallback(() => {
    setManualOpen(false);
    if (hitlPayload?.field) {
      onManualSelect?.(hitlPayload.field);
    }
  }, [hitlPayload, onManualSelect]);

  return {
    loading,
    error,
    hitlOpen,
    hitlPayload,
    manualOpen,
    execute,
    handleHitlConfirm,
    handleHitlCancel,
    handleManualSelect,
    hitlDialog: hitlPayload
      ? {
          field: hitlPayload.field,
          originalValue: hitlPayload.originalValue,
          candidates: hitlPayload.candidates,
        }
      : null,
  };
}
