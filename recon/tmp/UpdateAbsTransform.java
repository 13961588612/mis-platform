import java.sql.*;

public class UpdateAbsTransform {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        String user = "mis";
        String pass = "mis123";
        try (Connection c = DriverManager.getConnection(url, user, pass)) {
            String newRules = "[{\"name\": \"积分值\", \"is_amount\": false, \"left_field\": \"智慧购.int_num\", \"right_field\": \"积分流水.WCLJFBD\", \"compare_mode\": \"equal\", \"value_transform\": \"abs\"}]";
            try (PreparedStatement ps = c.prepareStatement(
                    "UPDATE recon_compare_rule SET rules_json = ?::jsonb WHERE scenario_code='zhg_order_integral'")) {
                ps.setString(1, newRules);
                int n = ps.executeUpdate();
                System.out.println("compare_rule updated=" + n);
            }
        }
    }
}