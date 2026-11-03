package com.mis.aireport.datasource.spm.bigdata;

import com.zaxxer.hikari.HikariDataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.util.StringUtils;

/**
 * {@code spm-big-data} 独立连接（与平台 PG 主库隔离）。
 *
 * <p><b>不</b>注册 {@code DataSource} Bean，避免挤掉 Spring Boot 对
 * {@code spring.datasource}（PostgreSQL）的自动配置，导致 JPA 误连 MySQL。
 */
@Configuration
public class SpmBigDataDataSourceConfig {

    private static final Logger log = LoggerFactory.getLogger(SpmBigDataDataSourceConfig.class);

    public static final String JDBC_BEAN = "spmBigDataJdbcTemplate";

    @Bean(name = JDBC_BEAN, destroyMethod = "close")
    @ConditionalOnProperty(prefix = "mis.ai-report.datasources.spm-big-data", name = "enabled", havingValue = "true")
    public SpmBigDataJdbcTemplateHolder spmBigDataJdbcTemplate(SpmBigDataProperties props) {
        String url = props.getJdbcUrl() == null ? "" : props.getJdbcUrl().trim();
        if (!StringUtils.hasText(url)) {
            throw new IllegalStateException("spm-big-data.enabled=true 但未配置 jdbc-url");
        }
        if (!url.startsWith("jdbc:")) {
            throw new IllegalStateException(
                    "spm-big-data.jdbc-url 必须是完整 JDBC 地址，例如 "
                            + "jdbc:mysql://10.254.2.200:9030/库名?useSSL=false&characterEncoding=utf8，"
                            + "当前值=" + url);
        }

        HikariDataSource ds = new HikariDataSource();
        ds.setPoolName("spm-big-data");
        ds.setJdbcUrl(url);
        ds.setUsername(props.getUsername());
        ds.setPassword(props.getPassword());
        ds.setDriverClassName(
                StringUtils.hasText(props.getDriverClassName())
                        ? props.getDriverClassName()
                        : "com.mysql.cj.jdbc.Driver");
        ds.setMaximumPoolSize(Math.max(1, props.getMaximumPoolSize()));
        ds.setMinimumIdle(1);
        ds.setConnectionTimeout(15_000);
        log.info("spm-big-data JdbcTemplate ready jdbcUrl={}", maskUrl(url));
        return new SpmBigDataJdbcTemplateHolder(ds, new JdbcTemplate(ds));
    }

    /** 持有池以便容器销毁时 close，对外只暴露 {@link JdbcTemplate}。 */
    public static final class SpmBigDataJdbcTemplateHolder implements AutoCloseable {
        private final HikariDataSource dataSource;
        private final JdbcTemplate jdbcTemplate;

        public SpmBigDataJdbcTemplateHolder(HikariDataSource dataSource, JdbcTemplate jdbcTemplate) {
            this.dataSource = dataSource;
            this.jdbcTemplate = jdbcTemplate;
        }

        public JdbcTemplate getJdbcTemplate() {
            return jdbcTemplate;
        }

        @Override
        public void close() {
            dataSource.close();
        }
    }

    private static String maskUrl(String url) {
        int at = url.indexOf('@');
        if (at > 0 && url.contains("://")) {
            return url.substring(0, url.indexOf("://") + 3) + "***" + url.substring(at);
        }
        return url;
    }
}
