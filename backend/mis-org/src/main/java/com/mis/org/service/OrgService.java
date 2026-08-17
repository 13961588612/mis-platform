package com.mis.org.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.org.domain.entity.SysDept;
import com.mis.org.domain.entity.SysDeptCategory;
import com.mis.org.domain.entity.SysOrg;
import com.mis.org.domain.repository.SysDeptCategoryRepository;
import com.mis.org.domain.repository.SysDeptRepository;
import com.mis.org.domain.repository.SysOrgRepository;
import com.mis.org.dto.OrgCreateRequest;
import com.mis.org.dto.OrgUpdateRequest;
import com.mis.org.dto.OrgVO;
import com.mis.org.support.IdGenerator;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 组织 CRUD（V40 起支持上下级 parentId）。
 *
 * <p>V40 行为变更：创建/编辑校验上级（存在/同租户/非自身/非子孙环路 BFS）；
 * 删除改为硬拦截（存在子组织或部门即拒绝，不级联），不再「级联软删全部部门」。
 */
@Service
public class OrgService {

    private final SysOrgRepository orgRepository;
    private final SysDeptRepository deptRepository;
    private final SysDeptCategoryRepository categoryRepository;

    public OrgService(SysOrgRepository orgRepository,
                      SysDeptRepository deptRepository,
                      SysDeptCategoryRepository categoryRepository) {
        this.orgRepository = orgRepository;
        this.deptRepository = deptRepository;
        this.categoryRepository = categoryRepository;
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

        Long parentId = request.parentId() != null ? request.parentId() : 0L;
        validateParent(request.tenantId(), null, parentId);

        Instant now = Instant.now();
        SysOrg org = new SysOrg();
        org.setId(IdGenerator.nextId());
        org.setTenantId(request.tenantId());
        org.setCode(request.code());
        org.setName(request.name());
        org.setParentId(parentId);
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

        if (request.parentId() != null) {
            validateParent(org.getTenantId(), org.getId(), request.parentId());
            org.setParentId(request.parentId());
        }

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

        // 规则 1.4 / 1.5：组织改名/改状态 → 同步到其顶级（根）部门。
        // 仅同步 isRoot=1 的根部门，绝不递归子部门，保持「每组织仅一根」语义。
        deptRepository.findByOrgIdAndIsRoot(id, 1).ifPresent(root -> {
            boolean dirty = false;
            if (request.name() != null && !Objects.equals(root.getName(), request.name())) {
                root.setName(request.name());
                dirty = true;
            }
            if (request.status() != null && !Objects.equals(root.getStatus(), request.status())) {
                root.setStatus(request.status());
                dirty = true;
            }
            if (dirty) {
                root.setUpdatedAt(Instant.now());
                deptRepository.save(root);
            }
        });

        return toVo(org);
    }

    /**
     * 删除组织：存在子组织或部门即硬拦截（V40 行为变更，不级联）。
     * 有子组织/有部门 → 拒绝；无子组织且无部门 → 软删组织。
     */
    @Transactional
    public void delete(Long id) {
        SysOrg org = orgRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "组织不存在"));

        if (orgRepository.existsByParentId(id)) {
            throw new BusinessException(ResultCode.ORG_HAS_CHILDREN, "组织下存在子组织，无法删除");
        }
        if (deptRepository.existsByOrgId(id)) {
            throw new BusinessException(ResultCode.ORG_HAS_CHILDREN, "组织下存在部门，无法删除");
        }

        org.setDeleted(1);
        org.setUpdatedAt(Instant.now());
        orgRepository.save(org);
    }

    /**
     * V40 上级校验：parent 存在、同租户、非自身、非子孙（BFS 环路检测）。
     *
     * @param tenantId     组织租户
     * @param orgId        当前组织（新建为 null）
     * @param newParentId  目标上级（0=顶级）
     */
    private void validateParent(Long tenantId, Long orgId, Long newParentId) {
        if (newParentId == null || newParentId == 0L) {
            return;
        }
        SysOrg parent = orgRepository.findById(newParentId)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "上级组织不存在"));
        if (!tenantId.equals(parent.getTenantId())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "上级组织不属于该租户");
        }
        if (orgId != null && newParentId.equals(orgId)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "不能将组织设置为自身的上级");
        }
        if (orgId != null && collectDescendantIds(tenantId, orgId).contains(newParentId)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "不能将组织设置为子孙组织的上级（存在环路）");
        }
    }

    /**
     * V40 收集某组织全部子孙 id（不含自身）：按 parentId 内存 BFS，避免递归 SQL。
     */
    private Set<Long> collectDescendantIds(Long tenantId, Long orgId) {
        List<SysOrg> all = orgRepository.findByTenantId(tenantId);
        Map<Long, List<SysOrg>> childrenMap = all.stream()
                .collect(Collectors.groupingBy(SysOrg::getParentId));
        Set<Long> result = new HashSet<>();
        Deque<Long> queue = new ArrayDeque<>();
        for (SysOrg child : childrenMap.getOrDefault(orgId, List.of())) {
            queue.add(child.getId());
        }
        while (!queue.isEmpty()) {
            Long current = queue.poll();
            if (!result.add(current)) {
                continue;
            }
            for (SysOrg child : childrenMap.getOrDefault(current, List.of())) {
                if (!result.contains(child.getId())) {
                    queue.add(child.getId());
                }
            }
        }
        return result;
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
                Objects.toString(org.getParentId(), "0"),
                org.getSort(),
                org.getStatus(),
                org.getRemark(),
                org.getCreatedAt(),
                org.getUpdatedAt());
    }
}
