package com.mis.adminbff.embed;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Optional;

/**
 * {@code agent_external_host} / {@code agent_external_identity} 映射存储 Mapper
 * （02-task-breakdown §2.3：BFF 映射存储 Mapper）。
 *
 * <p>表由 {@code mis-migrator} 在共享平台库创建（V68__a2ui_embed_identity.sql），
 * BFF 通过独立 datasource 直读（只读，兑换端点不写映射表——显式映射由运营侧
 * 手工登记，兑换端仅消费）。
 */
@Repository
public class AgentExternalMapper {

    private final JdbcTemplate jdbcTemplate;

    public AgentExternalMapper(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /**
     * 按 hostId 读取宿主注册行。
     *
     * @param hostId 宿主标识
     * @return 注册行；不存在返回 {@link Optional#empty()}
     */
    public Optional<AgentExternalHost> findHost(String hostId) {
        return jdbcTemplate.query(
                        "SELECT host_id, host_name, client_id, client_secret_hash, "
                                + "shadow_mis_user_id, status, tenant_id, allowed_origins "
                                + "FROM agent_external_host WHERE host_id = ?",
                        (rs, rowNum) -> mapHost(rs),
                        hostId)
                .stream()
                .findFirst();
    }

    /**
     * 按 hostId + externalUserId 读取显式映射行。
     *
     * @param hostId         宿主标识
     * @param externalUserId 外部用户标识（token 内为准）
     * @return 映射行；不存在返回 {@link Optional#empty()}
     */
    public Optional<AgentExternalIdentity> findIdentityMapping(String hostId, String externalUserId) {
        return jdbcTemplate.query(
                        "SELECT host_id, external_user_id, external_username, mis_user_id, "
                                + "phone_hash, status "
                                + "FROM agent_external_identity "
                                + "WHERE host_id = ? AND external_user_id = ?",
                        (rs, rowNum) -> mapIdentity(rs),
                        hostId,
                        externalUserId)
                .stream()
                .findFirst();
    }

    private static AgentExternalHost mapHost(ResultSet rs) throws SQLException {
        Long tenantId = rs.getObject("tenant_id", Long.class);
        return new AgentExternalHost(
                rs.getString("host_id"),
                rs.getString("host_name"),
                rs.getString("client_id"),
                rs.getString("client_secret_hash"),
                rs.getString("shadow_mis_user_id"),
                rs.getString("status"),
                tenantId,
                rs.getString("allowed_origins"));
    }

    private static AgentExternalIdentity mapIdentity(ResultSet rs) throws SQLException {
        Long misUserId = rs.getObject("mis_user_id", Long.class);
        return new AgentExternalIdentity(
                rs.getString("host_id"),
                rs.getString("external_user_id"),
                rs.getString("external_username"),
                misUserId,
                rs.getString("phone_hash"),
                rs.getString("status"));
    }
}
