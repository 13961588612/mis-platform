import java.sql.*;
import java.util.Properties;

public class CleanNullKeys {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            String sql = "DELETE FROM recon_detail WHERE scenario_code='zhg_order_integral' "
                    + "AND diff_type='anomaly' AND match_key_display LIKE '__nullkey__:%'";
            try (Statement st = c.createStatement()) {
                int n = st.executeUpdate(sql);
                System.out.println("deleted null-key diffs = " + n);
            }
        }
    }
}