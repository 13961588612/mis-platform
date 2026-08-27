import java.sql.*;
import java.util.Properties;

public class DiffByCheck {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            q(c, "SELECT check_name, diff_type, count(*) FROM recon_detail "
                    + "WHERE scenario_code='zhg_order_integral' AND status='confirmed' "
                    + "GROUP BY check_name, diff_type ORDER BY check_name, diff_type");
            System.out.println("-- 年返券 diff 明细");
            q(c, "SELECT id, diff_type, match_key_display, left_data_json, right_data_json, diff_desc "
                    + "FROM recon_detail WHERE scenario_code='zhg_order_integral' AND check_name='年返券金额核对' ORDER BY id DESC LIMIT 5");
            System.out.println("-- 积分 diff 明细");
            q(c, "SELECT id, diff_type, match_key_display, left_data_json, right_data_json, diff_desc "
                    + "FROM recon_detail WHERE scenario_code='zhg_order_integral' AND check_name='积分对账' ORDER BY id DESC LIMIT 5");
            System.out.println("-- 储值卡 config");
            q(c, "SELECT check_name, config_json FROM recon_match_rule WHERE scenario_code='zhg_order_integral' ORDER BY check_name");
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