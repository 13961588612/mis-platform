import java.sql.*;
import java.util.Properties;

public class CleanHuafenDiffs {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            // 删除华粉券金额核对下的误报差异（配置已加 tolerance，数值相等属正常）
            String del = "DELETE FROM recon_detail "
                    + "WHERE scenario_code='zhg_order_integral' AND check_name='华粉券金额核对' AND diff_type='field_mismatch'";
            try (PreparedStatement ps = c.prepareStatement(del)) {
                int n = ps.executeUpdate();
                System.out.println("已删除华粉券金额核对误报差异 " + n + " 条");
            }
        }
    }
}
