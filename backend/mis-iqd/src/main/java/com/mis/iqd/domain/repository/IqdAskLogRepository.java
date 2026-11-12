package com.mis.iqd.domain.repository;

import com.mis.iqd.domain.entity.IqdAskLog;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.List;

public interface IqdAskLogRepository extends JpaRepository<IqdAskLog, Long> {

    /** 按用户过滤，时间倒序（同秒再按 id 倒序）。 */
    List<IqdAskLog> findByUserIdOrderByCreatedAtDescIdDesc(Long userId);

    List<IqdAskLog> findByTraceId(String traceId);

    /** 按状态过滤，时间倒序（同秒再按 id 倒序）。 */
    List<IqdAskLog> findByStatusOrderByCreatedAtDescIdDesc(String status);

    List<IqdAskLog> findByCreatedAtAfterOrderByCreatedAtDescIdDesc(Instant after);
}
