import java.sql.*;
import java.util.Properties;

public class ProbeNullKey {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            q(c, "SELECT d.scenario_code, d.check_name, d.diff_type, d.match_key_display, d.amount_left, d.amount_right "
                    + "FROM recon_detail d "
                    + "WHERE d.diff_type IN ('unmatched_left','unmatched_right','field_mismatch') "
                    + "  AND d.match_key_display LIKE '__nullkey__:%' "
                    + "ORDER BY d.id DESC LIMIT 5");
            System.out.println("-- 近5条空键差异 --");
            q(c, "SELECT id, scenario_code, check_name, diff_type, match_key_hash, left_value, right_value, row_hash "
                    + "FROM recon_detail "
                    + "WHERE MATCH_KEY_DISPLAY LIKE '__NULLKEY__:%' "
                    + "ORDER BY id DESC LIMIT 5");
            System.out.println("-- 该场景全部差异统计 --");
            q(c, "SELECT diff_type, COUNT(*) FROM recon_detail WHERE scenario_code='zhg_order_integral' GROUP BY diff_type ORDER BY 2 DESC");
        }
    }
    static void q(Connection c, String sql) throws Exception {
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            System.out.println("  " + sql);
            while (rs.next()) {
                int n = rs.getMetaData().getColumnCount();
                StringBuilder sb = new StringBuilder();
                for (int i = 1; i <= n; i++) {
                    if (i > 1) sb.append(" | ");
                    String v = rs.getString(i);
                    sb.append(rs.getMetaData().getColumnName(i)).append("=").append(v == null ? "NULL" : (v.length() > 100 ? v.substring(0, 100) : v));
                }
                System.out.println("    " + sb);
            }
        }
    }
}