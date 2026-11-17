import java.sql.*;
import java.util.Properties;

public class DumpLeft {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            // 最新 detail，空键/仅右
            q(c, "SELECT id, scenario_code, check_name, diff_type, match_key_hash, match_key_display, left_data_json, right_data_json, diff_desc "
                    + "FROM recon_detail WHERE scenario_code='zhg_order_integral' ORDER BY id DESC LIMIT 8");
            System.out.println("== check consume ==");
            q(c, "SELECT check_name, consume_json FROM recon_check WHERE scenario_code='zhg_order_integral' ORDER BY seq_no");
            System.out.println("== match_rule ==");
            q(c, "SELECT check_name, strategy, datasets_json, key_fields_json, field_transform_json, multi_row_json, config_json "
                    + "FROM recon_match_rule WHERE scenario_code='zhg_order_integral' ORDER BY check_name");
            System.out.println("== compare_rule ==");
            q(c, "SELECT check_name, rules_json FROM recon_compare_rule WHERE scenario_code='zhg_order_integral' ORDER BY check_name");
        }
    }
    static void q(Connection c, String sql) throws Exception {
        System.out.println("-- " + sql);
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            ResultSetMetaData m = rs.getMetaData();
            int n = m.getColumnCount();
            int rows = 0;
            while (rs.next() && rows < 25) {
                StringBuilder sb = new StringBuilder();
                for (int i = 1; i <= n; i++) {
                    if (i > 1) sb.append(" | ");
                    String v = rs.getString(i);
                    sb.append(m.getColumnName(i)).append("=").append(v == null ? "NULL" : v.length() > 400 ? v.substring(0, 400) : v);
                }
                System.out.println("  " + sb);
                rows++;
            }
            if (rows == 0) System.out.println("  (0 rows)");
            else System.out.println("  (" + rows + " rows)");
        }
    }
}