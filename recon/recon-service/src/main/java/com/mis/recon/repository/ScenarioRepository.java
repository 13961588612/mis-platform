package com.mis.recon.repository;

import com.mis.recon.domain.config.ReconScenario;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

/**
 * 场景 Repository。
 */
public interface ScenarioRepository extends JpaRepository<ReconScenario, Long> {

    Optional<ReconScenario> findByScenarioCode(String scenarioCode);

    boolean existsByScenarioCode(String scenarioCode);

    List<ReconScenario> findByEnabled(Integer enabled);

    @Query("""
            SELECT s FROM ReconScenario s
            WHERE (:kw IS NULL OR s.scenarioCode LIKE CONCAT('%', CAST(:kw AS string), '%')
                              OR s.name        LIKE CONCAT('%', CAST(:kw AS string), '%'))
              AND (:enabled IS NULL OR s.enabled = :enabled)
            """)
    Page<ReconScenario> search(@Param("kw") String kw, @Param("enabled") Integer enabled, Pageable pageable);
}
