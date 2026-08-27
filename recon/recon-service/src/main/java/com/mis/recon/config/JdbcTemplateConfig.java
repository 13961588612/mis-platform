package com.mis.recon.config;

import jakarta.persistence.EntityManagerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.transaction.PlatformTransactionManager;

import javax.sql.DataSource;

/**
 * JDBC 与事务装配（单数据源）。
 * <ul>
 *   <li>reconJdbcTemplate：引擎热路径 / 源库直读走它；JPA 走实体查询。</li>
 *   <li>事务管理器：JPA 与 JdbcTemplate 共用同一事务；声明后 Boot 自动配置的
 *       JpaTransactionManager 退避（@ConditionalOnMissingBean 语义）。</li>
 * </ul>
 * 单数据源下 JdbcTemplate 与 JPA 天然同事务：JpaTransactionManager 会把连接绑定到线程，
 * reconJdbcTemplate 使用同一 DataSource 时自动加入 JPA 事务。源库（MySQL）只读连接在 T02
 * 引入时须另建独立 DataSource + 独立 JdbcTemplate（@Qualifier("sourceDataSource")），
 * 且只读不参与强一致事务。
 */
@Configuration
public class JdbcTemplateConfig {

    @Bean
    public JdbcTemplate reconJdbcTemplate(DataSource dataSource) {
        JdbcTemplate template = new JdbcTemplate(dataSource);
        template.setQueryTimeout(30);   // 引擎 SQL 超时（秒），可改配置
        template.setFetchSize(1000);    // 批量拉取防 OOM
        return template;
    }

    @Bean
    @Primary
    public PlatformTransactionManager transactionManager(EntityManagerFactory emf) {
        return new JpaTransactionManager(emf);
    }
}
