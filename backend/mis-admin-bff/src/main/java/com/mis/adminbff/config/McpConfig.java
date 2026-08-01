package com.mis.adminbff.config;

import com.mis.adminbff.resource.McpProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * MCP 配置类，启用 McpProperties 自动绑定。
 */
@Configuration
@EnableConfigurationProperties(McpProperties.class)
public class McpConfig {
}
