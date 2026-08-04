package com.mis.kb.domain.repository;

import com.mis.kb.domain.entity.KbDocument;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface KbDocumentRepository extends JpaRepository<KbDocument, Long> {

    List<KbDocument> findByLibraryIdOrderByCreatedAtDesc(Long libraryId);

    List<KbDocument> findByLibraryIdIn(List<Long> libraryIds);

    boolean existsByLibraryId(Long libraryId);

    long countByLibraryId(Long libraryId);

    Optional<KbDocument> findByEngineDocumentRef(String engineDocumentRef);
}
