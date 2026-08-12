package com.mis.kb.domain.repository;

import com.mis.kb.domain.entity.KbAcl;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;

public interface KbAclRepository extends JpaRepository<KbAcl, Long> {

    List<KbAcl> findByLibraryId(Long libraryId);

    List<KbAcl> findBySubjectTypeAndSubjectIdAndAction(String subjectType, Long subjectId, String action);

    /** KBP-10 只读清单：按动作集合过滤（存量 manage/acl 行）。 */
    List<KbAcl> findByActionIn(Collection<String> actions);

    boolean existsByLibraryIdAndSubjectTypeAndSubjectIdAndAction(
            Long libraryId, String subjectType, Long subjectId, String action);

    @Modifying
    void deleteByLibraryId(Long libraryId);
}
