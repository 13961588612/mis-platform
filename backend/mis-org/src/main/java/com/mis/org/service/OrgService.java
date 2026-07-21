package com.mis.org.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.org.domain.entity.SysDept;
import com.mis.org.domain.entity.SysDeptCategory;
import com.mis.org.domain.entity.SysOrg;
import com.mis.org.domain.repository.SysDeptCategoryRepository;
import com.mis.org.domain.repository.SysDeptRepository;
import com.mis.org.domain.repository.SysEmployeeRepository;
import com.mis.org.domain.repository.SysOrgRepository;
import com.mis.org.domain.repository.SysPostRepository;
import com.mis.org.dto.OrgCreateRequest;
import com.mis.org.dto.OrgUpdateRequest;
import com.mis.org.dto.OrgVO;
import com.mis.org.support.IdGenerator;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 组织（扁平）CRUD。创建组织时自动插入该组织下根部门（ADR-013）。
 */
@Service
public class OrgService {

    private final SysOrgRepository orgRepository;
    private final SysDeptRepository deptRepository;
    private final SysDeptCategoryRepository categoryRepository;
    private final SysEmployeeRepository employeeRepository;
    private final SysPostRepository postRepository;

    public OrgService(SysOrgRepository orgRepository,
                      SysDeptRepository deptRepository,
                      SysDeptCategoryRepository categoryRepository,
                      SysEmployeeRepository employeeRepository,
                      SysPostRepository postRepository) {
        this.orgRepository = orgRepository;
        this.deptRepository = deptRepository;
        this.categoryRepository = categoryRepository;
        this.employeeRepository = employeeRepository;
        this.postRepository = postRepository;
    }

    @Transactional(readOnly = true)
    public List<OrgVO> listByTenant(Long tenantId) {
        return orgRepository.findByTenantIdAndStatus(tenantId, 1).stream()
                .map(this::toVo)
                .toList();
    }

    @Transactional(readOnly = true)
    public OrgVO getById(Long id) {
        SysOrg org = orgRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "组织不存在"));
        return toVo(org);
    }

    @Transactional(readOnly = true)
    public Map<Long, String> namesByIds(List<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            return Map.of();
        }
        return orgRepository.findAllById(ids).stream()
                .collect(Collectors.toMap(SysOrg::getId, SysOrg::getName, (a, b) -> a));
    }

    @Transactional
    public OrgVO create(OrgCreateRequest request) {
        orgRepository.findByTenantIdAndCode(request.tenantId(), request.code())
                .ifPresent(o -> {
                    throw new BusinessException(ResultCode.ORG_CODE_EXISTS);
                });

        Long categoryId = resolveRootCategoryId(request.tenantId(), request.categoryId());

        Instant now = Instant.now();
        SysOrg org = new SysOrg();
        org.setId(IdGenerator.nextId());
        org.setTenantId(request.tenantId());
        org.setCode(request.code());
        org.setName(request.name());
        org.setSort(request.sort() != null ? request.sort() : 0);
        org.setStatus(1);
        org.setRemark(request.remark());
        org.setDeleted(0);
        org.setCreatedAt(now);
        org.setUpdatedAt(now);
        orgRepository.save(org);

        SysDept root = new SysDept();
        root.setId(IdGenerator.nextId());
        root.setTenantId(request.tenantId());
        root.setOrgId(org.getId());
        root.setParentId(0L);
        root.setCode("0001");
        root.setName(request.name());
        root.setCategoryId(categoryId);
        root.setAncestors("0");
        root.setSort(0);
        root.setStatus(1);
        root.setIsRoot(1);
        root.setDeleted(0);
        root.setCreatedAt(now);
        root.setUpdatedAt(now);
        deptRepository.save(root);

        return toVo(org);
    }

    @Transactional
    public OrgVO update(Long id, OrgUpdateRequest request) {
        SysOrg org = orgRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "组织不存在"));
        org.setName(request.name());
        if (request.sort() != null) {
            org.setSort(request.sort());
        }
        if (request.status() != null) {
            org.setStatus(request.status());
        }
        if (request.remark() != null) {
            org.setRemark(request.remark());
        }
        org.setUpdatedAt(Instant.now());
        orgRepository.save(org);
        return toVo(org);
    }

    /**
     * 删除组织：组织下任意部门有员工/岗位则拒绝；否则级联软删全部部门后软删组织
     *（根部门不可单独删除，故组织删除须级联）。
     */
    @Transactional
    public void delete(Long id) {
        SysOrg org = orgRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "组织不存在"));

        List<SysDept> depts = deptRepository.findByOrgId(id);
        for (SysDept dept : depts) {
            if (employeeRepository.existsByDeptId(dept.getId())) {
                throw new BusinessException(ResultCode.ORG_HAS_CHILDREN, "组织下存在员工，无法删除");
            }
            if (postRepository.existsByDeptId(dept.getId())) {
                throw new BusinessException(ResultCode.ORG_HAS_CHILDREN, "组织下存在岗位，无法删除");
            }
        }

        Instant now = Instant.now();
        for (SysDept dept : depts) {
            dept.setDeleted(1);
            dept.setUpdatedAt(now);
        }
        if (!depts.isEmpty()) {
            deptRepository.saveAll(depts);
        }

        org.setDeleted(1);
        org.setUpdatedAt(now);
        orgRepository.save(org);
    }

    private Long resolveRootCategoryId(Long tenantId, Long preferredCategoryId) {
        if (preferredCategoryId != null) {
            SysDeptCategory cat = categoryRepository.findById(preferredCategoryId)
                    .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "部门类别不存在"));
            if (!tenantId.equals(cat.getTenantId()) || cat.getStatus() != 1) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "部门类别无效");
            }
            return preferredCategoryId;
        }
        return categoryRepository.findByTenantIdAndCode(tenantId, "headquarters")
                .or(() -> categoryRepository.findByTenantIdAndStatus(tenantId, 1).stream().findFirst())
                .map(SysDeptCategory::getId)
                .orElseThrow(() -> new BusinessException(ResultCode.VALIDATION_ERROR, "租户未配置部门类别"));
    }

    private OrgVO toVo(SysOrg org) {
        return new OrgVO(
                String.valueOf(org.getId()),
                String.valueOf(org.getTenantId()),
                org.getCode(),
                org.getName(),
                org.getSort(),
                org.getStatus(),
                org.getRemark(),
                org.getCreatedAt(),
                org.getUpdatedAt());
    }
}
