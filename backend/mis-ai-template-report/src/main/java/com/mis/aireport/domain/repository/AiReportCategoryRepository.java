package com.mis.aireport.domain.repository;

import com.mis.aireport.domain.entity.AiReportCategory;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface AiReportCategoryRepository extends JpaRepository<AiReportCategory, Long> {

    Optional<AiReportCategory> findByCode(String code);

    List<AiReportCategory> findAllByOrderBySortOrderAscIdAsc();

    boolean existsByParentId(Long parentId);

    long countByParentId(Long parentId);
}
