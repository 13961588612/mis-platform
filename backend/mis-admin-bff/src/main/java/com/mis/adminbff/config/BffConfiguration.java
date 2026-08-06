package com.mis.adminbff.config;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.cloud.client.loadbalancer.LoadBalanced;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.web.reactive.function.client.WebClient;

/**
 * BFF 基础装配。
 *
 * <p><b>新增 {@link AgentOpsProperties} 的原因</b>：{@code @ConfigurationProperties} 本身
 * 只是「可绑定」的声明，不会让容器实例化它。本模块既没在 {@code AgentOpsProperties} 上加
 * {@code @Component}，也没开 {@code @ConfigurationPropertiesScan}，因此不在这里登记就没有
 * 这个 Bean —— 表现是 {@code AgentOpsClient} 启动期直接
 * {@code NoSuchBeanDefinitionException}。与既有的
 * {@link BffProperties} / {@link AiPlatformProperties} 保持同一种登记方式。
 */
@Configuration
@EnableConfigurationProperties({BffProperties.class, AiPlatformProperties.class, AgentOpsProperties.class})
@EnableScheduling
public class BffConfiguration {

    @Bean
    @Primary
    @Qualifier("plainWebClientBuilder")
    public WebClient.Builder plainWebClientBuilder() {
        return WebClient.builder();
    }

    @Bean
    @LoadBalanced
    @Qualifier("loadBalancedWebClientBuilder")
    public WebClient.Builder loadBalancedWebClientBuilder() {
        return WebClient.builder();
    }
}
