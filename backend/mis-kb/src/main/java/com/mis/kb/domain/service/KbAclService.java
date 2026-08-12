package com.mis.kb.domain.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.kb.api.dto.KbAclCreateRequest;
import com.mis.kb.api.dto.KbAclVO;
import com.mis.kb.api.dto.LegacyAclInventoryVO;
import com.mis.kb.domain.entity.KbAcl;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.AclAction;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.model.SubjectType;
import com.mis.kb.domain.repository.KbAclRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.support.IdGenerator;
import com.mis.kb.support.KbBusinessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/** 访问控制服务（P-01~07；权限模型改造：grant/revoke 补管辖校验、KBP-10 只读清单）。 */
@Service
public class KbAclService {

    private final KbAclRepository aclRepository;
    private final KbLibraryRepository libraryRepository;
    private final NodeAdminResolver nodeAdminResolver;

    public KbAclService(
            KbAclRepository aclRepository,
            KbLibraryRepository libraryRepository,
            NodeAdminResolver nodeAdminResolver) {
        this.aclRepository = aclRepository;
        this.libraryRepository = libraryRepository;
        this.nodeAdminResolver = nodeAdminResolver;
    }

    @Transactional(readOnly = true)
    public List<KbAclVO> list(Long libraryId) {
        requireLibrary(libraryId);
        return aclRepository.findByLibraryId(libraryId).stream().map(this::toVo).toList();
    }

    /**
     * 授予库权限（KBP-09）。
     *
     * <p><b>双闸门：</b>① 必须有库级管理权（{@code hasLibraryManage}，节点管辖 ∨
     * kb_acl.manage），否则 40311；② 仅允许 {@code action=read}——存量 manage/acl
     * 授权零迁移兼容生效，但<b>不再提供新增入口</b>，非 read 直接 400。
     *
     * @param userId    当前用户 id
     * @param libraryId 知识库 id
     * @param req       授权请求（subjectType/subjectId/action）
     * @return 新授权行视图
     */
    @Transactional
    public KbAclVO grant(Long userId, Long libraryId, KbAclCreateRequest req) {
        requireLibrary(libraryId);
        // KBP-09①：管辖校验（管理判定唯一入口 NodeAdminResolver，禁止内联）
        if (!nodeAdminResolver.hasLibraryManage(userId, libraryId)) {
            throw new KbBusinessException(KbResultCode.KB_CATEGORY_NOT_MANAGEABLE,
                    "该知识库不在您的管理范围内");
        }
        if (!SubjectType.isValid(req.subjectType())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "主体类型非法（应为 user/role/dept）");
        }
        if (!AclAction.isValid(req.action())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "动作非法（应为 read/manage/acl）");
        }
        // KBP-09②：仅允许 read——管理/授权语义随分类管辖自动获得，不再走 kb_acl 新增
        if (!AclAction.READ.code().equals(req.action())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR,
                    "仅支持授予只读（read）权限；管理权限随分类管辖自动获得");
        }
        if (aclRepository.existsByLibraryIdAndSubjectTypeAndSubjectIdAndAction(
                libraryId, req.subjectType(), req.subjectId(), req.action())) {
            throw new KbBusinessException(KbResultCode.KB_ACL_EXISTS);
        }
        Instant now = Instant.now();
        KbAcl entity = new KbAcl();
        entity.setId(IdGenerator.nextId());
        entity.setLibraryId(libraryId);
        entity.setSubjectType(req.subjectType());
        entity.setSubjectId(req.subjectId());
        entity.setAction(req.action());
        entity.setCreatedAt(now);
        entity.setUpdatedAt(now);
        return toVo(aclRepository.save(entity));
    }

    /**
     * 撤销库权限（KBP-09）。
     *
     * <p>先取行 {@code acl.libraryId}，再校验库级管理权（{@code hasLibraryManage}），
     * 否则 40311。存量 manage/acl 行同样可撤销（撤销不新增，兼容生效）。
     *
     * @param userId 当前用户 id
     * @param id     ACL 行 id
     */
    @Transactional
    public void revoke(Long userId, Long id) {
        KbAcl entity = aclRepository.findById(id)
                .orElseThrow(() -> new KbBusinessException(KbResultCode.KB_LIBRARY_NOT_FOUND));
        if (!nodeAdminResolver.hasLibraryManage(userId, entity.getLibraryId())) {
            throw new KbBusinessException(KbResultCode.KB_CATEGORY_NOT_MANAGEABLE,
                    "该知识库不在您的管理范围内");
        }
        aclRepository.delete(entity);
    }

    /**
     * KBP-10 存量 manage/acl 只读清单（运营清理依据，只读不清理）。
     *
     * <p><b>权限：</b>仅全局管理员可见——清单是跨库全局视角，普通分类管理员不应看到
     * 全平台授权数据；非全局管理员抛 40311。
     *
     * <p><b>过滤：</b>固定按 {@code action IN (manage, acl)} 查询（存量零迁移行），
     * 可选 {@code libraryId} / {@code subjectType} + {@code subjectId} 维度收敛；
     * 均缺省 = 全量存量 manage/acl 行。关联 {@link KbLibraryRepository} 回填
     * {@code libraryName / categoryId}（mis-kb 侧 {@code subjectName} 恒为 null，
     * 由 BFF 用 {@code KbSubjectProxyService} 回填）。
     *
     * @param userId      当前用户 id
     * @param libraryId   按库维度过滤；{@code null} = 不限制
     * @param subjectType 按主体类型过滤；{@code null} = 不限制
     * @param subjectId   按主体 id 过滤；{@code null} = 不限制
     * @return 存量授权清单视图
     */
    @Transactional(readOnly = true)
    public List<LegacyAclInventoryVO> listLegacyInventory(
            Long userId, Long libraryId, String subjectType, Long subjectId) {
        if (!nodeAdminResolver.isGlobalAdmin(userId)) {
            throw new KbBusinessException(KbResultCode.KB_CATEGORY_NOT_MANAGEABLE,
                    "仅全局管理员可查看存量授权清单");
        }
        List<KbAcl> rows = aclRepository.findByActionIn(List.of(
                AclAction.MANAGE.code(), AclAction.ACL.code()));
        List<LegacyAclInventoryVO> result = new ArrayList<>();
        for (KbAcl acl : rows) {
            if (libraryId != null && !libraryId.equals(acl.getLibraryId())) {
                continue;
            }
            if (subjectType != null && !subjectType.equals(acl.getSubjectType())) {
                continue;
            }
            if (subjectId != null && !subjectId.equals(acl.getSubjectId())) {
                continue;
            }
            KbLibrary lib = acl.getLibraryId() == null
                    ? null : libraryRepository.findById(acl.getLibraryId()).orElse(null);
            result.add(new LegacyAclInventoryVO(
                    acl.getId(),
                    acl.getLibraryId(),
                    lib != null ? lib.getName() : null,
                    lib != null ? lib.getCategoryId() : null,
                    acl.getSubjectType(),
                    acl.getSubjectId(),
                    null,
                    acl.getAction(),
                    acl.getCreatedAt(),
                    acl.getUpdatedAt()));
        }
        return result;
    }

    private KbLibrary requireLibrary(Long libraryId) {
        return libraryRepository.findById(libraryId)
                .orElseThrow(() -> new KbBusinessException(KbResultCode.KB_LIBRARY_NOT_FOUND));
    }

    private KbAclVO toVo(KbAcl e) {
        return new KbAclVO(
                e.getId(), e.getLibraryId(), e.getSubjectType(), e.getSubjectId(),
                e.getAction(), e.getCreatedAt(), e.getUpdatedAt());
    }
}
