import java.sql.*;
import java.util.Properties;

public class CleanOneDiff {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            // 1. 先按特征查出来
            String selSql = "SELECT id, match_key_display FROM recon_detail "
                    + "WHERE scenario_code='zhg_order_integral' AND check_name='储值卡金额核对' "
                    + "AND match_key_display='146794'";
            long foundId = -1;
            try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(selSql)) {
                while (rs.next()) {
                    long id = rs.getLong("id");
                    System.out.println("找到行: id=" + id
                            + " match_key_display=[" + rs.getString("match_key_display") + "]");
                    if (foundId < 0) foundId = id;
                }
            }
            if (foundId <= 0) {
                System.out.println("未找到该历史差异行，可能已被清理或 id 不同");
                return;
            }
            // 2. 按 id 精确删除
            try (PreparedStatement ps = c.prepareStatement("DELETE FROM recon_detail WHERE id=?")) {
                ps.setLong(1, foundId);
                int n = ps.executeUpdate();
                System.out.println("已删除 recon_detail id=" + foundId + "，删除行数=" + n);
            }
        }
    }
}