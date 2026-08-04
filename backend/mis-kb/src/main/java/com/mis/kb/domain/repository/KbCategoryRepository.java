package com.mis.kb.domain.repository;

import com.mis.kb.domain.entity.KbCategory;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface KbCategoryRepository extends JpaRepository<KbCategory, Long> {

    List<KbCategory> findByParentIdOrderBySortAscIdAsc(Long parentId);

    List<KbCategory> findByParentId(Long parentId);

    boolean existsByParentId(Long parentId);
}
