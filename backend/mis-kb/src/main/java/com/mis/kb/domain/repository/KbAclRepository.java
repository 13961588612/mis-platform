package com.mis.kb.domain.repository;

import com.mis.kb.domain.entity.KbAcl;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface KbAclRepository extends JpaRepository<KbAcl, Long> {

    List<KbAcl> findByLibraryId(Long libraryId);

    List<KbAcl> findBySubjectTypeAndSubjectIdAndAction(String subjectType, Long subjectId, String action);

    boolean existsByLibraryIdAndSubjectTypeAndSubjectIdAndAction(
            Long libraryId, String subjectType, Long subjectId, String action);

    @Modifying
    void deleteByLibraryId(Long libraryId);
}
