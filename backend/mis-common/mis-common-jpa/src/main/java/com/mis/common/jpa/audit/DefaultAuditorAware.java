package com.mis.common.jpa.audit;

import org.springframework.data.domain.AuditorAware;

import java.util.Optional;

/**
 * 提供当前操作人 ID，供 {@link org.springframework.data.jpa.domain.support.AuditingEntityListener} 写入审计字段。
 * <p>
 * 领域服务启动时可注册自定义 Bean 覆盖；接入 mis-common-security 后从 SecurityContext 取 userId。
 */
public class DefaultAuditorAware implements AuditorAware<Long> {

    @Override
    public Optional<Long> getCurrentAuditor() {
        return Optional.empty();
    }
}
