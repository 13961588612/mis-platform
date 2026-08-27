package com.mis.recon.service.config;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;

/**
 * JSON 解析辅助（ConfigValidationService 子功能拆分，满足单文件 300 行门禁）。
 * T03 不建 util 包，F15~F24 util 计划落地时并入 JsonUtil。
 */
final class JsonSupport {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private JsonSupport() {
    }

    /** 解析 JSON 字符串；空返回 null，非法抛 400。 */
    static JsonNode parse(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return MAPPER.readTree(json);
        } catch (JsonProcessingException e) {
            throw new BizException(ErrorCode.REQUEST_BODY_INVALID, "JSON 格式错误: " + json);
        }
    }

    /** 解析为 JSON 对象；非对象抛 400。 */
    static ObjectNode parseObject(String json) {
        JsonNode n = parse(json);
        if (n == null || !n.isObject()) {
            throw new BizException(ErrorCode.REQUEST_BODY_INVALID, "consume_json 必须为 JSON 对象");
        }
        return (ObjectNode) n;
    }
}
