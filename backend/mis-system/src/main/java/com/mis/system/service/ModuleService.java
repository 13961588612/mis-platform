package com.mis.system.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.system.domain.entity.SysApi;
import com.mis.system.domain.entity.SysMenuApi;
import com.mis.system.domain.entity.SysModule;
import com.mis.system.domain.repository.SysApiRepository;
import com.mis.system.domain.repository.SysMenuApiRepository;
import com.mis.system.domain.repository.SysModuleRepository;
import com.mis.system.dto.ApiVO;
import com.mis.system.dto.ModuleApiBindingVO;
import com.mis.system.dto.ModuleCreateRequest;
import com.mis.system.dto.ModuleUpdateRequest;
import com.mis.system.dto.ModuleVO;
import com.mis.system.support.IdGenerator;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@Service
public class ModuleService {

    private final SysModuleRepository moduleRepository;
    private final SysApiRepository apiRepository;
    private final SysMenuApiRepository menuApiRepository;
    private final ApiService apiService;

    public ModuleService(
            SysModuleRepository moduleRepository,
            SysApiRepository apiRepository,
            SysMenuApiRepository menuApiRepository,
            ApiService apiService) {
        this.moduleRepository = moduleRepository;
        this.apiRepository = apiRepository;
        this.menuApiRepository = menuApiRepository;
        this.apiService = apiService;
    }

    @Transactional(readOnly = true)
    public List<ModuleVO> list() {
        return moduleRepository.findByOrderBySortAscCodeAsc().stream()
                .map(this::toVo)
                .toList();
    }

    @Transactional(readOnly = true)
    public ModuleVO get(Long id) {
        return toVo(require(id));
    }

    @Transactional
    public ModuleVO create(ModuleCreateRequest request) {
        if (moduleRepository.existsByCode(request.code())) {
            throw new BusinessException(ResultCode.MODULE_CODE_EXISTS);
        }
        Instant now = Instant.now();
        SysModule module = new SysModule();
        module.setId(IdGenerator.nextId());
        module.setCode(request.code());
        module.setName(request.name());
        module.setServiceName(request.serviceName());
        module.setSort(request.sort() != null ? request.sort() : 0);
        module.setStatus(1);
        module.setCreatedAt(now);
        module.setUpdatedAt(now);
        moduleRepository.save(module);
        return toVo(module);
    }

    @Transactional
    public ModuleVO update(Long id, ModuleUpdateRequest request) {
        SysModule module = require(id);
        module.setName(request.name());
        module.setServiceName(request.serviceName());
        if (request.sort() != null) {
            module.setSort(request.sort());
        }
        if (request.status() != null) {
            module.setStatus(request.status());
        }
        module.setUpdatedAt(Instant.now());
        moduleRepository.save(module);
        return toVo(module);
    }

    @Transactional
    public void delete(Long id) {
        SysModule module = require(id);
        // 硬删前置校验：存在子接口或被菜单绑定则禁删（无 deleted 列）
        if (apiRepository.countByModuleId(id) > 0) {
            throw new BusinessException(ResultCode.MODULE_HAS_APIS);
        }
        if (apiRepository.existsBoundApiByModuleId(id)) {
            throw new BusinessException(ResultCode.MODULE_API_BOUND);
        }
        moduleRepository.delete(module);
    }

    @Transactional(readOnly = true)
    public List<ApiVO> apiTree(Long moduleId) {
        require(moduleId);
        return apiService.tree(moduleId);
    }

    @Transactional(readOnly = true)
    public List<ModuleApiBindingVO> bindings(Long moduleId) {
        require(moduleId);
        List<ModuleApiBindingVO> result = new ArrayList<>();
        for (SysMenuApiRepository.ModuleApiBindingRow row : menuApiRepository.findBindingsByModuleId(moduleId)) {
            result.add(new ModuleApiBindingVO(
                    String.valueOf(row.getMenuId()),
                    row.getMenuName(),
                    row.getPermission(),
                    String.valueOf(row.getApiId()),
                    row.getApiName(),
                    row.getHttpMethod(),
                    row.getPathPattern()));
        }
        return result;
    }

    private SysModule require(Long id) {
        return moduleRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "模块不存在"));
    }

    private ModuleVO toVo(SysModule module) {
        return new ModuleVO(
                String.valueOf(module.getId()),
                module.getCode(),
                module.getName(),
                module.getServiceName(),
                module.getSort(),
                module.getStatus(),
                module.getCreatedAt(),
                module.getUpdatedAt());
    }
}
