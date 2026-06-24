package com.mis.common.security.audit;

import com.mis.common.security.context.SecurityContextHolder;
import org.springframework.data.domain.AuditorAware;

import java.util.Optional;

/**
 * JPA 审计字段 {@code createdBy}/{@code updatedBy} 取当前 {@link com.mis.common.security.context.LoginUser#getUserId()}。
 */
public class LoginUserAuditorAware implements AuditorAware<Long> {

    @Override
    public Optional<Long> getCurrentAuditor() {
        return SecurityContextHolder.getUserId();
    }
}
