package com.mis.org.dto;

import java.util.Map;

/**
 * MCP JSON-RPC 请求反序列化模型。
 */
public class McpJsonRpcRequest {

    private String jsonrpc;
    private Long id;
    private String method;
    private McpParams params;

    public String getJsonrpc() {
        return jsonrpc;
    }

    public void setJsonrpc(String jsonrpc) {
        this.jsonrpc = jsonrpc;
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getMethod() {
        return method;
    }

    public void setMethod(String method) {
        this.method = method;
    }

    public McpParams getParams() {
        return params;
    }

    public void setParams(McpParams params) {
        this.params = params;
    }

    public static class McpParams {

        private String name;
        private Map<String, Object> arguments;

        public String getName() {
            return name;
        }

        public void setName(String name) {
            this.name = name;
        }

        public Map<String, Object> getArguments() {
            return arguments;
        }

        public void setArguments(Map<String, Object> arguments) {
            this.arguments = arguments;
        }
    }
}
