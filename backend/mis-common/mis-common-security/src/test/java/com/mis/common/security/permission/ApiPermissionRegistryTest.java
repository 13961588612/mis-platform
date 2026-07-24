package com.mis.common.security.permission;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ApiPermissionRegistryTest {

    @Test
    void matchPermissionAndAuthOnly() {
        ApiPermissionRegistry registry = new ApiPermissionRegistry();
        registry.replaceAll(List.of(
                new ApiPermissionRule("GET", "/api/v1/users", "system:user:list", false),
                new ApiPermissionRule("GET", "/api/v1/auth/me", null, true),
                new ApiPermissionRule("GET", "/api/v1/users/{id}", "system:user:query", false)
        ));

        Optional<ApiPermissionRegistry.Match> list = registry.match("GET", "/api/v1/users");
        assertTrue(list.isPresent());
        assertFalse(list.get().authOnly());
        assertTrue(list.get().permissions().contains("system:user:list"));

        Optional<ApiPermissionRegistry.Match> me = registry.match("GET", "/api/v1/auth/me");
        assertTrue(me.isPresent());
        assertTrue(me.get().authOnly());

        Optional<ApiPermissionRegistry.Match> detail = registry.match("GET", "/api/v1/users/42");
        assertTrue(detail.isPresent());
        assertEquals("system:user:query", detail.get().permissions().iterator().next());

        assertTrue(registry.match("POST", "/api/v1/users").isEmpty());
    }
}
