package com.mis.system.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.system.domain.entity.SysApi;
import com.mis.system.domain.entity.SysApi.ApiNodeType;
import com.mis.system.domain.repository.SysApiRepository;
import com.mis.system.domain.repository.SysApiRepository.ApiPermissionRow;
import com.mis.system.dto.ApiCreateRequest;
import com.mis.system.dto.ApiPermissionRuleVO;
import com.mis.system.dto.ApiUpdateRequest;
import com.mis.system.dto.ApiVO;
import com.mis.system.support.IdGenerator;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.Instant;
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
                    authOnly,
                    row.getModuleStatus()));
        }
        return rules;
    }

    @Transactional(readOnly = true)
    public List<ApiVO> tree(Long moduleId) {
        List<SysApi> apis = apiRepository.findByModuleIdOrderBySortAscCodeAsc(moduleId);
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
                String.valueOf(api.getModuleId()),
                String.valueOf(api.getParentId() == null ? 0L : api.getParentId()),
                api.getCode(),
                api.getType() != null ? api.getType().name() : null,
                api.getName(),
                api.getHttpMethod(),
                api.getPathPattern(),
                api.getSort(),
                api.getStatus(),
                children);
    }

    @Transactional
    public ApiVO create(ApiCreateRequest request) {
        if (apiRepository.existsByModuleIdAndCode(request.moduleId(), request.code())) {
            throw new BusinessException(ResultCode.API_CODE_EXISTS);
        }
        Instant now = Instant.now();
        SysApi api = new SysApi();
        api.setId(IdGenerator.nextId());
        api.setModuleId(request.moduleId());
        api.setParentId(request.parentId() == null ? 0L : request.parentId());
        api.setCode(request.code());
        api.setType(request.type());
        api.setName(request.name());
        api.setHttpMethod(request.httpMethod());
        api.setPathPattern(request.pathPattern());
        api.setSort(request.sort() != null ? request.sort() : 0);
        api.setStatus(request.status() != null ? request.status() : 1);
        api.setCreatedAt(now);
        api.setUpdatedAt(now);
        apiRepository.save(api);
        return toVo(api, List.of());
    }

    @Transactional
    public ApiVO update(Long id, ApiUpdateRequest request) {
        SysApi api = require(id);
        if (!api.getCode().equals(request.code())
                && apiRepository.existsByModuleIdAndCodeAndIdNot(api.getModuleId(), request.code(), id)) {
            throw new BusinessException(ResultCode.API_CODE_EXISTS);
        }
        api.setParentId(request.parentId() == null ? 0L : request.parentId());
        api.setCode(request.code());
        api.setType(request.type());
        api.setName(request.name());
        api.setHttpMethod(request.httpMethod());
        api.setPathPattern(request.pathPattern());
        if (request.sort() != null) {
            api.setSort(request.sort());
        }
        if (request.status() != null) {
            api.setStatus(request.status());
        }
        api.setUpdatedAt(Instant.now());
        apiRepository.save(api);
        return toVo(api, List.of());
    }

    @Transactional
    public void delete(Long id) {
        SysApi api = require(id);
        // 分组(catalog)非空禁止删除
        if (api.getType() == ApiNodeType.catalog && apiRepository.existsByParentId(id)) {
            throw new BusinessException(ResultCode.API_GROUP_NOT_EMPTY);
        }
        // 接口被菜单绑定禁止删除（避免悬空 sys_menu_api 行）
        if (apiRepository.existsBoundApi(id)) {
            throw new BusinessException(ResultCode.API_BOUND);
        }
        apiRepository.delete(api);
    }

    private SysApi require(Long id) {
        return apiRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "接口不存在"));
    }
}
