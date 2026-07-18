package com.mis.org.domain.repository;

import com.mis.org.domain.entity.SysPost;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SysPostRepository extends JpaRepository<SysPost, Long> {

    List<SysPost> findByDeptIdAndStatus(Long deptId, Integer status);

    boolean existsByDeptId(Long deptId);
}
