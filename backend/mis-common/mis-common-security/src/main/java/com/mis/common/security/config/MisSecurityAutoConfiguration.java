package com.mis.common.security.config;

import com.mis.common.security.audit.LoginUserAuditorAware;
import com.mis.common.security.filter.GatewayContextFilter;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.core.Ordered;
import org.springframework.data.domain.AuditorAware;

/**
 * Servlet MVC：Gateway 透传头 → LoginUser 上下文；可选 JPA 审计操作人。
 */
@AutoConfiguration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class MisSecurityAutoConfiguration {

    @Bean
    public FilterRegistrationBean<GatewayContextFilter> gatewayContextFilterRegistration() {
        FilterRegistrationBean<GatewayContextFilter> registration =
                new FilterRegistrationBean<>(new GatewayContextFilter());
        registration.setOrder(Ordered.HIGHEST_PRECEDENCE + 10);
        registration.addUrlPatterns("/*");
        return registration;
    }

    @Bean
    @ConditionalOnClass(AuditorAware.class)
    @ConditionalOnMissingBean(AuditorAware.class)
    public AuditorAware<Long> loginUserAuditorAware() {
        return new LoginUserAuditorAware();
    }
}
