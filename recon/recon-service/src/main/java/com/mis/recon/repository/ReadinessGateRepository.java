package com.mis.recon.repository;

import com.mis.recon.domain.config.ReconReadinessGate;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

/**
 * 数据就绪门 Repository。T03 只建接口（无 Service/Controller），CRUD 端点随 T07 落地。
 */
public interface ReadinessGateRepository extends JpaRepository<ReconReadinessGate, Long> {

    List<ReconReadinessGate> findByScenarioCode(String scenarioCode);

    Page<ReconReadinessGate> findByScenarioCode(String scenarioCode, Pageable pageable);
}
