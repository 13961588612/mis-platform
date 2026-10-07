package com.mis.org.domain.repository;

import com.mis.org.domain.entity.SysEmployeePost;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;

public interface SysEmployeePostRepository extends JpaRepository<SysEmployeePost, Long> {

    List<SysEmployeePost> findByEmployeeIdAndStatus(Long employeeId, Integer status);

    List<SysEmployeePost> findByPostIdAndStatus(Long postId, Integer status);

    long countByPostIdAndStatus(Long postId, Integer status);

    /**
     * 全量覆盖任职前先物理删除。必须 flush/clear，否则同事务紧接着 INSERT 同一
     * (employee_id, post_id) 会撞 uk_emp_post（Hibernate 可能先插后删）。
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("DELETE FROM SysEmployeePost ep WHERE ep.employeeId = :employeeId")
    void deleteByEmployeeId(@Param("employeeId") Long employeeId);

    @Query("""
            SELECT DISTINCT p.deptId FROM SysEmployeePost ep
            JOIN SysPost p ON p.id = ep.postId
            WHERE ep.employeeId = :employeeId AND ep.status = 1 AND p.status = 1
            """)
    List<Long> findActivePostDeptIds(@Param("employeeId") Long employeeId);


    /** order by start_date asc */
    List<SysEmployeePost> findByEmployeeIdOrderByStartDateAsc(Long employeeId);

    /** active posts: startDate IS NULL OR startDate <= today, status = 1 */
    @Query("""
            SELECT ep FROM SysEmployeePost ep
            WHERE ep.employeeId = :employeeId
              AND ep.status = 1
              AND (ep.startDate IS NULL OR ep.startDate <= :today)
            ORDER BY ep.startDate ASC
            """)
    List<SysEmployeePost> findActivePostsAsOfToday(@Param("employeeId") Long employeeId, @Param("today") LocalDate today);
}
