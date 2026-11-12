package com.mis.aireport.domain.repository;

import com.mis.aireport.domain.entity.AiReportCalendarMonth;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

public interface AiReportCalendarMonthRepository extends JpaRepository<AiReportCalendarMonth, String> {

    List<AiReportCalendarMonth> findByEnabledAndMonthStartGreaterThanEqualOrderByMonthStartDesc(
            Integer enabled, LocalDate fromInclusive);

    Optional<AiReportCalendarMonth> findByOrdMonthAndEnabled(String ordMonth, Integer enabled);
}
