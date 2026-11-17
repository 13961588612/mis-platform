import java.sql.*;
import java.util.Properties;

public class InspectRules {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            System.out.println("== recon_match_rule cols ==");
            DatabaseMetaData md = c.getMetaData();
            try (ResultSet rs = md.getColumns(null, null, "recon_match_rule", null)) {
                while (rs.next()) System.out.println("  " + rs.getString("COLUMN_NAME") + " : " + rs.getString("TYPE_NAME"));
            }
            System.out.println("== recon_compare_rule cols ==");
            try (ResultSet rs = md.getColumns(null, null, "recon_compare_rule", null)) {
                while (rs.next()) System.out.println("  " + rs.getString("COLUMN_NAME") + " : " + rs.getString("TYPE_NAME"));
            }
            System.out.println("\n== match_rule rows (zhg_order_integral) ==");
            q(c, "SELECT check_name, strategy, datasets_json, key_fields_json FROM recon_match_rule WHERE scenario_code='zhg_order_integral' ORDER BY check_name");
            System.out.println("\n== compare_rule rows (zhg_order_integral) ==");
            q(c, "SELECT check_name, rules_json FROM recon_compare_rule WHERE scenario_code='zhg_order_integral' ORDER BY check_name");
        }
    }
    static void q(Connection c, String sql) throws SQLException {
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