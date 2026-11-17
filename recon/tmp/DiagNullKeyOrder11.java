import java.sql.*;
import java.util.Properties;

public class DiagNullKeyOrder11 {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            c.setAutoCommit(false);
            // 1. 僵尸 run 627（15:31 服务重启中断，仍在 running）置 failed
            int zombie = c.createStatement().executeUpdate(
                    "UPDATE recon_run SET status='failed', err_msg='interrupted by service restart at 15:31', finished_at=now() "
                            + "WHERE id=627 AND status='running'");
            System.out.println("zombie recon runs marked failed: " + zombie);
            // 2. 若有新鲜在跑对账则中止
            long running = 0;
            try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(
                    "SELECT count(*) FROM recon_run WHERE status='running'")) {
                if (rs.next()) running = rs.getLong(1);
            }
            if (running > 0) {
                System.out.println("ABORT: recon running=" + running);
                return;
            }
            System.out.println("running recon: " + running);
            // 2. before counts
            q(c, "SELECT count(*) AS anomaly_total FROM recon_detail WHERE diff_type='anomaly'");
            // 3. delete children
            int ref = c.createStatement().executeUpdate(
                    "DELETE FROM recon_detail_source_ref WHERE detail_id IN (SELECT id FROM recon_detail WHERE diff_type='anomaly')");
            int hist = c.createStatement().executeUpdate(
                    "DELETE FROM recon_diff_status_history WHERE detail_id IN (SELECT id FROM recon_detail WHERE diff_type='anomaly')");
            // 4. delete anomalies
            int del = c.createStatement().executeUpdate("DELETE FROM recon_detail WHERE diff_type='anomaly'");
            c.commit();
            System.out.println("deleted: source_ref=" + ref + " status_history=" + hist + " anomaly_diffs=" + del);
            // 5. after counts
            q(c, "SELECT diff_type,count(*) FROM recon_detail GROUP BY diff_type ORDER BY diff_type");
        }
    }
    static void q(Connection c, String sql) throws SQLException {
        System.out.println("--- " + sql.replaceAll("\\s+", " "));
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            ResultSetMetaData md = rs.getMetaData();
            int n = md.getColumnCount();
            while (rs.next()) {
                StringBuilder sb = new StringBuilder();
                for (int i = 1; i <= n; i++) {
                    if (i > 1) sb.append(" | ");
                    String v = rs.getString(i);
                    sb.append(md.getColumnName(i)).append("=").append(v);
                }
                System.out.println("  " + sb);
            }
        }
    }
}
