package com.mis.adminbff.config;

import com.mis.adminbff.security.ApiPermissionRegistryLoader;
import com.mis.adminbff.security.UserPermissionLoader;
import com.mis.common.security.permission.ApiPermissionInterceptor;
import com.mis.common.security.permission.ApiPermissionProperties;
import com.mis.common.security.permission.ApiPermissionRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
@EnableScheduling
@EnableConfigurationProperties(ApiPermissionProperties.class)
public class ApiPermissionConfiguration {

    @Bean
    public ApiPermissionRegistry apiPermissionRegistry() {
        return new ApiPermissionRegistry();
    }

    @Bean
    public ApiPermissionInterceptor apiPermissionInterceptor(
            ApiPermissionRegistry registry,
            ApiPermissionProperties properties,
            UserPermissionLoader userPermissionLoader) {
        return new ApiPermissionInterceptor(registry, properties, userPermissionLoader::load);
    }

    @Bean
    public WebMvcConfigurer apiPermissionWebMvcConfigurer(ApiPermissionInterceptor interceptor) {
        return new WebMvcConfigurer() {
            @Override
            public void addInterceptors(InterceptorRegistry registry) {
                registry.addInterceptor(interceptor).addPathPatterns("/api/v1/**");
            }
        };
    }

    @Component
    static class ApiPermissionRegistryLifecycle implements ApplicationRunner {

        private static final Logger log = LoggerFactory.getLogger(ApiPermissionRegistryLifecycle.class);

        private final ApiPermissionRegistryLoader registryLoader;
        private final ApiPermissionProperties properties;

        ApiPermissionRegistryLifecycle(
                ApiPermissionRegistryLoader registryLoader,
                ApiPermissionProperties properties) {
            this.registryLoader = registryLoader;
            this.properties = properties;
        }

        @Override
        public void run(ApplicationArguments args) {
            reloadQuietly("启动");
        }

        @Scheduled(fixedDelayString = "#{${mis.api-permission.refresh-interval-seconds:300} * 1000}")
        public void refresh() {
            if (properties.getRefreshIntervalSeconds() <= 0) {
                return;
            }
            reloadQuietly("定时");
        }

        private void reloadQuietly(String phase) {
            if (!properties.isEnabled()) {
                return;
            }
            try {
                registryLoader.reload();
            } catch (Exception ex) {
                log.warn("{}加载 ApiPermissionRegistry 失败: {}", phase, ex.getMessage());
            }
        }
    }
}
