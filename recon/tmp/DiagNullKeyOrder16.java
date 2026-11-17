import java.sql.*;
import java.util.Properties;

public class DiagNullKeyOrder16 {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            System.out.println("== A. recon_diff_status_history columns ==");
            DatabaseMetaData md = c.getMetaData();
            try (ResultSet rs = md.getColumns(null, null, "recon_diff_status_history", null)) {
                while (rs.next()) System.out.println("  " + rs.getString("COLUMN_NAME"));
            }
            System.out.println("\n== B. status history for detail 1355895 ==");
            q(c, "SELECT * FROM recon_diff_status_history WHERE detail_id=1355895 ORDER BY created_at");
            System.out.println("\n== C. matched_index for 通用券对账 ==");
            q(c, "SELECT match_key_display,ds_code,record_key,record_time FROM recon_matched_index "
                    + "WHERE scenario_code='zhg_order_integral' AND check_name='通用券对账' ORDER BY record_key LIMIT 20");
            System.out.println("\n== D. matched_index count ==");
            q(c, "SELECT count(*) FROM recon_matched_index WHERE scenario_code='zhg_order_integral' AND check_name='通用券对账'");
            System.out.println("\n== E. 通用券对账 diffs now (both sides) ==");
            q(c, "SELECT d.id,d.diff_type,d.status,d.match_key_display,r.side,r.ds_code,r.record_key "
                    + "FROM recon_detail d JOIN recon_detail_source_ref r ON r.detail_id=d.id "
                    + "WHERE d.scenario_code='zhg_order_integral' AND d.check_name='通用券对账' ORDER BY d.id");
        }
    }
    static void q(Connection c, String sql) throws SQLException {
        System.out.println("--- " + sql.replaceAll("\\s+", " "));
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            ResultSetMetaData md = rs.getMetaData();
            int n = md.getColumnCount();
            int rows = 0;
            while (rs.next() && rows < 40) {
                StringBuilder sb = new StringBuilder();
                for (int i = 1; i <= n; i++) {
                    if (i > 1) sb.append(" | ");
                    String v = rs.getString(i);
                    sb.append(md.getColumnName(i)).append("=").append(v == null ? "NULL" : v.length() > 150 ? v.substring(0, 150) : v);
                }
                System.out.println("  " + sb);
                rows++;
            }
            if (rows == 0) System.out.println("  (no rows)");
        }
    }
}
