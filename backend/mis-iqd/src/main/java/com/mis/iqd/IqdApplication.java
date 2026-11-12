package com.mis.iqd;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * 问数（WrenAI 对接）领域微服务启动类。
 *
 * <p>端口 {@code 8109}；内部配置读取端点前缀 {@code /internal/v1/iqd/**}（供 Worker
 * {@code IqdConfigClient} 内网调用），管理面端点前缀 {@code /api/v1/iqd/**}（供 BFF 代理调用）。
 * 复用 mis-common 的统一响应、异常、安全上下文与 JPA 基础设施，对齐 mis-kb 分层范式。
 *
 * <p>{@code iqd_*} 表由 mis-migrator Flyway {@code V71__iqd_schema.sql} 建表，
 * JPA 侧 {@code spring.jpa.hibernate.ddl-auto=validate} 只做结构校验。
 */
@SpringBootApplication
@EnableDiscoveryClient
@EnableScheduling
public class IqdApplication {

    public static void main(String[] args) {
        SpringApplication.run(IqdApplication.class, args);
    }
}
