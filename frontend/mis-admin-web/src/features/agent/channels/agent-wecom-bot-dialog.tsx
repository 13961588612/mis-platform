/**
 * 企微 Bot 新建 / 编辑表单弹窗（UI#3，§4.3 #49 建 / #50 改）。
 *
 * <p>校验用 **zod**（仓库已依赖 `zod@^3`，零新增），与 `skills/agent-skill-form-dialog.tsx`
 * 同一手感：受控 state + 一次性 `safeParse`，不引 react-hook-form。
 *
 * <p>**secret 只写不读（impl-plan §10.5「敏感字段」硬约束）**：
 *   - 读接口（#48）只回 `secret_masked`，**永远不会**给到明文；
 *   - 因此编辑态默认把 secret 输入框**禁用**并以掩码占位，用户必须显式勾选
 *     「更换 Secret」才能输入 —— 这样「什么都不动直接保存」在物理上无法把
 *     `***` 之类的掩码串写回覆盖真密钥（这是 §4.4 在配置文件那边已经踩过的坑）；
 *   - 提交时 `secret` 为空串则**整个字段不进 payload**，对应后端「留空 = 不修改」。
 *
 * <p>**`bound_agent_id` 为什么可能退化成文本框**：候选来自 #13 `listAgents()`（已就绪），
 * 但父页在 #48 整体 501 的场景下仍要可用。父页拉不到 Agent 列表时传空数组，
 * 这里退化为手填 ID —— 比渲染一个永远空的下拉框（用户以为"没有 Agent 可绑"）更诚实。
 *
 * <p>**为什么没有「保存后立即生效」**：当前 Gateway 是单 Bot 架构（T04 才改造），
 * 多 Bot 配置落库后需重启 Gateway 才装载。提示条常驻在父页顶部，不在本弹窗重复。
 */
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { toast } from 'sonner';
import { SubmitButton } from '@/components/common/submit-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createWecomBot, updateWecomBot } from '../api/agent-ops-api';
import { agentErrorMessage } from '../types';
import type { AgentSummary, WecomBot, WecomBotPayload } from '../types';

const fieldLabel = 'mb-[0.4rem] block text-sm font-medium text-foreground';

const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

/** 表单态：全部摊平成非空字符串，避免受控输入在 undefined ⇄ '' 之间抖动。 */
interface BotFormValues {
  name: string;
  ws_url: string;
  secret: string;
  bound_agent_id: string;
}

const EMPTY_FORM: BotFormValues = {
  name: '',
  ws_url: '',
  secret: '',
  bound_agent_id: '',
};

/**
 * 按「secret 是否必填」动态构造 schema。
 *
 * <p>新建必填；编辑态只有在用户勾选「更换 Secret」后才必填 ——
 * 勾了却留空说明是误操作，此时报错比静默"不修改"更符合预期。
 *
 * <p>`ws_url` 限定 `ws://` / `wss://`：企微回调走 WebSocket 长连，
 * 填成 `https://` 会在 Gateway 启动时才失败，那时已经离配置现场很远了。
 */
function buildSchema(secretRequired: boolean) {
  return z.object({
    name: z.string().trim().min(1, '名称必填').max(64, '名称不超过 64 字符'),
    ws_url: z
      .string()
      .trim()
      .min(1, 'WS 地址必填')
      .max(500, 'WS 地址不超过 500 字符')
      .regex(/^wss?:\/\/.+/i, '需以 ws:// 或 wss:// 开头'),
    secret: secretRequired
      ? z.string().trim().min(1, 'Secret 必填').max(200, 'Secret 不超过 200 字符')
      : z.string().trim().max(200, 'Secret 不超过 200 字符'),
    bound_agent_id: z.string().trim().max(128, 'Agent ID 不超过 128 字符'),
  });
}

export interface AgentWecomBotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = 新建；非 null = 编辑该 Bot。 */
  bot: WecomBot | null;
  /** 可绑定的 Agent 候选（父页 #13 拉取）；为空则退化为手填 ID。 */
  agents: AgentSummary[];
  /** 保存成功回调（父页据此刷新列表）。 */
  onSaved: () => void;
}

