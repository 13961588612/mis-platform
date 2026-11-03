import { useState } from 'react';
import { AssistantAvatar } from '@/components/chat/CopilotAvatars';
import { ReportParamPanel } from '@/components/chat/report/report-param-panel';
import { buildReportSubmitText } from '@/components/chat/report/build-report-submit-text';
import type { ChatMessage } from '@/lib/chat/types';
import { useChatStore } from '@/stores/chat-store';

export interface ReportParamCardBubbleProps {
  message: ChatMessage;
  onSubmitText: (text: string) => void;
}

/** 助手侧气泡：模板报告参数卡。 */
export function ReportParamCardBubble({ message, onSubmitText }: ReportParamCardBubbleProps) {
  const [submitting, setSubmitting] = useState(false);
  const liveCard = useChatStore(
    (s) => s.messages.find((m) => m.id === message.id)?.reportParamCard,
  );
  const isGenerating = useChatStore((s) => s.isGenerating);
  const patchReportParamCard = useChatStore((s) => s.patchReportParamCard);
  const cancelActiveReportCard = useChatStore((s) => s.cancelActiveReportCard);
  const setActiveReportCardId = useChatStore((s) => s.setActiveReportCardId);

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

  const onSubmit = () => {
    if (card.state !== 'active' || submitting || isGenerating) return;
    const text = buildReportSubmitText(card);
    setSubmitting(true);
    try {
      patchReportParamCard(message.id, { state: 'submitted' });
      setActiveReportCardId(null);
      onSubmitText(text);
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
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    </div>
  );
}
