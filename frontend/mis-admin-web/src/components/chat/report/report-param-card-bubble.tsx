import { useState } from 'react';
import { toast } from 'sonner';
import { AssistantAvatar } from '@/components/chat/CopilotAvatars';
import { ReportParamPanel } from '@/components/chat/report/report-param-panel';
import { buildReportSubmitText } from '@/components/chat/report/build-report-submit-text';
import { formatExecuteResultMarkdown } from '@/components/chat/report/format-execute-result';
import { executeAiReport, saveAiReportResult } from '@/lib/api/ai-report';
import { ApiError } from '@/lib/api/errors';
import { appendSessionTranscript } from '@/features/agent/api/agent-ops-api';
import { generateClientId, type ChatMessage } from '@/lib/chat/types';
import { useChatStore } from '@/stores/chat-store';

export interface ReportParamCardBubbleProps {
  message: ChatMessage;
  /**
   * 未命中缓存时：把已组装任务消息发往会话（硬派发 agent/skill）。
   * 返回 Promise，resolve 时带上助手成文（用于回写缓存）。
   */
  onAgentRun?: (payload: {
    message: string;
    agentId: string;
    skillId?: string | null;
    reportCode: string;
    metadata: Record<string, unknown>;
  }) => Promise<string | void>;
}

/**
 * 助手侧气泡：模板报告参数卡。
 * execute → cached 直接展示 / agent_run 会话硬派发 / table 模拟表。
 */
export function ReportParamCardBubble({ message, onAgentRun }: ReportParamCardBubbleProps) {
  const [submitting, setSubmitting] = useState(false);
  const [regenerate, setRegenerate] = useState(false);
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
      const result = await executeAiReport({
        reportCode: card.reportCode,
        params,
        regenerate,
      });

      if (result.mode === 'cached' && result.content_md) {
        const assistantContent =
          (result.read_from_cache ? '> 来自缓存\n\n' : '') + result.content_md;
        addMessage({
          id: generateClientId('msg'),
          sessionId: sid,
          role: 'assistant',
          content: assistantContent,
          status: 'delivered',
          timestamp: new Date().toISOString(),
        });
        await persistTranscript(assistantContent, true);
        return;
      }

      if (result.mode === 'agent_run') {
        const agentId = (result.agent_id || '').trim();
        const runMessage = (result.message || text).trim();
        if (!agentId || !runMessage) {
          throw new Error('报告未配置目标智能体或任务文案');
        }
        if (!onAgentRun) {
          throw new Error('当前会话不支持智能体成文');
        }
        const meta = {
          ...(result.metadata ?? {}),
          ai_report_run: {
            agent_id: agentId,
            skill_id: result.skill_id ?? null,
            report_code: card.reportCode,
          },
        };
        const finalText = await onAgentRun({
          message: runMessage,
          agentId,
          skillId: result.skill_id,
          reportCode: card.reportCode,
          metadata: meta,
        });
        if (result.save_to_cache && result.cache_write_token && finalText?.trim()) {
          try {
            await saveAiReportResult({
              reportCode: card.reportCode,
              params,
              contentMd: finalText.trim(),
              cacheWriteToken: result.cache_write_token,
            });
          } catch (cacheErr) {
            console.warn('报告缓存回写失败', cacheErr);
            toast.message('报告已生成，但缓存未写入');
          }
        }
        return;
      }

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
        regenerate={regenerate}
        onRegenerateChange={setRegenerate}
        onChangeValue={onChangeValue}
        onSubmit={() => void onSubmit()}
        onCancel={onCancel}
      />
    </div>
  );
}
