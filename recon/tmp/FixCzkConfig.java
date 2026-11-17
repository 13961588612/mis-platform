import java.sql.*;
import java.util.Properties;

public class FixCzkConfig {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            System.out.println("=== BEFORE match_rule ===");
            q(c, "SELECT check_name, strategy, datasets_json, key_fields_json, config_json FROM recon_match_rule WHERE scenario_code='zhg_order_integral' AND check_name='储值卡金额核对'");
            System.out.println("=== BEFORE compare_rule ===");
            q(c, "SELECT check_name, rules_json FROM recon_compare_rule WHERE scenario_code='zhg_order_integral' AND check_name='储值卡金额核对'");

            // 1) match_rule：右侧匹配键字段名改大写（Oracle 源列）；config_json 开空键跳过（左侧非储值卡订单 trad_id 空 → 跳过不产 anomaly）
            String newKeyFields = "{\"智慧购\": \"{trad_id}\", \"zhg_czk_order_flow\": \"{TRAN_ID}\"}";
            String newConfig = "{\"empty_key_skip\": true}";
            // 2) compare_rule：右侧字段名改大写；金额同元数值比较（零容差，容忍 180.00 vs 180 格式差）
            String newRules = "[{\"name\": \"储值卡\", \"is_amount\": false, \"left_field\": \"智慧购.cash_card\", \"right_field\": \"zhg_czk_order_flow.AMOUNT\", \"compare_mode\": \"equal\", \"tolerance\": {\"type\": \"absolute\", \"value\": 0}}]";

            int n1;
            try (PreparedStatement ps = c.prepareStatement(
                    "UPDATE recon_match_rule SET key_fields_json=?::jsonb, config_json=?::jsonb WHERE scenario_code='zhg_order_integral' AND check_name='储值卡金额核对'")) {
                ps.setString(1, newKeyFields);
                ps.setString(2, newConfig);
                n1 = ps.executeUpdate();
            }
            int n2;
            try (PreparedStatement ps = c.prepareStatement(
                    "UPDATE recon_compare_rule SET rules_json=?::jsonb WHERE scenario_code='zhg_order_integral' AND check_name='储值卡金额核对'")) {
                ps.setString(1, newRules);
                n2 = ps.executeUpdate();
            }
            System.out.println("match_rule updated=" + n1 + ", compare_rule updated=" + n2);

            System.out.println("=== AFTER match_rule ===");
            q(c, "SELECT check_name, strategy, datasets_json, key_fields_json, config_json FROM recon_match_rule WHERE scenario_code='zhg_order_integral' AND check_name='储值卡金额核对'");
            System.out.println("=== AFTER compare_rule ===");
            q(c, "SELECT check_name, rules_json FROM recon_compare_rule WHERE scenario_code='zhg_order_integral' AND check_name='储值卡金额核对'");
        }
    }
    static void q(Connection c, String sql) throws SQLException {
        System.out.println("--- " + sql);
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            ResultSetMetaData md = rs.getMetaData();
            int n = md.getColumnCount();
            int rows = 0;
            while (rs.next() && rows < 10) {
                StringBuilder sb = new StringBuilder();
                for (int i = 1; i <= n; i++) {
                    if (i > 1) sb.append(" | ");
                    String v = rs.getString(i);
                    sb.append(md.getColumnName(i)).append("=").append(v == null ? "NULL" : (v.length() > 500 ? v.substring(0, 500) : v));
                }
                System.out.println("  " + sb);
                rows++;
            }
            if (rows == 0) System.out.println("  (no rows)");
        }
    }
}