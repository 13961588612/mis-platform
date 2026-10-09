package com.mis.taskflow.domain.repository;

import com.mis.taskflow.domain.entity.WfHistory;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface WfHistoryRepository extends JpaRepository<WfHistory, Long> {

    List<WfHistory> findByInstanceIdOrderByCreatedAtAsc(Long instanceId);
}
