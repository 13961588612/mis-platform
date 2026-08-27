package com.mis.recon.util;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.MissingNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;

/**
 * 公共 JSON 读写（T04 起新代码统一使用；T03 的 service/config/JsonSupport 保持不动，F21 落地时合并）。
 */
public final class JsonUtil {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private JsonUtil() {
    }

    /** 解析 JSON 字符串；null/空白返回 null；非法抛 BizException(1003)。 */
    public static JsonNode parse(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return MAPPER.readTree(json);
        } catch (JsonProcessingException e) {
            throw new BizException(ErrorCode.REQUEST_BODY_INVALID, "JSON 格式错误");
        }
    }

    /** 解析为对象；null/非对象抛 BizException(1003)。 */
    public static ObjectNode parseObject(String json) {
        JsonNode node = parse(json);
        if (node == null || !node.isObject()) {
            throw new BizException(ErrorCode.REQUEST_BODY_INVALID, "JSON 必须为对象");
        }
        return (ObjectNode) node;
    }

    /** 任意对象 → JSON 字符串；null → "null"。 */
    public static String toString(Object value) {
        try {
            return MAPPER.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new BizException(ErrorCode.REQUEST_BODY_INVALID, "对象序列化失败: " + value);
        }
    }

    /** 取字段（大小写不敏感回退）：先精确匹配，取不到再按字段名忽略大小写匹配。
     *  非对象 / 精确与忽略大小写均无匹配 → MissingNode（与 data.path 缺失语义一致）。 */
    public static JsonNode getFieldIgnoreCase(JsonNode obj, String field) {
        if (obj == null || !obj.isObject()) {
            return MissingNode.getInstance();
        }
        JsonNode exact = obj.get(field);
        if (exact != null) {
            return exact;
        }
        java.util.Iterator<String> it = obj.fieldNames();
        while (it.hasNext()) {
            String name = it.next();
            if (name.equalsIgnoreCase(field)) {
                return obj.get(name);
            }
        }
        return MissingNode.getInstance();
    }
}