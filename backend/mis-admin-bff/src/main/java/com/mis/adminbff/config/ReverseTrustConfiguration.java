package com.mis.adminbff.config;

import com.mis.adminbff.security.InternalServiceTrustInterceptor;
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
 *
 * <p>另注册 {@link InternalServiceTrustInterceptor} 守住 {@code /internal/**}
 * 服务间端点（当前是 ACL 权限码查询）。两者<b>路径互不相交</b>，且严格模式那条
 * 不做双模式放行 —— 详见 {@link InternalServiceTrustInterceptor} 类注释。
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

    /**
     * 注册 {@code /internal/**} 严格服务凭证闸门。
     *
     * <p>路径前缀刻意收在 {@code /internal}：{@code mis-gateway} 只把
     * {@code /api/v1/**} 路由给 BFF，故这些端点不经公网入口，仅内网直连可达；
     * 再叠一层 {@code X-Platform-Token} + 信任网段，构成防御纵深。
     *
     * @param interceptor 严格模式服务凭证拦截器
     * @return 注册用的 {@link WebMvcConfigurer}
     */
    @Bean
    @Order(Ordered.HIGHEST_PRECEDENCE)
    public WebMvcConfigurer internalServiceTrustWebMvcConfigurer(
            InternalServiceTrustInterceptor interceptor) {
        return new WebMvcConfigurer() {
            @Override
            public void addInterceptors(InterceptorRegistry registry) {
                registry.addInterceptor(interceptor).addPathPatterns("/internal/**");
            }
        };
    }
}
