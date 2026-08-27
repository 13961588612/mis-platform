import java.sql.*;
import java.util.Properties;

public class DiagNullKeyOrder7 {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            System.out.println("== A. zhg_order with/without order_main now ==");
            q(c, "SELECT (record_data::text LIKE '%order_main%') AS has_om, COUNT(*) FROM recon_source_record "
                    + "WHERE ds_code='zhg_order' GROUP BY 1");
            System.out.println("\n== B. the specific order record now ==");
            q(c, "SELECT record_key,record_data FROM recon_source_record WHERE ds_code='zhg_order' AND record_key='1783664787136418'");
            System.out.println("\n== C. pull 2474 status (interrupted?) ==");
            q(c, "SELECT id,ds_code,status,window_start,window_end,row_count,started_at,finished_at FROM recon_pull_run WHERE id=2474");
            System.out.println("\n== D. latest zhg_order pull runs ==");
            q(c, "SELECT id,status,window_start,window_end,row_count,update_count,started_at,finished_at "
                    + "FROM recon_pull_run WHERE ds_code='zhg_order' ORDER BY id DESC LIMIT 5");
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
                    sb.append(md.getColumnName(i)).append("=").append(v == null ? "NULL" : v.length() > 1500 ? v.substring(0, 1500) : v);
                }
                System.out.println("  " + sb);
                rows++;
            }
            if (rows == 0) System.out.println("  (no rows)");
        }
    }
}
