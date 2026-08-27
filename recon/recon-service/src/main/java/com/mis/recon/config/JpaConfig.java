package com.mis.recon.config;

import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.jpa.repository.config.EnableJpaAuditing;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

/**
 * JPA 装配：扫描 repository / entity 包，开启审计字段。
 * <ul>
 *   <li>ddl-auto=none 由 application.yml 的 spring.jpa.hibernate.ddl-auto 控制（改表只走 Flyway，ADR-015）。</li>
 *   <li>事务管理器不在此声明——单数据源场景统一在 JdbcTemplateConfig 声明，避免双 TransactionManager 歧义。</li>
 *   <li>审计字段（createdAt/updatedAt）由 @EnableJpaAuditing + AuditingEntityListener 提供。</li>
 * </ul>
 */
@Configuration
@EnableJpaRepositories(basePackages = "com.mis.recon.repository")
@EntityScan(basePackages = "com.mis.recon.domain")
@EnableJpaAuditing
public class JpaConfig {
}
