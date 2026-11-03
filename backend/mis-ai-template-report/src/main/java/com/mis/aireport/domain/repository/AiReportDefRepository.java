package com.mis.aireport.domain.repository;

import com.mis.aireport.domain.entity.AiReportDef;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface AiReportDefRepository extends JpaRepository<AiReportDef, Long> {

    Optional<AiReportDef> findByReportCode(String reportCode);

    List<AiReportDef> findByCategoryIdOrderBySortOrderAscIdAsc(Long categoryId);

    List<AiReportDef> findByCategoryIdIsNullOrderBySortOrderAscIdAsc();

    List<AiReportDef> findAllByOrderBySortOrderAscIdAsc();

    boolean existsByCategoryId(Long categoryId);

    long countByCategoryId(Long categoryId);
}
