import java.sql.*;
import java.util.Properties;

public class FixFixConfigs {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            // 1) 储值卡 check：恢复 empty_key_skip
            try (PreparedStatement ps = c.prepareStatement(
                    "UPDATE recon_match_rule SET config_json=? WHERE scenario_code='zhg_order_integral' AND check_name='储值卡金额核对'")) {
                ps.setObject(1, "{\"empty_key_skip\": true}", java.sql.Types.OTHER);
                System.out.println("储值卡 config => " + ps.executeUpdate());
            }
            // 2) 年返券 compare rule：加 tolerance absolute 0（176.80 vs 176.8 数值相等）
            String rules = "[{\"name\":\"年返券\",\"is_amount\":false,\"left_field\":\"zhg_order.nfq_amount\","
                    + "\"right_field\":\"zhg_nfq_order_flow.amount\",\"compare_mode\":\"equal\",\"zero_unmatched_skip\":true,"
                    + "\"tolerance\":{\"type\":\"absolute\",\"value\":0}}]";
            try (PreparedStatement ps = c.prepareStatement(
                    "UPDATE recon_compare_rule SET rules_json=? WHERE scenario_code=? AND check_name='年返券金额核对'")) {
                ps.setObject(1, rules, java.sql.Types.OTHER);
                ps.setString(2, "zhg_order_integral");
                System.out.println("年返券 compare => " + ps.executeUpdate());
            }
            // 3) 删掉已确认的空键异常（储值卡 34 条）
            try (Statement st = c.createStatement()) {
                int n = st.executeUpdate("DELETE FROM recon_detail WHERE scenario_code='zhg_order_integral' "
                        + "AND diff_type='anomaly' AND match_key_display LIKE '__nullkey__:%'");
                System.out.println("deleted null-key diffs = " + n);
            }
            // 4) 重置游标触发全量
            try (Statement st = c.createStatement()) {
                System.out.println("reset cursor => " + st.executeUpdate(
                        "UPDATE recon_consume_cursor SET cursor_seq=0 WHERE scenario_code='zhg_order_integral'"));
            }
            // 校验
            q(c, "SELECT check_name, config_json FROM recon_match_rule WHERE scenario_code='zhg_order_integral' ORDER BY check_name");
            q(c, "SELECT check_name, rules_json FROM recon_compare_rule WHERE scenario_code='zhg_order_integral' ORDER BY check_name");
        }
    }

    static Connection cc;

    static java.sql.Statement qc(Connection c, String sql) { return null; }

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