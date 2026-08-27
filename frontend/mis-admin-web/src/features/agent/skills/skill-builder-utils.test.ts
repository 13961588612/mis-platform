import { describe, expect, it } from 'vitest';
import { extractSkillMd } from './skill-builder-utils';

describe('extractSkillMd', () => {
  it('抽取 ```SKILL.md 外层围栏，保留正文里的 json 示例', () => {
    const reply = [
      '```SKILL.md',
      '---',
      'name: 订单详情',
      'description: 查单笔订单',
      '---',
      '',
      '## 示例',
      '```json',
      '{ "apiName": "getOrder" }',
      '```',
      '',
      '## 注意事项',
      '仅只读。',
      '```',
    ].join('\n');

    const md = extractSkillMd(reply);
    expect(md).toContain('name: 订单详情');
    expect(md).toContain('"apiName": "getOrder"');
    expect(md).toContain('## 注意事项');
    expect(md).toContain('仅只读。');
  });

  it('无围栏返回 null（调用方整段兜底）', () => {
    expect(extractSkillMd('只是一段说明，没有代码块')).toBeNull();
  });

  it('外层未闭合（生成被截断）时取到文末', () => {
    const reply = [
      '```SKILL.md',
      '---',
      'name: 半成品',
      'description: 还在写',
      '---',
      '',
      '## 示例',
      '```json',
      '{ "apiName": "getOrder" }',
      '```',
      '',
      '## 后半段不应丢失',
    ].join('\n');

    const md = extractSkillMd(reply);
    expect(md).toContain('## 后半段不应丢失');
    expect(md).toContain('"apiName": "getOrder"');
  });
});
