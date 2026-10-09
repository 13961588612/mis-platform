package com.mis.taskflow.domain.repository;

import com.mis.taskflow.domain.entity.WfNode;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface WfNodeRepository extends JpaRepository<WfNode, Long> {

    List<WfNode> findByDefinitionIdOrderBySortOrderAsc(Long definitionId);

    void deleteByDefinitionId(Long definitionId);
}
