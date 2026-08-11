package com.mis.adminbff.security;

import com.mis.adminbff.config.AiPlatformTrustConfig;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.io.PrintWriter;
import java.io.StringWriter;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link InternalServiceTrustInterceptor} 单测。
 *
 * <p><b>为什么这一层必须单独测</b>：{@code /internal/**} 不在
 * {@code ApiPermissionInterceptor} 的 {@code /api/v1/**} 覆盖范围内，也不在
 * {@code mis-gateway} 的路由表里，所以本拦截器是这些端点<b>唯一</b>的闸门。
 * 一旦有人照着 {@link ReverseTrustInterceptor} 的「缺 token 就放行」双模式来改，
 * 权限码查询接口就对内网彻底裸奔——那是能被横向越权利用的口子，
 * 而且不会有任何报错提示。下面每条断言都是在钉死「不许放行」。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class InternalServiceTrustInterceptorTest {

    private static final String SECRET = "shared-secret-value";

    @Mock
    private HttpServletRequest request;

    @Mock
    private HttpServletResponse response;

    private AiPlatformTrustConfig trustConfig;
    private InternalServiceTrustInterceptor interceptor;
    private StringWriter body;

    @BeforeEach
    void setUp() throws Exception {
        trustConfig = new AiPlatformTrustConfig();
        trustConfig.setServiceToken(SECRET);
        trustConfig.setTrustedNetwork("");
        interceptor = new InternalServiceTrustInterceptor(trustConfig);

        body = new StringWriter();
        lenient().when(response.getWriter()).thenReturn(new PrintWriter(body));
        lenient().when(request.getRequestURI()).thenReturn("/internal/permissions");
        lenient().when(request.getRemoteAddr()).thenReturn("10.20.1.5");
    }

    @Nested
    @DisplayName("放行")
    class Allow {

        @Test
        @DisplayName("凭证正确 → 放行")
        void validToken_passes() throws Exception {
            when(request.getHeader("X-Platform-Token")).thenReturn(SECRET);

            assertTrue(interceptor.preHandle(request, response, new Object()));
        }

        @Test
        @DisplayName("凭证正确 + 来源在信任网段 → 放行")
        void validTokenInTrustedNetwork_passes() throws Exception {
            trustConfig.setTrustedNetwork("10.20.0.0/16");
            when(request.getHeader("X-Platform-Token")).thenReturn(SECRET);

            assertTrue(interceptor.preHandle(request, response, new Object()));
        }

        @Test
        @DisplayName("reverse-trust-enabled=false 也照样校验（该开关管不到内部端点）")
        void reverseTrustDisabled_stillEnforced() throws Exception {
            trustConfig.setReverseTrustEnabled(false);
            when(request.getHeader("X-Platform-Token")).thenReturn(SECRET);

            assertTrue(interceptor.preHandle(request, response, new Object()));

            // 反过来：关掉开关也不能让缺凭证的请求溜过去
            when(request.getHeader("X-Platform-Token")).thenReturn(null);
            assertFalse(interceptor.preHandle(request, response, new Object()));
        }
    }

    @Nested
    @DisplayName("拒绝（严格模式，缺凭证不等于放行）")
    class Deny {

        @Test
        @DisplayName("缺 X-Platform-Token → 401，绝不按「普通网关调用」放行")
        void missingToken_rejected() throws Exception {
            when(request.getHeader("X-Platform-Token")).thenReturn(null);

            assertFalse(interceptor.preHandle(request, response, new Object()));
            verify(response).setStatus(401);
        }

        @Test
        @DisplayName("X-Platform-Token 为空白串 → 401")
        void blankToken_rejected() throws Exception {
            when(request.getHeader("X-Platform-Token")).thenReturn("   ");

            assertFalse(interceptor.preHandle(request, response, new Object()));
            verify(response).setStatus(401);
        }

        @Test
        @DisplayName("凭证不匹配 → 401")
        void wrongToken_rejected() throws Exception {
            when(request.getHeader("X-Platform-Token")).thenReturn("not-the-secret");

            assertFalse(interceptor.preHandle(request, response, new Object()));
            verify(response).setStatus(401);
        }

        @Test
        @DisplayName("服务端未配置 service-token → 401（没配密钥不等于免鉴权）")
        void serverSecretMissing_rejected() throws Exception {
            trustConfig.setServiceToken("");
            when(request.getHeader("X-Platform-Token")).thenReturn(SECRET);

            assertFalse(interceptor.preHandle(request, response, new Object()));
            verify(response).setStatus(401);
        }

        @Test
        @DisplayName("凭证正确但来源不在信任网段 → 401")
        void outsideTrustedNetwork_rejected() throws Exception {
            trustConfig.setTrustedNetwork("10.20.0.0/16");
            when(request.getHeader("X-Platform-Token")).thenReturn(SECRET);
            when(request.getRemoteAddr()).thenReturn("192.168.9.9");

            assertFalse(interceptor.preHandle(request, response, new Object()));
            verify(response).setStatus(401);
        }

        @Test
        @DisplayName("拒绝时写回 Result 形态 JSON（调用方据非 2xx 判定源不可用）")
        void rejectionWritesResultJson() throws Exception {
            when(request.getHeader("X-Platform-Token")).thenReturn(null);

            interceptor.preHandle(request, response, new Object());

            String json = body.toString();
            assertTrue(json.contains("\"code\""), "响应体应为 Result 形态: " + json);
            assertTrue(json.contains("缺少内部服务凭证"), "应说明拒绝原因: " + json);
            assertFalse(json.contains(SECRET), "响应体绝不能回显共享密钥: " + json);
        }
    }
}
