package com.mis.kb.domain.repository;

import com.mis.kb.domain.entity.KbCategoryAdmin;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;

import java.util.List;

/**
 * 分类节点管理员授权仓储。
 *
 * <p>查询方法覆盖两类用途：
 * <ul>
 *   <li>授权 CRUD（{@code KbCategoryAdminService}）：按节点查 / UK 去重 / 按主体查 / 级联清理；</li>
 *   <li>管辖判定（{@code NodeAdminResolver}）：按「节点 × 主体类型 × 主体 id 集合」存在性、
 *       按「主体类型 × 主体 id 集合」批量取命中节点，支撑祖先链与子树并集。</li>
 * </ul>
 */
public interface KbCategoryAdminRepository extends JpaRepository<KbCategoryAdmin, Long> {

    List<KbCategoryAdmin> findByCategoryId(Long categoryId);

    boolean existsByCategoryIdAndSubjectTypeAndSubjectId(Long categoryId, String subjectType, Long subjectId);

    List<KbCategoryAdmin> findBySubjectTypeAndSubjectId(String subjectType, Long subjectId);

    /** 某节点上、某类主体任一命中即 true（祖先链判定用）。 */
    boolean existsByCategoryIdAndSubjectTypeAndSubjectIdIn(Long categoryId, String subjectType, List<Long> subjectIds);

    /** 某类主体的授权节点集合（子树并集计算用）。 */
    List<KbCategoryAdmin> findBySubjectTypeAndSubjectIdIn(String subjectType, List<Long> subjectIds);

    @Modifying
    void deleteByCategoryId(Long categoryId);
}
