package com.mis.adminbff.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.adminbff.client.IamWebClient;
import com.mis.adminbff.client.OrgWebClient;
import com.mis.adminbff.client.model.IamRoleVO;
import com.mis.adminbff.client.model.IamUserVO;
import com.mis.adminbff.client.model.UserDataSetScopeVO;
import com.mis.adminbff.support.AgentOpsErrorCodes;
import com.mis.common.core.exception.BusinessException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 问数身份上下文（IAM 角色 + 组织数据范围）——测试问数头注入与 Copilot WS 回源共用。
 *
 * <p>不把角色写进 JWT；调用方必须已通过内网闸门或持有登录上下文。
 */
@Service
public class IdentityContextService {

    public static final String HEADER_MIS_DEPTS = "X-Mis-Depts";
    public static final String HEADER_MIS_ORGS = "X-Mis-Orgs";
    public static final String HEADER_MIS_ROLES = "X-Mis-Roles";
    public static final String HEADER_MIS_DEPT_SCOPE = "X-Mis-Dept-Scope";
    public static final String HEADER_MIS_STORES = "X-Mis-Stores";
    public static final String HEADER_MIS_DATA_SCOPE = "X-Mis-Data-Scope";

    private static final long CACHE_TTL_MS = 60_000L;
    private static final Logger log = LoggerFactory.getLogger(IdentityContextService.class);

    private final IamWebClient iamWebClient;
    private final OrgWebClient orgWebClient;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final Map<Long, IamCacheEntry> iamCache = new ConcurrentHashMap<>();
    private final Map<Long, OrgCacheEntry> orgCache = new ConcurrentHashMap<>();

    public IdentityContextService(IamWebClient iamWebClient, OrgWebClient orgWebClient) {
        this.iamWebClient = iamWebClient;
        this.orgWebClient = orgWebClient;
    }

    /**
     * 按 userId 组装 {@code X-Mis-*} 快照。
     *
     * @param userId            MIS userId（必填）
     * @param tenantIdOverride  登录上下文主租户；为空则回落 IAM {@code tenantId}
     * @return 身份快照（用户不存在时 headers 为空，不是错误）
     * @throws BusinessException IAM / mis-org 不可达时 {@link AgentOpsErrorCodes#ACL_UNAVAILABLE}
     */
    public IdentityAskContext resolve(Long userId, Long tenantIdOverride) {
        if (userId == null) {
            throw new BusinessException(com.mis.common.core.exception.ResultCode.VALIDATION_ERROR, "缺少 userId");
        }
        IamUserVO iamUser = lookupIamUser(userId);
        Map<String, String> headers = new LinkedHashMap<>();
        if (iamUser != null) {
            putJson(headers, HEADER_MIS_DEPTS, buildDepts(iamUser));
            putJson(headers, HEADER_MIS_ORGS, buildOrgs(iamUser, tenantIdOverride));
            putJson(headers, HEADER_MIS_ROLES, buildRoles(iamUser));
        }
        injectDataRowScope(headers, userId);
        return new IdentityAskContext(userId, headers);
    }

    private List<Map<String, String>> buildDepts(IamUserVO iamUser) {
        List<Map<String, String>> depts = new ArrayList<>();
        if (iamUser.deptId() != null && !iamUser.deptId().isBlank()) {
            depts.add(Map.of("id", iamUser.deptId()));
        }
        return depts;
    }

    private List<Map<String, String>> buildOrgs(IamUserVO iamUser, Long tenantIdOverride) {
        List<Map<String, String>> orgs = new ArrayList<>();
        String tenant = tenantIdOverride != null
                ? String.valueOf(tenantIdOverride)
                : (iamUser.tenantId() != null && !iamUser.tenantId().isBlank() ? iamUser.tenantId() : null);
        if (tenant != null) {
            orgs.add(Map.of("id", tenant));
        }
        return orgs;
    }

