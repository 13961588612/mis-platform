import java.sql.*;

public class InspectMysql {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:mysql://10.254.16.219:3306/huadi2?useUnicode=true&characterEncoding=UTF-8&serverTimezone=GMT%2B8&useSSL=false";
        try (Connection c = DriverManager.getConnection(url, "root", "")) {
            // 1. order 全列
            System.out.println("== order ALL columns ==");
            try (Statement st = c.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT COLUMN_NAME, DATA_TYPE, COLUMN_COMMENT FROM information_schema.COLUMNS " +
                     "WHERE TABLE_SCHEMA='huadi2' AND TABLE_NAME='order' ORDER BY ORDINAL_POSITION")) {
                StringBuilder sb = new StringBuilder();
                while (rs.next()) sb.append(rs.getString(1)).append("(").append(rs.getString(2)).append(") ");
                System.out.println("  " + sb);
            }
            // 2. 储值卡支付订单（cash_card>0）：trad_id 是否有值
            System.out.println("== order cash_card>0 stats ==");
            q(c, "SELECT COUNT(*) AS total, SUM(trad_id IS NOT NULL AND trad_id<>'') AS has_trad FROM `order` WHERE cash_card>0 AND pay_time>='2026-08-01'");
            System.out.println("== order cash_card>0 sample (trad_id, code) ==");
            q(c, "SELECT code, trad_id, cash_card, amount, pay_time FROM `order` WHERE cash_card>0 AND pay_time>='2026-08-01' ORDER BY pay_time DESC LIMIT 8");
            // 3. 储值卡流水 tran_id=146947 对应哪一行 order
            System.out.println("== order where id/other cols = 146947 ==");
            q(c, "SELECT code, id, trad_id, cash_card, amount, pay_time FROM `order` WHERE id=146947 OR trad_id=146947");
            // 4. 全局 trad_id 非空样例（看格式）
            System.out.println("== order trad_id not null sample ==");
            q(c, "SELECT code, trad_id, cash_card, amount, pay_time FROM `order` WHERE trad_id IS NOT NULL AND trad_id<>'' ORDER BY pay_time DESC LIMIT 5");
        }
    }

    static void q(Connection c, String sql) throws SQLException {
        System.out.println("--- " + sql);
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            ResultSetMetaData md = rs.getMetaData();
            int n = md.getColumnCount();
            int rows = 0;
            while (rs.next() && rows < 20) {
                StringBuilder sb = new StringBuilder();
                for (int i = 1; i <= n; i++) {
                    if (i > 1) sb.append(" | ");
                    String v = rs.getString(i);
                    sb.append(md.getColumnName(i)).append("=").append(v == null ? "NULL" : v);
                }
                System.out.println("  " + sb);
                rows++;
            }
            if (rows == 0) System.out.println("  (no rows)");
        }
    }
}