export function AgentWecomBotDialog({
  open,
  onOpenChange,
  bot,
  agents,
  onSaved,
}: AgentWecomBotDialogProps) {
  const [form, setForm] = useState<BotFormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof BotFormValues, string>>>({});
  const [saving, setSaving] = useState(false);
  /** 编辑态是否要覆盖既有 secret；false 时输入框禁用且不进 payload。 */
  const [replaceSecret, setReplaceSecret] = useState(false);

  const isEdit = bot !== null;
  const hasStoredSecret = isEdit && Boolean(bot?.secret_masked);
  const secretEditable = !isEdit || !hasStoredSecret || replaceSecret;
  const secretRequired = !isEdit || replaceSecret;

  // 每次打开按当前对象重置：上一次编辑残留的 secret 串进新建表单是最危险的一种脏数据
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setSaving(false);
    setReplaceSecret(false);
    setForm(
      bot
        ? {
            name: bot.name,
            ws_url: bot.ws_url,
            secret: '',
            bound_agent_id: bot.bound_agent_id ?? '',
          }
        : EMPTY_FORM,
    );
  }, [open, bot]);

  function patch(key: keyof BotFormValues, value: string): void {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  }

  /** 勾选 / 取消「更换 Secret」：取消时清空已输入内容，回到"不修改"语义。 */
  function toggleReplaceSecret(checked: boolean): void {
    setReplaceSecret(checked);
    if (!checked) {
      setForm((f) => ({ ...f, secret: '' }));
      setErrors((e) => (e.secret ? { ...e, secret: undefined } : e));
    }
  }

  async function onSubmit(): Promise<void> {
    const parsed = buildSchema(secretRequired).safeParse(form);
    if (!parsed.success) {
      const next: Partial<Record<keyof BotFormValues, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string' && !(key in next)) {
          next[key as keyof BotFormValues] = issue.message;
        }
      }
      setErrors(next);
      return;
    }

    const values = parsed.data;
    const payload: WecomBotPayload = {
      name: values.name,
      ws_url: values.ws_url,
      bound_agent_id: values.bound_agent_id || undefined,
    };
    // 空串绝不进 payload：后端把「字段缺席」判为不修改，把空串判为清空
    if (values.secret) payload.secret = values.secret;

    setSaving(true);
    try {
      if (isEdit && bot) {
        await updateWecomBot(bot.bot_id, payload);
      } else {
        await createWecomBot(payload);
      }
      toast.success(isEdit ? 'Bot 已更新，重启 Gateway 后生效' : 'Bot 已创建，重启 Gateway 后生效');
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(agentErrorMessage(e, isEdit ? '更新企微机器人失败' : '新增企微机器人失败'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑企微机器人' : '新增企微机器人'}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-3 overflow-auto pr-1">
          <div>
            <label className={fieldLabel} htmlFor="wecom-name">
              名称 *
            </label>
            <Input
              id="wecom-name"
              value={form.name}
              autoComplete="off"
              placeholder="如：客服机器人 / 值班播报"
              onChange={(e) => patch('name', e.target.value)}
            />
            {errors.name ? <p className="mt-1 text-xs text-destructive">{errors.name}</p> : null}
          </div>

          <div>
            <label className={fieldLabel} htmlFor="wecom-ws-url">
              WS 地址 *
            </label>
            <Input
              id="wecom-ws-url"
              value={form.ws_url}
              autoComplete="off"
              placeholder="wss://gateway.example.com/wecom/bot-1"
              onChange={(e) => patch('ws_url', e.target.value)}
            />
            <p className="mt-[0.35rem] text-xs text-muted-foreground">
              Gateway 与企微之间的 WebSocket 接入地址，需以 ws:// 或 wss:// 开头。
            </p>
            {errors.ws_url ? (
              <p className="mt-1 text-xs text-destructive">{errors.ws_url}</p>
            ) : null}
          </div>

          <div>
            <label className={fieldLabel} htmlFor="wecom-secret">
              Secret {secretRequired ? '*' : ''}
            </label>
            {hasStoredSecret ? (
              <label className="mb-[0.4rem] flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 cursor-pointer accent-primary"
                  checked={replaceSecret}
                  onChange={(e) => toggleReplaceSecret(e.target.checked)}
                />
                更换 Secret（勾选后才可输入）
              </label>
            ) : null}
            <Input
              id="wecom-secret"
              type="password"
              value={form.secret}
              disabled={!secretEditable}
              autoComplete="new-password"
              placeholder={
                hasStoredSecret && !replaceSecret
                  ? (bot?.secret_masked ?? '已配置，留空不修改')
                  : '请输入企微机器人 Secret'
              }
              onChange={(e) => patch('secret', e.target.value)}
            />
            <p className="mt-[0.35rem] text-xs text-muted-foreground">
              {hasStoredSecret
                ? 'Secret 只写不读：读接口仅返回掩码，此处不回显明文。留空 = 不修改既有 Secret。'
                : isEdit
                  ? '后端未返回掩码（可能尚未配置）。留空 = 不修改，填写则覆盖。'
                  : '仅在创建时明文提交一次，之后接口只回掩码。'}
            </p>
            {errors.secret ? (
              <p className="mt-1 text-xs text-destructive">{errors.secret}</p>
            ) : null}
          </div>

          <div>
            <label className={fieldLabel} htmlFor="wecom-agent">
              绑定 Agent
            </label>
            {agents.length > 0 ? (
              <select
                id="wecom-agent"
                className={selectClass}
                value={form.bound_agent_id}
                onChange={(e) => patch('bound_agent_id', e.target.value)}
              >
                <option value="">（不绑定，使用 Gateway 默认路由）</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.display_name}（{a.id}）
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id="wecom-agent"
                value={form.bound_agent_id}
                autoComplete="off"
                placeholder="Agent ID，留空则使用 Gateway 默认路由"
                onChange={(e) => patch('bound_agent_id', e.target.value)}
              />
            )}
            <p className="mt-[0.35rem] text-xs text-muted-foreground">
              {agents.length > 0
                ? '绑定后该 Bot 收到的消息固定投递给此 Agent；不绑定则由 Gateway 按路由规则分派。'
                : '当前拉不到 Agent 候选列表，可手动填写 Agent ID。'}
            </p>
            {errors.bound_agent_id ? (
              <p className="mt-1 text-xs text-destructive">{errors.bound_agent_id}</p>
            ) : null}
          </div>

          {isEdit && bot ? (
            <p className="rounded-md border bg-muted/40 p-2.5 text-xs text-muted-foreground">
              Bot ID：<span className="font-mono">{bot.bot_id}</span>。
              启停请使用列表中的「启用 / 停用」操作，本表单不改变启用状态。
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <SubmitButton loading={saving} onClick={() => void onSubmit()}>
            保存
          </SubmitButton>
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            取消
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
