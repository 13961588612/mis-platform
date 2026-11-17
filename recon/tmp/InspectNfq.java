import java.sql.*;
import java.util.Properties;

public class InspectNfq {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            System.out.println("== 年返券金额核对 match_rule ==");
            q(c, "SELECT check_name, strategy, datasets_json, key_fields_json, field_transform_json, multi_row_json, config_json FROM recon_match_rule WHERE scenario_code='zhg_order_integral'");
            System.out.println("== 年返券金额核对 compare_rule ==");
            q(c, "SELECT check_name, rules_json FROM recon_compare_rule WHERE scenario_code='zhg_order_integral'");
            System.out.println("== zhg_nfq_order_flow datasource ==");
            q(c, "SELECT ds_code, conn_code, record_key_expression, time_field, fetch_config_json FROM recon_datasource WHERE ds_code='zhg_nfq_order_flow'");
            System.out.println("== zhg_nfq_order_flow record sample ==");
            q(c, "SELECT record_key, record_data FROM recon_source_record WHERE ds_code='zhg_nfq_order_flow' ORDER BY update_seq DESC LIMIT 3");
            System.out.println("== 空键差异统计 ==");
            q(c, "SELECT check_name, COUNT(*) FROM recon_detail WHERE scenario_code='zhg_order_integral' AND match_key_display LIKE '__nullkey__%' GROUP BY check_name");
        }
    }
    static void q(Connection c, String sql) throws SQLException {
        System.out.println("--- " + sql);
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            ResultSetMetaData md = rs.getMetaData();
            int n = md.getColumnCount();
            int rows = 0;
            while (rs.next() && rows < 20) {
                StringBuilder sb = new StringBuilder();
                for (int i = 1; i <= n; i++) {
                    if (i > 1) sb.append(" | ");
                    String v = rs.getString(i);
                    sb.append(md.getColumnName(i)).append("=").append(v == null ? "NULL" : (v.length() > 600 ? v.substring(0, 600) : v));
                }
                System.out.println("  " + sb);
                rows++;
            }
            if (rows == 0) System.out.println("  (no rows)");
        }
    }
}