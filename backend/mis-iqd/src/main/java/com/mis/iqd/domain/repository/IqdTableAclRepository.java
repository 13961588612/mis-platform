package com.mis.iqd.domain.repository;

import com.mis.iqd.domain.entity.IqdTableAcl;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface IqdTableAclRepository extends JpaRepository<IqdTableAcl, Long> {

    List<IqdTableAcl> findByConnectionId(Long connectionId);

    List<IqdTableAcl> findByConnectionIdAndSubjectTypeAndSubjectId(
            Long connectionId, String subjectType, String subjectId);

    List<IqdTableAcl> findByConnectionIdAndAction(Long connectionId, String action);

    Optional<IqdTableAcl> findByConnectionIdAndSubjectTypeAndSubjectIdAndItemKeyAndAction(
            Long connectionId, String subjectType, String subjectId, String itemKey, String action);

    boolean existsByConnectionIdAndSubjectTypeAndSubjectIdAndItemKeyAndAction(
            Long connectionId, String subjectType, String subjectId, String itemKey, String action);
}
