package com.mis.recon.repository;

import com.mis.recon.domain.config.ReconCompareRule;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

/**
 * 比较规则 Repository（级联删除用 deleteByScenarioCodeAndCheckName，派生删除无需 @Modifying）。
 */
public interface CompareRuleRepository extends JpaRepository<ReconCompareRule, Long> {

    Optional<ReconCompareRule> findByScenarioCodeAndCheckName(String scenarioCode, String checkName);

    boolean existsByScenarioCodeAndCheckName(String scenarioCode, String checkName);

    void deleteByScenarioCodeAndCheckName(String scenarioCode, String checkName);
}
