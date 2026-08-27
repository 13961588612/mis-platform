package com.mis.recon.service.support;

import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;
import com.mis.recon.domain.config.ReconConnection;
import com.mis.recon.repository.ConnectionRepository;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import jakarta.annotation.PreDestroy;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 动态连接池管理器（F82 完整池，技术适配 §2.7）。
 * <ul>
 *   <li>按 conn_code 构建 HikariCP DataSource（readOnly=true）并缓存到 ConcurrentHashMap</li>
 *   <li>池参数解析自 props_json（JSONB），jdbc_props_locked 为锁定集（不可被 props_json 覆盖）</li>
 *   <li>连接 CRUD 保存后 evict（close 旧池 + 移除）；enabled=0 evict 并拒绝新建</li>
 *   <li>testConnection 保留 T03 的 DriverManager 直连（低频一次性，不污染池，G15）</li>
 * </ul>
 */
@Service
@RequiredArgsConstructor
public class ConnectionPoolManager {

    private static final Map<String, String> DRIVER_CLASS = Map.of(
            "mysql", "com.mysql.cj.jdbc.Driver",
            "postgresql", "org.postgresql.Driver",
            "oracle", "oracle.jdbc.OracleDriver"
    );

    /** props_json 中可解析的池参数（HikariConfig setter 名 → 键） */
    private static final Set<String> POOL_PROPS = Set.of(
            "maximum_pool_size", "minimum_idle", "connection_timeout_ms", "idle_timeout_ms",
            "max_lifetime_ms", "validation_timeout_ms"
    );

    private final ConnectionRepository connectionRepository;
    private final ConcurrentHashMap<String, DataSource> pool = new ConcurrentHashMap<>();

    /**
     * 取连接池（缓存未命中则构建）。
     *
     * @throws BizException 7008：连接不存在 / 已禁用 / 构建失败
     */
    public DataSource getDataSource(String connCode) {
        DataSource existing = pool.get(connCode);
        if (existing != null) {
            return existing;
        }
        ReconConnection conn = connectionRepository.findByConnCode(connCode)
                .orElseThrow(() -> new BizException(ErrorCode.CONN_NOT_READY, "连接不存在: " + connCode));
        if (conn.getEnabled() == null || conn.getEnabled() != 1) {
            throw new BizException(ErrorCode.CONN_NOT_READY, "连接已禁用: " + connCode);
        }
        DataSource built = build(conn);
        DataSource raced = pool.putIfAbsent(connCode, built);
        return raced != null ? raced : built;
    }

    /** evict：close 旧池 + 移除（连接 CRUD 保存后调用）。 */
    public void evict(String connCode) {
        DataSource removed = pool.remove(connCode);
        if (removed instanceof HikariDataSource hds) {
            hds.close();
        }
    }

    /** 连通性测试（G15：DriverManager 直连，不污染池）。 */
    public void testConnection(ReconConnection conn) {
        String driver = DRIVER_CLASS.get(conn.getType());
        if (driver == null) {
            throw new BizException(ErrorCode.CONN_TEST_FAILED, "不支持的连接类型: " + conn.getType());
        }
        try {
            Class.forName(driver);
        } catch (ClassNotFoundException e) {
            throw new BizException(ErrorCode.CONN_TEST_FAILED, "驱动未部署: " + conn.getType());
        }
        Properties props = new Properties();
        props.setProperty("user", conn.getUsername() == null ? "" : conn.getUsername());
        props.setProperty("password", conn.getPassword() == null ? "" : conn.getPassword());
        applyConnectTimeout(props, conn.getType());
        try (Connection c = DriverManager.getConnection(conn.getJdbcUrl(), props)) {
            if (!c.isValid(3)) {
                throw new SQLException("connection not valid");
            }
        } catch (SQLException e) {
            throw new BizException(ErrorCode.CONN_TEST_FAILED, "连接失败: " + e.getMessage());
        }
    }

    /** 应用关闭：全池 close。 */
    @PreDestroy
    public void closeAll() {
        pool.values().forEach(ds -> {
            if (ds instanceof HikariDataSource hds) {
                hds.close();
            }
        });
        pool.clear();
    }

    private DataSource build(ReconConnection conn) {
        try {
            Class.forName(DRIVER_CLASS.get(conn.getType()));
        } catch (ClassNotFoundException e) {
            throw new BizException(ErrorCode.CONN_NOT_READY, "驱动未部署: " + conn.getType());
        }
        HikariConfig cfg = new HikariConfig();
        cfg.setJdbcUrl(conn.getJdbcUrl());
        cfg.setUsername(conn.getUsername() == null ? "" : conn.getUsername());
        cfg.setPassword(conn.getPassword() == null ? "" : conn.getPassword());
        cfg.setReadOnly(true);                       // 源库只读（技术适配 §2.7）
        cfg.setPoolName("recon-src-" + conn.getConnCode());
        cfg.setConnectionTimeout(30000);
        cfg.setValidationTimeout(5000);
        cfg.setMaximumPoolSize(5);
        cfg.setMinimumIdle(1);
        // props_json 池参数（锁定集之外可覆盖）
        applyPoolProps(cfg, conn.getPropsJson(), conn.getJdbcPropsLocked());
        return new HikariDataSource(cfg);
    }

    /** props_json 池参数解析；jdbc_props_locked 锁定集内的键忽略（防配置漂移）。 */
    private void applyPoolProps(HikariConfig cfg, String propsJson, String jdbcPropsLocked) {
        if (propsJson == null || propsJson.isBlank()) {
            return;
        }
        Set<String> locked = jdbcPropsLocked == null || jdbcPropsLocked.isBlank()
                ? Set.of()
                : Set.of(jdbcPropsLocked.split(","));
        com.fasterxml.jackson.databind.JsonNode node;
        try {
            node = new com.fasterxml.jackson.databind.ObjectMapper().readTree(propsJson);
        } catch (Exception e) {
            return;   // props_json 非法不阻塞构建，用默认池参数
        }
        if (!node.isObject()) {
            return;
        }
        node.fields().forEachRemaining(entry -> {
            String key = entry.getKey();
            if (locked.contains(key) || !POOL_PROPS.contains(key)) {
                return;
            }
            int value = entry.getValue().asInt();
            switch (key) {
                case "maximum_pool_size" -> cfg.setMaximumPoolSize(value);
                case "minimum_idle" -> cfg.setMinimumIdle(value);
                case "connection_timeout_ms" -> cfg.setConnectionTimeout(value);
                case "idle_timeout_ms" -> cfg.setIdleTimeout(value);
                case "max_lifetime_ms" -> cfg.setMaxLifetime(value);
                case "validation_timeout_ms" -> cfg.setValidationTimeout(value);
                default -> { }
            }
        });
    }

    private static void applyConnectTimeout(Properties props, String type) {
        switch (type) {
            case "mysql":
                props.setProperty("connectTimeout", "5000");
                break;
            case "postgresql":
                props.setProperty("connectTimeout", "5");
                break;
            case "oracle":
                props.setProperty("oracle.net.CONNECT_TIMEOUT", "5000");
                break;
            default:
                break;
        }
    }
}
