package com.mis.org.dto;

import java.util.Collections;
import java.util.List;

/**
 * MCP JSON-RPC 响应序列化模型。
 */
public class McpJsonRpcResponse {

    private String jsonrpc = "2.0";
    private Long id;
    private McpResult result;
    private McpError error;

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

    public McpResult getResult() {
        return result;
    }

    public void setResult(McpResult result) {
        this.result = result;
    }

    public McpError getError() {
        return error;
    }

    public void setError(McpError error) {
        this.error = error;
    }

    public static McpJsonRpcResponse success(Long id, String text) {
        McpJsonRpcResponse response = new McpJsonRpcResponse();
        response.setId(id);
        McpResult result = new McpResult();
        result.setContent(Collections.singletonList(McpContent.resource(text)));
        response.setResult(result);
        return response;
    }

    public static McpJsonRpcResponse error(Long id, int code, String message) {
        McpJsonRpcResponse response = new McpJsonRpcResponse();
        response.setId(id);
        response.setError(new McpError(code, message));
        return response;
    }

    public static class McpResult {

        private List<McpContent> content;

        public List<McpContent> getContent() {
            return content;
        }

        public void setContent(List<McpContent> content) {
            this.content = content;
        }
    }

    public static class McpContent {

        private String type = "resource";
        private McpResource resource;

        public String getType() {
            return type;
        }

        public void setType(String type) {
            this.type = type;
        }

        public McpResource getResource() {
            return resource;
        }

        public void setResource(McpResource resource) {
            this.resource = resource;
        }

        public static McpContent resource(String text) {
            McpContent content = new McpContent();
            content.resource = new McpResource("org://candidates", text);
            return content;
        }
    }

    public static class McpResource {

        private String uri;
        private String text;

        public McpResource() {
        }

        public McpResource(String uri, String text) {
            this.uri = uri;
            this.text = text;
        }

        public String getUri() {
            return uri;
        }

        public void setUri(String uri) {
            this.uri = uri;
        }

        public String getText() {
            return text;
        }

        public void setText(String text) {
            this.text = text;
        }
    }

    public static class McpError {

        private int code;
        private String message;

        public McpError() {
        }

        public McpError(int code, String message) {
            this.code = code;
            this.message = message;
        }

        public int getCode() {
            return code;
        }

        public void setCode(int code) {
            this.code = code;
        }

        public String getMessage() {
            return message;
        }

        public void setMessage(String message) {
            this.message = message;
        }
    }
}
