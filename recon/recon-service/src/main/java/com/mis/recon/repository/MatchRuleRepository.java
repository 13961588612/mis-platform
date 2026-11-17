package com.mis.recon.repository;

import com.mis.recon.domain.config.ReconMatchRule;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

/**
 * 匹配规则 Repository（级联删除用 deleteByScenarioCodeAndCheckName，派生删除无需 @Modifying）。
 */
public interface MatchRuleRepository extends JpaRepository<ReconMatchRule, Long> {

    Optional<ReconMatchRule> findByScenarioCodeAndCheckName(String scenarioCode, String checkName);

    boolean existsByScenarioCodeAndCheckName(String scenarioCode, String checkName);

    void deleteByScenarioCodeAndCheckName(String scenarioCode, String checkName);
}
