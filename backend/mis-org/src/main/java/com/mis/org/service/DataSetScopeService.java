package com.mis.org.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.Result;
import com.mis.org.client.IamDataScopeClient;
import com.mis.org.client.IamDataScopeClient.DataScopePayload;
import com.mis.org.config.OrgProperties;
import com.mis.org.domain.entity.SysDept;
import com.mis.org.domain.entity.SysEmployeePost;
import com.mis.org.domain.entity.SysPost;
import com.mis.org.domain.repository.SysDeptRepository;
import com.mis.org.domain.repository.SysEmployeePostRepository;
import com.mis.org.domain.repository.SysEmployeeRepository;
import com.mis.org.domain.repository.SysPostRepository;
import com.mis.org.dto.UserDataSetScopeVO;
import com.mis.org.dto.UserDataSetScopeVO.DeptAnchor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 为数据 Worker 准备的用户数据范围视图。
 */
@Service
public class DataSetScopeService {

    private static final Logger log = LoggerFactory.getLogger(DataSetScopeService.class);

    private final IamDataScopeClient iamDataScopeClient;
    private final SysDeptRepository deptRepository;
    private final SysEmployeeRepository employeeRepository;
    private final SysEmployeePostRepository employeePostRepository;
    private final SysPostRepository postRepository;
    private final RestClient iamRestClient;

    public DataSetScopeService(
            IamDataScopeClient iamDataScopeClient,
            SysDeptRepository deptRepository,
            SysEmployeeRepository employeeRepository,
            SysEmployeePostRepository employeePostRepository,
            SysPostRepository postRepository,
            OrgProperties properties) {
        this.iamDataScopeClient = iamDataScopeClient;
        this.deptRepository = deptRepository;
        this.employeeRepository = employeeRepository;
        this.employeePostRepository = employeePostRepository;
        this.postRepository = postRepository;
        String baseUrl = properties.isIamDiscoveryEnabled()
                ? "http://" + properties.getIamServiceId()
                : properties.getIamBaseUrl();
        this.iamRestClient = RestClient.builder().baseUrl(baseUrl).build();
    }

    @Transactional(readOnly = true)
    public UserDataSetScopeVO getUserDataSetScope(Long userId) {
        DataScopePayload payload;
        try {
            payload = iamDataScopeClient.resolveDataScope(userId);
        } catch (Exception e) {
            log.warn("calling mis-iam data-scope failed: userId={}", userId, e);
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "cannot resolve user data scope");
        }
        int dataScope = payload.dataScope();
        boolean isAll = dataScope == 1;
        List<Long> orgIds = payload.customOrgIds();
        List<Long> customDeptIds = payload.customDeptIds();
        List<Long> storeIds = payload.customStoreIds();
        if (isAll) {
            return new UserDataSetScopeVO(userId, dataScope, true, List.of(), List.of(), List.of(), List.of(),
                    storeIds != null ? storeIds : List.of());
        }
        Set<Long> assignedDeptIds = resolveAssignedDeptIds(userId);
        List<Long> effectiveDeptIds = new ArrayList<>(assignedDeptIds);
        if (effectiveDeptIds.isEmpty() && customDeptIds != null && !customDeptIds.isEmpty()) {
            effectiveDeptIds.addAll(customDeptIds);
        }
        if (effectiveDeptIds.isEmpty() && (storeIds == null || storeIds.isEmpty())) {
            return new UserDataSetScopeVO(userId, dataScope, false, orgIds, List.of(), List.of(), List.of(),
                    storeIds != null ? storeIds : List.of());
        }
        Set<Long> subtreeIds = computeSubtreeIds(effectiveDeptIds);
        List<DeptAnchor> anchors = buildDeptAnchors(effectiveDeptIds, customDeptIds, subtreeIds);
        return new UserDataSetScopeVO(userId, dataScope, false, orgIds, effectiveDeptIds,
                new ArrayList<>(subtreeIds), anchors,
                storeIds != null ? storeIds : List.of());
    }

    /**
     * 解析用户实际拥有的部门 ID（含任职记录对应的部门）。
     */
    private Set<Long> resolveAssignedDeptIds(Long userId) {
        Long employeeId = resolveEmployeeIdByUserId(userId);
        if (employeeId == null) return Set.of();
        Set<Long> deptIds = new HashSet<>();

        // 员工主部门
        employeeRepository.findById(employeeId).ifPresent(emp -> {
            if (emp.getDeptId() != null) deptIds.add(emp.getDeptId());
        });

        // 任职部门的部门：取 startDate IS NULL 或 startDate <= today 的记录，关联 sys_post 获取 deptId
        LocalDate today = LocalDate.now();
        List<SysEmployeePost> activePosts = employeePostRepository
                .findActivePostsAsOfToday(employeeId, today);

        Set<Long> postIdSet = new HashSet<>();
        for (SysEmployeePost post : activePosts) {
            postIdSet.add(post.getPostId());
        }
        if (!postIdSet.isEmpty()) {
            List<SysPost> posts = postRepository.findAllById(postIdSet);
            for (SysPost post : posts) {
                if (post.getStatus() == 1 && post.getDeptId() != null) {
                    deptIds.add(post.getDeptId());
                }
            }
        }
        return deptIds;
    }

    private Long resolveEmployeeIdByUserId(Long userId) {
        try {
            Result<Long> result = iamRestClient.get()
                    .uri("/internal/v1/users/{id}/employee-id", userId)
                    .retrieve()
                    .body(new ParameterizedTypeReference<Result<Long>>() {});
            if (result != null && result.isSuccess() && result.getData() != null) {
                return result.getData();
            }
        } catch (RestClientException e) {
            log.warn("querying employeeId from mis-iam failed: userId={}", userId, e);
        }
        return null;
    }

    private Set<Long> computeSubtreeIds(List<Long> deptIds) {
        Set<Long> ids = new HashSet<>();
        for (Long deptId : deptIds) {
            SysDept dept = deptRepository.findById(deptId).orElse(null);
            if (dept == null) continue;
            ids.add(deptId);
            try { ids.addAll(deptRepository.findDescendantIdsById(deptId)); }
            catch (Exception e) { /* tolerant */ }
        }
        return ids;
    }

    private List<DeptAnchor> buildDeptAnchors(List<Long> effectiveDeptIds, List<Long> customDeptIds, Set<Long> subtreeIds) {
        List<DeptAnchor> anchors = new ArrayList<>();
        for (Long deptId : effectiveDeptIds) {
            SysDept dept = deptRepository.findById(deptId).orElse(null);
            if (dept == null) continue;
            String scope;
            if (customDeptIds != null && customDeptIds.contains(deptId)) {
                scope = "dept";
            } else if (subtreeIds.size() > effectiveDeptIds.size()) {
                scope = "dept_subtree";
            } else {
                scope = "org_scope";
            }
            anchors.add(new DeptAnchor(deptId, dept.getDeptPath(), scope));
        }
        return anchors;
    }
}
