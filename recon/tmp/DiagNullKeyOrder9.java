import java.sql.*;
import java.util.Properties;

public class DiagNullKeyOrder9 {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            System.out.println("== A. match rules of zhg_order_integral (incl config_json) ==");
            q(c, "SELECT check_name,strategy,key_fields_json,config_json FROM recon_match_rule "
                    + "WHERE scenario_code='zhg_order_integral' ORDER BY check_name");
            System.out.println("\n== B. recon_match_rule columns ==");
            DatabaseMetaData md = c.getMetaData();
            try (ResultSet rs = md.getColumns(null, null, "recon_match_rule", null)) {
                while (rs.next()) System.out.println("  " + rs.getString("COLUMN_NAME"));
            }
            System.out.println("\n== C. consume config of 储值卡金额核对 ==");
            q(c, "SELECT check_name,consume_json FROM recon_check WHERE scenario_code='zhg_order_integral' AND check_name='储值卡金额核对'");
        }
    }
    static void q(Connection c, String sql) throws SQLException {
        System.out.println("--- " + sql.replaceAll("\\s+", " "));
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            ResultSetMetaData md = rs.getMetaData();
            int n = md.getColumnCount();
            int rows = 0;
            while (rs.next() && rows < 20) {
                StringBuilder sb = new StringBuilder();
                for (int i = 1; i <= n; i++) {
                    if (i > 1) sb.append(" | ");
                    String v = rs.getString(i);
                    sb.append(md.getColumnName(i)).append("=").append(v == null ? "NULL" : v.length() > 2000 ? v.substring(0, 2000) : v);
                }
                System.out.println("  " + sb);
                rows++;
            }
            if (rows == 0) System.out.println("  (no rows)");
        }
    }
}
