package com.mis.adminbff.filter;

import com.mis.adminbff.support.DownstreamAuthContext;
import com.mis.common.core.constant.SecurityConstants;
import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * {@link MisJwtCaptureFilter} 的回归测试 —— 守护 401 修复链路的上游半截：
 * 过滤器必须在请求入口把 Gateway 转发的 MIS JWT 写进 {@link DownstreamAuthContext}，
 * 否则 {@link AgentOpsTransport} 即便会补 Authorization 头也拿不到 token，下游依旧 401。
 *
 * <p>本类仅做「捕获 / 不捕获 / 结束后清除」三件事的单元断言，用 Spring 的
 * {@code MockHttpServletRequest/Response} 驱动真实过滤器，不启动容器、不联网。
 */
class MisJwtCaptureFilterTest {

    private final MisJwtCaptureFilter filter = new MisJwtCaptureFilter();

    @AfterEach
    void tearDown() {
        DownstreamAuthContext.clear();
    }

    @Test
    @DisplayName("请求携带 Authorization 头时，过滤器把它写入 DownstreamAuthContext 供下游透传")
    void capturesAuthorizationHeaderIntoContext() throws Exception {
        String jwt = "Bearer eyJhbGciOiJSUzI1NiJ9.abc.def";
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader(SecurityConstants.AUTHORIZATION_HEADER, jwt);
        MockHttpServletResponse response = new MockHttpServletResponse();

        AtomicReference<String> captured = new AtomicReference<>();
        FilterChain chain = (req, resp) -> captured.set(DownstreamAuthContext.getToken());

        filter.doFilterInternal(request, response, chain);

        assertEquals(jwt, captured.get(),
                "请求携带的 JWT 必须被捕获进上下文，否则下游拿不到 token 继续 401");
    }

    @Test
    @DisplayName("无 Authorization 头时不写入（上下文保持 null）")
    void noHeaderLeavesContextEmpty() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest();
        MockHttpServletResponse response = new MockHttpServletResponse();

        AtomicReference<String> captured = new AtomicReference<>("UNSET");
        FilterChain chain = (req, resp) -> captured.set(DownstreamAuthContext.getToken());

        filter.doFilterInternal(request, response, chain);

        assertNull(captured.get(), "无 JWT 时上下文应保持 null，不应残留上一次请求的 token");
    }

    @Test
    @DisplayName("请求结束后 finally 清除上下文，避免线程池复用串号")
    void clearsContextAfterFilter() throws Exception {
        String jwt = "Bearer some.token.value";
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader(SecurityConstants.AUTHORIZATION_HEADER, jwt);
        MockHttpServletResponse response = new MockHttpServletResponse();

        FilterChain chain = (req, resp) -> { /* 不读取上下文 */ };

        filter.doFilterInternal(request, response, chain);

        assertNull(DownstreamAuthContext.getToken(),
                "finally 必须清除 token，否则线程复用时串号，把 A 用户的 JWT 发给 B 的下游请求");
    }
}
