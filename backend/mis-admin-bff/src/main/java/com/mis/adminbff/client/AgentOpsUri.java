package com.mis.adminbff.client;

import org.springframework.web.util.UriBuilder;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 查询参数拼装小工具。
 *
 * <p>存在的理由很实际：{@link AgentOpsClient} 有 8 个方法需要「把一个可选 query map
 * 挂到 UriBuilder 上，跳过 null 与空串」。这段逻辑抄 8 遍，就有 8 处机会漏掉空值判断 ——
 * 漏掉的后果是往下游发出 {@code ?keyword=&page=1} 这种带空值的参数，
 * FastAPI 的 {@code Query(None)} 会把空串当成<b>有效的空字符串过滤条件</b>而不是「未传」，
 * 于是列表返回 0 条。这类 bug 不抛异常、日志干净，只表现为「筛选框一动就没数据」。
 *
 * <p>顺带保证顺序稳定（{@link LinkedHashMap}），让日志里的下游 URL 可比对。
 */
public final class AgentOpsUri {

    private AgentOpsUri() {
    }

    /**
     * 把 {@code params} 里的非空项挂到 {@code builder} 上。
     *
     * @param builder 目标 builder（已 {@code path(...)}）
     * @param params  查询参数，允许为 {@code null}
     * @return 同一个 {@code builder}，便于链式调用
     */
    static UriBuilder query(UriBuilder builder, Map<String, String> params) {
        if (params == null || params.isEmpty()) {
            return builder;
        }
        for (Map.Entry<String, String> entry : params.entrySet()) {
            String value = entry.getValue();
            if (value == null || value.isBlank()) {
                continue;
            }
            builder.queryParam(entry.getKey(), value);
        }
        return builder;
    }

    /**
     * 由若干「键, 值」交替的参数构造有序 map，值为 {@code null} 的项直接丢弃。
     *
     * <p>给 Controller 用：{@code AgentOpsUri.of("page", page, "page_size", size)} 比
     * 手写 6 行 {@code if (x != null) map.put(...)} 可读得多，也不会漏。
     *
     * @param keyValues 必须成对出现，key 为 {@code String}，value 任意（{@code null} 表示不传）
     * @return 有序且已剔除空值的参数表
     * @throws IllegalArgumentException 参数个数为奇数时
     */
    public static Map<String, String> of(Object... keyValues) {
        if (keyValues.length % 2 != 0) {
            throw new IllegalArgumentException("keyValues 必须成对出现，当前长度 " + keyValues.length);
        }
        Map<String, String> params = new LinkedHashMap<>();
        for (int i = 0; i < keyValues.length; i += 2) {
            Object key = keyValues[i];
            Object value = keyValues[i + 1];
            if (key == null || value == null) {
                continue;
            }
            String text = String.valueOf(value);
            if (text.isBlank()) {
                continue;
            }
            params.put(String.valueOf(key), text);
        }
        return params;
    }
}
