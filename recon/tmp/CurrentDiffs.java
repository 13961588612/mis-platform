import java.sql.*;
import java.util.Properties;

public class CurrentDiffs {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            q(c, "SELECT check_name, diff_type, status, count(*) FROM recon_detail WHERE scenario_code='zhg_order_integral' "
                    + "GROUP BY check_name, diff_type, status ORDER BY check_name, diff_type, status");
            q(c, "SELECT id, check_name, diff_type, status, match_key_display, diff_desc, reported_at, resolved_at "
                    + "FROM recon_detail WHERE scenario_code='zhg_order_integral' ORDER BY id DESC LIMIT 10");
        }
    }
    static void q(Connection c, String sql) throws Exception {
        System.out.println("-- " + sql);
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            ResultSetMetaData m = rs.getMetaData();
            int n = m.getColumnCount();
            while (rs.next()) {
                StringBuilder sb = new StringBuilder();
                for (int i = 1; i <= n; i++) {
                    if (i > 1) sb.append(" | ");
                    String v = rs.getString(i);
                    sb.append(m.getColumnName(i)).append("=").append(v == null ? "NULL" : v);
                }
                System.out.println("  " + sb);
            }
        }
    }
}