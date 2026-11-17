import java.sql.*;
import java.util.Properties;

public class DiagNullKeyOrder17 {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            System.out.println("== A. 1355895 handle_status / first_seen ==");
            q(c, "SELECT id,status,handle_status,first_seen_at,pending_at,confirmed_at,resolved_at "
                    + "FROM recon_detail WHERE id=1355895");
            System.out.println("\n== B. all resolve/reopen history events around 15:34-16:10 ==");
            q(c, "SELECT h.detail_id,h.from_value,h.to_value,h.reason,h.created_at,d.match_key_display "
                    + "FROM recon_diff_status_history h LEFT JOIN recon_detail d ON d.id=h.detail_id "
                    + "WHERE h.created_at BETWEEN '2026-08-21 15:34' AND '2026-08-21 16:10' "
                    + "AND h.reason IN ('matched','reopened') ORDER BY h.created_at LIMIT 30");
            System.out.println("\n== C. would-be pool rows for 通用券对账 flow side ==");
            q(c, "SELECT d.id,d.status,d.handle_status,d.first_seen_at,r.ds_code,r.record_key "
                    + "FROM recon_detail d JOIN recon_detail_source_ref r ON r.detail_id=d.id "
                    + "WHERE d.scenario_code='zhg_order_integral' AND d.check_name='通用券对账' "
                    + "AND r.ds_code='zhg_public_coupon_order_flow' AND d.status IN ('pending','confirmed') AND d.handle_status='unhandled'");
            System.out.println("\n== D. run 629-632 通用券对账 logs ==");
        }
        System.out.println("== D. run 629-632 通用券对账 logs (from file, separate) ==");
    }
    static void q(Connection c, String sql) throws SQLException {
        System.out.println("--- " + sql.replaceAll("\\s+", " "));
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            ResultSetMetaData md = rs.getMetaData();
            int n = md.getColumnCount();
            int rows = 0;
            while (rs.next() && rows < 30) {
                StringBuilder sb = new StringBuilder();
                for (int i = 1; i <= n; i++) {
                    if (i > 1) sb.append(" | ");
                    String v = rs.getString(i);
                    sb.append(md.getColumnName(i)).append("=").append(v == null ? "NULL" : v.length() > 130 ? v.substring(0, 130) : v);
                }
                System.out.println("  " + sb);
                rows++;
            }
            if (rows == 0) System.out.println("  (no rows)");
        }
    }
}
