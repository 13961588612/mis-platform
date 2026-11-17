import java.sql.*;
import java.util.Properties;

public class ShowHuafenDiff {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            String sql = "SELECT scenario_code, check_name, rules_json::text FROM recon_compare_rule "
                    + "WHERE check_name IN ('华粉券金额核对','年返券金额核对') ORDER BY check_name";
            try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
                while (rs.next()) {
                    System.out.println("========== " + rs.getString(1) + "." + rs.getString(2) + " ==========");
                    System.out.println(rs.getString(3));
                    System.out.println();
                }
            }
        }
    }
}
