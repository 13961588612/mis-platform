/**
 * 配置文件编辑器（UI#9 右栏，§4.3 #23 读 / #24 写）。
 *
 * <p>后端 T04 未实现 ⇒ 两个端点当前返回 **501**，本组件走 `AgentContentState` 的
 * error 态 + 重试，**不白屏**。接好后无需改前端即自动转真数据。
 *
 * <p>**为什么是纯 `<textarea>` 而不是 CodeMirror / Monaco**：impl-plan §2.1「零新框架」，
 * 禁止新增依赖。等宽字体 + 关闭拼写检查 + `Tab` 键插入两个空格，
 * 已覆盖 YAML / Markdown 的日常编辑需求；语法高亮不是本期验收项。
 *
 * <p>**三道保存护栏**（缺一都会造成真实的数据损坏）：
 *   1. `masked === true` ⇒ **禁用保存**。内容里的密钥已被替换成 `***`，
 *      整体回写会把 `***` 当成真值覆盖掉真密钥（impl-plan §4.4 必备护栏）;
 *   2. `editable === false` ⇒ 禁用保存。白名单只读项;
 *   3. `base_sha256` 并发保护。落后于磁盘时后端返回 **409 `CONFIG_CONFLICT`**，
 *      此时给专属提示「文件已被他人修改，请重新加载」并**就地给出「重新加载」按钮** ——
 *      只弹 toast 的话用户不知道下一步该干嘛，多半会反复点保存。
 */
import { useCallback, useEffect, useState } from 'react';
import { FileWarning, Lock, RefreshCw, RotateCcw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/common/submit-button';
import { PermissionGate } from '@/components/auth/permission-gate';
import { AgentContentState } from '../components/agent-page-shell';
import { getConfigFileContent, saveConfigFileContent } from '../api/agent-ops-api';
import { agentErrorMessage, formatTime } from '../types';
import type { ConfigFileContent, ConfigFileNode } from '../types';

export interface AgentConfigFileEditorProps {
  agentId: string;
  /** 当前选中的文件节点；null 时提示「请选择文件」。 */
  file: ConfigFileNode | null;
}

/** 冲突文案（impl-plan §10.5 错误码约定）。 */
const CONFLICT_TEXT = '文件已被他人修改，请重新加载。';

/** 判断异常是否为 409 CONFIG_CONFLICT（鸭子类型探测，不 import axios）。 */
function isConfigConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return typeof error === 'string' && error.includes('CONFIG_CONFLICT');
  }
  const shaped = error as {
    response?: { status?: unknown; data?: { code?: unknown; message?: unknown } };
    message?: unknown;
  };
  if (shaped.response?.status === 409) return true;
  const body = shaped.response?.data?.message;
  if (typeof body === 'string' && body.includes('CONFIG_CONFLICT')) return true;
  return typeof shaped.message === 'string' && shaped.message.includes('CONFIG_CONFLICT');
}

