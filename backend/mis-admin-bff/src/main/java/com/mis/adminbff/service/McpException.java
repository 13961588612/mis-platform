package com.mis.adminbff.service;

/**
 * MCP 调用异常，封装 JSON-RPC 错误或网络/解析异常。
 */
public class McpException extends RuntimeException {

    public McpException(String message) {
        super(message);
    }

    public McpException(String message, Throwable cause) {
        super(message, cause);
    }
}
