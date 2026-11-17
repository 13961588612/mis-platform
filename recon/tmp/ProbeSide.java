import java.sql.*;
import java.util.Properties;

public class ProbeSide {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            // 1) 右侧流水 HANDLE_NO=1786673845918822 来自哪个数据集？
            q(c, "SELECT id, scenario_code, check_name, ds_code, handle_no, amount, order_id, trans_id, create_time "
                    + "FROM recon_detail "
                    + "WHERE id = (SELECT MAX(id) FROM recon_detail WHERE right_data_json LIKE '%1786673845918822%')");
            q(c, "SELECT scenario_code, check_name, datasets_json, key_fields_json, config_json FROM recon_match_rule "
                    + "WHERE scenario_code='zhg_order_integral' ORDER BY check_name");
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