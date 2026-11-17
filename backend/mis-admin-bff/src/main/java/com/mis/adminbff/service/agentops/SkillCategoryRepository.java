package com.mis.adminbff.service.agentops;

import com.mis.adminbff.dto.agentops.SkillCategoryVO;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** {@code ai_skill_category} / {@code ai_skill_category_bind} JDBC 存储。 */
@Repository
public class SkillCategoryRepository {

    private final JdbcTemplate jdbc;

    public SkillCategoryRepository(JdbcTemplate jdbcTemplate) {
        this.jdbc = jdbcTemplate;
    }

    public List<SkillCategoryVO> findAll() {
        return jdbc.query(
                "SELECT id, parent_id, name, sort_order FROM ai_skill_category ORDER BY sort_order ASC, id ASC",
                (rs, rowNum) -> {
                    SkillCategoryVO vo = new SkillCategoryVO();
                    vo.setId(rs.getLong("id"));
                    vo.setParentId(rs.getLong("parent_id"));
                    vo.setName(rs.getString("name"));
                    vo.setSortOrder(rs.getInt("sort_order"));
                    return vo;
                });
    }

    public Optional<SkillCategoryVO> findById(long id) {
        List<SkillCategoryVO> rows = jdbc.query(
                "SELECT id, parent_id, name, sort_order FROM ai_skill_category WHERE id = ?",
                (rs, rowNum) -> {
                    SkillCategoryVO vo = new SkillCategoryVO();
                    vo.setId(rs.getLong("id"));
                    vo.setParentId(rs.getLong("parent_id"));
                    vo.setName(rs.getString("name"));
                    vo.setSortOrder(rs.getInt("sort_order"));
                    return vo;
                },
                id);
        return rows.stream().findFirst();
    }

    public Map<Long, Long> parentById() {
        Map<Long, Long> map = new HashMap<>();
        jdbc.query(
                "SELECT id, parent_id FROM ai_skill_category",
                rs -> {
                    map.put(rs.getLong("id"), rs.getLong("parent_id"));
                });
        return map;
    }

    public Map<String, Long> findBinds() {
        Map<String, Long> map = new HashMap<>();
        jdbc.query(
                "SELECT skill_id, category_id FROM ai_skill_category_bind",
                rs -> {
                    map.put(rs.getString("skill_id"), rs.getLong("category_id"));
                });
        return map;
    }

    public boolean existsChildren(long id) {
        Boolean found = jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM ai_skill_category WHERE parent_id = ?)",
                Boolean.class,
                id);
        return Boolean.TRUE.equals(found);
    }

    public boolean existsBinds(long categoryId) {
        Boolean found = jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM ai_skill_category_bind WHERE category_id = ?)",
                Boolean.class,
                categoryId);
        return Boolean.TRUE.equals(found);
    }

    public long insert(long parentId, String name, int sortOrder) {
        Long id = jdbc.queryForObject(
                "INSERT INTO ai_skill_category (parent_id, name, sort_order, created_at, updated_at) "
                        + "VALUES (?, ?, ?, NOW(), NOW()) RETURNING id",
                Long.class,
                parentId,
                name,
                sortOrder);
        if (id == null) {
            throw new IllegalStateException("ai_skill_category insert 未返回 id");
        }
        return id;
    }

    public void update(long id, long parentId, String name, int sortOrder) {
        jdbc.update(
                "UPDATE ai_skill_category SET parent_id = ?, name = ?, sort_order = ?, updated_at = NOW() WHERE id = ?",
                parentId,
                name,
                sortOrder,
                id);
    }

    public void delete(long id) {
        jdbc.update("DELETE FROM ai_skill_category WHERE id = ?", id);
    }

    public void upsertBind(String skillId, long categoryId) {
        jdbc.update(
                "INSERT INTO ai_skill_category_bind (skill_id, category_id, updated_at) VALUES (?, ?, NOW()) "
                        + "ON CONFLICT (skill_id) DO UPDATE SET category_id = EXCLUDED.category_id, updated_at = NOW()",
                skillId,
                categoryId);
    }

    public void deleteBind(String skillId) {
        jdbc.update("DELETE FROM ai_skill_category_bind WHERE skill_id = ?", skillId);
    }
}
