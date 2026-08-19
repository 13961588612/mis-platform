/**
 * wecomBotAdapter.sessionId.test.ts — T4 sessionId 内联 botId 单测（tsx 直跑）。
 *
 * 验证 WecomBotAdapter.receive / receiveEventCallback 的 sessionId 拼接规则
 * `wecom-bot-{botId}-{chatId|userId}`，并证明「同用户连 2 个 bot 不串台」。
 * 仅构造 adapter（不 start，不连 WS），纯逻辑。
 *
 * 运行：node_modules/.bin/tsx tests/wecomBotAdapter.sessionId.test.ts
 */

import { WecomBotAdapter } from '../src/adapters/wecom/WecomBotAdapter.js';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name} ${detail}`);
  }
}

function makeAdapter(botId: string): WecomBotAdapter {
  return new WecomBotAdapter({
    botId,
    secret: 's',
    sourceName: 's',
    wsUrl: 'wss://openws.work.weixin.qq.com',
  } as unknown as ConstructorParameters<typeof WecomBotAdapter>[0]);
}

async function main(): Promise<void> {
  const a = makeAdapter('botA');
  const b = makeAdapter('botB');

  const singleMsg = {
    cmd: 'aibot_msg_callback',
    msgType: 'text',
    content: 'hi',
    reqId: 'r1',
    from: { userId: 'u1' },
    chatType: 'single',
    raw: {},
  } as unknown as Parameters<WecomBotAdapter['receive']>[0];

  // ① 单聊 sessionId 含 botId 与 userId
  const sa = a.receive(singleMsg).sessionId;
  check('单聊 sessionId = wecom-bot-botA-u1', sa === 'wecom-bot-botA-u1', `got=${sa}`);

  // ② 同用户不同 bot → 不同 sessionId（不串台）
  const sb = b.receive(singleMsg).sessionId;
  check(
    '同用户不同 bot → 不同 sessionId（不串台）',
    sa !== sb && sb === 'wecom-bot-botB-u1',
    `a=${sa} b=${sb}`,
  );

  // ③ 群聊用 chatId
  const groupMsg = {
    ...singleMsg,
    chatType: 'group',
    chatId: 'C9',
  } as unknown as Parameters<WecomBotAdapter['receive']>[0];
  const sg = a.receive(groupMsg).sessionId;
  check('群聊 sessionId = wecom-bot-botA-C9', sg === 'wecom-bot-botA-C9', `got=${sg}`);

  // ④ 事件回调（按钮点击）sessionId 同样含 botId
  const cbMsg = {
    cmd: 'aibot_event_callback',
    raw: { body: { event: { task_id: 'tk1', event_key: 'manual' } } },
    from: { userId: 'u1' },
    chatType: 'single',
  } as unknown as Parameters<WecomBotAdapter['receive']>[0];
  const scb = (a as unknown as { receiveEventCallback: (m: unknown) => unknown }).receiveEventCallback(cbMsg) as {
    sessionId: string;
  } | null;
  check(
    '事件回调 sessionId 含 botId',
    scb != null && scb.sessionId === 'wecom-bot-botA-u1',
    `got=${JSON.stringify(scb)}`,
  );

  console.log(`\nWecomBotAdapter sessionId: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
