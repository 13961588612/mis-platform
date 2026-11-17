import java.sql.*;
import java.util.Properties;

public class NfqSource {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            q(c, "SELECT ds_code, count(*), min(update_seq), max(update_seq) FROM recon_source_record "
                    + "WHERE ds_code='zhg_nfq_order_flow' GROUP BY ds_code");
            q(c, "SELECT record_key, record_data FROM recon_source_record WHERE ds_code='zhg_nfq_order_flow' LIMIT 5");
            q(c, "SELECT id, scenario_code, check_name, diff_type, status, created_at, updated_at "
                    + "FROM recon_detail WHERE scenario_code='zhg_order_integral' ORDER BY id DESC LIMIT 6");
            q(c, "SELECT id, pull_run_id, recon_run_id, run_status, started_at, finished_at, stats_json "
                    + "FROM recon_run WHERE scenario_code='zhg_order_integral' ORDER BY id DESC LIMIT 5");
        }
    }
    static void q(Connection c, String sql) throws Exception {
        System.out.println("-- " + sql);
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            while (rs.next()) {
                StringBuilder sb = new StringBuilder();
                int n = rs.getMetaData().getColumnCount();
                for (int i = 1; i <= n; i++) {
                    if (i > 1) sb.append(" | ");
                    String v = rs.getString(i);
                    sb.append(rs.getMetaData().getColumnName(i)).append("=").append(v == null ? "NULL" : v);
                }
                System.out.println("  " + sb);
            }
        }
    }
}