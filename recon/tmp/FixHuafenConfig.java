import java.sql.*;
import java.util.Properties;

public class FixHuafenConfig {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            // 1) 修复华粉券金额核对：加 tolerance absolute 0（与年返券一致，金额字符串 458.00 vs 458 走数值比较）
            String newRules = "[{\"name\": \"华粉券\", \"is_amount\": false, \"tolerance\": {\"type\": \"absolute\", \"value\": 0}, "
                    + "\"left_field\": \"zhg_order.welfare_amount\", \"right_field\": \"zhg_welfare_order_flow.amount\", "
                    + "\"compare_mode\": \"equal\", \"zero_unmatched_skip\": true}]";
            try (PreparedStatement ps = c.prepareStatement(
                    "UPDATE recon_compare_rule SET rules_json = ?::jsonb, updated_at = now() "
                            + "WHERE scenario_code='zhg_order_integral' AND check_name='华粉券金额核对'")) {
                ps.setString(1, newRules);
                int n = ps.executeUpdate();
                System.out.println("华粉券金额核对 updated=" + n);
            }

            // 2) 扫描所有 check 的 compare rule：无 tolerance 但字段名疑似金额的规则
            System.out.println("\n===== 疑似金额字段但无 tolerance 的规则（供排查） =====");
            String scan = "SELECT scenario_code, check_name, rules_json::text FROM recon_compare_rule ORDER BY scenario_code, check_name";
            try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(scan)) {
                while (rs.next()) {
                    String json = rs.getString(3);
                    if (json == null) continue;
                    // 粗扫：规则不含 tolerance，且字段引用名含 amount / _money / 金额 字样
                    boolean hasTol = json.contains("tolerance");
                    boolean amountish = json.contains("_amount") || json.contains("amount") || json.contains("金额");
                    if (!hasTol && amountish) {
                        System.out.println("  " + rs.getString(1) + "." + rs.getString(2) + " : " + json);
                    }
                }
            }
        }
    }
}
