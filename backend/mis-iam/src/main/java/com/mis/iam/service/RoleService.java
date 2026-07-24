package com.mis.iam.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.iam.domain.entity.SysRole;
import com.mis.iam.domain.repository.SysRoleRepository;
import com.mis.iam.domain.repository.SysUserRoleRepository;
import com.mis.iam.dto.RoleCreateRequest;
import com.mis.iam.dto.RoleUpdateRequest;
import com.mis.iam.dto.RoleVO;
import com.mis.iam.support.IdGenerator;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;

@Service
public class RoleService {

    /** 内置角色 type=1（种子 TENANT_ADMIN） */
    private static final int TYPE_BUILTIN = 1;
    private static final int TYPE_CUSTOM = 2;

    private final SysRoleRepository roleRepository;
    private final SysUserRoleRepository userRoleRepository;

    public RoleService(SysRoleRepository roleRepository, SysUserRoleRepository userRoleRepository) {
        this.roleRepository = roleRepository;
        this.userRoleRepository = userRoleRepository;
    }

    @Transactional(readOnly = true)
    public Page<RoleVO> page(Long tenantId, Long appId, int page, int size) {
        int safePage = Math.max(page, 1);
        int safeSize = Math.min(Math.max(size, 1), 100);
        return roleRepository.findByTenantIdAndAppId(
                        tenantId, appId,
                        PageRequest.of(safePage - 1, safeSize, Sort.by(Sort.Direction.ASC, "code")))
                .map(this::toVo);
    }

    @Transactional(readOnly = true)
    public List<RoleVO> listEnabled(Long tenantId, Long appId) {
        return roleRepository.findByTenantIdAndAppIdAndStatus(tenantId, appId, 1).stream()
                .map(this::toVo)
                .toList();
    }

    @Transactional(readOnly = true)
    public RoleVO getById(Long id) {
        return toVo(requireRole(id));
    }

    @Transactional
    public RoleVO create(RoleCreateRequest request) {
        if (roleRepository.existsByTenantIdAndAppIdAndCode(request.tenantId(), request.appId(), request.code())) {
            throw new BusinessException(ResultCode.ROLE_CODE_EXISTS);
        }
        Instant now = Instant.now();
        SysRole role = new SysRole();
        role.setId(IdGenerator.nextId());
        role.setTenantId(request.tenantId());
        role.setAppId(request.appId());
        role.setCode(request.code());
        role.setName(request.name());
        role.setType(TYPE_CUSTOM);
        role.setDataScope(request.dataScope() != null ? request.dataScope() : 5);
        role.setStatus(1);
        role.setRemark(request.remark());
        role.setDeleted(0);
        role.setCreatedAt(now);
        role.setUpdatedAt(now);
        roleRepository.save(role);
        return toVo(role);
    }

    @Transactional
    public RoleVO update(Long id, RoleUpdateRequest request) {
        SysRole role = requireRole(id);
        role.setName(request.name());
        if (request.dataScope() != null) {
            role.setDataScope(request.dataScope());
        }
        if (request.status() != null) {
            role.setStatus(request.status());
        }
        role.setRemark(request.remark());
        role.setUpdatedAt(Instant.now());
        roleRepository.save(role);
        return toVo(role);
    }

    @Transactional
    public void delete(Long id) {
        SysRole role = requireRole(id);
        if (role.getType() != null && role.getType() == TYPE_BUILTIN) {
            throw new BusinessException(ResultCode.ROLE_BUILTIN_PROTECTED);
        }
        if (userRoleRepository.existsByRoleId(id)) {
            throw new BusinessException(ResultCode.FORBIDDEN, "角色已分配给用户，无法删除");
        }
        role.setDeleted(1);
        role.setUpdatedAt(Instant.now());
        roleRepository.save(role);
    }

    private SysRole requireRole(Long id) {
        return roleRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "角色不存在"));
    }

    public RoleVO toVo(SysRole role) {
        return new RoleVO(
                String.valueOf(role.getId()),
                String.valueOf(role.getTenantId()),
                String.valueOf(role.getAppId()),
                role.getCode(),
                role.getName(),
                role.getType(),
                role.getDataScope(),
                role.getStatus(),
                role.getRemark(),
                role.getCreatedAt());
    }
}
