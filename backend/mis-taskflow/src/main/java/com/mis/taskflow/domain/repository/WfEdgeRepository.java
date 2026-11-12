package com.mis.taskflow.domain.repository;

import com.mis.taskflow.domain.entity.WfEdge;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface WfEdgeRepository extends JpaRepository<WfEdge, Long> {

    List<WfEdge> findByDefinitionIdOrderBySortOrderAsc(Long definitionId);

    List<WfEdge> findByDefinitionIdAndSourceNodeOrderBySortOrderAsc(Long definitionId, String sourceNode);

    void deleteByDefinitionId(Long definitionId);
}
