package com.mis.kb.domain.repository;

import com.mis.kb.domain.entity.KbSynonymGroup;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

/**
 * 同义词术语组仓储（Wave D）。
 */
public interface KbSynonymGroupRepository extends JpaRepository<KbSynonymGroup, Long> {

    /**
     * 服务端分页搜索（WD-03 硬要求：<b>任何情况下不一次性拉全表</b>）。
     *
     * <p>搜索范围是「规范词 <b>或</b> 任意别名」，大小写不敏感（PRD §4.2「搜索框搜什么」）。
     * 别名侧走 {@code EXISTS} 子查询而非 JOIN —— JOIN 会因一组多别名产生重复行，
     * 再 {@code DISTINCT} 去重会让分页计数失真。
     *
     * @param keyword  已 {@code %…%} 包裹并转小写的关键词；{@code null} 表示不过滤
     * @param status   状态过滤；{@code null} 表示不过滤
     * @param pageable 分页与排序
     * @return 命中的术语组分页
     */
    @Query("""
            SELECT g FROM KbSynonymGroup g
            WHERE (:status IS NULL OR g.status = :status)
              AND (:keyword IS NULL
                   OR LOWER(g.canonicalTerm) LIKE :keyword
                   OR EXISTS (SELECT 1 FROM KbSynonymTerm t
                              WHERE t.groupId = g.id AND LOWER(t.term) LIKE :keyword))
            """)
    Page<KbSynonymGroup> search(
            @Param("keyword") String keyword,
            @Param("status") Integer status,
            Pageable pageable);

    /**
     * 按状态取全部组 ID（词典全量加载用，只装载启用组）。
     *
     * @param status 组状态
     * @return 组 ID 列表
     */
    @Query("SELECT g.id FROM KbSynonymGroup g WHERE g.status = :status")
    List<Long> findIdsByStatus(@Param("status") Integer status);

    /**
     * 按状态取全部组实体（词典全量加载用）。
     *
     * @param status 组状态
     * @return 组列表
     */
    List<KbSynonymGroup> findByStatus(Integer status);

    /**
     * 术语组总数（水位提示 WD-15 用）。
     *
     * @return 组总数
     */
    @Query("SELECT COUNT(g) FROM KbSynonymGroup g")
    long countAll();
}
