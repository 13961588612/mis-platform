import java.sql.*;
import java.util.Properties;

public class LatestStats {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            q(c, "SELECT id, scenario_code, check_name, diff_type, match_key_hash, match_key_display, "
                    + "left_data_json, right_data_json, diff_desc FROM recon_detail "
                    + "WHERE scenario_code = 'zhg_order_integral' ORDER BY id DESC LIMIT 6");
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