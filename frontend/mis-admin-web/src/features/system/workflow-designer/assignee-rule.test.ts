import { describe, expect, it } from 'vitest';
import {
  assigneeRuleLabel,
  isAssigneeRuleConfigured,
  parseAssigneeRule,
  serializeAssigneeRule,
} from './assignee-rule';

describe('assignee-rule parse/serialize', () => {
  it('空 / {} 解析为 SELF', () => {
    expect(parseAssigneeRule('')).toEqual({ type: 'SELF', ids: [], orgPosts: [] });
    expect(parseAssigneeRule('{}')).toEqual({ type: 'SELF', ids: [], orgPosts: [] });
  });

  it('USER_LIST 往返；FIXED/ROLE 仍可解析（兼容旧数据）', () => {
    expect(parseAssigneeRule('{"type":"USER_LIST","value":[1,2]}')).toEqual({
      type: 'USER_LIST',
      ids: ['1', '2'],
      orgPosts: [],
    });
    expect(serializeAssigneeRule({ type: 'USER_LIST', ids: ['1', '2'] })).toBe(
      '{"type":"USER_LIST","value":[1,2]}',
    );

    expect(parseAssigneeRule('{"type":"FIXED","value":700001}')).toEqual({
      type: 'FIXED',
      ids: ['700001'],
      orgPosts: [],
    });
    expect(serializeAssigneeRule({ type: 'ROLE', ids: ['10', '11'] })).toBe(
      '{"type":"ROLE","value":[10,11]}',
    );
  });

  it('SELF / SUPERVISOR 不带 value', () => {
    expect(serializeAssigneeRule({ type: 'SELF', ids: [] })).toBe('{"type":"SELF"}');
    expect(serializeAssigneeRule({ type: 'SUPERVISOR', ids: ['x'] })).toBe('{"type":"SUPERVISOR"}');
  });

  it('ORG_POST 支持多岗位数组，兼容旧版单对象', () => {
    const multi =
      '{"type":"ORG_POST","value":[{"orgId":1,"deptId":2,"postId":3},{"orgId":1,"deptId":2,"postId":4}]}';
    expect(parseAssigneeRule(multi)).toEqual({
      type: 'ORG_POST',
      ids: [],
      orgPosts: [
        { orgId: '1', deptId: '2', postId: '3' },
        { orgId: '1', deptId: '2', postId: '4' },
      ],
    });
    expect(
      serializeAssigneeRule({
        type: 'ORG_POST',
        ids: [],
        orgPosts: [
          { orgId: '1', deptId: '2', postId: '3' },
          { orgId: '1', deptId: '2', postId: '4' },
        ],
      }),
    ).toBe(multi);

    // 旧版单对象 → 解析为单元素数组；序列化为数组
    expect(parseAssigneeRule('{"type":"ORG_POST","value":{"orgId":1,"deptId":2,"postId":3}}')).toEqual(
      {
        type: 'ORG_POST',
        ids: [],
        orgPosts: [{ orgId: '1', deptId: '2', postId: '3' }],
      },
    );
    expect(
      serializeAssigneeRule({
        type: 'ORG_POST',
        ids: [],
        orgPosts: [{ orgId: '1', deptId: '2', postId: '3' }],
      }),
    ).toBe('{"type":"ORG_POST","value":[{"orgId":1,"deptId":2,"postId":3}]}');

    expect(isAssigneeRuleConfigured('{"type":"ORG_POST"}')).toBe(false);
    expect(isAssigneeRuleConfigured(multi)).toBe(true);
  });

  it('配置完整性：空 / {} / FIXED 无人选视为未配置', () => {
    expect(isAssigneeRuleConfigured('')).toBe(false);
    expect(isAssigneeRuleConfigured('{}')).toBe(false);
    expect(isAssigneeRuleConfigured('{"type":"SELF"}')).toBe(true);
    expect(isAssigneeRuleConfigured('{"type":"FIXED"}')).toBe(false);
    expect(isAssigneeRuleConfigured('{"type":"FIXED","value":1}')).toBe(true);
    expect(isAssigneeRuleConfigured('{"type":"USER_LIST","value":[]}')).toBe(false);
  });

  it('中文短标签', () => {
    expect(assigneeRuleLabel('{"type":"SELF"}')).toBe('发起人本人');
    expect(assigneeRuleLabel('{"type":"FIXED","value":1}')).toBe('指定人员（已停用）');
    expect(assigneeRuleLabel('{"type":"ORG_POST"}')).toBe('公司 + 部门 + 岗位');
  });
});
