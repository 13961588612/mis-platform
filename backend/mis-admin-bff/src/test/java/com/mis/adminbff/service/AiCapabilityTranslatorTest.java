package com.mis.adminbff.service;

import com.mis.adminbff.dto.ai.AiExtractResponse;
import com.mis.adminbff.dto.ai.AiPlatformChatData;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link AiCapabilityTranslator#parseExtract(AiPlatformChatData)} 的回归测试。
 *
 * <p>固化「修复前 readTree 遇 markdown 围栏抛 JsonParseException 被静默吞掉 →
 * 永远返回 {"fields":{}}」的回归问题。平台 mis-extract agent 实际返回的 response
 * 常裹 ```json 围栏，且有时把 JSON 输出两遍（紧凑版 + 格式化版）。
 *
 * <p>本测试直接 new AiCapabilityTranslator() 调用 parseExtract，验证各类真实 payload
 * 均能正确解析出非空 fields；若未来误删 stripJsonFences，测试将失败（回归告警）。
 */
class AiCapabilityTranslatorTest {

    /** 紧凑版 JSON（与平台第一遍输出一致）。 */
    private static final String COMPACT_JSON = "{"
            + "\"fields\":{"
            + "\"username\":null,\"realName\":\"小王\",\"employeeNo\":null,"
            + "\"email\":null,\"phone\":\"13961588612\",\"deptId\":\"江苏华地\",\"roleIds\":null"
            + "},"
            + "\"confidence\":{"
            + "\"username\":0,\"realName\":0.95,\"employeeNo\":0,\"email\":0,"
            + "\"phone\":0.95,\"deptId\":0.70,\"roleIds\":0"
            + "},"
            + "\"unmapped\":[{\"raw\":\"新增用户\",\"hint\":\"操作类型\"}]"
            + "}";

    /** 格式化版 JSON（与平台第二遍输出一致，内容同 COMPACT_JSON）。 */
    private static final String FORMATTED_JSON = "{\n"
            + "  \"fields\": {\n"
            + "    \"username\": null,\n"
            + "    \"realName\": \"小王\",\n"
            + "    \"employeeNo\": null,\n"
            + "    \"email\": null,\n"
            + "    \"phone\": \"13961588612\",\n"
            + "    \"deptId\": \"江苏华地\",\n"
            + "    \"roleIds\": null\n"
            + "  },\n"
            + "  \"confidence\": {\n"
            + "    \"username\": 0,\n"
            + "    \"realName\": 0.95,\n"
            + "    \"employeeNo\": 0,\n"
            + "    \"email\": 0,\n"
            + "    \"phone\": 0.95,\n"
            + "    \"deptId\": 0.70,\n"
            + "    \"roleIds\": 0\n"
            + "  },\n"
            + "  \"unmapped\": [\n"
            + "    {\n"
            + "      \"raw\": \"新增用户\",\n"
            + "      \"hint\": \"操作类型\"\n"
            + "    }\n"
            + "  ]\n"
            + "}";

    /** 用 ```json 围栏包裹一段 JSON，模拟平台 agent 的真实输出。 */
    private static String fence(String json) {
        return "```json\n" + json + "\n```";
    }

    // ===== Case A：单围栏紧凑 JSON（核心·真实失败 payload） =====

    @Test
    void parseExtract_singleFence_compactJson_parsesFields() {
        AiPlatformChatData data = new AiPlatformChatData();
        data.setResponse(fence(COMPACT_JSON));
        data.setSessionId("sess-case-a");

        AiExtractResponse resp = new AiCapabilityTranslator().parseExtract(data);

        assertNotNull(resp, "response DTO 不应为 null");
        assertNotNull(resp.getFields(), "fields 不应为 null");
        assertFalse(resp.getFields().isEmpty(), "fields 不应为空（修复前为 {} 导致静默降级）");
        assertTrue(resp.getFields().size() >= 5,
                "fields 条目数应 >=5，实际=" + resp.getFields().size());

        assertEquals("小王", resp.getFields().get("realName"), "realName 应解析为 小王");
        assertEquals("13961588612", resp.getFields().get("phone"), "phone 应解析为 13961588612");

        assertNotNull(resp.getConfidence(), "confidence 不应为 null");
        assertEquals(0.95, resp.getConfidence().get("realName"), 0.0001,
                "realName 置信度应为 0.95");

        assertNotNull(resp.getUnmapped(), "unmapped 不应为 null");
        assertEquals(1, resp.getUnmapped().size(), "unmapped 应有 1 条");
        assertEquals("新增用户", resp.getUnmapped().get(0).get("raw"),
                "unmapped[0].raw 应为 新增用户");

        assertEquals("sess-case-a", resp.getSessionId(), "sessionId 应原样透传");
    }

    // ===== Case B：双围栏 / 重复输出（紧凑版 + 格式化版 直接拼接） =====

    @Test
    void parseExtract_doubleFence_repeatedOutput_parsesFields() {
        AiPlatformChatData data = new AiPlatformChatData();
        data.setResponse(fence(COMPACT_JSON) + fence(FORMATTED_JSON));
        data.setSessionId("sess-case-b");

        AiExtractResponse resp = new AiCapabilityTranslator().parseExtract(data);

        assertNotNull(resp);
        assertNotNull(resp.getFields());
        assertFalse(resp.getFields().isEmpty(),
                "双围栏场景下 fields 仍应正确解析（非静默降级）");
        assertTrue(resp.getFields().size() >= 5,
                "双围栏场景下 fields 条目数应 >=5，实际=" + resp.getFields().size());
        assertEquals("小王", resp.getFields().get("realName"),
                "双围栏场景下 realName 应解析为 小王");
        assertEquals("13961588612", resp.getFields().get("phone"),
                "双围栏场景下 phone 应解析为 13961588612");
    }

    // ===== Case C：无围栏纯 JSON =====

    @Test
    void parseExtract_plainJson_noFence_parsesFields() {
        AiPlatformChatData data = new AiPlatformChatData();
        data.setResponse(COMPACT_JSON);
        data.setSessionId("sess-case-c");

        AiExtractResponse resp = new AiCapabilityTranslator().parseExtract(data);

        assertNotNull(resp);
        assertNotNull(resp.getFields());
        assertFalse(resp.getFields().isEmpty(), "纯 JSON 也应正确解析出非空 fields");
        assertTrue(resp.getFields().size() >= 5);
        assertEquals("小王", resp.getFields().get("realName"));
        assertEquals("13961588612", resp.getFields().get("phone"));
        assertEquals(0.95, resp.getConfidence().get("realName"), 0.0001);
        assertEquals(1, resp.getUnmapped().size());
    }

    // ===== Case D-1：null response（降级不抛异常） =====

    @Test
    void parseExtract_nullResponse_returnsEmptyFields() {
        AiPlatformChatData data = new AiPlatformChatData();
        data.setResponse(null);
        data.setSessionId("sess-case-d1");

        AiExtractResponse resp = new AiCapabilityTranslator().parseExtract(data);

        assertNotNull(resp, "null response 也应返回 DTO（不抛异常）");
        assertNotNull(resp.getFields(), "fields 不应为 null");
        assertTrue(resp.getFields().isEmpty(), "null response 时 fields 应为空（降级）");
    }

    // ===== Case D-2：blank response（降级不抛异常） =====

    @Test
    void parseExtract_blankResponse_returnsEmptyFields() {
        AiPlatformChatData data = new AiPlatformChatData();
        data.setResponse("   ");
        data.setSessionId("sess-case-d2");

        AiExtractResponse resp = new AiCapabilityTranslator().parseExtract(data);

        assertNotNull(resp, "blank response 也应返回 DTO（不抛异常）");
        assertNotNull(resp.getFields());
        assertTrue(resp.getFields().isEmpty(), "blank response 时 fields 应为空（降级）");
    }
}
