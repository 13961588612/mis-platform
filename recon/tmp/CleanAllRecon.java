import java.sql.*;
import java.util.Properties;

public class CleanAllRecon {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            try (Statement st = c.createStatement()) {
                int d = st.executeUpdate("DELETE FROM recon_detail WHERE scenario_code='zhg_order_integral'");
                System.out.println("deleted diffs = " + d);
            }
            try (Statement st = c.createStatement()) {
                int r = st.executeUpdate("UPDATE recon_consume_cursor SET cursor_seq=0 WHERE scenario_code='zhg_order_integral'");
                System.out.println("reset cursor = " + r);
            }
        }
    }
}