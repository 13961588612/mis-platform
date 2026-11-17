package com.mis.recon.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Web MVC 装配（T01 只做 CORS）。
 * <ul>
 *   <li>允许来源从配置读取（默认本地前端联调源）。</li>
 *   <li>生产流量走 Gateway/BFF 同源，allowed-origins 收紧或留空即关闭。</li>
 * </ul>
 * 预留：认证/审计拦截器 T02 再加（addInterceptors），T01 不实现。
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    @Value("${mis.recon.cors.allowed-origins:http://localhost:5173,http://localhost:8081}")
    private String[] allowedOrigins;

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOriginPatterns(allowedOrigins)
                .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .allowCredentials(true)
                .maxAge(3600);
    }
}
