package com.mis.org.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.org.domain.entity.SysDept;
import com.mis.org.domain.entity.SysEmployee;
import com.mis.org.domain.entity.SysEmployeeDept;
import com.mis.org.domain.entity.SysEmployeePost;
import com.mis.org.domain.entity.SysPost;
import com.mis.org.domain.repository.SysDeptRepository;
import com.mis.org.domain.repository.SysEmployeeDeptRepository;
import com.mis.org.domain.repository.SysEmployeePostRepository;
import com.mis.org.domain.repository.SysEmployeeRepository;
import com.mis.org.domain.repository.SysPostRepository;
import com.mis.org.dto.DeptStaffingVO;
import com.mis.org.dto.EmployeeLiteVO;
import com.mis.org.dto.PostStaffingVO;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 部门岗位编制统计：岗位任职情况、空缺、部门任职人员。
 */
@Service
public class DeptStaffingService {

    private final SysDeptRepository deptRepository;
    private final SysPostRepository postRepository;
    private final SysEmployeePostRepository employeePostRepository;
    private final SysEmployeeDeptRepository employeeDeptRepository;
    private final SysEmployeeRepository employeeRepository;

    public DeptStaffingService(
            SysDeptRepository deptRepository,
            SysPostRepository postRepository,
            SysEmployeePostRepository employeePostRepository,
            SysEmployeeDeptRepository employeeDeptRepository,
            SysEmployeeRepository employeeRepository) {
        this.deptRepository = deptRepository;
        this.postRepository = postRepository;
        this.employeePostRepository = employeePostRepository;
        this.employeeDeptRepository = employeeDeptRepository;
        this.employeeRepository = employeeRepository;
    }

    @Transactional(readOnly = true)
    public DeptStaffingVO staffing(Long tenantId, Long deptId) {
        SysDept dept = deptRepository.findById(deptId)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "部门不存在"));

        List<SysPost> posts = postRepository.findByDeptIdAndStatus(deptId, 1);

        // 岗位 → 任职员工 id
        Map<Long, List<Long>> postHolderIds = new LinkedHashMap<>();
        for (SysPost p : posts) {
            List<Long> ids = employeePostRepository.findByPostIdAndStatus(p.getId(), 1).stream()
                    .map(SysEmployeePost::getEmployeeId)
                    .toList();
            postHolderIds.put(p.getId(), ids);
        }
        // 部门任职员工（含主属 + 兼任）
        List<Long> deptEmployeeIds = employeeDeptRepository.findByDeptIdAndStatus(deptId, 1).stream()
                .map(SysEmployeeDept::getEmployeeId)
                .distinct()
                .toList();

        // 批量取姓名
        Map<Long, SysEmployee> empMap = employeeRepository.findAllById(
                java.util.stream.Stream.concat(
                                postHolderIds.values().stream().flatMap(List::stream),
                                deptEmployeeIds.stream())
                        .distinct()
                        .toList())
                .stream()
                .collect(Collectors.toMap(SysEmployee::getId, e -> e));

        List<PostStaffingVO> postVos = new ArrayList<>();
        int filled = 0;
        for (SysPost p : posts) {
            List<Long> holderIds = postHolderIds.getOrDefault(p.getId(), List.of());
            List<EmployeeLiteVO> holders = holderIds.stream()
                    .map(empMap::get)
                    .filter(java.util.Objects::nonNull)
                    .map(e -> new EmployeeLiteVO(String.valueOf(e.getId()), e.getRealName(), null))
                    .toList();
            boolean vacant = holders.isEmpty();
            if (!vacant) filled++;
            postVos.add(new PostStaffingVO(
                    String.valueOf(p.getId()),
                    p.getName(),
                    postTypeName(p.getPostTypeId()),
                    holders,
                    vacant));
        }

        List<EmployeeLiteVO> employees = deptEmployeeIds.stream()
                .map(empMap::get)
                .filter(java.util.Objects::nonNull)
                .map(e -> new EmployeeLiteVO(String.valueOf(e.getId()), e.getRealName(), null))
                .toList();

        return new DeptStaffingVO(
                String.valueOf(dept.getId()),
                dept.getName(),
                posts.size(),
                filled,
                posts.size() - filled,
                postVos,
                employees);
    }

    private String postTypeName(Long postTypeId) {
        if (postTypeId == null) return "未分类";
        return switch (postTypeId.intValue()) {
            case 1 -> "管理";
            case 2 -> "技术";
            case 3 -> "财务";
            default -> "其他";
        };
    }
}
