import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { getFeedback, submitFeedback } from '../api/kb-api';
import type { KbFeedbackForm, KbQaFeedback } from '../types';

const DIMENSIONS: { key: keyof KbFeedbackForm; label: string; hint: string }[] = [
  { key: 'accuracy', label: '准确性', hint: '回答与事实/制度是否一致' },
  { key: 'helpful', label: '有用性', hint: '是否解决了你的问题' },
  { key: 'offtopic', label: '跑题度', hint: '分值越高代表越跑题' },
  { key: 'citeError', label: '引用错误', hint: '分值越高代表引用越不可靠' },
];

const EMPTY_FORM: KbFeedbackForm = {
  accuracy: null,
  helpful: null,
  offtopic: null,
  citeError: null,
};

/** 0-5 星打分条。 */
function ScoreBar({
  value,
  onChange,
  disabled,
}: {
  value: number | null;
  onChange: (v: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((score) => (
        <button
          key={score}
          type="button"
          disabled={disabled}
          aria-label={`${score} 分`}
          className={cn(
            'rounded p-0.5 transition-colors',
            disabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-accent',
          )}
          onClick={() => onChange(score)}
        >
          <Star
            className={cn(
              'h-4 w-4',
              value != null && score <= value
                ? 'fill-warning text-warning'
                : 'text-muted-foreground',
            )}
          />
        </button>
      ))}
      <span className="ml-1 w-8 text-xs tabular-nums text-muted-foreground">
        {value == null ? '未评' : `${value}分`}
      </span>
    </div>
  );
}

interface KbFeedbackFormProps {
  sessionId: number;
  /** 提交成功回调（父组件可刷新历史列表） */
  onSubmitted?: (feedback: KbQaFeedback) => void;
}

/**
 * 问答反馈表单。
 *
 * <p>后端 `editable_once` 语义：首次提交创建（editable_once=1），第二次提交为「唯一一次修改」
 * （置 0），第三次及以后返回 KB_FEEDBACK_ALREADY(40923)。本组件在首次加载时读取既有反馈，
 * 并在提交后按后端返回结果刷新；被拒绝时以 toast 透传后端提示，不做本地兜底猜测。
 */
export function KbFeedbackFormPanel({ sessionId, onSubmitted }: KbFeedbackFormProps) {
  const [form, setForm] = useState<KbFeedbackForm>(EMPTY_FORM);
  const [existing, setExisting] = useState<KbQaFeedback | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLocked(false);
    getFeedback(sessionId)
      .then((fb) => {
        if (cancelled) return;
        setExisting(fb);
        setForm({
          accuracy: fb.accuracy ?? null,
          helpful: fb.helpful ?? null,
          offtopic: fb.offtopic ?? null,
          citeError: fb.citeError ?? null,
        });
      })
      .catch(() => {
        // 尚无反馈属正常情况（后端返回 40410/空），保持空表单
        if (!cancelled) {
          setExisting(null);
          setForm(EMPTY_FORM);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  async function onSubmit() {
    if (
      form.accuracy == null &&
      form.helpful == null &&
      form.offtopic == null &&
      form.citeError == null
    ) {
      toast.warning('请至少为一个维度打分');
      return;
    }
    setSaving(true);
    try {
      const fb = await submitFeedback(sessionId, form);
      setExisting(fb);
      toast.success('反馈已提交，感谢你的评价');
      onSubmitted?.(fb);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '提交反馈失败';
      // 第三次及以后由后端拒绝，此处锁定表单避免重复点击
      if (msg.includes('已') || msg.includes('ALREADY')) setLocked(true);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  const disabled = loading || saving || locked;

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">回答质量反馈</p>
          <p className="text-xs text-muted-foreground">
            {existing ? '已提交过反馈，仅可修改一次' : '每个会话可提交一次并修改一次'}
          </p>
        </div>
        <Button size="sm" disabled={disabled} onClick={() => void onSubmit()}>
          {existing ? '更新反馈' : '提交反馈'}
        </Button>
      </div>
      <div className="space-y-1.5">
        {DIMENSIONS.map((d) => (
          <div key={d.key} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="text-sm">{d.label}</span>
              <span className="ml-2 text-xs text-muted-foreground">{d.hint}</span>
            </div>
            <ScoreBar
              value={form[d.key]}
              disabled={disabled}
              onChange={(v) => setForm((f) => ({ ...f, [d.key]: v }))}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
