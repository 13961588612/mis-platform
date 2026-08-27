import java.sql.*;
import java.util.Properties;

public class DiagNullKeyOrder19 {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            System.out.println("== stale unmatched diffs (identity already in matched_index) ==");
            q(c, "SELECT d.id,d.check_name,d.diff_type,d.status,d.match_key_display,d.created_at,d.updated_at "
                    + "FROM recon_detail d "
                    + "WHERE d.diff_type IN ('unmatched_left','unmatched_right') AND d.status IN ('pending','confirmed') "
                    + "AND EXISTS (SELECT 1 FROM recon_matched_index mi "
                    + "  WHERE mi.scenario_code=d.scenario_code AND mi.check_name=d.check_name "
                    + "  AND mi.pair_segment=d.pair_segment AND mi.match_key_hash=d.match_key_hash) "
                    + "ORDER BY d.check_name,d.id");
            System.out.println("\n== counts by check ==");
            q(c, "SELECT d.check_name,d.diff_type,count(*) "
                    + "FROM recon_detail d "
                    + "WHERE d.diff_type IN ('unmatched_left','unmatched_right') AND d.status IN ('pending','confirmed') "
                    + "AND EXISTS (SELECT 1 FROM recon_matched_index mi "
                    + "  WHERE mi.scenario_code=d.scenario_code AND mi.check_name=d.check_name "
                    + "  AND mi.pair_segment=d.pair_segment AND mi.match_key_hash=d.match_key_hash) "
                    + "GROUP BY d.check_name,d.diff_type ORDER BY d.check_name,d.diff_type");
        }
    }
    static void q(Connection c, String sql) throws SQLException {
        System.out.println("--- " + sql.replaceAll("\\s+", " "));
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            ResultSetMetaData md = rs.getMetaData();
            int n = md.getColumnCount();
            int rows = 0;
            while (rs.next() && rows < 100) {
                StringBuilder sb = new StringBuilder();
                for (int i = 1; i <= n; i++) {
                    if (i > 1) sb.append(" | ");
                    String v = rs.getString(i);
                    sb.append(md.getColumnName(i)).append("=").append(v == null ? "NULL" : v.length() > 90 ? v.substring(0, 90) : v);
                }
                System.out.println("  " + sb);
                rows++;
            }
            if (rows == 0) System.out.println("  (no rows)");
            else System.out.println("  (" + rows + " rows shown)");
        }
    }
}
