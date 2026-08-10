package com.mis.kb.domain.service;

import com.mis.kb.api.dto.KbCategoryCreateRequest;
import com.mis.kb.api.dto.KbCategoryUpdateRequest;
import com.mis.kb.api.dto.KbCategoryVO;
import com.mis.kb.domain.entity.KbCategory;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.repository.KbCategoryRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.support.IdGenerator;
import com.mis.kb.support.KbBusinessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.Instant;
import java.util.List;

/**
 * 分类服务（C-01~07 + 知识库域一期：节点管辖校验 + 移动）。
 *
 * <p>知识库域一期（system_design §4.3 / §5.3）：{@code create}/{@code update}/{@code delete}/
 * {@code move} 均加节点管辖校验（经 {@link NodeAdminResolver}，禁止内联）：
 * <ul>
 *   <li>新建：子节点须能管其父节点；根节点须全局管理员（角色码短路）；</li>
 *   <li>编辑/删除：须能管该节点；删除沿用 {@code KB_CATEGORY_HAS_CHILDREN}
 *       （子分类/库引用），授权行由 FK CASCADE 级联清理，无需业务拦截；</li>
 *   <li>移动：{@code assertCanMove}（管辖 + 防环），越权/防环返回明确业务码。</li>
 * </ul>
 */
@Service
public class KbCategoryService {

    private final KbCategoryRepository categoryRepository;
    private final KbLibraryRepository libraryRepository;
    private final NodeAdminResolver nodeAdminResolver;

    public KbCategoryService(
            KbCategoryRepository categoryRepository,
            KbLibraryRepository libraryRepository,
            NodeAdminResolver nodeAdminResolver) {
        this.categoryRepository = categoryRepository;
        this.libraryRepository = libraryRepository;
        this.nodeAdminResolver = nodeAdminResolver;
    }

    @Transactional(readOnly = true)
    public List<KbCategoryVO> listAll() {
        return categoryRepository.findAll().stream().map(this::toVo).toList();
    }

    /**
     * 新建分类；父节点必须在本人管辖内，根节点须全局管理员。
     *
     * @param req    创建请求
     * @param userId 当前用户 id（BFF 透传，可为 null → 拒绝）
     */
    @Transactional
    public KbCategoryVO create(KbCategoryCreateRequest req, Long userId) {
        if (req.parentId() == null) {
            if (!nodeAdminResolver.isGlobalAdmin(userId)) {
                throw new KbBusinessException(KbResultCode.KB_CATEGORY_NOT_MANAGEABLE);
            }
        } else {
            nodeAdminResolver.assertNodeManage(userId, req.parentId());
        }
        Instant now = Instant.now();
        KbCategory entity = new KbCategory();
        entity.setId(IdGenerator.nextId());
        entity.setParentId(req.parentId());
        entity.setName(req.name().trim());
        entity.setEnabled(req.enabled());
        entity.setSort(req.sort() != null ? req.sort() : 0);
        entity.setRemark(trimToNull(req.remark()));
        entity.setCreatedAt(now);
        entity.setUpdatedAt(now);
        return toVo(categoryRepository.save(entity));
    }

    /**
     * 编辑分类；须能管该节点。
     */
    @Transactional
    public KbCategoryVO update(Long id, KbCategoryUpdateRequest req, Long userId) {
        KbCategory entity = require(id);
        nodeAdminResolver.assertNodeManage(userId, id);
        entity.setName(req.name().trim());
        entity.setEnabled(req.enabled());
        if (req.sort() != null) {
            entity.setSort(req.sort());
        }
        entity.setRemark(trimToNull(req.remark()));
        entity.setUpdatedAt(Instant.now());
        return toVo(categoryRepository.save(entity));
    }

    /**
     * 删除分类；须能管该节点；沿用 {@code KB_CATEGORY_HAS_CHILDREN}（子分类/库引用），
     * 授权行由 FK CASCADE 级联清理。
     */
    @Transactional
    public void delete(Long id, Long userId) {
        KbCategory entity = require(id);
        nodeAdminResolver.assertNodeManage(userId, id);
        if (categoryRepository.existsByParentId(id) || libraryRepository.existsByCategoryId(id)) {
            throw new KbBusinessException(KbResultCode.KB_CATEGORY_HAS_CHILDREN);
        }
        categoryRepository.delete(entity);
    }

    /**
     * 移动分类节点；目标父节点须在本人管辖内且非自己后代（防环）。
     */
    @Transactional
    public KbCategoryVO move(Long nodeId, Long newParentId, Long userId) {
        KbCategory entity = require(nodeId);
        nodeAdminResolver.assertCanMove(userId, nodeId, newParentId);
        entity.setParentId(newParentId);
        entity.setUpdatedAt(Instant.now());
        return toVo(categoryRepository.save(entity));
    }

    private KbCategory require(Long id) {
        return categoryRepository.findById(id)
                .orElseThrow(() -> new KbBusinessException(KbResultCode.KB_CATEGORY_NOT_FOUND));
    }

    private KbCategoryVO toVo(KbCategory e) {
        return new KbCategoryVO(
                e.getId(), e.getParentId(), e.getName(), e.getEnabled(),
                e.getSort(), e.getRemark(), e.getCreatedAt(), e.getUpdatedAt());
    }

    private static String trimToNull(String v) {
        return StringUtils.hasText(v) ? v.trim() : null;
    }
}
