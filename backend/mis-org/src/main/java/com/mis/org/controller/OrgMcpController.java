package com.mis.org.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.org.dto.McpJsonRpcRequest;
import com.mis.org.dto.McpJsonRpcResponse;
import com.mis.org.dto.McpJsonRpcRequest.McpParams;
import com.mis.org.dto.OrgCandidate;
import com.mis.org.service.OrgMcpService;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * MCP JSON-RPC 端点：接收 BFF 侧的工具调用请求，路由到对应的 Service 方法。
 *
 * <p>路径: POST /internal/v1/mcp/tools/call</p>
 */
@RestController
@RequestMapping("/internal/v1/mcp")
public class OrgMcpController {

    private final OrgMcpService orgMcpService;
    private final ObjectMapper objectMapper;

    public OrgMcpController(OrgMcpService orgMcpService, ObjectMapper objectMapper) {
        this.orgMcpService = orgMcpService;
        this.objectMapper = objectMapper;
    }

    @PostMapping("/tools/call")
    public McpJsonRpcResponse handleJsonRpc(@RequestBody McpJsonRpcRequest request) {
        if (!"tools/call".equals(request.getMethod())) {
            return McpJsonRpcResponse.error(request.getId(), -32601, "Method not found: " + request.getMethod());
        }

        McpParams params = request.getParams();
        Map<String, Object> arguments = params != null ? params.getArguments() : Map.of();
        String name = (String) arguments.get("name");

        Long userId = null;
        Long tenantId = null;
        Object userIdObj = arguments.get("userId");
        Object tenantIdObj = arguments.get("tenantId");
        if (userIdObj instanceof Number) {
            userId = ((Number) userIdObj).longValue();
        }
        if (tenantIdObj instanceof Number) {
            tenantId = ((Number) tenantIdObj).longValue();
        }

        try {
            List<OrgCandidate> candidates = orgMcpService.queryOrgByName(name, userId, tenantId);
            String text = objectMapper.writeValueAsString(candidates);
            return McpJsonRpcResponse.success(request.getId(), text);
        } catch (Exception e) {
            return McpJsonRpcResponse.error(request.getId(), -32603, "Internal error: " + e.getMessage());
        }
    }
}
