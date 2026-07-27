package com.mis.common.security.permission;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.security.context.LoginUser;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Q4 回归：模块停用后其 API 一律 403，启用后恢复。
 */
class ApiPermissionModuleStatusTest {

    private static final Function<LoginUser, Set<String>> EMPTY_LOADER = u -> Set.of();

    @Test
    void registryCarriesModuleStatus() {
        ApiPermissionRegistry registry = new ApiPermissionRegistry();
        registry.replaceAll(List.of(
                new ApiPermissionRule("GET", "/api/v1/disabled", "p:a", false, 0),
                new ApiPermissionRule("GET", "/api/v1/enabled", "p:b", false, 1)
        ));

        Optional<ApiPermissionRegistry.Match> disabled = registry.match("GET", "/api/v1/disabled");
        assertTrue(disabled.isPresent());
        assertEquals(0, disabled.get().moduleStatus());

        Optional<ApiPermissionRegistry.Match> enabled = registry.match("GET", "/api/v1/enabled");
        assertTrue(enabled.isPresent());
        assertEquals(1, enabled.get().moduleStatus());
    }

    @Test
    void disabledModuleWinsWhenMultipleRulesMatchSamePath() {
        ApiPermissionRegistry registry = new ApiPermissionRegistry();
        registry.replaceAll(List.of(
                new ApiPermissionRule("GET", "/api/v1/x", "p:1", false, 1),
                new ApiPermissionRule("GET", "/api/v1/x", "p:2", false, 0)
        ));
        Optional<ApiPermissionRegistry.Match> match = registry.match("GET", "/api/v1/x");
        assertTrue(match.isPresent());
        assertEquals(0, match.get().moduleStatus());
    }

    @Test
    void interceptorRejectsWhenModuleDisabled() {
        ApiPermissionRegistry registry = new ApiPermissionRegistry();
        registry.replaceAll(List.of(
                new ApiPermissionRule("GET", "/api/v1/disabled", "p:a", false, 0)
        ));
        ApiPermissionInterceptor interceptor = new ApiPermissionInterceptor(
                registry, new ApiPermissionProperties(), EMPTY_LOADER);

        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/disabled");
        MockHttpServletResponse response = new MockHttpServletResponse();

        BusinessException ex = assertThrows(BusinessException.class,
                () -> interceptor.preHandle(request, response, new Object()));
        assertEquals(ResultCode.FORBIDDEN.getCode(), ex.getCode());
    }

    @Test
    void interceptorAllowsWhenModuleEnabledAndAuthOnly() {
        ApiPermissionRegistry registry = new ApiPermissionRegistry();
        registry.replaceAll(List.of(
                new ApiPermissionRule("GET", "/api/v1/enabled", null, true, 1)
        ));
        ApiPermissionInterceptor interceptor = new ApiPermissionInterceptor(
                registry, new ApiPermissionProperties(), EMPTY_LOADER);

        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/enabled");
        MockHttpServletResponse response = new MockHttpServletResponse();

        assertDoesNotThrow(() -> {
            boolean allowed = interceptor.preHandle(request, response, new Object());
            assertTrue(allowed);
        });
    }
}
