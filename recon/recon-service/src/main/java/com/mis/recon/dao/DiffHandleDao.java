package com.mis.recon.dao;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 差异人工处理 DAO（T07-spec §6，JdbcTemplate 热路径）：写 recon_diff_handle + 更新
 * recon_detail.handle_status（引擎重构/upsert 不覆盖该列，重对不丢人工标记）。
 */
@Repository
public class DiffHandleDao {

    private final JdbcTemplate jdbcTemplate;

    public DiffHandleDao(@Qualifier("reconJdbcTemplate") JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /** 写人工处理记录：返回 id。 */
    public long insert(long detailId, String handleStatus, String operator, String remark) {
        Long id = jdbcTemplate.queryForObject("""
                INSERT INTO recon_diff_handle (detail_id, handle_status, operator, remark)
                VALUES (?, ?, ?, ?)
                RETURNING id
                """, Long.class, detailId, handleStatus, operator, remark);
        return id == null ? 0 : id;
    }

    /** 回写 recon_detail.handle_status（引擎不覆盖）。 */
    public void updateDetailHandle(long detailId, String handleStatus) {
        jdbcTemplate.update("""
                UPDATE recon_detail
                   SET handle_status = ?, updated_at = now()
                 WHERE id = ?
                """, handleStatus, detailId);
    }

    /** 回退为未处理（V4）：重置 detail.handle_status = 'unhandled'。 */
    public void revertDetailHandle(long detailId) {
        jdbcTemplate.update("""
                UPDATE recon_detail
                   SET handle_status = 'unhandled', updated_at = now()
                 WHERE id = ?
                """, detailId);
    }
}