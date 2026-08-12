package com.mis.kb.domain.service;

import com.mis.kb.api.client.KbSubjectClient;
import com.mis.kb.domain.entity.KbAcl;
import com.mis.kb.domain.entity.KbCategory;
import com.mis.kb.domain.entity.KbCategoryAdmin;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.AclAction;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.model.SubjectType;
import com.mis.kb.domain.repository.KbAclRepository;
import com.mis.kb.domain.repository.KbCategoryAdminRepository;
import com.mis.kb.domain.repository.KbCategoryRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.support.KbBusinessException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 节点管辖判定核心（知识库域一期，D3）。
 *
 * <p><b>铁律：</b>所有「能否管理某节点/库」的判定只允许走本类（{@code hasNodeManage} /
 * {@code canMove} / {@code assertCanMove} / {@code hasLibraryManage}），<b>禁止</b>在
 * Service/Controller 内联祖先链或直接查 {@code kb_category_admin} 绕过本类
 * （同 {@code DocumentChunkConfigResolver} 铁律，防口径漂移）。
 *
 * <p>判定链（对齐 PRD R-KB-P0-3 / system_design §4.3）：
 * <ol>
 *   <li><b>全局管理员短路</b>：{@code fetchUserRoleCodes} ∩ 配置的全局管理员角色码
 *       （默认 {@code TENANT_ADMIN}，{@code mis.kb.admin.global-role-codes} 可扩展）
 *       → 直接放行；</li>
 *   <li><b>祖先链</b>：自身 → parent → … → 根，任一节点存在
 *       {@code (user|role|dept, 主体id)} 授权即命中（角色/部门取数走 {@link KbSubjectClient}，
 *       IAM 不可达降级空，安全侧收紧）；</li>
 *   <li><b>子树并集</b>：{@link #resolveManageableCategoryIds} 取全部授权节点的子树并集。</li>
 * </ol>
 *
 * <p>读/管语义分离：普通用户读库仍走 {@link KbVisibilityService}（public ∪ ACL read），
 * 本类只合成<b>管理</b>语义，不污染读语义。
 */
@Component
public class NodeAdminResolver {

    private final KbCategoryAdminRepository adminRepository;
    private final KbCategoryRepository categoryRepository;
    private final KbLibraryRepository libraryRepository;
    private final KbAclRepository aclRepository;
    private final KbSubjectClient subjectClient;
    private final Set<String> globalAdminRoleCodes;

    public NodeAdminResolver(
            KbCategoryAdminRepository adminRepository,
            KbCategoryRepository categoryRepository,
            KbLibraryRepository libraryRepository,
            KbAclRepository aclRepository,
            KbSubjectClient subjectClient,
            @Value("${mis.kb.admin.global-role-codes:TENANT_ADMIN}") String globalRoleCodes) {
        this.adminRepository = adminRepository;
        this.categoryRepository = categoryRepository;
        this.libraryRepository = libraryRepository;
        this.aclRepository = aclRepository;
        this.subjectClient = subjectClient;
        this.globalAdminRoleCodes = parseCommaSeparated(globalRoleCodes);
    }

    /**
     * 是否全局管理员（角色码短路，不依赖授权表）。
     *
     * <p>平台 superadmin 按现有网关/菜单语义已可访问管理端，本方法只认角色码；
     * 如需把平台用户也短路，扩展 {@code mis.kb.admin.global-role-codes} 即可
     * （设计 §9 待明确 5，本期默认角色码短路 + 权限码门控）。
     */
    public boolean isGlobalAdmin(Long userId) {
        if (userId == null || globalAdminRoleCodes.isEmpty()) {
            return false;
        }
        List<String> roleCodes = subjectClient.fetchUserRoleCodes(userId);
        if (roleCodes == null || roleCodes.isEmpty()) {
            return false;
        }
        for (String code : roleCodes) {
            if (code != null && globalAdminRoleCodes.contains(code)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 用户能否管理某节点（管辖范围 = 以该节点为根的子树）。
     *
     * @param userId 当前用户 id；{@code null} 一律判否（安全侧收紧）
     * @param nodeId 节点 id；{@code null} 判否（根节点无授权行，移动/建根由调用方另行裁定）
     */
    public boolean hasNodeManage(Long userId, Long nodeId) {
        if (userId == null || nodeId == null) {
            return false;
        }
        if (isGlobalAdmin(userId)) {
            return true;
        }
        Set<Long> roleIds = dedupe(subjectClient.fetchUserRoleIds(userId));
        Set<Long> deptIds = dedupe(subjectClient.fetchUserDeptIds(userId));
        for (Long cur : ancestorChain(nodeId)) {
            if (adminRepository.existsByCategoryIdAndSubjectTypeAndSubjectIdIn(
                    cur, SubjectType.USER.code(), List.of(userId))) {
                return true;
            }
            if (!roleIds.isEmpty()
                    && adminRepository.existsByCategoryIdAndSubjectTypeAndSubjectIdIn(
                            cur, SubjectType.ROLE.code(), new ArrayList<>(roleIds))) {
                return true;
            }
            if (!deptIds.isEmpty()
                    && adminRepository.existsByCategoryIdAndSubjectTypeAndSubjectIdIn(
                            cur, SubjectType.DEPT.code(), new ArrayList<>(deptIds))) {
                return true;
            }
        }
        return false;
    }

    /**
     * 解析用户可管理的全部节点 id（授权节点的子树并集；全局管理员=全量）。
     */
    public Set<Long> resolveManageableCategoryIds(Long userId) {
        if (userId == null) {
            return Set.of();
        }
        if (isGlobalAdmin(userId)) {
            return categoryRepository.findAll().stream()
                    .map(KbCategory::getId)
                    .collect(java.util.stream.Collectors.toSet());
        }
        Set<Long> hits = new HashSet<>();
        collectHitCategoryIds(hits, SubjectType.USER.code(), List.of(userId));
        Set<Long> roleIds = dedupe(subjectClient.fetchUserRoleIds(userId));
        if (!roleIds.isEmpty()) {
            collectHitCategoryIds(hits, SubjectType.ROLE.code(), new ArrayList<>(roleIds));
        }
        Set<Long> deptIds = dedupe(subjectClient.fetchUserDeptIds(userId));
        if (!deptIds.isEmpty()) {
            collectHitCategoryIds(hits, SubjectType.DEPT.code(), new ArrayList<>(deptIds));
        }
        if (hits.isEmpty()) {
            return Set.of();
        }
        List<KbCategory> all = categoryRepository.findAll();
        Set<Long> result = new HashSet<>();
        for (Long hit : hits) {
            result.addAll(subtree(hit, all));
        }
        return result;
    }

    /**
     * 移动是否合法（boolean 形式，对齐类图 API）。
     *
     * <p>口径：能管节点自身 ∧ （目标为根层级时能管至少一个根节点或全局管理员；
     * 目标非根时能管目标节点） ∧ 目标不是自己后代。
     */
    public boolean canMove(Long userId, Long nodeId, Long newParentId) {
        if (userId == null || nodeId == null) {
            return false;
        }
        if (!hasNodeManage(userId, nodeId)) {
            return false;
        }
        if (newParentId == null) {
            // 移为根（Q8 收紧）：目标「根层级」须在管辖内——能管至少一个根节点或全局管理员，
            // 否则节点管理员可把所辖节点移出他人子树到根，构成越权。
            return canManageRootLevel(userId);
        }
        if (!hasNodeManage(userId, newParentId)) {
            return false;
        }
        return !subtree(nodeId, categoryRepository.findAll()).contains(newParentId);
    }

    /**
     * 移动合法性断言（业务码可区分：越权 40312 / 防环 40933 / 无管理权 40311）。
     *
     * @throws KbBusinessException 校验不通过时抛出对应业务码
     */
    public void assertCanMove(Long userId, Long nodeId, Long newParentId) {
        if (userId == null || nodeId == null) {
            throw new KbBusinessException(KbResultCode.KB_CATEGORY_MOVE_OUT_OF_SCOPE);
        }
        if (!hasNodeManage(userId, nodeId)) {
            throw new KbBusinessException(KbResultCode.KB_CATEGORY_NOT_MANAGEABLE);
        }
        if (newParentId == null) {
            // 移为根（Q8 收紧）：目标「根层级」不在管辖内 → 越权（40312）
            if (!canManageRootLevel(userId)) {
                throw new KbBusinessException(KbResultCode.KB_CATEGORY_MOVE_OUT_OF_SCOPE);
            }
            return;
        }
        if (subtree(nodeId, categoryRepository.findAll()).contains(newParentId)) {
            throw new KbBusinessException(KbResultCode.KB_CATEGORY_MOVE_CYCLE);
        }
        if (!hasNodeManage(userId, newParentId)) {
            throw new KbBusinessException(KbResultCode.KB_CATEGORY_MOVE_OUT_OF_SCOPE);
        }
    }

    /**
     * 节点管理断言；不通过抛 {@code KB_CATEGORY_NOT_MANAGEABLE(40311)}。
     */
    public void assertNodeManage(Long userId, Long nodeId) {
        if (!hasNodeManage(userId, nodeId)) {
            throw new KbBusinessException(KbResultCode.KB_CATEGORY_NOT_MANAGEABLE);
        }
    }

    /**
     * 解析用户可管理的全部知识库 id（合成口径与 {@link #hasLibraryManage} 完全一致）。
     *
     * <p>{@code { lib | lib.categoryId ∈ resolveManageableCategoryIds(userId) }} ∪
     * {@code { lib | kb_acl 存在 (user|role|dept, lib, manage) 授权 }}；
     * 全局管理员短路返回全量库（{@code userId == null} 安全侧收紧返回空集）。
     *
     * <p><b>铁律：</b>scope=manageable 的数据面收敛唯一出口，禁止在 Service/Controller
     * 内联祖先链或直查 {@code kb_category_admin} 绕过本类。
     */
    public Set<Long> resolveManageableLibraryIds(Long userId) {
        if (userId == null) {
            return Set.of();
        }
        if (isGlobalAdmin(userId)) {
            return libraryRepository.findAll().stream()
                    .map(KbLibrary::getId)
                    .collect(java.util.stream.Collectors.toSet());
        }
        Set<Long> result = new HashSet<>();
        // 分支一：管辖分类（含子树）下挂的库
        Set<Long> manageableCategories = resolveManageableCategoryIds(userId);
        for (KbLibrary lib : libraryRepository.findAll()) {
            if (lib.getCategoryId() != null && manageableCategories.contains(lib.getCategoryId())) {
                result.add(lib.getId());
            }
        }
        // 分支二：kb_acl 补充——user ∪ role ∪ dept 任一 manage 命中（与 hasLibraryManage 同口径）
        collectManageAclLibraryIds(result, SubjectType.USER.code(), List.of(userId));
        Set<Long> roleIds = dedupe(subjectClient.fetchUserRoleIds(userId));
        if (!roleIds.isEmpty()) {
            collectManageAclLibraryIds(result, SubjectType.ROLE.code(), new ArrayList<>(roleIds));
        }
        Set<Long> deptIds = dedupe(subjectClient.fetchUserDeptIds(userId));
        if (!deptIds.isEmpty()) {
            collectManageAclLibraryIds(result, SubjectType.DEPT.code(), new ArrayList<>(deptIds));
        }
        return result;
    }

    /**
     * 库级管理合成（Q9）：{@code hasNodeManage(库所属分类) ∨ kb_acl.exists(manage)}。
     *
     * <p>文档写操作双闸门（权限码 + 管辖）统一走这里，禁止内联。
     */
    public boolean hasLibraryManage(Long userId, Long libraryId) {
        if (userId == null || libraryId == null) {
            return false;
        }
        KbLibrary lib = libraryRepository.findById(libraryId).orElse(null);
        if (lib == null) {
            return false;
        }
        if (hasNodeManage(userId, lib.getCategoryId())) {
            return true;
        }
        // kb_acl 补充：user ∪ role ∪ dept 任一 manage 命中
        if (aclRepository.existsByLibraryIdAndSubjectTypeAndSubjectIdAndAction(
                libraryId, SubjectType.USER.code(), userId, AclAction.MANAGE.code())) {
            return true;
        }
        Set<Long> roleIds = dedupe(subjectClient.fetchUserRoleIds(userId));
        for (Long roleId : roleIds) {
            if (aclRepository.existsByLibraryIdAndSubjectTypeAndSubjectIdAndAction(
                    libraryId, SubjectType.ROLE.code(), roleId, AclAction.MANAGE.code())) {
                return true;
            }
        }
        Set<Long> deptIds = dedupe(subjectClient.fetchUserDeptIds(userId));
        for (Long deptId : deptIds) {
            if (aclRepository.existsByLibraryIdAndSubjectTypeAndSubjectIdAndAction(
                    libraryId, SubjectType.DEPT.code(), deptId, AclAction.MANAGE.code())) {
                return true;
            }
        }
        return false;
    }

    // ---------------------------------------------------------------- 内部

    /**
     * 是否能管理「根层级」（移为根时目标位置的管辖判定，Q8 收紧）。
     *
     * <p>收紧口径：节点管理员不得把所辖节点移出他人子树到根——移为根须能管
     * <b>至少一个根节点</b>（{@code hasNodeManage(rootId)}，沿祖先链 + 全局短路）
     * 或为全局管理员，否则视为目标位置不在管辖内（越权 40312）。
     */
    private boolean canManageRootLevel(Long userId) {
        if (isGlobalAdmin(userId)) {
            return true;
        }
        for (KbCategory c : categoryRepository.findAll()) {
            if (c.getParentId() == null && hasNodeManage(userId, c.getId())) {
                return true;
            }
        }
        return false;
    }

    private void collectHitCategoryIds(Set<Long> target, String subjectType, List<Long> subjectIds) {
        for (KbCategoryAdmin admin : adminRepository.findBySubjectTypeAndSubjectIdIn(subjectType, subjectIds)) {
            target.add(admin.getCategoryId());
        }
    }

    /**
     * 收集主体维度 kb_acl.manage 授权的库 id（{@link #resolveManageableLibraryIds} 分支二）。
     */
    private void collectManageAclLibraryIds(Set<Long> target, String subjectType, List<Long> subjectIds) {
        for (Long subjectId : subjectIds) {
            for (KbAcl acl : aclRepository.findBySubjectTypeAndSubjectIdAndAction(
                    subjectType, subjectId, AclAction.MANAGE.code())) {
                if (acl.getLibraryId() != null) {
                    target.add(acl.getLibraryId());
                }
            }
        }
    }

    /**
     * 祖先链（自身 → parent → … → 根），去环保护。
     */
    private List<Long> ancestorChain(Long nodeId) {
        Map<Long, Long> parentOf = new HashMap<>();
        for (KbCategory c : categoryRepository.findAll()) {
            if (c.getParentId() != null) {
                parentOf.put(c.getId(), c.getParentId());
            }
        }
        List<Long> chain = new ArrayList<>();
        Set<Long> seen = new HashSet<>();
        Long cur = nodeId;
        while (cur != null && seen.add(cur)) {
            chain.add(cur);
            cur = parentOf.get(cur);
        }
        return chain;
    }

    /**
     * 子树（自身 + 全部后代）。
     */
    private Set<Long> subtree(Long nodeId, List<KbCategory> all) {
        Map<Long, List<Long>> childrenOf = new HashMap<>();
        for (KbCategory c : all) {
            if (c.getParentId() != null) {
                childrenOf.computeIfAbsent(c.getParentId(), k -> new ArrayList<>()).add(c.getId());
            }
        }
        Set<Long> result = new HashSet<>();
        Deque<Long> stack = new ArrayDeque<>();
        stack.push(nodeId);
        while (!stack.isEmpty()) {
            Long cur = stack.pop();
            if (!result.add(cur)) {
                continue;
            }
            for (Long child : childrenOf.getOrDefault(cur, List.of())) {
                stack.push(child);
            }
        }
        return result;
    }

    private static Set<Long> dedupe(List<Long> ids) {
        return ids == null || ids.isEmpty() ? new LinkedHashSet<>() : new LinkedHashSet<>(ids);
    }

    private static Set<String> parseCommaSeparated(String raw) {
        Set<String> result = new LinkedHashSet<>();
        if (raw == null || raw.isBlank()) {
            return result;
        }
        for (String part : raw.split(",")) {
            if (part != null && !part.isBlank()) {
                result.add(part.trim());
            }
        }
        return result;
    }
}
