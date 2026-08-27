import java.sql.*;

public class InspectConnPwd {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        try (Connection c = DriverManager.getConnection(url, "mis", "mis123")) {
            try (Statement st = c.createStatement();
                 ResultSet rs = st.executeQuery("SELECT conn_code, username, password, type, jdbc_url FROM recon_connection")) {
                while (rs.next()) {
                    System.out.println(rs.getString(1) + " | " + rs.getString(2) + " | pwd=[" + rs.getString(3) + "] | " + rs.getString(4) + " | " + rs.getString(5));
                }
            }
        }
    }
}
