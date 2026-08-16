"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * 被测对象：`src/features/system/admin-list-page.tsx` 的两处核心过滤逻辑。
 *
 * ⚠️ 说明：这两段逻辑写在 React 组件内部的 useMemo 闭包里（`filtered`、
 * `serverFilterSignature`），无法直接 import。因此此处按**逐字等价移植**
 * （源码 admin-list-page.tsx L562-567 与 L769-788），移植后对照源码复核过一遍。
 * 若日后源码改动而本文件未同步，属测试维护债 —— 已在报告中标注。
 *
 * 验收映射：POST-02/POST-03 的 serverFilterKeys 跳过客户端二次过滤、
 * multiselect 数组包含过滤；架构 §7.5「服务端/客户端过滤分工」。
 */
const harness_1 = require("./harness");
// ---------------------------------------------------------------------------
// 移植自 admin-list-page.tsx L769-788（filtered 的 .filter 谓词部分）
// ---------------------------------------------------------------------------
function applyClientFilter(rows, def, applied) {
    return rows.filter((r) => (def.filters ?? []).every((f) => {
        // 服务端已过滤的 key（deptIds/orgIds）：跳过客户端二次过滤，避免数组匹配全空
        if (def.serverFilterKeys?.includes(f.key))
            return true;
        const v = applied[f.key];
        if (v === '' || v == null)
            return true;
        const cell = r[f.key];
        if (f.type === 'select')
            return String(cell) === String(v);
        if (f.type === 'multiselect' && Array.isArray(v)) {
            if (v.length === 0)
                return true;
            return v.map(String).includes(String(cell));
        }
        return String(cell ?? '')
            .toLowerCase()
            .includes(String(v).toLowerCase());
    }));
}
// ---------------------------------------------------------------------------
// 移植自 admin-list-page.tsx L562-567（serverFilterSignature）
// ---------------------------------------------------------------------------
function serverFilterSignature(def, applied) {
    return (def.serverFilterKeys ?? []).map((k) => String(applied[k] ?? '')).join('|');
}
// ---------------------------------------------------------------------------
// 布景：与 /system/post 的 def 一致
// ---------------------------------------------------------------------------
const POST_DEF = {
    filters: [
        { key: 'name', type: 'text' },
        { key: 'deptIds', type: 'multiselect' },
        { key: 'orgIds', type: 'multiselect' },
        { key: 'status', type: 'select' },
    ],
    serverFilterKeys: ['deptIds', 'orgIds'],
};
/** 后端已按 deptIds/orgIds 过滤后返回的行。 */
const ROWS = [
    { id: '1', name: '研发工程师', deptId: '101', status: 1 },
    { id: '2', name: '架构师', deptId: '102', status: 1 },
    { id: '3', name: '大区总', deptId: '201', status: 0 },
];
(0, harness_1.describe)('admin-list-page filtered —— serverFilterKeys 跳过客户端二次过滤', () => {
    (0, harness_1.it)('deptIds 已选但行上没有 deptIds 字段 → 不得把结果过滤空（核心回归点）', () => {
        const out = applyClientFilter(ROWS, POST_DEF, { deptIds: ['101', '102'] });
        (0, harness_1.assertEqual)(out.length, 3, '服务端已过滤的 key 必须跳过，否则数组匹配 undefined 会全空');
    });
    (0, harness_1.it)('orgIds 已选 → 同样跳过，不影响结果', () => {
        const out = applyClientFilter(ROWS, POST_DEF, { orgIds: ['10', '20'] });
        (0, harness_1.assertEqual)(out.length, 3);
    });
    (0, harness_1.it)('deptIds + orgIds 同时选 → 仍全量保留（交集由后端完成）', () => {
        const out = applyClientFilter(ROWS, POST_DEF, { deptIds: ['101'], orgIds: ['10'] });
        (0, harness_1.assertEqual)(out.length, 3);
    });
    (0, harness_1.it)('客户端 key 仍正常过滤：name 模糊匹配', () => {
        const out = applyClientFilter(ROWS, POST_DEF, { name: '架构' });
        (0, harness_1.assertDeepEqual)(out.map((r) => r.id), ['2']);
    });
    (0, harness_1.it)('客户端 key 仍正常过滤：status 精确匹配（select）', () => {
        const out = applyClientFilter(ROWS, POST_DEF, { status: 0 });
        (0, harness_1.assertDeepEqual)(out.map((r) => r.id), ['3']);
    });
    (0, harness_1.it)('服务端 key 与客户端 key 叠加：deptIds 跳过、name 生效', () => {
        const out = applyClientFilter(ROWS, POST_DEF, { deptIds: ['999'], name: '研发' });
        (0, harness_1.assertDeepEqual)(out.map((r) => r.id), ['1'], 'deptIds 不参与客户端过滤，name 仍须生效');
    });
    (0, harness_1.it)('未配置 serverFilterKeys 时，multiselect 走数组包含过滤', () => {
        const def = { filters: [{ key: 'deptId', type: 'multiselect' }] };
        const out = applyClientFilter(ROWS, def, { deptId: ['101', '201'] });
        (0, harness_1.assertDeepEqual)(out.map((r) => r.id), ['1', '3'], 'multiselect 应按「单元格值 ∈ 已选集合」过滤');
    });
    (0, harness_1.it)('multiselect 空数组 → 不约束（返回全部）', () => {
        const def = { filters: [{ key: 'deptId', type: 'multiselect' }] };
        const out = applyClientFilter(ROWS, def, { deptId: [] });
        (0, harness_1.assertEqual)(out.length, 3, '空数组必须视作不约束');
    });
    (0, harness_1.it)('multiselect 数字与字符串混用可比对（选项 value 可能是 number）', () => {
        const def = { filters: [{ key: 'deptId', type: 'multiselect' }] };
        const out = applyClientFilter(ROWS, def, { deptId: [101, 102] });
        (0, harness_1.assertDeepEqual)(out.map((r) => r.id), ['1', '2'], '须经 String() 归一后比较，否则数字选项匹配不到字符串单元格');
    });
});
(0, harness_1.describe)('admin-list-page serverFilterSignature —— 仅服务端筛选键变化才重拉数据', () => {
    (0, harness_1.it)('deptIds 数组变化 → 签名变化（触发 loader 重拉）', () => {
        const before = serverFilterSignature(POST_DEF, { deptIds: ['1'] });
        const after = serverFilterSignature(POST_DEF, { deptIds: ['1', '2'] });
        (0, harness_1.assertEqual)(before === after, false, '服务端筛选键变化必须改变签名');
    });
    (0, harness_1.it)('仅客户端键（name）变化 → 签名不变（不触发无谓网络请求）', () => {
        const before = serverFilterSignature(POST_DEF, { deptIds: ['1'], name: 'a' });
        const after = serverFilterSignature(POST_DEF, { deptIds: ['1'], name: 'b' });
        (0, harness_1.assertEqual)(before, after, '客户端筛选不应触发 loader 重拉');
    });
    (0, harness_1.it)('orgIds 变化 → 签名变化', () => {
        const before = serverFilterSignature(POST_DEF, { orgIds: ['10'] });
        const after = serverFilterSignature(POST_DEF, { orgIds: ['20'] });
        (0, harness_1.assertEqual)(before === after, false);
    });
    (0, harness_1.it)('清空 deptIds（[] → 未传）签名一致，均为空串', () => {
        (0, harness_1.assertEqual)(serverFilterSignature(POST_DEF, { deptIds: [] }), serverFilterSignature(POST_DEF, {}), '空数组与未传应产生相同签名，避免重复拉取');
    });
    (0, harness_1.it)('两个服务端键以 | 分隔，互不串味（["1","2"]+[] ≠ ["1"]+["2"]）', () => {
        const a = serverFilterSignature(POST_DEF, { deptIds: ['1', '2'], orgIds: [] });
        const b = serverFilterSignature(POST_DEF, { deptIds: ['1'], orgIds: ['2'] });
        (0, harness_1.assertEqual)(a === b, false, '分隔符必须防止不同组合产生相同签名');
        (0, harness_1.assertEqual)(a, '1,2|');
        (0, harness_1.assertEqual)(b, '1|2');
    });
});
