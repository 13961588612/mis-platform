import java.sql.*;
import java.util.Properties;

public class DiagNullKeyOrder10 {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            System.out.println("== A. match rule config_json now (empty_key_skip applied?) ==");
            q(c, "SELECT check_name,config_json,updated_at FROM recon_match_rule WHERE scenario_code='zhg_order_integral' ORDER BY check_name");
            System.out.println("\n== B. anomaly diff counts per check ==");
            q(c, "SELECT check_name,diff_type,status,count(*) FROM recon_detail WHERE diff_type='anomaly' GROUP BY check_name,diff_type,status ORDER BY check_name");
            System.out.println("\n== C. FK constraints referencing recon_detail ==");
            q(c, "SELECT tc.table_name AS child, rc.delete_rule FROM information_schema.table_constraints tc "
                    + "JOIN information_schema.referential_constraints rc ON tc.constraint_name=rc.constraint_name "
                    + "JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name=ccu.constraint_name "
                    + "WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_name='recon_detail'");
            System.out.println("\n== D. status history / source ref tables ==");
            q(c, "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN "
                    + "('recon_status_history','recon_detail_source_ref','recon_detail_anchor','recon_diff_pool')");
            System.out.println("\n== E. recon_status_history count for anomaly diffs ==");
            q(c, "SELECT count(*) FROM recon_status_history h WHERE EXISTS (SELECT 1 FROM recon_detail d WHERE d.id=h.detail_id AND d.diff_type='anomaly')");
            System.out.println("\n== F. source_ref count for anomaly diffs ==");
            q(c, "SELECT count(*) FROM recon_detail_source_ref r WHERE EXISTS (SELECT 1 FROM recon_detail d WHERE d.id=r.detail_id AND d.diff_type='anomaly')");
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
                    sb.append(md.getColumnName(i)).append("=").append(v == null ? "NULL" : v.length() > 120 ? v.substring(0, 120) : v);
                }
                System.out.println("  " + sb);
                rows++;
            }
            if (rows == 0) System.out.println("  (no rows)");
        }
    }
}
