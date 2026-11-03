package com.mis.aireport.domain.repository;

import com.mis.aireport.domain.entity.AiReportCalendarWeek;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

public interface AiReportCalendarWeekRepository extends JpaRepository<AiReportCalendarWeek, String> {

    List<AiReportCalendarWeek> findByEnabledAndWeekStartGreaterThanEqualOrderByWeekStartDesc(
            Integer enabled, LocalDate fromInclusive);

    Optional<AiReportCalendarWeek> findByOrdWeekAndEnabled(String ordWeek, Integer enabled);
}
