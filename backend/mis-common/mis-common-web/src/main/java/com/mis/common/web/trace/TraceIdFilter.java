package com.mis.common.web.trace;

import com.mis.common.core.constant.SecurityConstants;
import com.mis.common.core.constant.TraceConstants;
import com.mis.common.core.util.TraceIdUtils;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * 从请求头读取或生成 traceId，写入 MDC 与响应头。
 * <p>
 * 适用于 Spring MVC（Servlet）服务；Gateway（WebFlux）需单独实现。
 */
public class TraceIdFilter extends OncePerRequestFilter {

  @Override
  protected void doFilterInternal(
      HttpServletRequest request,
      HttpServletResponse response,
      FilterChain filterChain) throws ServletException, IOException {
    String traceId = request.getHeader(SecurityConstants.HEADER_TRACE_ID);
    if (traceId == null || traceId.isBlank()) {
      traceId = TraceIdUtils.generate();
    } else {
      traceId = traceId.trim();
    }

    MDC.put(TraceConstants.MDC_TRACE_ID, traceId);
    response.setHeader(SecurityConstants.HEADER_TRACE_ID, traceId);
    try {
      filterChain.doFilter(request, response);
    } finally {
      MDC.remove(TraceConstants.MDC_TRACE_ID);
    }
  }
}
