package com.mis.kb.domain.repository;

import com.mis.kb.domain.entity.KbDocument;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface KbDocumentRepository extends JpaRepository<KbDocument, Long> {

    List<KbDocument> findByLibraryIdOrderByCreatedAtDesc(Long libraryId);

    List<KbDocument> findByLibraryIdIn(List<Long> libraryIds);

    boolean existsByLibraryId(Long libraryId);

    long countByLibraryId(Long libraryId);

    Optional<KbDocument> findByEngineDocumentRef(String engineDocumentRef);

    /**
     * 按「库范围 + 启用 + 可选文档 id 集 + 可选上传时间范围」解析启用文档 id 集（KE-08/KE-09）。
     *
     * <p><b>过滤语义（设计 §1.5 / R5）：</b>
     * <ul>
     *   <li>只返回 {@code enabled=1} 的文档（引擎 code:102 校验 document 归属 + 检索到停用文档的双重防护）；</li>
     *   <li>{@code explicitIds} 为 {@code null} 时不限制 id（传空 List 会被 JPQL 判成恒假，
     *       所以<b>无 id 限制必须传 null</b>，由调用方归一化）；</li>
     *   <li>{@code uploadFrom}/{@code uploadTo} 为 {@code null} 时不限制对应边界（按
     *       {@code kb_document.created_at} 上传时间过滤，KE-09）；</li>
     *   <li>解析结果为空 = 过滤条件无任何命中，调用方按 R5「不下发 document_ids 键」处理。</li>
     * </ul>
     *
     * @param libraryIds  库 id 范围（必填；为空则无结果）
     * @param explicitIds 显式文档 id 集；{@code null} = 不限制
     * @param uploadFrom  上传时间下界（含）；{@code null} = 不限制
     * @param uploadTo    上传时间上界（含）；{@code null} = 不限制
     * @return 命中的启用文档 id 列表
     */
    @Query("""
            select d.id from KbDocument d
            where d.libraryId in :libraryIds
              and d.enabled = 1
              and (:explicitIds is null or d.id in :explicitIds)
              and (:uploadFrom is null or d.createdAt >= :uploadFrom)
              and (:uploadTo is null or d.createdAt <= :uploadTo)
            """)
    List<Long> findEnabledIdsByFilter(
            @Param("libraryIds") List<Long> libraryIds,
            @Param("explicitIds") List<Long> explicitIds,
            @Param("uploadFrom") Instant uploadFrom,
            @Param("uploadTo") Instant uploadTo);

    /**
     * 物理删库时清理该库下的全部文档行（引擎删除策略 P0 / Q6）。
     *
     * <p>历史实现只清了 {@code kb_acl}，{@code kb_document} 留下一堆指向已删库的悬空行——
     * 文档列表页按 {@code libraryIdIn} 查会直接把它们捞出来。物理删除路径必须先调本方法。
     *
     * @param libraryId 知识库 ID
     */
    @Modifying
    void deleteByLibraryId(Long libraryId);
}
