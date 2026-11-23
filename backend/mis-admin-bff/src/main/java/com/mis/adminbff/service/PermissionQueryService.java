package com.mis.adminbff.service;

import com.mis.adminbff.client.OrgWebClient;
import com.mis.adminbff.client.model.OrgVO;
import com.mis.adminbff.client.model.UserDataSetScopeVO;
import com.mis.adminbff.dto.StoreVO;
import com.mis.adminbff.support.RequestContext;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 当前操作员权限查询（门店等数据范围展开）。
 */
@Service
public class PermissionQueryService {

    private static final Set<String> STORE_TYPES = Set.of("BGMD", "CSMD", "WLZS");

    private final OrgWebClient orgWebClient;

    public PermissionQueryService(OrgWebClient orgWebClient) {
        this.orgWebClient = orgWebClient;
    }

    /**
     * 查询当前登录用户权限内门店。
     *
     * @param storeType 可选；BGMD/CSMD/WLZS；空则不限类型
     */
    public List<StoreVO> listMyStores(String storeType) {
        String typeFilter = normalizeStoreType(storeType);
        Long userId = RequestContext.requireLoginUser().getUserId();
        Long tenantId = RequestContext.requireTenantId();

        UserDataSetScopeVO scope = orgWebClient.getUserDataSetScope(userId);
        List<OrgVO> orgs = orgWebClient.listOrgs(tenantId);
        List<OrgVO> storeOrgs = orgs.stream()
                .filter(o -> o.isStore() != null && o.isStore() == 1)
                .filter(o -> typeFilter == null || typeFilter.equalsIgnoreCase(nullToEmpty(o.storeType())))
                .toList();

        if (scope != null && Boolean.TRUE.equals(scope.all())) {
            return toSortedStores(storeOrgs);
        }

        Set<Long> allowedIds = new HashSet<>();
        if (scope != null && scope.storeIds() != null) {
            allowedIds.addAll(scope.storeIds());
        }
        Set<Long> orgRoots = new HashSet<>();
        if (scope != null && scope.orgIds() != null) {
            orgRoots.addAll(scope.orgIds());
        }
        if (!orgRoots.isEmpty()) {
            Map<String, OrgVO> byId = orgs.stream()
                    .filter(o -> o.id() != null)
                    .collect(Collectors.toMap(OrgVO::id, o -> o, (a, b) -> a, HashMap::new));
            for (OrgVO store : storeOrgs) {
                Long sid = parseId(store.id());
                if (sid == null) continue;
                if (orgRoots.contains(sid) || isUnderOrgs(store, orgRoots, byId)) {
                    allowedIds.add(sid);
                }
            }
        }

        return toSortedStores(storeOrgs.stream()
                .filter(o -> {
                    Long id = parseId(o.id());
                    return id != null && allowedIds.contains(id);
                })
                .toList());
    }

    private static String normalizeStoreType(String storeType) {
        if (!StringUtils.hasText(storeType)) {
            return null;
        }
        String t = storeType.trim().toUpperCase();
        if (!STORE_TYPES.contains(t)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "门店类型无效，可选：BGMD/CSMD/WLZS");
        }
        return t;
    }

    private static boolean isUnderOrgs(OrgVO store, Set<Long> orgRoots, Map<String, OrgVO> byId) {
        String parentId = store.parentId();
        int guard = 0;
        while (parentId != null && !parentId.isBlank() && !"0".equals(parentId) && guard++ < 64) {
            Long pid = parseId(parentId);
            if (pid != null && orgRoots.contains(pid)) {
                return true;
            }
            OrgVO parent = byId.get(parentId);
            if (parent == null) {
                return false;
            }
            parentId = parent.parentId();
        }
        return false;
    }

    private static List<StoreVO> toSortedStores(List<OrgVO> stores) {
        return stores.stream()
                .sorted(Comparator
                        .comparing((OrgVO o) -> o.sort() == null ? Integer.MAX_VALUE : o.sort())
                        .thenComparing(o -> nullToEmpty(o.storeCode()), String::compareTo)
                        .thenComparing(o -> nullToEmpty(o.name()), String::compareTo))
                .map(o -> new StoreVO(
                        o.id(),
                        o.storeCode(),
                        o.name(),
                        o.storeType(),
                        o.sort()))
                .toList();
    }

    private static Long parseId(String id) {
        if (id == null || id.isBlank()) return null;
        try {
            return Long.valueOf(id);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static String nullToEmpty(String s) {
        return Objects.toString(s, "");
    }
}
