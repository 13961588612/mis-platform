package com.mis.aireport.domain.repository;

import com.mis.aireport.domain.entity.AiReportCalendarDay;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDate;
import java.util.List;

public interface AiReportCalendarDayRepository extends JpaRepository<AiReportCalendarDay, LocalDate> {

    List<AiReportCalendarDay> findByEnabledAndBizDateGreaterThanEqualOrderByBizDateDesc(
            Integer enabled, LocalDate fromInclusive);
}
