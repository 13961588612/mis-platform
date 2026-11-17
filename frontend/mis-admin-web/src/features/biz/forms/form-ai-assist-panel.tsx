import { useRef, useState, type ChangeEvent } from 'react';
import { FileUp, Loader2, Send, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { createChatSession, sendChatMessage } from '@/features/agent/api/agent-chat-api';
import { agentErrorMessage } from '@/features/agent/types';
import { useAttachmentComposer } from '@/lib/chat/useAttachmentComposer';
import type { FormData, FormFieldSchema } from './types';
import { buildFormAssistPrompt, parseFormAssistFields, pickAssistFields } from './lib/form-ai-assist';

export function FormAiAssistPanel({
  formCode,
  agentId,
  skillId,
  fields,
  currentValues,
  onApply,
}: {
  formCode: string;
  agentId: string;
  skillId: string;
  fields: FormFieldSchema[];
  currentValues: FormData;
  onApply: (partial: FormData) => void;
}) {
  const [text, setText] = useState('');
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState<FormData>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [reply, setReply] = useState('');
  const sessionRef = useRef<string | null>(null);
  const composer = useAttachmentComposer();

  async function ensureSession(): Promise<string> {
    if (sessionRef.current) return sessionRef.current;
    const session = await createChatSession(agentId);
    sessionRef.current = session.session_id;
    return session.session_id;
  }

  async function handleRun() {
    const userText = text.trim();
    const ready = composer.attachments.filter((a) => a.status === 'done');
    if (!userText && ready.length === 0) {
      toast.warning('请输入说明或上传文档/图片');
      return;
    }
    if (composer.hasUploading) {
      toast.warning('请等待附件上传完成');
      return;
    }
    setRunning(true);
    setPreview({});
    setChecked({});
    setReply('');
    try {
      const sid = await ensureSession();
      const content = buildFormAssistPrompt({
        formCode,
        skillId,
        fields,
        currentValues,
        userText,
      });
      const metadata =
        ready.length > 0
          ? {
              attachments: ready.map((a) => ({
                fileId: a.fileId,
                name: a.name,
                mimeType: a.mimeType,
                size: a.size,
                url: a.url,
              })),
            }
          : undefined;
      const msg = await sendChatMessage(sid, content, metadata);
      setReply(msg.content);
      const picked = pickAssistFields(fields, parseFormAssistFields(msg.content));
      const keys = Object.keys(picked);
      if (keys.length === 0) {
        toast.warning('未能解析出表单字段，请核对技能输出是否为 JSON');
        return;
      }
      const nextChecked: Record<string, boolean> = {};
      for (const k of keys) nextChecked[k] = true;
      setPreview(picked);
      setChecked(nextChecked);
    } catch (e) {
      toast.error(agentErrorMessage(e, '辅助录入失败'));
    } finally {
      setRunning(false);
    }
  }

  function applySelected() {
    const partial: FormData = {};
    for (const [k, on] of Object.entries(checked)) {
      if (on && preview[k] !== undefined) partial[k] = preview[k];
    }
    if (Object.keys(partial).length === 0) {
      toast.warning('请先勾选要填入的字段');
      return;
    }
    onApply(partial);
    toast.success(`已填入 ${Object.keys(partial).length} 个字段，请核对后保存`);
  }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (!list?.length) return;
    void composer.addFiles(Array.from(list));
    e.target.value = '';
  }

  const previewKeys = Object.keys(preview);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <Sparkles className="h-4 w-4" />
        AI 辅助录入
      </div>
      <p className="text-xs text-muted-foreground">
        使用技能 <span className="font-mono">{skillId}</span>
        ，按表单字段 key 抽取。确认后写入左侧，不会自动保存。
      </p>
      <Textarea
        aria-label="辅助录入说明"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="粘贴或描述单据内容，也可上传附件"
        rows={4}
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground">
          <FileUp className="h-3.5 w-3.5" />
          上传文档/图片
          <input
            type="file"
            className="sr-only"
            multiple
            accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.doc,.docx,.xlsx,.csv,.txt,.md"
            onChange={onFile}
          />
        </label>
        {composer.attachments.map((a) => (
          <span key={a.fileId} className="rounded border px-1.5 py-0.5 text-[11px]">
            {a.name}
            {a.status === 'uploading' ? '…' : a.status === 'error' ? ' 失败' : ''}
          </span>
        ))}
      </div>
      {composer.rejectionHint ? (
        <p className="text-xs text-destructive">{composer.rejectionHint}</p>
      ) : null}
      <Button type="button" size="sm" disabled={running} onClick={() => void handleRun()}>
        {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {running ? '解析中…' : '解析并预览'}
      </Button>
      {previewKeys.length > 0 ? (
        <div className="min-h-0 flex-1 space-y-2 overflow-auto rounded-md border p-2">
          {previewKeys.map((k) => {
            const field = fields.find((f) => f.key === k);
            const val = preview[k];
            return (
              <label key={k} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={!!checked[k]}
                  onChange={(e) => setChecked((prev) => ({ ...prev, [k]: e.target.checked }))}
                />
                <span>
                  <span className="text-muted-foreground">{field?.label ?? k}</span>
                  <span className="ml-1 font-mono text-xs">({k})</span>
                  <div className="break-all">{Array.isArray(val) ? val.join('、') : String(val)}</div>
                </span>
              </label>
            );
          })}
          <Button type="button" size="sm" onClick={applySelected}>
            填入表单
          </Button>
        </div>
      ) : reply ? (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-[11px]">
          {reply}
        </pre>
      ) : null}
    </div>
  );
}
