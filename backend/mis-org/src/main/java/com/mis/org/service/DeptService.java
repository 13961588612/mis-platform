package com.mis.org.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.org.domain.entity.SysDept;
import com.mis.org.domain.repository.SysDeptRepository;
import com.mis.org.domain.repository.SysEmployeeRepository;
import com.mis.org.domain.repository.SysPostRepository;
import com.mis.org.dto.DeptCreateRequest;
import com.mis.org.dto.DeptUpdateRequest;
import com.mis.org.dto.DeptVO;
import com.mis.org.support.IdGenerator;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class DeptService {

    private final SysDeptRepository deptRepository;
    private final SysEmployeeRepository employeeRepository;
    private final SysPostRepository postRepository;

    public DeptService(SysDeptRepository deptRepository,
                       SysEmployeeRepository employeeRepository,
                       SysPostRepository postRepository) {
        this.deptRepository = deptRepository;
        this.employeeRepository = employeeRepository;
        this.postRepository = postRepository;
    }

    @Transactional(readOnly = true)
    public List<DeptVO> tree(Long orgId) {
        List<SysDept> all = deptRepository.findByOrgIdAndStatus(orgId, 1);
        Map<Long, List<SysDept>> parentMap = all.stream()
                .collect(Collectors.groupingBy(SysDept::getParentId));
        List<SysDept> roots = parentMap.getOrDefault(0L, List.of());
        return roots.stream()
                .map(d -> toVo(d, parentMap))
                .toList();
    }

    @Transactional(readOnly = true)
    public DeptVO getById(Long id) {
        SysDept dept = deptRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "部门不存在"));
        return toVo(dept, Map.of());
    }

    @Transactional
    public DeptVO create(DeptCreateRequest request) {
        deptRepository.findByTenantIdAndOrgIdAndCode(request.tenantId(), request.orgId(), "")
                .ifPresent(d -> { /* code will be generated */ });

        SysDept dept = new SysDept();
        dept.setId(IdGenerator.nextId());
        dept.setTenantId(request.tenantId());
        dept.setOrgId(request.orgId());
        dept.setParentId(request.parentId());

        // generate hierarchical code
        String code = generateCode(request.orgId(), request.parentId());
        dept.setCode(code);

        dept.setName(request.name());
        dept.setCategoryId(request.categoryId());
        dept.setAncestors(buildAncestors(request.orgId(), request.parentId()));
        dept.setSort(request.sort() != null ? request.sort() : 0);
        dept.setStatus(1);
        dept.setIsRoot(request.parentId() == 0 ? 1 : 0);
        dept.setLeaderEmployeeId(request.leaderEmployeeId());
        dept.setDeleted(0);
        dept.setCreatedAt(Instant.now());
        dept.setUpdatedAt(Instant.now());
        deptRepository.save(dept);
        return toVo(dept, Map.of());
    }

    @Transactional
    public DeptVO update(Long id, DeptUpdateRequest request) {
        SysDept dept = deptRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "部门不存在"));
        dept.setName(request.name());
        if (request.categoryId() != null) dept.setCategoryId(request.categoryId());
        if (request.sort() != null) dept.setSort(request.sort());
        if (request.status() != null) dept.setStatus(request.status());
        if (request.leaderEmployeeId() != null) dept.setLeaderEmployeeId(request.leaderEmployeeId());

        // handle parent move: update ancestors for self and descendants
        if (request.parentId() != null && !request.parentId().equals(dept.getParentId())) {
            String newAncestors = buildAncestors(dept.getOrgId(), request.parentId());
            String oldAncestors = dept.getAncestors();
            dept.setParentId(request.parentId());
            dept.setAncestors(newAncestors);
            dept.setIsRoot(request.parentId() == 0 ? 1 : 0);
            // update subtree ancestors
            List<Long> subtreeIds = deptRepository.findSubtreeIds(dept.getOrgId(), "%," + id + ",%");
            List<SysDept> subtree = deptRepository.findAllById(subtreeIds);
            for (SysDept child : subtree) {
                child.setAncestors(child.getAncestors().replace(oldAncestors, newAncestors));
            }
            deptRepository.saveAll(subtree);
        }

        dept.setUpdatedAt(Instant.now());
        deptRepository.save(dept);
        return toVo(dept, Map.of());
    }

    @Transactional
    public void delete(Long id) {
        SysDept dept = deptRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "部门不存在"));

        if (dept.getIsRoot() == 1) {
            throw new BusinessException(ResultCode.ORG_HAS_CHILDREN, "根部门不可删除");
        }
        if (deptRepository.existsByOrgIdAndParentId(dept.getOrgId(), id)) {
            throw new BusinessException(ResultCode.ORG_HAS_CHILDREN, "存在子部门，无法删除");
        }
        if (employeeRepository.existsByDeptId(id)) {
            throw new BusinessException(ResultCode.ORG_HAS_CHILDREN, "部门下存在员工，无法删除");
        }
        if (postRepository.existsByDeptId(id)) {
            throw new BusinessException(ResultCode.ORG_HAS_CHILDREN, "部门下存在岗位，无法删除");
        }

        dept.setDeleted(1);
        dept.setUpdatedAt(Instant.now());
        deptRepository.save(dept);
    }

    private String generateCode(Long orgId, Long parentId) {
        List<SysDept> siblings = deptRepository.findByOrgIdAndParentId(orgId, parentId);
        int maxCode = siblings.stream()
                .map(SysDept::getCode)
                .filter(c -> c != null && c.length() == 4)
                .mapToInt(c -> {
                    try { return Integer.parseInt(c); } catch (NumberFormatException e) { return 0; }
                })
                .max().orElse(0);
        return String.format("%04d", maxCode + 1);
    }

    private String buildAncestors(Long orgId, Long parentId) {
        if (parentId == 0) return "0";
        SysDept parent = deptRepository.findById(parentId).orElse(null);
        if (parent == null) return "0";
        return parent.getAncestors() + "," + parentId;
    }

    private DeptVO toVo(SysDept dept, Map<Long, List<SysDept>> parentMap) {
        List<DeptVO> children = parentMap.getOrDefault(dept.getId(), List.of()).stream()
                .map(d -> toVo(d, parentMap))
                .toList();
        return new DeptVO(
                String.valueOf(dept.getId()),
                String.valueOf(dept.getTenantId()),
                String.valueOf(dept.getOrgId()),
                String.valueOf(dept.getParentId()),
                dept.getCode(),
                dept.getName(),
                String.valueOf(dept.getCategoryId()),
                dept.getAncestors(),
                dept.getSort(),
                dept.getStatus(),
                dept.getIsRoot(),
                dept.getLeaderEmployeeId() != null ? String.valueOf(dept.getLeaderEmployeeId()) : null,
                dept.getCreatedAt(),
                dept.getUpdatedAt(),
                children.isEmpty() ? null : children);
    }
}
