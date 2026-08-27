import java.sql.*;
import java.util.Properties;

public class InspectZhg {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            // 1. scenario
            System.out.println("== recon_scenario ==");
            q(c, "SELECT scenario_code,name,enabled FROM recon_scenario WHERE scenario_code='zhg_order_integral'");
            // 2. checks
            System.out.println("== recon_check ==");
            q(c, "SELECT check_name,seq_no,consume_json,run_mode,enabled FROM recon_check WHERE scenario_code='zhg_order_integral' ORDER BY seq_no");
            // 3. match rules
            System.out.println("== recon_match_rule ==");
            q(c, "SELECT check_name,strategy,datasets_json,key_fields_json,field_transform_json,multi_row_json FROM recon_match_rule WHERE scenario_code='zhg_order_integral' ORDER BY check_name");
            // 4. compare rules
            System.out.println("== recon_compare_rule ==");
            q(c, "SELECT check_name,rules_json FROM recon_compare_rule WHERE scenario_code='zhg_order_integral' ORDER BY check_name");
            // 5. diff stats
            System.out.println("== diff stats ==");
            q(c, "SELECT check_name,diff_type,status,count(*) FROM recon_detail WHERE scenario_code='zhg_order_integral' GROUP BY check_name,diff_type,status ORDER BY check_name,diff_type");
            // 6. nullkey samples
            System.out.println("== nullkey diff samples ==");
            q(c, "SELECT check_name,match_key_display,diff_type,left_data_json,right_data_json FROM recon_detail WHERE scenario_code='zhg_order_integral' AND match_key_display LIKE '__nullkey__%' LIMIT 5");
            // 7. ledger samples per ds used by this scenario
            System.out.println("== consume cursor ==");
            q(c, "SELECT check_name,ds_code,cursor_seq FROM recon_consume_cursor WHERE scenario_code='zhg_order_integral' ORDER BY check_name,ds_code");
            // 8. ledger counts for candidate ds
            System.out.println("== source record counts (zhg_order/zhg_czk_order_flow/crm_zhg_integral_flow) ==");
            q(c, "SELECT ds_code,count(*),min(update_seq),max(update_seq) FROM recon_source_record WHERE ds_code IN ('zhg_order','zhg_czk_order_flow','crm_zhg_integral_flow') GROUP BY ds_code");
            // 9. sample rows of zhg_czk_order_flow
            System.out.println("== zhg_czk_order_flow sample (3) ==");
            q(c, "SELECT record_key, record_data FROM recon_source_record WHERE ds_code='zhg_czk_order_flow' ORDER BY update_seq DESC LIMIT 3");
            // 10. sample rows of zhg_order (智慧购) & crm flow
            System.out.println("== zhg_order sample (3) ==");
            q(c, "SELECT record_key, record_data FROM recon_source_record WHERE ds_code='zhg_order' ORDER BY update_seq DESC LIMIT 3");
            System.out.println("== crm_zhg_integral_flow sample (3) ==");
            q(c, "SELECT record_key, record_data FROM recon_source_record WHERE ds_code='crm_zhg_integral_flow' ORDER BY update_seq DESC LIMIT 3");
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
                    sb.append(md.getColumnName(i)).append("=").append(v == null ? "NULL" : v.length() > 900 ? v.substring(0, 900) : v);
                }
                System.out.println("  " + sb);
                rows++;
            }
            if (rows == 0) System.out.println("  (no rows)");
            else System.out.println("  (" + rows + " rows shown)");
        }
    }
}
