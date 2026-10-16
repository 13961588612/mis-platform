package com.mis.recon.service.config;

import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;
import com.mis.recon.service.support.ConnectionPoolManager;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.SQLException;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * V35 UNION 金额字段类型校验单测（mock DataSource/MetaData，不 gate mvn test）。
 */
class UnionAmountTypeValidatorTest {

    private static final String CONN = "conn1";
    private static final String SQL =
            "SELECT order_id, amount FROM order_tab_a UNION SELECT order_id, amount FROM order_tab_b";

    /** 夹具：pool mock + metaData mock（getColumns 可 stub）。 */
    private static final class Fixture {
        ConnectionPoolManager pool;
        DatabaseMetaData md;
    }

    private Fixture fixture() throws SQLException {
        Fixture f = new Fixture();
        f.pool = mock(ConnectionPoolManager.class);
        DataSource ds = mock(DataSource.class);
        Connection conn = mock(Connection.class);
        f.md = mock(DatabaseMetaData.class);
        Mockito.when(f.pool.getDataSource(CONN)).thenReturn(ds);
        Mockito.when(ds.getConnection()).thenReturn(conn);
        Mockito.when(conn.getMetaData()).thenReturn(f.md);
        return f;
    }

    private void stubType(DatabaseMetaData md, String table, String col, String type) throws SQLException {
        ResultSet rs = mock(ResultSet.class);
        Mockito.when(rs.next()).thenReturn(true);
        Mockito.when(rs.getString("TYPE_NAME")).thenReturn(type);
        Mockito.when(md.getColumns(isNull(), isNull(), eq(table), eq(col))).thenReturn(rs);
    }

    @Test
    void exactDecimalVsIntegerRejected() throws Exception {
        Fixture f = fixture();
        stubType(f.md, "order_tab_a", "amount", "DECIMAL");
        stubType(f.md, "order_tab_b", "amount", "INT");
        BizException e = assertThrows(BizException.class, () -> UnionAmountTypeValidator.validate(f.pool, CONN, SQL));
        assertEquals(ErrorCode.V35_UNION_AMOUNT_TYPE.getCode(), e.getCode());
    }

    @Test
    void bothExactDecimalAccepted() throws Exception {
        Fixture f = fixture();
        stubType(f.md, "order_tab_a", "amount", "DECIMAL");
        stubType(f.md, "order_tab_b", "amount", "NUMERIC");
        assertDoesNotThrow(() -> UnionAmountTypeValidator.validate(f.pool, CONN, SQL));
    }

    @Test
    void bothIntegerAccepted() throws Exception {
        Fixture f = fixture();
        stubType(f.md, "order_tab_a", "order_id", "BIGINT");
        stubType(f.md, "order_tab_b", "order_id", "INT");
        stubType(f.md, "order_tab_a", "amount", "BIGINT");
        stubType(f.md, "order_tab_b", "amount", "INTEGER");
        assertDoesNotThrow(() -> UnionAmountTypeValidator.validate(f.pool, CONN, SQL));
    }

    @Test
    void nonNumericSideIgnored() throws Exception {
        Fixture f = fixture();
        stubType(f.md, "order_tab_a", "amount", "VARCHAR");
        stubType(f.md, "order_tab_b", "amount", "DECIMAL");
        assertDoesNotThrow(() -> UnionAmountTypeValidator.validate(f.pool, CONN, SQL));
    }

    @Test
    void columnNotFoundIgnored() throws Exception {
        Fixture f = fixture();
        stubType(f.md, "order_tab_a", "order_id", "BIGINT");
        stubType(f.md, "order_tab_b", "order_id", "BIGINT");
        // amount 两侧均查不到（rs.next=false）：放行
        ResultSet none = mock(ResultSet.class);
        Mockito.when(none.next()).thenReturn(false);
        Mockito.when(f.md.getColumns(isNull(), isNull(), eq("order_tab_a"), eq("amount"))).thenReturn(none);
        Mockito.when(f.md.getColumns(isNull(), isNull(), eq("order_tab_b"), eq("amount"))).thenReturn(none);
        assertDoesNotThrow(() -> UnionAmountTypeValidator.validate(f.pool, CONN, SQL));
    }

    @Test
    void connectionErrorIgnored() {
        ConnectionPoolManager pool = mock(ConnectionPoolManager.class);
        Mockito.when(pool.getDataSource(CONN)).thenThrow(new RuntimeException("conn down"));
        assertDoesNotThrow(() -> UnionAmountTypeValidator.validate(pool, CONN, SQL));
    }

    @Test
    void noUnionIgnored() {
        ConnectionPoolManager pool = mock(ConnectionPoolManager.class);
        assertDoesNotThrow(() -> UnionAmountTypeValidator.validate(pool, CONN, "SELECT * FROM t WHERE ts >= :p_start"));
        Mockito.verifyNoInteractions(pool);
    }

    @Test
    void blankConnCodeIgnored() {
        ConnectionPoolManager pool = mock(ConnectionPoolManager.class);
        assertDoesNotThrow(() -> UnionAmountTypeValidator.validate(pool, "", SQL));
        Mockito.verifyNoInteractions(pool);
    }
}
