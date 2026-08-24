package com.mis.iqd.domain.repository;

import com.mis.iqd.domain.entity.IqdAskLog;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.List;

public interface IqdAskLogRepository extends JpaRepository<IqdAskLog, Long> {

    List<IqdAskLog> findByUserIdOrderByIdDesc(Long userId);

    List<IqdAskLog> findByTraceId(String traceId);

    List<IqdAskLog> findByStatusOrderByIdDesc(String status);

    List<IqdAskLog> findByCreatedAtAfterOrderByIdDesc(Instant after);
}
