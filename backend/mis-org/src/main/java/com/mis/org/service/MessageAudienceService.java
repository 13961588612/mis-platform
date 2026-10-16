package com.mis.org.service;

import com.mis.org.domain.entity.SysDept;
import com.mis.org.domain.entity.SysPostType;
import com.mis.org.domain.repository.SysDeptRepository;
import com.mis.org.domain.repository.SysEmployeePostRepository;
import com.mis.org.domain.repository.SysEmployeeRepository;
import com.mis.org.domain.repository.SysPostTypeRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 消息圈人：部门（含子部门）与岗位类型（含下级、含兼职）解析为员工 ID，取并集。
 */
@Service
public class MessageAudienceService {

    private static final int CHUNK = 500;

    private final SysDeptRepository deptRepository;
    private final SysEmployeeRepository employeeRepository;
    private final SysPostTypeRepository postTypeRepository;
    private final SysEmployeePostRepository employeePostRepository;

    public MessageAudienceService(SysDeptRepository deptRepository,
                                  SysEmployeeRepository employeeRepository,
                                  SysPostTypeRepository postTypeRepository,
                                  SysEmployeePostRepository employeePostRepository) {
        this.deptRepository = deptRepository;
        this.employeeRepository = employeeRepository;
        this.postTypeRepository = postTypeRepository;
        this.employeePostRepository = employeePostRepository;
    }

    @Transactional(readOnly = true)
    public List<Long> employeeIds(Long tenantId, List<Long> deptIds, List<Long> postTypeIds) {
        Set<Long> employees = new LinkedHashSet<>();
        Set<Long> depts = expandDepts(tenantId, deptIds);
        for (List<Long> chunk : chunks(depts)) {
            employees.addAll(employeeRepository.findActiveIdsInDepts(tenantId, chunk));
        }
        Set<Long> types = expandPostTypes(tenantId, postTypeIds);
        LocalDate today = LocalDate.now();
        for (List<Long> chunk : chunks(types)) {
            employees.addAll(employeePostRepository.findActiveEmployeeIdsByPostTypes(tenantId, chunk, today));
        }
        return List.copyOf(employees);
    }

    private Set<Long> expandDepts(Long tenantId, List<Long> deptIds) {
        Set<Long> expanded = new LinkedHashSet<>();
        if (deptIds == null) {
            return expanded;
        }
        for (Long deptId : deptIds) {
            if (deptId == null) {
                continue;
            }
            SysDept dept = deptRepository.findById(deptId).orElse(null);
            if (dept == null || !tenantId.equals(dept.getTenantId()) || dept.getStatus() == null || dept.getStatus() != 1) {
                continue;
            }
            expanded.add(deptId);
            expanded.addAll(deptRepository.findDescendantIdsById(deptId));
        }
        if (expanded.isEmpty()) {
            return expanded;
        }
        return new LinkedHashSet<>(deptRepository.findActiveIds(tenantId, expanded));
    }

    private Set<Long> expandPostTypes(Long tenantId, List<Long> postTypeIds) {
        Set<Long> selected = new HashSet<>();
        if (postTypeIds != null) {
            postTypeIds.stream().filter(id -> id != null).forEach(selected::add);
        }
        if (selected.isEmpty()) {
            return Set.of();
        }
        List<SysPostType> all = postTypeRepository.findByTenantIdAndStatus(tenantId, 1);
        Set<Long> enabled = new HashSet<>();
        Map<Long, List<SysPostType>> children = new HashMap<>();
        for (SysPostType type : all) {
            enabled.add(type.getId());
            children.computeIfAbsent(type.getParentId(), k -> new ArrayList<>()).add(type);
        }
        Set<Long> expanded = new LinkedHashSet<>();
        for (Long id : selected) {
            walk(id, enabled, children, expanded);
        }
        return expanded;
    }

    private void walk(Long id, Set<Long> enabled, Map<Long, List<SysPostType>> children, Set<Long> into) {
        if (id == null || !enabled.contains(id) || !into.add(id)) {
            return;
        }
        for (SysPostType child : children.getOrDefault(id, List.of())) {
            walk(child.getId(), enabled, children, into);
        }
    }

    private static List<List<Long>> chunks(Collection<Long> ids) {
        List<List<Long>> parts = new ArrayList<>();
        List<Long> current = new ArrayList<>();
        for (Long id : ids) {
            current.add(id);
            if (current.size() == CHUNK) {
                parts.add(current);
                current = new ArrayList<>();
            }
        }
        if (!current.isEmpty()) {
            parts.add(current);
        }
        return parts;
    }
}
