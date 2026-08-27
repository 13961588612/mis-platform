"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * 被测对象：`src/lib/api/posts.ts` 的**真实源码**（listPosts + 私有 toParams）。
 *
 * 验收映射：POST-02（deptIds 多选）、POST-03（orgIds 多选）、
 * 架构 §7.4「多选参数序列化：前端数组 join(',') → 后端 List<Long>；空数组等同不约束」。
 */
const posts_1 = require("@/lib/api/posts");
const client_1 = __importStar(require("@/lib/api/client"));
const harness_1 = require("./harness");
// 触发 stub 的类型使用，确保 default 导出被真实引用（避免被摇掉）
void client_1.default;
/** 调 listPosts 后取出实际发出的 params。 */
async function paramsOf(query) {
    (0, client_1.resetStub)([]);
    await (0, posts_1.listPosts)(query);
    return ((0, client_1.lastCall)().params ?? {});
}
(0, harness_1.describe)('posts.ts listPosts —— 多选参数逗号序列化（POST-02 / POST-03）', () => {
    (0, harness_1.it)('deptIds=[1,2] + orgIds=[3,4] → ?deptIds=1,2&orgIds=3,4', async () => {
        const params = await paramsOf({ deptIds: [1, 2], orgIds: [3, 4] });
        (0, harness_1.assertEqual)(params.deptIds, '1,2', 'deptIds 必须是逗号串而非数组');
        (0, harness_1.assertEqual)(params.orgIds, '3,4', 'orgIds 必须是逗号串而非数组');
        (0, harness_1.assertEqual)((0, client_1.queryStringOf)(params), 'deptIds=1,2&orgIds=3,4', '最终 query string 须与后端 @RequestParam List<Long> 的逗号绑定契约一致');
    });
    (0, harness_1.it)('请求打到 /posts（相对 baseURL /api/v1）', async () => {
        (0, client_1.resetStub)([]);
        await (0, posts_1.listPosts)({ deptIds: [1] });
        (0, harness_1.assertEqual)((0, client_1.lastCall)().url, '/posts');
        (0, harness_1.assertEqual)((0, client_1.lastCall)().method, 'get');
    });
    (0, harness_1.it)('字符串 id 也归一成数字逗号串（选项 value 来自后端 String.valueOf(id)）', async () => {
        const params = await paramsOf({ deptIds: ['101', '102'], orgIds: ['10'] });
        (0, harness_1.assertEqual)(params.deptIds, '101,102');
        (0, harness_1.assertEqual)(params.orgIds, '10');
    });
    (0, harness_1.it)('单元素数组 → 无尾随逗号', async () => {
        const params = await paramsOf({ deptIds: [7] });
        (0, harness_1.assertEqual)(params.deptIds, '7');
    });
    (0, harness_1.it)('空数组 → 参数完全不下传（等同「不约束」，不得变成 deptIds=）', async () => {
        const params = await paramsOf({ deptIds: [], orgIds: [] });
        (0, harness_1.assertUndefined)(params.deptIds, '空数组必须省略，否则后端会收到空串参数');
        (0, harness_1.assertUndefined)(params.orgIds, '空数组必须省略');
        (0, harness_1.assertEqual)((0, client_1.queryStringOf)(params), '', '不应产生任何查询参数');
    });
    (0, harness_1.it)('未传 → 参数不出现', async () => {
        const params = await paramsOf({});
        (0, harness_1.assertUndefined)(params.deptIds);
        (0, harness_1.assertUndefined)(params.orgIds);
        (0, harness_1.assertUndefined)(params.deptId);
    });
    (0, harness_1.it)('单值 deptId 兼容保留，且可与 deptIds 共存', async () => {
        const params = await paramsOf({ deptId: 5, deptIds: [1, 2] });
        (0, harness_1.assertEqual)(params.deptId, 5, '单值 deptId 须保留（后端与 deptIds 取并集）');
        (0, harness_1.assertEqual)(params.deptIds, '1,2');
    });
    (0, harness_1.it)('deptId 为空串 → 视作未传（筛选栏清空场景）', async () => {
        const params = await paramsOf({ deptId: '' });
        (0, harness_1.assertUndefined)(params.deptId, '空串不应下传，否则后端 Long 绑定会 400');
    });
    (0, harness_1.it)('postTypeId / status 与多选参数互不干扰', async () => {
        const params = await paramsOf({ deptIds: [1], orgIds: [3], postTypeId: 7, status: 1 });
        (0, harness_1.assertEqual)(params.deptIds, '1');
        (0, harness_1.assertEqual)(params.orgIds, '3');
        (0, harness_1.assertEqual)(params.postTypeId, 7);
        (0, harness_1.assertEqual)(params.status, 1);
    });
    (0, harness_1.it)('status=0（禁用）不被误当成空值丢弃', async () => {
        const params = await paramsOf({ status: 0 });
        (0, harness_1.assertEqual)(params.status, 0, 'status=0 是有效值，falsy 判断会把它吃掉');
    });
});
