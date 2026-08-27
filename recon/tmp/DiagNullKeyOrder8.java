import java.sql.*;
import java.util.Properties;

public class DiagNullKeyOrder8 {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            System.out.println("== A. the specific old diff now ==");
            q(c, "SELECT id,check_name,diff_type,status,match_key_display,created_at,updated_at FROM recon_detail "
                    + "WHERE scenario_code='zhg_order_integral' AND match_key_display='__nullkey__:zhg_order:1783664787136418'");
            System.out.println("\n== B. stale nullkey diffs of 通用券对账 by status ==");
            q(c, "SELECT status,count(*) FROM recon_detail WHERE scenario_code='zhg_order_integral' "
                    + "AND check_name='通用券对账' AND diff_type='anomaly' AND match_key_display LIKE '__nullkey__:zhg_order:%' "
                    + "GROUP BY status");
            System.out.println("\n== C. 通用券对账 diff by type/status now ==");
            q(c, "SELECT diff_type,status,count(*) FROM recon_detail WHERE scenario_code='zhg_order_integral' AND check_name='通用券对账' "
                    + "GROUP BY diff_type,status ORDER BY diff_type,status");
            System.out.println("\n== D. the 2 records still without order_main ==");
            q(c, "SELECT record_key FROM recon_source_record WHERE ds_code='zhg_order' AND record_data::text NOT LIKE '%order_main%'");
        }
    }
    static void q(Connection c, String sql) throws SQLException {
        System.out.println("--- " + sql.replaceAll("\\s+", " "));
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            ResultSetMetaData md = rs.getMetaData();
            int n = md.getColumnCount();
            int rows = 0;
            while (rs.next() && rows < 20) {
                StringBuilder sb = new StringBuilder();
                for (int i = 1; i <= n; i++) {
                    if (i > 1) sb.append(" | ");
                    String v = rs.getString(i);
                    sb.append(md.getColumnName(i)).append("=").append(v == null ? "NULL" : v.length() > 200 ? v.substring(0, 200) : v);
                }
                System.out.println("  " + sb);
                rows++;
            }
            if (rows == 0) System.out.println("  (no rows)");
        }
    }
}
