package com.mis.common.security.filter;

import com.mis.common.security.context.LoginUser;
import com.mis.common.security.context.SecurityContextHolder;
import com.mis.common.security.support.LoginUserHeaderResolver;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Servlet MVC 侧：解析 Gateway 透传的登录用户头，写入 {@link SecurityContextHolder}。
 * <p>
 * <b>信任边界</b>：仅部署在 BFF / 领域服务（内网），假定请求已经过 Gateway JWT 验签。
 * 禁止从公网直连领域服务绕过 Gateway。
 * <p>
 * 请求结束必须 {@link SecurityContextHolder#clear()}，防止线程池复用导致用户串号。
 * JPA 审计操作人见 {@link com.mis.common.security.audit.LoginUserAuditorAware}。
 *
 * @see com.mis.common.security.config.MisSecurityAutoConfiguration
 */
public class GatewayContextFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        LoginUser loginUser = LoginUserHeaderResolver.resolve(request);
        if (loginUser != null) {
            SecurityContextHolder.setLoginUser(loginUser);
        }
        try {
            filterChain.doFilter(request, response);
        } finally {
            SecurityContextHolder.clear();
        }
    }
}
