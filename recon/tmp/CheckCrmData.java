import java.sql.*;

public class CheckCrmData {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        String user = "mis";
        String pass = "mis123";
        try (Connection c = DriverManager.getConnection(url, user, pass)) {
            try (Statement s = c.createStatement();
                 ResultSet rs = s.executeQuery(
                     "SELECT record_key, record_data FROM recon_source_record WHERE ds_code='crm_zhg_integral_flow' LIMIT 30")) {
                while (rs.next()) {
                    System.out.println("key=" + rs.getString(1) + " data=" + rs.getString(2));
                }
            }
            System.out.println("--- crm count ---");
            try (Statement s = c.createStatement();
                 ResultSet rs = s.executeQuery("SELECT count(*) FROM recon_source_record WHERE ds_code='crm_zhg_integral_flow'")) {
                rs.next();
                System.out.println(rs.getLong(1));
            }
            System.out.println("--- crm with null djh ---");
            try (Statement s = c.createStatement();
                 ResultSet rs = s.executeQuery(
                     "SELECT count(*) FROM recon_source_record WHERE ds_code='crm_zhg_integral_flow' AND (record_data->>'djh' IS NULL OR record_data->>'djh' = '')")) {
                rs.next();
                System.out.println(rs.getLong(1));
            }
        }
    }
}