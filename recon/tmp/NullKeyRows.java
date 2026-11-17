import java.sql.*;
import java.util.Properties;

public class NullKeyRows {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            q(c, "SELECT id, scenario_code, check_name, pair_segment, match_key_hash, match_key_display, "
                    + "diff_type, status, left_data_json, right_data_json, diff_desc, "
                    + "diff_amount_cent, diff_diagnosis_json, handle_status, first_seen_at, created_at "
                    + "FROM recon_detail WHERE match_key_display LIKE '__nullkey__:%' ORDER BY id DESC LIMIT 3");
        }
    }
    static void q(Connection c, String sql) throws Exception {
        System.out.println("-- " + sql);
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            ResultSetMetaData m = rs.getMetaData();
            int n = m.getColumnCount();
            while (rs.next()) {
                StringBuilder sb = new StringBuilder();
                for (int i = 1; i <= n; i++) {
                    if (i > 1) sb.append(" | ");
                    String v = rs.getString(i);
                    sb.append(m.getColumnName(i)).append("=").append(v == null ? "NULL" : v);
                }
                System.out.println("  " + sb);
            }
        }
    }
}