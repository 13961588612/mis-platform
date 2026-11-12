package com.mis.iqd.domain.repository;

import com.mis.iqd.domain.entity.IqdScopePolicy;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface IqdScopePolicyRepository extends JpaRepository<IqdScopePolicy, Long> {

    List<IqdScopePolicy> findByConnectionId(Long connectionId);

    List<IqdScopePolicy> findByConnectionIdAndSubjectTypeAndSubjectId(
            Long connectionId, String subjectType, String subjectId);

    Optional<IqdScopePolicy> findByConnectionIdAndSubjectTypeAndSubjectIdAndItemKey(
            Long connectionId, String subjectType, String subjectId, String itemKey);

    boolean existsByConnectionIdAndSubjectTypeAndSubjectIdAndItemKey(
            Long connectionId, String subjectType, String subjectId, String itemKey);

    /** 按连接 + item_key 集合查出范围策略（含 global / 角色等主体）。 */
    List<IqdScopePolicy> findByConnectionIdAndItemKeyIn(
            Long connectionId, Collection<String> itemKeys);
}
