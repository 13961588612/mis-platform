import java.sql.*;
import java.util.Properties;

public class UpdateMatchConfig {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            // 1) 年返券 key_fields 清理：左侧键用 code（智慧购订单号），右侧用 handle_no
            String keyFields = "{\"zhg_order\": \"{code}\", \"zhg_nfq_order_flow\": \"{handle_no}\"}";
            String datasets = "[\"zhg_order\", \"zhg_nfq_order_flow\"]";
            String config = "{\"empty_key_skip\": true}";
            try (PreparedStatement ps = c.prepareStatement(
                    "UPDATE recon_match_rule SET datasets_json=?, key_fields_json=?, field_transform_json=NULL, multi_row_json=NULL, config_json=? "
                            + "WHERE scenario_code=? AND check_name=?")) {
                // jsonb 类型显式 cast
                ps.setObject(1, datasets, java.sql.Types.OTHER);
                ps.setObject(2, keyFields, java.sql.Types.OTHER);
                ps.setObject(3, config, java.sql.Types.OTHER);
                ps.setString(4, "zhg_order_integral");
                ps.setString(5, "年返券金额核对");
                System.out.println("UPDATE => " + ps.executeUpdate());
            }
            // 查所有相关 match_rule 打印最终配置
            q(c, "SELECT scenario_code, check_name, strategy, datasets_json, key_fields_json, config_json FROM recon_match_rule WHERE scenario_code='zhg_order_integral' ORDER BY check_name");
        }
    }

    static void q(Connection c, String sql) throws Exception {
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