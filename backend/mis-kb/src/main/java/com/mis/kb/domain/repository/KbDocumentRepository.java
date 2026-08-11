package com.mis.kb.domain.repository;

import com.mis.kb.domain.entity.KbDocument;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;

import java.util.List;
import java.util.Optional;

public interface KbDocumentRepository extends JpaRepository<KbDocument, Long> {

    List<KbDocument> findByLibraryIdOrderByCreatedAtDesc(Long libraryId);

    List<KbDocument> findByLibraryIdIn(List<Long> libraryIds);

    boolean existsByLibraryId(Long libraryId);

    long countByLibraryId(Long libraryId);

    Optional<KbDocument> findByEngineDocumentRef(String engineDocumentRef);

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
