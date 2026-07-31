package com.mis.adminbff.config;

import com.mis.adminbff.security.ReverseTrustInterceptor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * 反向信任拦截器注册（设计 §3 决策3 / T01）。
 *
 * <p>以最高优先级注册 {@link ReverseTrustInterceptor}，确保其在既有
 * {@code ApiPermissionInterceptor}（网关 PEP）之前执行：先写入委托身份到
 * {@code SecurityContextHolder}，使 PEP 与下游写处理器能复用该身份。
 *
 * <p>仅作用于两个反向端点：{@code /api/v1/ai/skill/execute} 与 {@code /api/v1/ai/skill/apply}。
 */
@Configuration
public class ReverseTrustConfiguration {

    @Bean
    @Order(Ordered.HIGHEST_PRECEDENCE)
    public WebMvcConfigurer reverseTrustWebMvcConfigurer(ReverseTrustInterceptor interceptor) {
        return new WebMvcConfigurer() {
            @Override
            public void addInterceptors(InterceptorRegistry registry) {
                registry.addInterceptor(interceptor)
                        .addPathPatterns(
                                "/api/v1/ai/skill/execute",
                                "/api/v1/ai/skill/apply");
            }
        };
    }
}
