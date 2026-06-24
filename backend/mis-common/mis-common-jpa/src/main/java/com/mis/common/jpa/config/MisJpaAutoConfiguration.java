package com.mis.common.jpa.config;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.data.jpa.repository.config.EnableJpaAuditing;

/**
 * JPA 审计与仓库扫描（各服务需配置 {@code @EntityScan} 扫描本服务实体包）。
 */
@AutoConfiguration
@EnableJpaAuditing
public class MisJpaAutoConfiguration {
}