    private List<Map<String, String>> buildRoles(IamUserVO iamUser) {
        List<Map<String, String>> roles = new ArrayList<>();
        if (iamUser.roles() == null) {
            return roles;
        }
        for (IamRoleVO role : iamUser.roles()) {
            if (role == null) {
                continue;
            }
            String code = role.code() != null ? role.code() : role.id();
            if (code == null || code.isBlank()) {
                continue;
            }
            String id = role.id() != null ? role.id() : code;
            roles.add(Map.of("id", id, "code", code));
        }
        return roles;
    }

    private void injectDataRowScope(Map<String, String> headers, Long userId) {
        UserDataSetScopeVO scope = lookupOrgDataScope(userId);
        if (scope == null) {
            return;
        }
        if (Boolean.TRUE.equals(scope.all())) {
            headers.put(HEADER_MIS_DATA_SCOPE, "all");
            return;
        }
        List<UserDataSetScopeVO.DeptAnchor> anchors = scope.deptAnchors();
        if (anchors != null && !anchors.isEmpty()) {
            List<Map<String, Object>> anchorJsonList = new ArrayList<>();
            for (UserDataSetScopeVO.DeptAnchor anchor : anchors) {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("id", String.valueOf(anchor.id()));
                if (anchor.path() != null && !anchor.path().isEmpty()) {
                    item.put("path", anchor.path());
                }
                if (anchor.scope() != null && !anchor.scope().isEmpty()) {
                    item.put("scope", anchor.scope());
                }
                anchorJsonList.add(item);
            }
            putJson(headers, HEADER_MIS_DEPT_SCOPE, anchorJsonList);
        }
        List<Long> storeIds = scope.storeIds();
        if (storeIds != null && !storeIds.isEmpty()) {
            List<String> storeCodes = new ArrayList<>(storeIds.size());
            for (Long storeId : storeIds) {
                storeCodes.add(String.valueOf(storeId));
            }
            putJson(headers, HEADER_MIS_STORES, storeCodes);
        }
    }

    private void putJson(Map<String, String> headers, String name, Object value) {
        if (value instanceof List<?> list && list.isEmpty()) {
            return;
        }
        try {
            headers.put(name, objectMapper.writeValueAsString(value));
        } catch (JsonProcessingException ex) {
            log.warn("序列化身份头失败: header={}", name);
        }
    }

    private IamUserVO lookupIamUser(Long userId) {
        IamCacheEntry cached = iamCache.get(userId);
        if (cached != null && cached.isAlive()) {
            return cached.user();
        }
        try {
            IamUserVO user = iamWebClient.getUser(userId);
            if (user != null) {
                iamCache.put(userId, new IamCacheEntry(user, System.currentTimeMillis() + CACHE_TTL_MS));
            }
            return user;
        } catch (RuntimeException ex) {
            log.warn("IAM 取用户失败: userId={}, cause={}", userId, ex.toString());
            throw new BusinessException(AgentOpsErrorCodes.ACL_UNAVAILABLE, "身份源不可用",
                    Map.of("reason", "iam_unavailable"));
        }
    }

    private UserDataSetScopeVO lookupOrgDataScope(Long userId) {
        OrgCacheEntry cached = orgCache.get(userId);
        if (cached != null && cached.isAlive()) {
            return cached.scope();
        }
        try {
            UserDataSetScopeVO scope = orgWebClient.getUserDataSetScope(userId);
            if (scope != null) {
                orgCache.put(userId, new OrgCacheEntry(scope, System.currentTimeMillis() + CACHE_TTL_MS));
            }
            return scope;
        } catch (RuntimeException ex) {
            log.warn("mis-org 数据范围不可用: userId={}, cause={}", userId, ex.toString());
            throw new BusinessException(AgentOpsErrorCodes.ACL_UNAVAILABLE, "身份源不可用",
                    Map.of("reason", "org_scope_unavailable"));
        }
    }

    private record IamCacheEntry(IamUserVO user, long expireAt) {
        private boolean isAlive() {
            return System.currentTimeMillis() < expireAt;
        }
    }

    private record OrgCacheEntry(UserDataSetScopeVO scope, long expireAt) {
        private boolean isAlive() {
            return System.currentTimeMillis() < expireAt;
        }
    }
}
