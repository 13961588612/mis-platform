package com.mis.taskflow.support;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/**
 * 变更差异计算（P4）：对比 before/after 两个 JSON，产出 [{field, old, new}] 摘要。
 */
public final class AuditDiffUtils {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private AuditDiffUtils() {
    }

    /**
     * 计算字段级差异。
     *
     * @param beforeJson 变更前 JSON（可为空）
     * @param afterJson  变更后 JSON（可为空）
     * @return JSON 数组字符串，如 {@code [{"field":"amount","old":"50000","new":"65000"}]}
     */
    public static String diff(String beforeJson, String afterJson) {
        List<Map<String, String>> diffs = new ArrayList<>();
        try {
            JsonNode before = parse(beforeJson);
            JsonNode after = parse(afterJson);
            collect("", before, after, diffs);
        } catch (Exception e) {
            // diff 失败不应影响主业务；返回空数组
            return "[]";
        }
        try {
            return MAPPER.writeValueAsString(diffs);
        } catch (Exception e) {
            return "[]";
        }
    }

    private static void collect(String prefix, JsonNode before, JsonNode after, List<Map<String, String>> out) {
        if (before == null && after == null) {
            return;
        }
        if (before == null || after == null || !before.isObject() || !after.isObject()) {
            String b = nodeText(before);
            String a = nodeText(after);
            if (!equalsStr(b, a)) {
                out.add(field(prefix, b, a));
            }
            return;
        }
        java.util.Set<String> keys = new java.util.LinkedHashSet<>();
        before.fieldNames().forEachRemaining(keys::add);
        after.fieldNames().forEachRemaining(keys::add);
        for (String key : keys) {
            String childPrefix = prefix.isEmpty() ? key : prefix + "." + key;
            collect(childPrefix, before.get(key), after.get(key), out);
        }
    }

    private static Map<String, String> field(String name, String oldVal, String newVal) {
        Map<String, String> m = new java.util.LinkedHashMap<>();
        m.put("field", name);
        m.put("old", oldVal);
        m.put("new", newVal);
        return m;
    }

    private static JsonNode parse(String json) throws Exception {
        if (json == null || json.isBlank()) {
            return null;
        }
        return MAPPER.readTree(json);
    }

    private static String nodeText(JsonNode node) {
        if (node == null || node.isNull()) {
            return null;
        }
        return node.isValueNode() ? node.asText() : node.toString();
    }

    private static boolean equalsStr(String a, String b) {
        return a == null ? b == null : a.equals(b);
    }

    /** 供测试与序列化使用。 */
    public static String toJson(Object value) {
        try {
            return MAPPER.writeValueAsString(value);
        } catch (Exception e) {
            return "{}";
        }
    }
}