import java.sql.*;
import java.util.Properties;

public class CleanCzkNullDiffs {
    public static void main(String[] args) throws Exception {
        // recon 库 PG（与之前脚本同库同用户）
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            // 1. 先查：该 check 下空键异常数量（确认后删）
            String countSql = "SELECT COUNT(*) FROM recon_detail WHERE scenario_code='zhg_order_integral' AND check_name='储值卡金额核对' AND match_key_display LIKE '__nullkey__%'";
            try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(countSql)) {
                rs.next();
                System.out.println("旧空键异常条数=" + rs.getLong(1));
            }
            // 2. 删除该 check 下所有历史空键异常（重建时新逻辑不再产生）
            String delSql = "DELETE FROM recon_detail WHERE scenario_code='zhg_order_integral' AND check_name='储值卡金额核对' AND match_key_display LIKE '__nullkey__%'";
            try (PreparedStatement ps = c.prepareStatement(delSql)) {
                int n = ps.executeUpdate();
                System.out.println("已清理空键异常=" + n);
            }
            // 3. 顺带确认：非空键（unmatched 等）保留
            String checkSql = "SELECT COUNT(*) FROM recon_detail WHERE scenario_code='zhg_order_integral' AND check_name='储值卡金额核对'";
            try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(checkSql)) {
                rs.next();
                System.out.println("该 check 剩余差异=" + rs.getLong(1));
            }
        }
    }
}