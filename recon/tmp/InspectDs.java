import java.sql.*;

public class InspectDs {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        try (Connection c = DriverManager.getConnection(url, "mis", "mis123")) {
            q(c, "SELECT ds_code, name, conn_code, record_key_expression, time_field, fetch_config_json, fields_json, amount_fields_json FROM recon_datasource WHERE ds_code IN ('zhg_order','zhg_czk_order_flow','crm_zhg_integral_flow')");
            q(c, "SELECT conn_code, name, type, jdbc_url, username, db_timezone FROM recon_connection");
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
                    sb.append(md.getColumnName(i)).append("=").append(v == null ? "NULL" : v.length() > 1500 ? v.substring(0, 1500) : v);
                }
                System.out.println("  " + sb);
                rows++;
            }
            if (rows == 0) System.out.println("  (no rows)");
        }
    }
}
