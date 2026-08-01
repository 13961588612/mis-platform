package com.mis.adminbff.resource;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.HashMap;
import java.util.Map;

/**
 * MCP 服务端配置，从 application.yml 的 mis.mcp.servers 读取。
 *
 * <p>示例配置：
 * <pre>
 * mis:
 *   mcp:
 *     servers:
 *       org: http://localhost:8103
 *       system: http://localhost:8105
 *       iam: http://localhost:8102
 * </pre>
 * </p>
 */
@ConfigurationProperties(prefix = "mis.mcp")
public class McpProperties {

    private Map<String, String> servers = new HashMap<>();

    public Map<String, String> getServers() {
        return servers;
    }

    public void setServers(Map<String, String> servers) {
        this.servers = servers;
    }
}
