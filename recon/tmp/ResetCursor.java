import java.sql.*;
import java.util.Properties;

public class ResetCursor {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            String sql = "UPDATE recon_consume_cursor SET cursor_seq=0 WHERE scenario_code='zhg_order_integral'";
            try (Statement st = c.createStatement()) {
                int n = st.executeUpdate(sql);
                System.out.println("reset cursor rows = " + n);
            }
            q(c, "SELECT check_name, ds_code, cursor_seq FROM recon_consume_cursor WHERE scenario_code='zhg_order_integral' ORDER BY check_name, ds_code");
        }
    }
    static void q(Connection c, String sql) throws Exception {
        System.out.println("-- " + sql);
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            while (rs.next()) {
                System.out.println("  " + rs.getString(1) + " | " + rs.getString(2) + " | " + rs.getLong(3));
            }
        }
    }
}