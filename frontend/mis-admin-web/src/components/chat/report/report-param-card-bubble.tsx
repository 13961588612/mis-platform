import { useState } from 'react';
import { toast } from 'sonner';
import { AssistantAvatar } from '@/components/chat/CopilotAvatars';
import { ReportParamPanel } from '@/components/chat/report/report-param-panel';
import { buildReportSubmitText } from '@/components/chat/report/build-report-submit-text';
import { formatExecuteResultMarkdown } from '@/components/chat/report/format-execute-result';
import { executeAiReport } from '@/lib/api/ai-report';
import { ApiError } from '@/lib/api/errors';
import { appendSessionTranscript } from '@/features/agent/api/agent-ops-api';
import { generateClientId, type ChatMessage } from '@/lib/chat/types';
import { useChatStore } from '@/stores/chat-store';

export interface ReportParamCardBubbleProps {
  message: ChatMessage;
  /** 兼容旧签名；当前提交走 execute API，不再经 Agent。 */
  onSubmitText?: (text: string) => void;
}

/**
 * 助手侧气泡：模板报告参数卡。
 * 提交 → {@link executeAiReport}（BFF → mis-ai-template-report execute），
 * 本地插入用户文案 + 助手结果，并旁路写入会话 transcript（供会话管理可见）。
 */
export function ReportParamCardBubble({ message }: ReportParamCardBubbleProps) {
  const [submitting, setSubmitting] = useState(false);
  const liveCard = useChatStore(
    (s) => s.messages.find((m) => m.id === message.id)?.reportParamCard,
  );
  const isGenerating = useChatStore((s) => s.isGenerating);
  const patchReportParamCard = useChatStore((s) => s.patchReportParamCard);
  const cancelActiveReportCard = useChatStore((s) => s.cancelActiveReportCard);
  const setActiveReportCardId = useChatStore((s) => s.setActiveReportCardId);
  const addMessage = useChatStore((s) => s.addMessage);

  const card = liveCard ?? message.reportParamCard;
  if (!card) return null;

  const onChangeValue = (wireKey: string, value: string) => {
    if (card.state !== 'active') return;
    patchReportParamCard(message.id, {
      values: { ...card.values, [wireKey]: value },
    });
  };

  const onCancel = () => {
    if (card.state !== 'active') return;
    cancelActiveReportCard();
    const latest = useChatStore.getState().messages.find((m) => m.id === message.id);
    if (latest?.reportParamCard?.state === 'active') {
      patchReportParamCard(message.id, { state: 'cancelled' });
      setActiveReportCardId(null);
    }
  };

  const onSubmit = async () => {
    if (card.state !== 'active' || submitting || isGenerating) return;
    const sid = useChatStore.getState().sessionId;
    if (!sid) {
      toast.error('会话尚未就绪');
      return;
    }

    const text = buildReportSubmitText(card);
    const params: Record<string, string> = {};
    for (const slot of card.slots) {
      const v = (card.values[slot.wire_key] ?? '').trim();
      if (v) params[slot.wire_key] = v;
    }

    setSubmitting(true);
    patchReportParamCard(message.id, { state: 'submitted' });
    setActiveReportCardId(null);

    addMessage({
      id: generateClientId('msg'),
      sessionId: sid,
      role: 'user',
      content: text,
      status: 'delivered',
      timestamp: new Date().toISOString(),
    });

    const persistTranscript = async (
      assistantContent: string,
      ok: boolean,
    ): Promise<void> => {
      try {
        const agentId = useChatStore.getState().agentId || 'mis-copilot';
        await appendSessionTranscript(
          sid,
          [
            {
              role: 'user',
              content: text,
              metadata: {
                kind: 'ai_report_submit',
                report_code: card.reportCode,
              },
            },
            {
              role: 'assistant',
              content: assistantContent,
              metadata: {
                kind: ok ? 'ai_report_result' : 'ai_report_error',
                report_code: card.reportCode,
              },
            },
          ],
          { agentId },
        );
      } catch (persistErr) {
        console.warn('报告结果写入会话失败', persistErr);
        toast.error('报告已出结果，但未能写入会话记录');
      }
    };

    try {
      // POST /api/v1/ai-reports/execute → AiReportRuntimeService.execute
      const result = await executeAiReport({
        reportCode: card.reportCode,
        params,
      });
      const assistantContent = formatExecuteResultMarkdown(result);
      addMessage({
        id: generateClientId('msg'),
        sessionId: sid,
        role: 'assistant',
        content: assistantContent,
        status: 'delivered',
        timestamp: new Date().toISOString(),
      });
      await persistTranscript(assistantContent, true);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : '执行报告失败';
      toast.error(msg);
      const assistantContent = `报告执行失败：${msg}`;
      addMessage({
        id: generateClientId('msg'),
        sessionId: sid,
        role: 'assistant',
        content: assistantContent,
        status: 'error',
        timestamp: new Date().toISOString(),
        error: msg,
      });
      await persistTranscript(assistantContent, false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex items-start gap-3 py-1">
      <AssistantAvatar className="mt-0.5 h-8 w-8" />
      <ReportParamPanel
        card={card}
        submitting={submitting || isGenerating}
        onChangeValue={onChangeValue}
        onSubmit={() => void onSubmit()}
        onCancel={onCancel}
      />
    </div>
  );
}
