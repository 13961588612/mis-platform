import java.sql.*;
import java.util.Properties;

public class DiagNullKeyOrder6 {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            System.out.println("== all non-idle sessions on recon db ==");
            q(c, "SELECT pid,state,wait_event_type,wait_event,now()-xact_start AS tx_age,now()-query_start AS q_age,"
                    + "left(query,200) AS query "
                    + "FROM pg_stat_activity WHERE datname='recon' AND state <> 'idle' AND pid <> pg_backend_pid() "
                    + "ORDER BY query_start LIMIT 20");
            System.out.println("\n== recon_detail count per check (all time) ==");
            q(c, "SELECT check_name,count(*) FROM recon_detail WHERE scenario_code='zhg_order_integral' GROUP BY check_name ORDER BY check_name");
            System.out.println("\n== matched_index rows for zhg_order_integral ==");
            q(c, "SELECT check_name,count(*) FROM recon_matched_index WHERE scenario_code='zhg_order_integral' GROUP BY check_name ORDER BY check_name");
            System.out.println("\n== run 628 elapsed ==");
            q(c, "SELECT id,status,now()-started_at AS elapsed FROM recon_run WHERE id=628");
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
                    sb.append(md.getColumnName(i)).append("=").append(v == null ? "NULL" : v.length() > 180 ? v.substring(0, 180) : v);
                }
                System.out.println("  " + sb);
                rows++;
            }
            if (rows == 0) System.out.println("  (no rows)");
        }
    }
}
