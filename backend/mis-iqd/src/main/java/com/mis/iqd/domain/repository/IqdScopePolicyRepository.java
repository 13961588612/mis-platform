package com.mis.iqd.domain.repository;

import com.mis.iqd.domain.entity.IqdScopePolicy;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.List;

public interface IqdScopePolicyRepository extends JpaRepository<IqdScopePolicy, Long> {

    List<IqdScopePolicy> findByConnectionId(Long connectionId);

    List<IqdScopePolicy> findByConnectionIdAndSubjectTypeAndSubjectId(
            Long connectionId, String subjectType, String subjectId);

    Optional<IqdScopePolicy> findByConnectionIdAndSubjectTypeAndSubjectIdAndItemKey(
            Long connectionId, String subjectType, String subjectId, String itemKey);

    boolean existsByConnectionIdAndSubjectTypeAndSubjectIdAndItemKey(
            Long connectionId, String subjectType, String subjectId, String itemKey);
}
