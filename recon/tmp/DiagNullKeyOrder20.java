import java.sql.*;
import java.util.Properties;

public class DiagNullKeyOrder20 {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            c.setAutoCommit(false);
            String sql = "UPDATE recon_detail SET status='resolved', resolved_at=now(), updated_at=now() "
                    + "WHERE id IN (1355895,1355896) AND status <> 'resolved'";
            int n = c.createStatement().executeUpdate(sql);
            System.out.println("resolved diffs: " + n);
            if (n > 0) {
                int h = c.createStatement().executeUpdate(
                        "INSERT INTO recon_diff_status_history (detail_id, field, from_value, to_value, reason, operator, created_at) "
                                + "SELECT id, 'status', status, 'resolved', 'matched_index_cleanup', 'manual', now() "
                                + "FROM recon_detail WHERE id IN (1355895,1355896) AND status='resolved'");
                System.out.println("history rows: " + h);
            }
            c.commit();
            // verify
            q(c, "SELECT id,status,resolved_at FROM recon_detail WHERE id IN (1355895,1355896)");
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
                    sb.append(md.getColumnName(i)).append("=").append(rs.getString(i));
                }
                System.out.println("  " + sb);
            }
        }
    }
}
