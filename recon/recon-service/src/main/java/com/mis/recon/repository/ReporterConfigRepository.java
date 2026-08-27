package com.mis.recon.repository;

import com.mis.recon.domain.config.ReconReporterConfig;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

/**
 * 报告渠道 Repository。T03 只建接口（无 Service/Controller），CRUD 端点随 T07 落地。
 */
public interface ReporterConfigRepository extends JpaRepository<ReconReporterConfig, Long> {

    List<ReconReporterConfig> findByScenarioCode(String scenarioCode);

    Page<ReconReporterConfig> findByScenarioCode(String scenarioCode, Pageable pageable);

    Optional<ReconReporterConfig> findByScenarioCodeAndCheckName(String scenarioCode, String checkName);
}
