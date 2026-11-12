// @vitest-environment node
/**
 * app_code 归属参数「打通」回归测试（P0，QA 独立验证轮）。
 *
 * <p><b>红线</b>：任务约定「不传 `appCode`/`scope` = 现状，**零回归**」。本测试锁死
 * `lib/api/{messages,tasks,workflow}.ts` 的参数构造契约：
 * - 未传 / 空白（undefined / 空串 / 纯空格）时，请求 query **不含** `appCode`/`scope`；
 * - 传入时，原样透传到 `api.get` 的 `params`；
 * - 既有参数（tenantId/userId/msgType/keyword/page/size）不受影响。
 *
 * <p>范式对齐 `biz-category.test.ts`：整体 mock `@/lib/api/client`，断言请求 path 与 params。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '@/lib/api/client';
import * as messagesApi from '@/lib/api/messages';
import * as tasksApi from '@/lib/api/tasks';
import * as workflowApi from '@/lib/api/workflow';

vi.mock('@/lib/api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const apiMock = api as unknown as { get: ReturnType<typeof vi.fn> };

const emptyPage = { data: { code: 0, data: { page: 1, size: 20, total: 0, list: [] } } };

/** 取出最近一次 api.get 的 params。 */
function lastParams(): Record<string, unknown> {
  const call = apiMock.get.mock.calls.at(-1);
  return (call?.[1] as { params: Record<string, unknown> }).params;
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue(emptyPage);
});
afterEach(() => vi.clearAllMocks());

describe('messages API · appCode/scope 打通', () => {
  it('fetchInbox 不传 appCode/scope ⇒ query 不含二者（零回归）', async () => {
    await messagesApi.fetchInbox({ tenantId: '1', userId: '1', msgType: 'NOTIFY', page: 1, size: 20 });
    expect(apiMock.get).toHaveBeenCalledWith('/messages/inbox', expect.anything());
    const p = lastParams();
    expect(p).toMatchObject({ tenantId: '1', userId: '1', msgType: 'NOTIFY', page: 1, size: 20 });
    expect(p).not.toHaveProperty('appCode');
    expect(p).not.toHaveProperty('scope');
  });

  it('fetchInbox 空白 appCode/scope（纯空格）也不透传', async () => {
    await messagesApi.fetchInbox({ tenantId: '1', userId: '1', appCode: '   ', scope: '' });
    const p = lastParams();
    expect(p).not.toHaveProperty('appCode');
    expect(p).not.toHaveProperty('scope');
  });

  it('fetchInbox 传 scope=APP&appCode=kb ⇒ 原样透传（去空格）', async () => {
    await messagesApi.fetchInbox({ tenantId: '1', userId: '1', scope: 'APP', appCode: ' kb ' });
    const p = lastParams();
    expect(p.scope).toBe('APP');
    expect(p.appCode).toBe('kb');
  });

  it('searchMessages 同样遵守「空白不透传 / 非空透传」', async () => {
    await messagesApi.searchMessages({ tenantId: '1', userId: '1', q: 'x' });
    expect(lastParams()).not.toHaveProperty('scope');

    await messagesApi.searchMessages({ tenantId: '1', userId: '1', q: 'x', scope: 'PLATFORM' });
    expect(lastParams().scope).toBe('PLATFORM');
    expect(lastParams().q).toBe('x');
  });
});

describe('tasks API · appCode/scope 打通', () => {
  it('fetchMyTasks 不传 ⇒ 不含 appCode/scope；keyword 仍按旧规则过滤空白', async () => {
    await tasksApi.fetchMyTasks({ tenantId: '1', assigneeId: '1', keyword: '  ', page: 1, size: 20 });
    const p = lastParams();
    expect(p).not.toHaveProperty('keyword');
    expect(p).not.toHaveProperty('appCode');
    expect(p).not.toHaveProperty('scope');
  });

  it('fetchMyTasks 传 scope=APP&appCode=kb ⇒ 透传', async () => {
    await tasksApi.fetchMyTasks({ tenantId: '1', assigneeId: '1', scope: 'APP', appCode: 'kb' });
    expect(apiMock.get).toHaveBeenCalledWith('/tasks/my', expect.anything());
    expect(lastParams()).toMatchObject({ scope: 'APP', appCode: 'kb' });
  });

  it('fetchHandledTasks 命中 /tasks/handled 并透传 scope', async () => {
    await tasksApi.fetchHandledTasks({ tenantId: '1', assigneeId: '1', scope: 'PLATFORM' });
    expect(apiMock.get).toHaveBeenCalledWith('/tasks/handled', expect.anything());
    expect(lastParams().scope).toBe('PLATFORM');
  });
});

describe('workflow API · fetchMyProcesses 尾参打通', () => {
  it('6 参调用（不传 scope/appCode）⇒ 不含二者（零回归）', async () => {
    await workflowApi.fetchMyProcesses('1', '1', undefined, 1, 20, 'kw');
    const p = lastParams();
    expect(p).toMatchObject({ tenantId: '1', initiatorId: '1', page: 1, size: 20, keyword: 'kw' });
    expect(p).not.toHaveProperty('scope');
    expect(p).not.toHaveProperty('appCode');
    expect(p).not.toHaveProperty('includeFormData');
  });

  it('includeFormData=true ⇒ 透传', async () => {
    await workflowApi.fetchMyProcesses('1', '1', undefined, 1, 20, undefined, undefined, undefined, undefined, undefined, true);
    expect(lastParams().includeFormData).toBe(true);
  });

  it('传 scope/appCode ⇒ 追加透传', async () => {
    await workflowApi.fetchMyProcesses('1', '1', undefined, 1, 20, undefined, 'APP', 'kb');
    expect(apiMock.get).toHaveBeenCalledWith('/workflow/instances/my', expect.anything());
    expect(lastParams()).toMatchObject({ scope: 'APP', appCode: 'kb' });
    expect(lastParams()).not.toHaveProperty('keyword');
  });

  it('scope/appCode 为纯空格 ⇒ 不透传', async () => {
    await workflowApi.fetchMyProcesses('1', '1', undefined, 1, 20, undefined, '  ', ' ');
    const p = lastParams();
    expect(p).not.toHaveProperty('scope');
    expect(p).not.toHaveProperty('appCode');
  });
});
