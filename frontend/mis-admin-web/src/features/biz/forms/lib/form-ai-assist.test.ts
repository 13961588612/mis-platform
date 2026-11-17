import { describe, expect, it } from 'vitest';
import type { FormFieldSchema } from '../types';
import {
  buildFormAssistPrompt,
  canShowFormAiAssist,
  parseFormAssistFields,
  pickAssistFields,
} from './form-ai-assist';

const schema: FormFieldSchema[] = [
  { key: 'orderNo', label: '采购单号' },
  { key: 'amount', label: '申请金额', type: 'number', unit: '元' },
  { key: 'priority', label: '优先级', type: 'select', options: [{ value: 'HIGH', label: '高' }] },
];

describe('form-ai-assist', () => {
  it('未配齐 Agent/Skill 或无执行码时不显示按钮', () => {
    const has = (c: string) => c === 'ai:skill:form-assist:run';
    expect(canShowFormAiAssist(null, has)).toBe(false);
    expect(canShowFormAiAssist({ aiAgentId: 'mis-copilot', aiSkillId: '' }, has)).toBe(false);
    expect(canShowFormAiAssist({ aiAgentId: 'mis-copilot', aiSkillId: 'form-assist' }, () => false)).toBe(
      false,
    );
    expect(canShowFormAiAssist({ aiAgentId: 'mis-copilot', aiSkillId: 'form-assist' }, has)).toBe(true);
  });

  it('按 schema.key 解析 JSON 并丢掉未知键、把 select 的 label 映射为 value', () => {
    const raw = parseFormAssistFields(
      '说明\n```json\n{"fields":{"orderNo":"PO-1","amount":"128,000元","priority":"高","ghost":1}}\n```',
    );
    expect(raw.orderNo).toBe('PO-1');
    const picked = pickAssistFields(schema, raw);
    expect(picked).toEqual({ orderNo: 'PO-1', amount: 128000, priority: 'HIGH' });
    expect(picked).not.toHaveProperty('ghost');
  });

  it('prompt 注入 skill 与 schema key', () => {
    const p = buildFormAssistPrompt({
      formCode: 'PUR_FORM',
      skillId: 'form-assist',
      fields: schema,
      currentValues: {},
      userText: '买防火墙',
    });
    expect(p).toContain('form-assist');
    expect(p).toContain('orderNo');
    expect(p).toContain('买防火墙');
  });
});
