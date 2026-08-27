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
                new ApiPermissionRule("GET", "/api/v1/users", "system:user:list", false, 1),
                new ApiPermissionRule("GET", "/api/v1/auth/me", null, true, 1),
                new ApiPermissionRule("GET", "/api/v1/users/{id}", "system:user:query", false, 1)
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

    @Test
    void chunkImagePathMatchesAndUnionsPermissions() {
        ApiPermissionRegistry registry = new ApiPermissionRegistry();
        String pattern = "/api/v1/kb/libraries/{libraryId:[0-9]+}/documents/{id:[0-9]+}/chunk-images/{imageId}";
        registry.replaceAll(List.of(
                new ApiPermissionRule("GET", pattern, "kb:document:list", false, 1),
                new ApiPermissionRule("GET", pattern, "kb:qa:ask", false, 1),
                new ApiPermissionRule("GET", pattern, "agent:chat:use", false, 1)
        ));

        String path = "/api/v1/kb/libraries/1787129768241/documents/1787141570258"
                + "/chunk-images/cf3640e89bab11f1b45c7dc3cecfbcd9-dd11859a72a962e7";
        Optional<ApiPermissionRegistry.Match> match = registry.match("GET", path);
        assertTrue(match.isPresent());
        assertEquals(3, match.get().permissions().size());
        assertTrue(match.get().permissions().contains("agent:chat:use"));
    }
}
