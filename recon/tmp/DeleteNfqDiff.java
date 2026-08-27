import java.sql.*;
import java.util.Properties;

public class DeleteNfqDiff {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            String sql = "DELETE FROM recon_detail WHERE scenario_code='zhg_order_integral' "
                    + "AND check_name='年返券金额核对' AND match_key_display='1786673845918822'";
            try (Statement st = c.createStatement()) {
                System.out.println("deleted = " + st.executeUpdate(sql));
            }
            q(c, "SELECT check_name, diff_type, status, count(*) FROM recon_detail WHERE scenario_code='zhg_order_integral' "
                    + "GROUP BY check_name, diff_type, status ORDER BY check_name, diff_type");
        }
    }
    static void q(Connection c, String sql) throws Exception {
        System.out.println("-- " + sql);
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            while (rs.next()) {
                System.out.println("  " + rs.getString(1) + " | " + rs.getString(2) + " | " + rs.getString(3) + " | " + rs.getInt(4));
            }
        }
    }
}