package com.mis.aireport.domain.repository;

import com.mis.aireport.domain.entity.AiWorkflowPlatform;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface AiWorkflowPlatformRepository extends JpaRepository<AiWorkflowPlatform, Long> {

    Optional<AiWorkflowPlatform> findByPlatformCode(String platformCode);

    List<AiWorkflowPlatform> findAllByOrderByPlatformCodeAsc();
}
