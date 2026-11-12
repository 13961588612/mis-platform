package com.mis.aireport;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;

/**
 * 模板报告微服务启动类。
 *
 * <p>端口 {@code 8110}；管理面/Copilot 经 BFF 代理 {@code /api/v1/ai-reports/**}；
 * Agent 可内网直连同前缀。表 {@code ai_report_*} / 日历表由 mis-migrator Flyway 建表，
 * JPA {@code ddl-auto=none}。
 */
@SpringBootApplication
@EnableDiscoveryClient
public class AiTemplateReportApplication {

    public static void main(String[] args) {
        SpringApplication.run(AiTemplateReportApplication.class, args);
    }
}
