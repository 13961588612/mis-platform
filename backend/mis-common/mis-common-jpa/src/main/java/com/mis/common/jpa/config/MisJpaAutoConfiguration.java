package com.mis.common.jpa.config;

import com.mis.common.jpa.audit.DefaultAuditorAware;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.data.domain.AuditorAware;
import org.springframework.data.jpa.repository.config.EnableJpaAuditing;

/**
 * JPA 审计与仓库扫描（各服务需配置 {@code @EntityScan} 扫描本服务实体包）。
 */
@AutoConfiguration
@EnableJpaAuditing
public class MisJpaAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean(AuditorAware.class)
    public AuditorAware<Long> auditorAware() {
        return new DefaultAuditorAware();
    }
}
