import { toast } from 'sonner';
import {
  AI_REPORT_NO_PARAM_ACCESS,
  prepareAiReportCard,
  type AiReportPrepareCard,
} from '@/lib/api/ai-report';
import { ApiError } from '@/lib/api/errors';
import { generateClientId, type ReportParamCardMeta } from '@/lib/chat/types';
import { useChatStore } from '@/stores/chat-store';

/**
 * 调用 prepare-card 并在会话中插入参数卡（顶栏点击 / 流式 ai.report.open_card 共用）。
 *
 * @param initialValues 对话侧已识别槽位（覆盖 default / 首选项）
 */
export async function openReportParamCard(
  sessionId: string,
  reportCode: string,
  initialValues?: Record<string, string>,
): Promise<boolean> {
  const code = (reportCode || '').trim();
  if (!sessionId || !code) return false;
  try {
    const prepared = await prepareAiReportCard(code);
    insertParamCard(sessionId, prepared, initialValues);
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.code === AI_REPORT_NO_PARAM_ACCESS) {
      toast.message('无权限或无可选参数');
    } else {
      toast.error(e instanceof Error ? e.message : '打开报告失败');
    }
    return false;
  }
}

function insertParamCard(
  sessionId: string,
  prepared: AiReportPrepareCard,
  initialValues?: Record<string, string>,
): void {
  const store = useChatStore.getState();
  store.cancelActiveReportCard();

  const values: Record<string, string> = {};
  const allowedByWire = new Map<string, Set<string>>();
  for (const slot of prepared.slots ?? []) {
    const allowed = new Set(
      (slot.options ?? [])
        .map((o) => String(o.value ?? '').trim())
        .filter((v) => v.length > 0),
    );
    allowedByWire.set(slot.wire_key, allowed);
    const def = slot.default_value;
    if (def != null && String(def).trim()) {
      values[slot.wire_key] = String(def).trim();
    } else if (slot.options?.[0]?.value) {
      values[slot.wire_key] = slot.options[0].value;
    } else {
      values[slot.wire_key] = '';
    }
  }
  // 对话识别结果覆盖默认；有 options 时必须命中合法 value（如 0021=城北）
  if (initialValues) {
    for (const [wire, raw] of Object.entries(initialValues)) {
      const key = String(wire || '').trim();
      const val = String(raw || '').trim();
      if (!key || !val || !(key in values)) continue;
      const allowed = allowedByWire.get(key);
      if (allowed && allowed.size > 0 && !allowed.has(val)) continue;
      values[key] = val;
    }
  }

  const cardId = generateClientId('rptcard');
  const messageId = generateClientId('msg');
  const meta: ReportParamCardMeta = {
    kind: 'report_param_card',
    cardId,
    state: 'active',
    reportCode: prepared.report_code,
    title: prepared.title,
    description: prepared.description,
    useAiWorkflow: Boolean(prepared.use_ai_workflow),
    workflowCode: prepared.workflow_code,
    workflowPlatformCode: prepared.workflow_platform_code,
    slots: (prepared.slots ?? []).map((s) => ({
      source_code: s.source_code,
      value_type: s.value_type,
      wire_key: s.wire_key,
      label: s.label,
      required: Boolean(s.required),
      options: (s.options ?? []).map((o) => ({
        value: o.value,
        label: o.label,
        extra: o.extra,
      })),
    })),
    values,
  };

  store.addMessage({
    id: messageId,
    sessionId,
    role: 'assistant',
    content: '',
    status: 'delivered',
    timestamp: new Date().toISOString(),
    reportParamCard: meta,
  });
  store.setActiveReportCardId(messageId);
}
