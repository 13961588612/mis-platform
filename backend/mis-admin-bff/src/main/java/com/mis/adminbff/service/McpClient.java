package com.mis.adminbff.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mis.adminbff.resource.McpProperties;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

/**
 * MCP JSON-RPC 客户端，通过 HTTP POST 调用各微服务暴露的 MCP 工具端点。
 */
@Component
public class McpClient {

    private final WebClient webClient;
    private final McpProperties mcpProperties;
    private final AtomicLong idCounter = new AtomicLong(1);

    public McpClient(WebClient.Builder webClientBuilder, McpProperties mcpProperties) {
        this.webClient = webClientBuilder.build();
        this.mcpProperties = mcpProperties;
    }

    /**
     * 调用指定 MCP 服务器上的工具。
     *
     * @param serverKey 服务器标识（如 "org"、"iam"）
     * @param toolName  工具名称
     * @param args      工具参数
     * @param userId    用户 ID（可为 null）
     * @param tenantId  租户 ID（可为 null）
     * @return JSON-RPC 响应中的 result 节点
     */
    public JsonNode callTool(String serverKey, String toolName,
                             Map<String, Object> args, Long userId, Long tenantId) {
        String baseUrl = mcpProperties.getServers().get(serverKey);
        if (baseUrl == null) {
            throw new McpException("Unknown MCP server key: " + serverKey);
        }

        ObjectNode request = buildJsonRpcRequest(toolName, args, userId, tenantId);

        String response = webClient.post()
                .uri(baseUrl + "/internal/v1/mcp/tools/call")
                .bodyValue(request)
                .retrieve()
                .bodyToMono(String.class)
                .block();

        return parseJsonRpcResponse(response);
    }

    private ObjectNode buildJsonRpcRequest(String toolName, Map<String, Object> args,
                                           Long userId, Long tenantId) {
        ObjectMapper mapper = new ObjectMapper();
        ObjectNode root = mapper.createObjectNode();
        root.put("jsonrpc", "2.0");
        root.put("id", idCounter.getAndIncrement());
        root.put("method", "tools/call");

        ObjectNode params = mapper.createObjectNode();
        params.put("name", toolName);

        ObjectNode arguments = mapper.valueToTree(args != null ? args : Map.of());
        if (userId != null) {
            arguments.put("userId", userId);
        }
        if (tenantId != null) {
            arguments.put("tenantId", tenantId);
        }

        params.set("arguments", arguments);
        root.set("params", params);
        return root;
    }

    private JsonNode parseJsonRpcResponse(String response) {
        try {
            ObjectMapper mapper = new ObjectMapper();
            JsonNode root = mapper.readTree(response);
            JsonNode error = root.get("error");
            if (error != null && !error.isNull()) {
                throw new McpException("MCP error: " + error.toPrettyString());
            }
            return root.get("result");
        } catch (McpException e) {
            throw e;
        } catch (Exception e) {
            throw new McpException("Failed to parse MCP response: " + e.getMessage(), e);
        }
    }
}
