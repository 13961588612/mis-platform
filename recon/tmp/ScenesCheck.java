import java.sql.*;
import java.util.Properties;

public class ScenesCheck {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            q(c, "SELECT scenario_code, COUNT(*) FROM recon_detail GROUP BY scenario_code");
            q(c, "SELECT scenario_code, COUNT(*) FROM recon_run GROUP BY scenario_code");
            q(c, "SELECT scenario_code, COUNT(*) FROM recon_check GROUP BY scenario_code");
        }
    }
    static void q(Connection c, String sql) throws Exception {
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            System.out.println("-- " + sql);
            while (rs.next()) System.out.println("  " + rs.getString(1) + " = " + rs.getString(2));
        }
    }
}