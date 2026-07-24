package com.mis.system.service;

import com.mis.system.domain.entity.SysApi;
import com.mis.system.domain.repository.SysApiRepository;
import com.mis.system.domain.repository.SysApiRepository.ApiPermissionRow;
import com.mis.system.dto.ApiPermissionRuleVO;
import com.mis.system.dto.ApiVO;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class ApiService {

    private final SysApiRepository apiRepository;

    public ApiService(SysApiRepository apiRepository) {
        this.apiRepository = apiRepository;
    }

    @Transactional(readOnly = true)
    public List<ApiPermissionRuleVO> registry() {
        List<ApiPermissionRuleVO> rules = new ArrayList<>();
        for (ApiPermissionRow row : apiRepository.findRegistryRows()) {
            String permission = row.getPermission();
            boolean authOnly = !StringUtils.hasText(permission);
            rules.add(new ApiPermissionRuleVO(
                    row.getHttpMethod(),
                    row.getPathPattern(),
                    authOnly ? null : permission,
                    authOnly));
        }
        return rules;
    }

    @Transactional(readOnly = true)
    public List<ApiVO> tree(Long appId) {
        List<SysApi> apis = apiRepository.findByAppIdOrderBySortAscCodeAsc(appId);
        Map<Long, List<SysApi>> byParent = new HashMap<>();
        for (SysApi api : apis) {
            Long pid = api.getParentId() == null ? 0L : api.getParentId();
            byParent.computeIfAbsent(pid, k -> new ArrayList<>()).add(api);
        }
        return buildChildren(0L, byParent);
    }

    private List<ApiVO> buildChildren(Long parentId, Map<Long, List<SysApi>> byParent) {
        List<SysApi> children = byParent.getOrDefault(parentId, List.of());
        List<ApiVO> result = new ArrayList<>(children.size());
        for (SysApi api : children) {
            result.add(toVo(api, buildChildren(api.getId(), byParent)));
        }
        return result;
    }

    private ApiVO toVo(SysApi api, List<ApiVO> children) {
        return new ApiVO(
                String.valueOf(api.getId()),
                String.valueOf(api.getTenantId()),
                String.valueOf(api.getAppId()),
                String.valueOf(api.getModuleId()),
                String.valueOf(api.getParentId()),
                api.getCode(),
                api.getType() != null ? api.getType().name() : null,
                api.getName(),
                api.getHttpMethod(),
                api.getPathPattern(),
                api.getSort(),
                api.getStatus(),
                children);
    }
}
