package com.mis.adminbff.dto.agentops;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;

/**
 * MCP 工具（§4.3 #37，对应前端 {@code types.ts:McpTool}）。
 *
 * <p>{@code inputSchema} 是一份 JSON Schema，形状由各 MCP Server 自定。
 * 保持 {@code Map<String, Object>} 是唯一可行的表达：JSON Schema 本身是递归的、
 * 且允许任意 vendor 扩展关键字，任何试图用 Java 类穷举它的做法都会在
 * 下一个接入的 Server 上失效，且失效方式是<b>静默丢字段</b>——
 * 前端渲染出的参数表单会少一个必填项，用户提交后才被下游拒绝。
 *
 * @param name        工具名
 * @param description 描述
 * @param inputSchema 入参 JSON Schema，前端只做只读展示
 */
public record McpToolVO(
        @JsonProperty("name") String name,
        @JsonProperty("description") String description,
        @JsonProperty("input_schema") Map<String, Object> inputSchema) {
}
