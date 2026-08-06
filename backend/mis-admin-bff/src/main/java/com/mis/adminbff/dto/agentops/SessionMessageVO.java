package com.mis.adminbff.dto.agentops;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;

/**
 * 会话消息（§4.3 #29，对应前端 {@code types.ts:SessionMessage}）。
 *
 * <p>{@code meta} 保持 {@code Map<String, Object>} 而非强类型：工具调用类消息的附加信息
 * 形状由各 MCP Server 自定，BFF 无从穷举，前端也只做只读展示。
 * 硬套一个 DTO 的结果是每接入一个新 MCP Server 就要改 Java 类，
 * 且没改到的字段会被 Jackson 静默丢弃 —— 展示型数据丢字段不会报错，只会少一行。
 *
 * @param id        消息 ID
 * @param sessionId 所属会话
 * @param role      {@code user} | {@code assistant} | {@code system} | {@code tool}
 * @param content   文本内容
 * @param createdAt 创建时间
 * @param meta      工具调用等附加信息，形状不固定
 */
public record SessionMessageVO(
        @JsonProperty("id") String id,
        @JsonProperty("session_id") String sessionId,
        @JsonProperty("role") String role,
        @JsonProperty("content") String content,
        @JsonProperty("created_at") String createdAt,
        @JsonProperty("meta") Map<String, Object> meta) {
}
