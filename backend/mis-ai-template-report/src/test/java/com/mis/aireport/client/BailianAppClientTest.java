package com.mis.aireport.client;

import com.mis.aireport.config.BailianProperties;
import com.mis.common.core.exception.BusinessException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

class BailianAppClientTest {

    private MockRestServiceServer server;
    private BailianAppClient client;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder();
        server = MockRestServiceServer.bindTo(builder).build();
        RestClient rest = builder.baseUrl("https://dashscope.aliyuncs.com").build();
        BailianProperties props = new BailianProperties();
        props.setApiKey("sk-test");
        props.setBaseUrl("https://dashscope.aliyuncs.com");
        client = new BailianAppClient(rest, props);
    }

    @Test
    void completeParsesOutputText() {
        server.expect(requestTo("https://dashscope.aliyuncs.com/api/v1/apps/app-123/completion"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("Authorization", "Bearer sk-test"))
                .andRespond(withSuccess(
                        "{\"output\":{\"text\":\"# 日报\\n营业额上升\"},\"request_id\":\"rid-1\"}",
                        MediaType.APPLICATION_JSON));

        String text = client.complete("app-123", "请生成日报");
        assertEquals("# 日报\n营业额上升", text);
        server.verify();
    }

    @Test
    void completeHttpErrorDoesNotLeakUpstreamBody() {
        server.expect(requestTo("https://dashscope.aliyuncs.com/api/v1/apps/app-123/completion"))
                .andExpect(method(HttpMethod.POST))
                .andRespond(withServerError().body("secret-upstream-trace"));

        BusinessException ex = assertThrows(BusinessException.class, () -> client.complete("app-123", "p"));
        assertTrue(ex.getMessage().contains("阿里百炼工作流调用失败"));
        assertTrue(ex.getMessage() == null || !ex.getMessage().contains("secret-upstream"));
        server.verify();
    }

    @Test
    void missingApiKeyIsValidationError() {
        BailianProperties empty = new BailianProperties();
        empty.setApiKey("");
        RestClient rest = RestClient.builder().baseUrl("https://dashscope.aliyuncs.com").build();
        BailianAppClient noKey = new BailianAppClient(rest, empty);
        BusinessException ex = assertThrows(BusinessException.class, () -> noKey.complete("app-123", "p"));
        assertTrue(ex.getMessage().contains("MIS_BAILIAN_API_KEY"));
    }
}
