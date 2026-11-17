package com.mis.recon;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * 上下文冒烟测试：验证 Spring 上下文可加载。
 * <p>需要本地 PostgreSQL recon 库 + 关闭 Nacos（T01-spec §6.1）：本地 `mvn test` 默认跳过
 * （MIS_TEST_DB 未设置），T02 实库验证时设 MIS_TEST_DB=true + DB_HOST/DB_USER/DB_PASSWORD 后纳入回归。</p>
 */
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "MIS_TEST_DB", matches = "true")
class ReconApplicationTests {

    @Test
    void contextLoads() {
    }
}
