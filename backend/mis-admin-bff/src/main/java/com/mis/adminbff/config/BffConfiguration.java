package com.mis.adminbff.config;

import io.netty.channel.ChannelOption;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.cloud.client.loadbalancer.LoadBalanced;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.netty.http.client.HttpClient;
import reactor.netty.resources.ConnectionProvider;

import java.time.Duration;

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

    /**
     * 直连下游用的 WebClient 构建器。
     *
     * <p>必须自建 {@link ConnectionProvider}：默认全局池会长时间复用 idle 连接。
     * 本机 uvicorn（ai-platform :8000）重启或主动收连接后，池里残留的半死连接在
     * Windows 上常表现为「隔一次 Connection refused」——一次借到僵尸连接失败，
     * 下一次新建成功，如此交替。短 {@code maxIdleTime} + 后台驱逐可避免复用僵尸连接。
     */
    @Bean
    @Primary
    @Qualifier("plainWebClientBuilder")
    public WebClient.Builder plainWebClientBuilder() {
        ConnectionProvider provider = ConnectionProvider.builder("bff-plain")
                .maxConnections(100)
                .maxIdleTime(Duration.ofSeconds(3))
                .maxLifeTime(Duration.ofSeconds(30))
                .evictInBackground(Duration.ofSeconds(5))
                .pendingAcquireTimeout(Duration.ofSeconds(5))
                .build();
        HttpClient httpClient = HttpClient.create(provider)
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 3_000);
        return WebClient.builder()
                .clientConnector(new ReactorClientHttpConnector(httpClient));
    }

    @Bean
    @LoadBalanced
    @Qualifier("loadBalancedWebClientBuilder")
    public WebClient.Builder loadBalancedWebClientBuilder() {
        return WebClient.builder();
    }
}
