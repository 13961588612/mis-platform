package com.mis.adminbff.dto.agentops;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 新建技能线协议是 {@code skill_id}（前端 / ai-platform 同形），BFF 不得只认 {@code id}。
 */
class SkillUpsertRequestJsonTest {

    /** 与 Spring Boot 容器 ObjectMapper 对齐（未知字段不炸）。 */
    private static final ObjectMapper MAPPER = Jackson2ObjectMapperBuilder.json().build();

    @Test
    @DisplayName("反序列化 skill_id + handler + body，并原样序列化回 skill_id")
    void readsSkillIdWireNameAndForwardsBody() throws Exception {
        String json = """
                {"skill_id":"orders-detail.crm","name":"CRM 订单详情","handler":"","body":"# 正文","tags":[]}
                """;

        SkillUpsertRequest req = MAPPER.readValue(json, SkillUpsertRequest.class);

        assertEquals("orders-detail.crm", req.normalizedId());
        assertEquals("CRM 订单详情", req.name());
        assertEquals("", req.handler());
        assertEquals("# 正文", req.body());

        JsonNode out = MAPPER.readTree(MAPPER.writeValueAsString(req));
        assertEquals("orders-detail.crm", out.path("skill_id").asText());
        assertTrue(out.path("id").isMissingNode(), "下发给 ai-platform 必须是 skill_id 不是 id");
        assertEquals("# 正文", out.path("body").asText());
    }

    @Test
    @DisplayName("兼容旧客户端只传 id")
    void stillAcceptsLegacyIdField() throws Exception {
        SkillUpsertRequest req = MAPPER.readValue(
                "{\"id\":\"legacy.skill\",\"name\":\"n\"}", SkillUpsertRequest.class);
        assertEquals("legacy.skill", req.normalizedId());
    }

    @Test
    @DisplayName("skill_id 缺失时 normalizedId 为空（由门面转 40917）")
    void missingSkillIdStaysNull() throws Exception {
        SkillUpsertRequest req = MAPPER.readValue("{\"name\":\"n\"}", SkillUpsertRequest.class);
        assertNull(req.normalizedId());
    }
}
