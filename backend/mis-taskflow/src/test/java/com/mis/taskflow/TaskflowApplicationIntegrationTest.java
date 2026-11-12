package com.mis.taskflow;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.ResponseEntity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * P1 集成测试：以真实上下文启动 mis-taskflow，连接测试库，验证探针与数据源可用。
 *
 * <p>默认跳过，只在显式提供 DB 环境时运行（避免在无数据库的 CI/本地环境破坏构建）：
 * <pre>
 *   $env:MIS_DB_TEST="true"; $env:DB_HOST="10.254.16.6"; ... ; mvn -pl mis-taskflow test
 * </pre>
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@EnabledIfEnvironmentVariable(named = "MIS_DB_TEST", matches = "true")
class TaskflowApplicationIntegrationTest {

    @Autowired
    private TestRestTemplate restTemplate;

    @Autowired
    private javax.sql.DataSource dataSource;

    @Test
    @DisplayName("P1：应用上下文启动，数据源可连接测试库")
    void dataSourceConnects() throws Exception {
        assertNotNull(dataSource, "数据源应被注入");
        try (var conn = dataSource.getConnection()) {
            assertTrue(conn.isValid(5), "测试库连接应有效");
        }
    }

    @Test
    @DisplayName("P1：/internal/v1/taskflow/health 返回 code=0 且 status=UP")
    void healthEndpoint() {
        ResponseEntity<String> resp = restTemplate.getForEntity("/internal/v1/taskflow/health", String.class);
        assertEquals(200, resp.getStatusCode().value());
        String body = resp.getBody();
        assertNotNull(body);
        assertTrue(body.contains("\"code\":0"), "响应应包含 code=0：" + body);
        assertTrue(body.contains("\"status\":\"UP\""), "响应应包含 status=UP：" + body);
        assertTrue(body.contains("mis-taskflow"), "响应应包含服务名：" + body);
    }
}