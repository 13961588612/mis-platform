package com.mis.iqd.domain.repository;

import com.mis.iqd.domain.entity.IqdMaskRule;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface IqdMaskRuleRepository extends JpaRepository<IqdMaskRule, Long> {

    Optional<IqdMaskRule> findByName(String name);

    boolean existsByName(String name);

    List<IqdMaskRule> findByEnabledOrderByPriorityDesc(Integer enabled);
}
