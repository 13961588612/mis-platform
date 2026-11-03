package com.mis.aireport.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.jdbc.DataSourceProperties;
import org.springframework.core.annotation.Order;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * 不自建主库 DataSource（交给 Boot + Nacos，与 mis-admin-bff 一致）。
 * 启动时打印命名空间并校验 JPA 主库必须是 PostgreSQL。
 */
@Component
@Order(0)
public class PrimaryDataSourceConfig implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(PrimaryDataSourceConfig.class);

    private final DataSourceProperties dataSourceProperties;
    private final Environment environment;

    public PrimaryDataSourceConfig(DataSourceProperties dataSourceProperties, Environment environment) {
        this.dataSourceProperties = dataSourceProperties;
        this.environment = environment;
    }

    @Override
    public void run(ApplicationArguments args) {
        String nacosNs = environment.getProperty("spring.cloud.nacos.config.namespace", "");
        String misRemote = environment.getProperty("MIS_REMOTE", environment.getProperty("mis.remote", ""));
        String url = dataSourceProperties.determineUrl();
        log.info(
                "DataSource check: MIS_REMOTE/env={}, nacos.namespace={}, jdbcUrl={}",
                misRemote,
                nacosNs,
                url == null ? "" : url.replaceAll("://[^@/]+@", "://***@"));

        if (!StringUtils.hasText(url) || !url.startsWith("jdbc:postgresql:")) {
            throw new IllegalStateException(
                    "主库 spring.datasource.url 必须是 PostgreSQL，当前=" + url
                            + "；请确认进程环境 NACOS_NAMESPACE / MIS_REMOTE=true，"
                            + "并 nacos-push Data ID mis-common 与 mis-ai-template-report（Group=MIS_GROUP）");
        }
        if (url.contains("localhost") || url.contains("127.0.0.1")) {
            log.error(
                    "主库仍指向本机 PostgreSQL。通常是 Nacos 未加载到远端库配置："
                            + "检查 NACOS_NAMESPACE（prod/integration）、MIS_REMOTE=true、"
                            + "以及 Nacos 中 mis-common / mis-ai-template-report 是否已 push");
        }
    }
}
