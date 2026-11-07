package com.mis.aireport.domain.repository;

import com.mis.aireport.domain.entity.AiReportResultCache;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface AiReportResultCacheRepository extends JpaRepository<AiReportResultCache, Long> {

    Optional<AiReportResultCache> findByReportCodeAndParamsHash(String reportCode, String paramsHash);
}
