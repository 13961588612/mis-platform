package com.mis.org.domain.repository;

import com.mis.org.domain.entity.SysEmployeePost;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface SysEmployeePostRepository extends JpaRepository<SysEmployeePost, Long> {

    List<SysEmployeePost> findByEmployeeIdAndStatus(Long employeeId, Integer status);

    @Query("""
            SELECT DISTINCT p.deptId FROM SysEmployeePost ep
            JOIN SysPost p ON p.id = ep.postId
            WHERE ep.employeeId = :employeeId AND ep.status = 1 AND p.status = 1
            """)
    List<Long> findActivePostDeptIds(@Param("employeeId") Long employeeId);
}
