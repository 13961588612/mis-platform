package com.mis.adminbff.filter;

import com.mis.adminbff.support.DownstreamAuthContext;
import com.mis.common.core.constant.SecurityConstants;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * 在请求入口捕获 Gateway 转发来的 MIS JWT（Authorization 头），写入
 * {@link DownstreamAuthContext}，供 agent-ops 下游客户端透传给 ai-platform。
 *
 * <p>ai-platform 的 {@code get_current_user} 要求 {@code Authorization: Bearer <token>}，
 * 而既有 {@code loginContextHeaders()} 只透传 X-User-Id 等上下文头、不含 JWT，
 * 导致 agent-ops 控制台（如 {@code GET /api/v1/agents}）全部下游请求 401。
 * 本过滤器把原始 JWT 暂存，由 {@code AgentOpsTransport} 在下游请求里补上
 * Authorization 头，与 {@code AiPlatformClient.buildHeaders} 对已工作的
 * AI 能力路径的处理保持一致。
 *
 * <p>仅捕获、不改写任何请求/响应；在 finally 中清除持有器，避免线程池复用串号。
 * 本类为 Servlet 过滤器（mis-admin-bff 为 Spring MVC / Servlet 栈），随
 * {@code @Component} 自动注册到所有请求。
 */
@Component
public class MisJwtCaptureFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        try {
            DownstreamAuthContext.setToken(request.getHeader(SecurityConstants.AUTHORIZATION_HEADER));
            filterChain.doFilter(request, response);
        } finally {
            DownstreamAuthContext.clear();
        }
    }
}
