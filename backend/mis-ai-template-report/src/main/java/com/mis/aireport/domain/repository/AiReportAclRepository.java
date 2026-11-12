package com.mis.aireport.domain.repository;

import com.mis.aireport.domain.entity.AiReportAcl;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface AiReportAclRepository extends JpaRepository<AiReportAcl, Long> {

    List<AiReportAcl> findByReportCodeOrderByIdAsc(String reportCode);

    void deleteByReportCode(String reportCode);

    boolean existsByReportCodeAndSubjectTypeAndSubjectId(
            String reportCode, String subjectType, String subjectId);
}
