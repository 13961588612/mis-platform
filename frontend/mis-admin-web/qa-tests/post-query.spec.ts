/**
 * 被测对象：`src/lib/api/posts.ts` 的**真实源码**（listPosts + 私有 toParams）。
 *
 * 验收映射：POST-02（deptIds 多选）、POST-03（orgIds 多选）、
 * 架构 §7.4「多选参数序列化：前端数组 join(',') → 后端 List<Long>；空数组等同不约束」。
 */
import { listPosts, type PostQuery } from '@/lib/api/posts';
import api, { lastCall, queryStringOf, resetStub } from '@/lib/api/client';
import { assertEqual, assertUndefined, describe, it } from './harness';

// 触发 stub 的类型使用，确保 default 导出被真实引用（避免被摇掉）
void api;

/** 调 listPosts 后取出实际发出的 params。 */
async function paramsOf(query: PostQuery): Promise<Record<string, unknown>> {
  resetStub([]);
  await listPosts(query);
  return (lastCall().params ?? {}) as Record<string, unknown>;
}

describe('posts.ts listPosts —— 多选参数逗号序列化（POST-02 / POST-03）', () => {
  it('deptIds=[1,2] + orgIds=[3,4] → ?deptIds=1,2&orgIds=3,4', async () => {
    const params = await paramsOf({ deptIds: [1, 2], orgIds: [3, 4] });

    assertEqual(params.deptIds, '1,2', 'deptIds 必须是逗号串而非数组');
    assertEqual(params.orgIds, '3,4', 'orgIds 必须是逗号串而非数组');
    assertEqual(
      queryStringOf(params),
      'deptIds=1,2&orgIds=3,4',
      '最终 query string 须与后端 @RequestParam List<Long> 的逗号绑定契约一致',
    );
  });

  it('请求打到 /posts（相对 baseURL /api/v1）', async () => {
    resetStub([]);
    await listPosts({ deptIds: [1] });

    assertEqual(lastCall().url, '/posts');
    assertEqual(lastCall().method, 'get');
  });

  it('字符串 id 也归一成数字逗号串（选项 value 来自后端 String.valueOf(id)）', async () => {
    const params = await paramsOf({ deptIds: ['101', '102'], orgIds: ['10'] });

    assertEqual(params.deptIds, '101,102');
    assertEqual(params.orgIds, '10');
  });

  it('单元素数组 → 无尾随逗号', async () => {
    const params = await paramsOf({ deptIds: [7] });

    assertEqual(params.deptIds, '7');
  });

  it('空数组 → 参数完全不下传（等同「不约束」，不得变成 deptIds=）', async () => {
    const params = await paramsOf({ deptIds: [], orgIds: [] });

    assertUndefined(params.deptIds, '空数组必须省略，否则后端会收到空串参数');
    assertUndefined(params.orgIds, '空数组必须省略');
    assertEqual(queryStringOf(params), '', '不应产生任何查询参数');
  });

  it('未传 → 参数不出现', async () => {
    const params = await paramsOf({});

    assertUndefined(params.deptIds);
    assertUndefined(params.orgIds);
    assertUndefined(params.deptId);
  });

  it('单值 deptId 兼容保留，且可与 deptIds 共存', async () => {
    const params = await paramsOf({ deptId: 5, deptIds: [1, 2] });

    assertEqual(params.deptId, 5, '单值 deptId 须保留（后端与 deptIds 取并集）');
    assertEqual(params.deptIds, '1,2');
  });

  it('deptId 为空串 → 视作未传（筛选栏清空场景）', async () => {
    const params = await paramsOf({ deptId: '' });

    assertUndefined(params.deptId, '空串不应下传，否则后端 Long 绑定会 400');
  });

  it('postTypeId / status 与多选参数互不干扰', async () => {
    const params = await paramsOf({ deptIds: [1], orgIds: [3], postTypeId: 7, status: 1 });

    assertEqual(params.deptIds, '1');
    assertEqual(params.orgIds, '3');
    assertEqual(params.postTypeId, 7);
    assertEqual(params.status, 1);
  });

  it('status=0（禁用）不被误当成空值丢弃', async () => {
    const params = await paramsOf({ status: 0 });

    assertEqual(params.status, 0, 'status=0 是有效值，falsy 判断会把它吃掉');
  });
});
