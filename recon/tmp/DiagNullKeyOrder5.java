import java.sql.*;
import java.util.Properties;

public class DiagNullKeyOrder5 {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            System.out.println("== A. recon_run 628 status ==");
            q(c, "SELECT id,scenario_code,status,matched_count,diff_count,resolved_count,err_msg,started_at,finished_at FROM recon_run WHERE id=628");
            System.out.println("\n== B. recent recon_detail inserts (last 10 min) ==");
            q(c, "SELECT check_name,count(*) AS cnt,MAX(created_at) AS max_created FROM recon_detail "
                    + "WHERE scenario_code='zhg_order_integral' AND created_at >= now() - interval '10 minutes' "
                    + "GROUP BY check_name ORDER BY check_name");
            System.out.println("\n== C. recon_detail newest rows ==");
            q(c, "SELECT id,check_name,created_at FROM recon_detail WHERE scenario_code='zhg_order_integral' ORDER BY id DESC LIMIT 5");
            System.out.println("\n== D. active queries on recon_detail ==");
            q(c, "SELECT pid,state,wait_event_type,now()-query_start AS dur,left(query,120) AS query FROM pg_stat_activity "
                    + "WHERE query ILIKE '%recon_detail%' AND state <> 'idle' ORDER BY query_start LIMIT 10");
        }
    }
    static void q(Connection c, String sql) throws SQLException {
        System.out.println("--- " + sql.replaceAll("\\s+", " "));
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            ResultSetMetaData md = rs.getMetaData();
            int n = md.getColumnCount();
            int rows = 0;
            while (rs.next() && rows < 15) {
                StringBuilder sb = new StringBuilder();
                for (int i = 1; i <= n; i++) {
                    if (i > 1) sb.append(" | ");
                    String v = rs.getString(i);
                    sb.append(md.getColumnName(i)).append("=").append(v == null ? "NULL" : v.length() > 160 ? v.substring(0, 160) : v);
                }
                System.out.println("  " + sb);
                rows++;
            }
            if (rows == 0) System.out.println("  (no rows)");
        }
    }
}
