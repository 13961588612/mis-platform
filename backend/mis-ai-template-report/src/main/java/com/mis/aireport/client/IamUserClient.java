package com.mis.aireport.client;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.mis.common.core.result.Result;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * 调用 mis-iam 取用户数据范围与角色（降级空列表，不阻断启动）。
 */
@Component
public class IamUserClient {

    private static final Logger log = LoggerFactory.getLogger(IamUserClient.class);

    private final RestClient client;

    public IamUserClient(
            RestClient.Builder builder,
            @Value("${mis.ai-report.iam.base-url:http://127.0.0.1:8102}") String iamBaseUrl) {
        this.client = builder.baseUrl(iamBaseUrl).build();
    }

    public DataScopeDto fetchDataScope(Long userId) {
        if (userId == null) {
            return new DataScopeDto(4, List.of());
        }
        try {
            Result<DataScopeDto> result = client.get()
                    .uri("/internal/v1/users/{id}/data-scope", userId)
                    .retrieve()
                    .body(new ParameterizedTypeReference<>() {});
            if (result == null || result.getData() == null) {
                return new DataScopeDto(4, List.of());
            }
            return result.getData();
        } catch (Exception ex) {
            log.warn("fetch data-scope failed userId={}: {}", userId, ex.getMessage());
            return new DataScopeDto(4, List.of());
        }
    }

    public List<Long> fetchRoleIds(Long userId) {
        if (userId == null) {
            return List.of();
        }
        try {
            Result<UserDto> result = client.get()
                    .uri("/internal/v1/users/{id}", userId)
                    .retrieve()
                    .body(new ParameterizedTypeReference<>() {});
            if (result == null || result.getData() == null || result.getData().roles() == null) {
                return List.of();
            }
            List<Long> ids = new ArrayList<>();
            for (RoleDto role : result.getData().roles()) {
                Long id = parseLong(role == null ? null : role.id());
                if (id != null) {
                    ids.add(id);
                }
            }
            return ids;
        } catch (Exception ex) {
            log.warn("fetch user roles failed userId={}: {}", userId, ex.getMessage());
            return Collections.emptyList();
        }
    }

    private static Long parseLong(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return Long.parseLong(raw.trim());
        } catch (NumberFormatException ex) {
            return null;
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record DataScopeDto(
            int dataScope,
            @JsonProperty("customStoreIds") List<Long> customStoreIds) {
        public DataScopeDto {
            if (customStoreIds == null) {
                customStoreIds = List.of();
            }
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UserDto(@JsonProperty("roles") List<RoleDto> roles) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record RoleDto(String id) {
    }
}
