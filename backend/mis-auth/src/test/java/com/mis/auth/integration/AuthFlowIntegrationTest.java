package com.mis.auth.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 端到端集成测试：经 Gateway 登录 → 查询登录日志。
 * <p>
 * 前置：{@code .\scripts\start-integration-stack.ps1}，且 mis-auth 已运行（容器或 IDE）。
 * <pre>
 *   $env:MIS_INTEGRATION_TEST='true'
 *   .\mvn.ps1 test -pl mis-auth -Dtest=AuthFlowIntegrationTest
 * </pre>
 */
@Tag("integration")
@EnabledIfEnvironmentVariable(named = "MIS_INTEGRATION_TEST", matches = "true")
class AuthFlowIntegrationTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(15))
            .build();
    private static final String GATEWAY =
            System.getenv().getOrDefault("MIS_GATEWAY_URL", "http://localhost:8080");

    @Test
    void loginThenLoginLogContainsAdmin() throws Exception {
        String accessToken = login();
        Thread.sleep(2000L);

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(GATEWAY + "/api/v1/audit/login-logs?page=1&size=10&username=admin&status=1"))
                .header("Authorization", "Bearer " + accessToken)
                .GET()
                .timeout(Duration.ofSeconds(15))
                .build();
        HttpResponse<String> response = HTTP.send(request, HttpResponse.BodyHandlers.ofString());

        assertThat(response.statusCode()).isEqualTo(200);
        JsonNode root = MAPPER.readTree(response.body());
        assertThat(root.path("code").asInt()).isZero();
        assertThat(root.path("data").path("total").asLong()).isGreaterThanOrEqualTo(1L);
    }

    private String login() throws Exception {
        String body = """
                {"appCode":"system","username":"admin","password":"Mis@123456","captchaId":"it","captchaCode":"it"}
                """;
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(GATEWAY + "/api/v1/auth/login"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .timeout(Duration.ofSeconds(15))
                .build();
        HttpResponse<String> response = HTTP.send(request, HttpResponse.BodyHandlers.ofString());

        assertThat(response.statusCode()).isEqualTo(200);
        JsonNode root = MAPPER.readTree(response.body());
        assertThat(root.path("code").asInt())
                .as("login response: %s", response.body())
                .isZero();
        String token = root.path("data").path("accessToken").asText();
        assertThat(token).isNotBlank();
        return token;
    }
}