export function AgentConfigFileEditor({ agentId, file }: AgentConfigFileEditorProps) {
  const [data, setData] = useState<ConfigFileContent | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** 并发冲突态：非空时在编辑器上方显示红条 + 重新加载入口。 */
  const [conflict, setConflict] = useState<string | null>(null);

  const path = file?.path ?? '';

  const load = useCallback(async () => {
    if (!agentId || !path) {
      setData(null);
      setDraft('');
      return;
    }
    setLoading(true);
    setError(null);
    setConflict(null);
    try {
      const content = await getConfigFileContent(agentId, path);
      setData(content);
      setDraft(content.content);
    } catch (e) {
      setData(null);
      setDraft('');
      setError(agentErrorMessage(e, '读取配置文件失败'));
    } finally {
      setLoading(false);
    }
  }, [agentId, path]);

  useEffect(() => {
    void load();
  }, [load]);

  const masked = data?.masked === true;
  const readOnly = data === null || masked || data.editable === false;
  const dirty = data !== null && draft !== data.content;

  async function onSave(): Promise<void> {
    if (!data || readOnly || saving) return;
    setSaving(true);
    try {
      const saved = await saveConfigFileContent(agentId, {
        path: data.path,
        content: draft,
        base_sha256: data.sha256,
      });
      setData(saved);
      setDraft(saved.content);
      setConflict(null);
      toast.success('配置文件已保存');
    } catch (e) {
      if (isConfigConflict(e)) {
        // 专属处理：保留用户的编辑内容，只提示需要重新加载后再提交
        setConflict(CONFLICT_TEXT);
        toast.error(CONFLICT_TEXT);
      } else {
        toast.error(agentErrorMessage(e, '保存配置文件失败'));
      }
    } finally {
      setSaving(false);
    }
  }

  /** `Tab` 插入两个空格：YAML 对缩进敏感，默认的焦点跳转在这里毫无用处。 */
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const el = e.currentTarget;
    const { selectionStart, selectionEnd } = el;
    const next = `${draft.slice(0, selectionStart)}  ${draft.slice(selectionEnd)}`;
    setDraft(next);
    requestAnimationFrame(() => {
      el.selectionStart = selectionStart + 2;
      el.selectionEnd = selectionStart + 2;
    });
  }

  if (!file) {
    return (
      <div className="flex min-h-[16rem] flex-1 items-center justify-center rounded-lg border border-dashed bg-card">
        <p className="text-sm text-muted-foreground">请在左侧文件树中选择一个文件</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-sm" title={file.path}>
            {file.path}
          </p>
          <p className="text-xs text-muted-foreground">
            {file.format.toUpperCase()} · {file.size} 字节 · 更新于 {formatTime(file.updated_at)}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          重新加载
        </Button>
        {dirty ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(data?.content ?? '');
              setConflict(null);
            }}
          >
            <RotateCcw className="h-4 w-4" />
            放弃改动
          </Button>
        ) : null}
        <PermissionGate permission="agent:agent:config:write">
          <SubmitButton
            size="sm"
            loading={saving}
            disabled={readOnly || !dirty}
            onClick={() => void onSave()}
          >
            <Save className="h-4 w-4" />
            保存
          </SubmitButton>
        </PermissionGate>
      </div>

      <div className="min-h-0 flex-1 p-3">
        <AgentContentState
          loading={loading && data === null}
          error={error}
          onRetry={() => void load()}
        >
          <div className="flex h-full min-h-0 flex-col gap-2">
            {/* 脱敏护栏：必须解释「为什么不能存」，否则会被当成权限 bug 提报 */}
            {masked ? (
              <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-muted-foreground">
                <Lock className="mt-[0.1rem] h-3.5 w-3.5 shrink-0 text-warning" />
                <p className="leading-relaxed">
                  <span className="font-medium text-foreground">
                    该文件为敏感配置，当前不可在线编辑。
                  </span>
                  文件中的 <span className="font-mono">api_key</span> /{' '}
                  <span className="font-mono">secret</span> /{' '}
                  <span className="font-mono">token</span> /{' '}
                  <span className="font-mono">password</span> 已脱敏为{' '}
                  <span className="font-mono">***</span>。 若在此保存，会把{' '}
                  <span className="font-mono">***</span> 当作真值写回并覆盖真实密钥，
                  因此保存已被禁用。如需修改，请通过运维渠道直接变更服务端配置。
                </p>
              </div>
            ) : null}

            {!masked && data?.editable === false ? (
              <div className="flex gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                <Lock className="mt-[0.1rem] h-3.5 w-3.5 shrink-0" />
                <p>该文件在白名单中标记为只读，仅供查看。</p>
              </div>
            ) : null}

            {/* 409 冲突：给出明确的下一步动作，而不是只弹一个 toast */}
            {conflict ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
                <FileWarning className="h-3.5 w-3.5 shrink-0 text-destructive" />
                <span className="font-medium text-destructive">{conflict}</span>
                <span className="text-muted-foreground">
                  你的编辑内容仍保留在编辑框中，请先重新加载再手动合并。
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => void load()}
                >
                  <RefreshCw className="h-4 w-4" />
                  重新加载
                </Button>
              </div>
            ) : null}

            <textarea
              value={draft}
              readOnly={readOnly}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              className={cn(
                'min-h-[18rem] w-full flex-1 resize-none rounded-md border border-input bg-background p-3',
                'font-mono text-xs leading-relaxed text-foreground shadow-none outline-none',
                'focus-visible:ring-1 focus-visible:ring-ring',
                readOnly && 'cursor-not-allowed bg-muted/40 text-muted-foreground',
              )}
            />

            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>{draft.length} 字符</span>
              <span>{draft.split('\n').length} 行</span>
              {data ? (
                <span className="truncate font-mono" title={data.sha256}>
                  base_sha256: {data.sha256.slice(0, 12)}…
                </span>
              ) : null}
              {dirty ? <span className="text-warning">有未保存的改动</span> : null}
            </div>
          </div>
        </AgentContentState>
      </div>
    </div>
  );
}
