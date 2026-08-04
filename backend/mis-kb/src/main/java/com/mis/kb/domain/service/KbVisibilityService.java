package com.mis.kb.domain.service;

import com.mis.kb.api.client.KbSubjectClient;
import com.mis.kb.domain.entity.KbAcl;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.AclAction;
import com.mis.kb.domain.model.LibraryStatus;
import com.mis.kb.domain.model.Secrecy;
import com.mis.kb.domain.model.SubjectType;
import com.mis.kb.domain.repository.KbAclRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 知识库可见性计算（V-01~05）。
 *
 * <p>规则：{@code visible = {secrecy='public' ∧ status=enabled} ∪ {ACL 授予 user 或 其某 role read} − {status=disabled}}。
 * 检索/问答只命中可见库。
 *
 * <p><b>关于设计文档里的「− deleted」项（口径说明）：</b>
 * P0 的 {@code kb_library} <b>没有独立软删列</b>（见 {@code V12__kb_schema.sql}：只有
 * {@code status SMALLINT NOT NULL DEFAULT 1}，1=enabled / 0=disabled）。因此「删除」有两条路径，
 * 二者都已被 {@code findByStatus(ENABLED)} 这一道过滤覆盖，<b>无需再叠加 {@code deleted=0} 条件</b>：
 * <ul>
 *   <li><b>物理删除</b>——{@code KbLibraryService#delete} 走 {@code libraryRepository.delete(entity)}，
 *       行直接消失，自然不会被任何查询捞到；</li>
 *   <li><b>运营侧「软删/下架」</b>——约定为置 {@code status=0}，即落到 {@code DISABLED} 语义，
 *       被 {@code status=ENABLED} 过滤排除。</li>
 * </ul>
 * <p>换言之 {@code status} 一列兼表 enabled / disabled / 软删三态，设计公式中的 {@code − deleted}
 * 与 {@code − {status=disabled}} 在 P0 是同一件事。若 P1 引入独立的 {@code deleted_at} 列，
 * 必须回到这里补条件并同步 {@code docs/backend/mis-kb-system-design.md} 的可见性公式。
 */
@Service
public class KbVisibilityService {

    private final KbLibraryRepository libraryRepository;
    private final KbAclRepository aclRepository;
    private final KbSubjectClient subjectClient;

    public KbVisibilityService(
            KbLibraryRepository libraryRepository,
            KbAclRepository aclRepository,
            KbSubjectClient subjectClient) {
        this.libraryRepository = libraryRepository;
        this.aclRepository = aclRepository;
        this.subjectClient = subjectClient;
    }

    /**
     * 解析当前用户可见的知识库 id 列表。
     *
     * <p>数据源头即收敛：{@code findByStatus(ENABLED)} 一次性排除 disabled 与「软删」
     * （P0 无独立软删列，软删即 {@code status=0}；物理删除的行本就不存在）——
     * 详见类级 Javadoc 的口径说明。因此后续 ACL 授权只能在<b>已启用</b>的库里做加法，
     * 任何 ACL 都无法让停用/已删库重新可见（disabled 一票否决）。
     *
     * @param userId   当前用户 id；{@code null} 时只返回公开库
     * @param tenantId 租户 id（P0 单租户，预留参数，暂不参与过滤）
     * @return 可见知识库 id 列表（无序）
     */
    public List<Long> resolveVisibleLibraryIds(Long userId, Long tenantId) {
        List<KbLibrary> enabled = libraryRepository.findByStatus(LibraryStatus.ENABLED.code());
        if (enabled.isEmpty()) {
            return List.of();
        }
        Set<Long> visible = new HashSet<>();
        List<Long> restricted = new ArrayList<>();
        for (KbLibrary lib : enabled) {
            if (Secrecy.isPublic(lib.getSecrecy())) {
                visible.add(lib.getId());
            } else {
                restricted.add(lib.getId());
            }
        }
        if (restricted.isEmpty() || userId == null) {
            return new ArrayList<>(visible);
        }

        Set<Long> granted = resolveGrantedLibraryIds(userId, AclAction.READ.code());
        for (Long libId : restricted) {
            if (granted.contains(libId)) {
                visible.add(libId);
            }
        }
        return new ArrayList<>(visible);
    }

    /**
     * 解析用户在某动作上被授权的知识库 id 集合（并集：用户 ∪ 角色 ∪ 部门）。
     *
     * <p>I-03：新增部门主体。三类主体是<b>或</b>关系——任一条授权命中即可见，
     * 与 P0 的「用户 ∪ 角色」语义保持一致，不引入优先级或互斥规则。
     *
     * <p>部门取值用 {@link KbSubjectClient#fetchUserDeptIds}（主部门 + 多部门）而非只取主部门：
     * V11 起员工可挂多部门，只认主部门会漏掉本应可见的库。
     *
     * <p><b>不做部门树向上继承。</b>即授权给「研发部」不会让「研发部/前端组」的人自动可见。
     * 原因：mis-kb 不持有部门树，向上继承需要每次可见性计算都远程拉 mis-org 的 subtree，
     * 代价与故障面都过大。需要覆盖子部门时，由运营在授权界面显式勾选子部门
     * （前端部门选择器是树形多选，支持一次勾多个）。此口径已同步到 PRD I-03 验收说明。
     *
     * @param userId 用户 id，非空
     * @param action 动作码值（read/manage/acl）
     * @return 被授权的知识库 id 集合
     */
    private Set<Long> resolveGrantedLibraryIds(Long userId, String action) {
        Set<Long> granted = new HashSet<>();
        // 1) 用户级授权
        collectInto(granted, SubjectType.USER.code(), List.of(userId), action);
        // 2) 角色级授权
        collectInto(granted, SubjectType.ROLE.code(), subjectClient.fetchUserRoleIds(userId), action);
        // 3) 部门级授权（I-03 新增）
        collectInto(granted, SubjectType.DEPT.code(), subjectClient.fetchUserDeptIds(userId), action);
        return granted;
    }

    /** 把某类主体的授权库 id 收集进目标集合；subjectIds 为空时直接跳过，避免空查询。 */
    private void collectInto(Set<Long> target, String subjectType, List<Long> subjectIds, String action) {
        if (subjectIds == null || subjectIds.isEmpty()) {
            return;
        }
        for (Long subjectId : subjectIds) {
            if (subjectId == null) {
                continue;
            }
            List<KbAcl> acls = aclRepository.findBySubjectTypeAndSubjectIdAndAction(
                    subjectType, subjectId, action);
            for (KbAcl acl : acls) {
                target.add(acl.getLibraryId());
            }
        }
    }

    /**
     * 判断用户对某知识库是否拥有指定动作权限。
     *
     * <p>用于管理端点的细粒度校验（如「谁能改 RAG 参数」需要 {@code manage}）。
     * public 库对 {@code read} 天然放行，对 {@code manage}/{@code acl} 仍需显式授权。
     *
     * @param userId    用户 id；{@code null} 一律判否
     * @param libraryId 知识库 id
     * @param action    动作码值
     * @return 有权限返回 {@code true}
     */
    public boolean hasPermission(Long userId, Long libraryId, String action) {
        if (userId == null || libraryId == null || action == null) {
            return false;
        }
        if (AclAction.READ.code().equals(action)) {
            KbLibrary lib = libraryRepository.findById(libraryId).orElse(null);
            // LibraryStatus.code() 返回基本类型 int，实体 status 是 Integer，故显式判空后再比对
            if (lib != null
                    && Secrecy.isPublic(lib.getSecrecy())
                    && lib.getStatus() != null
                    && LibraryStatus.isEnabled(lib.getStatus())) {
                return true;
            }
        }
        return resolveGrantedLibraryIds(userId, action).contains(libraryId);
    }

    /** 在可见库范围内过滤请求库（取交集），保证检索只命中可见库。 */
    public List<Long> filterVisible(List<Long> requested, List<Long> visible) {
        if (requested == null || requested.isEmpty()) {
            return visible;
        }
        Set<Long> visibleSet = new HashSet<>(visible);
        return requested.stream().filter(visibleSet::contains).collect(Collectors.toList());
    }
}
