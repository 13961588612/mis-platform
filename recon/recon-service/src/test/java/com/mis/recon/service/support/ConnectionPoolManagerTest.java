package com.mis.recon.service.support;

import com.mis.recon.common.BizException;
import com.mis.recon.domain.config.ReconConnection;
import com.mis.recon.repository.ConnectionRepository;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.Driver;
import java.sql.DriverManager;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;

/**
 * 连接池与测试连接单测（mock DriverManager 驱动，不 gate mvn test）。
 */
class ConnectionPoolManagerTest {

    private static final String TEST_URL = "jdbc:fake:ok";
    private final ConnectionPoolManager manager = new ConnectionPoolManager(mock(ConnectionRepository.class));

    @Test
    void connectivityPasses() throws Exception {
        Connection fakeConn = fakeConnection();
        Driver fakeDriver = fakeDriver(TEST_URL, fakeConn);
        DriverManager.registerDriver(fakeDriver);
        try {
            manager.testConnection(connection("mysql", TEST_URL, "u", "p"));
        } finally {
            DriverManager.deregisterDriver(fakeDriver);
        }
    }

    @Test
    void badUrlThrows2004() {
        ReconConnection conn = connection("mysql", "jdbc:mysql://127.0.0.1:1/none", "u", "p");
        BizException ex = assertThrows(BizException.class, () -> manager.testConnection(conn));
        assertEquals(2004, ex.getCode());
        assertTrue(ex.getMessage().contains("连接失败"));
    }

    @Test
    void unsupportedTypeThrows2004() {
        ReconConnection conn = connection("sqlserver", "jdbc:sqlserver://x", "u", "p");
        BizException ex = assertThrows(BizException.class, () -> manager.testConnection(conn));
        assertEquals(2004, ex.getCode());
        assertTrue(ex.getMessage().contains("不支持的连接类型"));
    }

    @Test
    void getDataSourceDisabledConnThrows7008() {
        ReconConnection conn = connection("mysql", "jdbc:mysql://127.0.0.1:3306/x", "u", "p");
        conn.setEnabled(0);
        conn.setConnCode("disabled");
        ConnectionRepository repo = mock(ConnectionRepository.class);
        org.mockito.Mockito.when(repo.findByConnCode("disabled"))
                .thenReturn(java.util.Optional.of(conn));
        ConnectionPoolManager m = new ConnectionPoolManager(repo);
        BizException ex = assertThrows(BizException.class, () -> m.getDataSource("disabled"));
        assertEquals(7008, ex.getCode());
    }

    @Test
    void getDataSourceMissingConnThrows7008() {
        ConnectionRepository repo = mock(ConnectionRepository.class);
        org.mockito.Mockito.when(repo.findByConnCode("nope"))
                .thenReturn(java.util.Optional.empty());
        ConnectionPoolManager m = new ConnectionPoolManager(repo);
        BizException ex = assertThrows(BizException.class, () -> m.getDataSource("nope"));
        assertEquals(7008, ex.getCode());
    }

    private ReconConnection connection(String type, String url, String user, String pass) {
        ReconConnection c = new ReconConnection();
        c.setType(type);
        c.setJdbcUrl(url);
        c.setUsername(user);
        c.setPassword(pass);
        return c;
    }

    private Connection fakeConnection() {
        return (Connection) Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[]{Connection.class},
                (proxy, method, args) -> {
                    if (method.getName().equals("isValid")) {
                        return true;
                    }
                    if (method.getName().equals("close")) {
                        return null;
                    }
                    return defaultValue(method.getReturnType());
                });
    }

    private Driver fakeDriver(String url, Connection conn) {
        return (Driver) Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[]{Driver.class},
                (proxy, method, args) -> {
                    switch (method.getName()) {
                        case "connect":
                            return url.equals(args[0]) ? conn : null;
                        case "acceptsURL":
                            return url.equals(args[0]);
                        case "jdbcCompliant":
                            return true;
                        case "getParentLogger":
                            return java.util.logging.Logger.getGlobal();
                        case "getMajorVersion":
                            return 1;
                        case "getMinorVersion":
                            return 0;
                        case "getPropertyInfo":
                            return new java.sql.DriverPropertyInfo[0];
                        default:
                            return null;
                    }
                });
    }

    private static Object defaultValue(Class<?> type) {
        if (!type.isPrimitive()) {
            return null;
        }
        if (type == boolean.class) {
            return false;
        }
        if (type == int.class) {
            return 0;
        }
        if (type == long.class) {
            return 0L;
        }
        if (type == double.class) {
            return 0d;
        }
        if (type == float.class) {
            return 0f;
        }
        if (type == short.class) {
            return (short) 0;
        }
        if (type == byte.class) {
            return (byte) 0;
        }
        if (type == char.class) {
            return '\0';
        }
        return null;
    }
}
