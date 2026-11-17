import java.sql.*;

public class InspectOrderFlow {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:mysql://10.254.16.219:3306/huadi2?useUnicode=true&characterEncoding=UTF-8&serverTimezone=GMT%2B8&useSSL=false";
        try (Connection c = DriverManager.getConnection(url, "root", "mysql")) {
            System.out.println("== order where trad_id not null & cash_card>0 sample ==");
            q(c, "SELECT code, id, trad_id, cash_card, amount, pay_time FROM `order` WHERE trad_id IS NOT NULL AND trad_id<>'' AND cash_card>0 ORDER BY pay_time DESC LIMIT 5");
            System.out.println("== direct: rows where id or trad_id = 146947 ==");
            q(c, "SELECT id, code, trad_id, cash_card, amount, pay_time FROM `order` WHERE id=146947 OR trad_id=146947");
            System.out.println("== any row whose trad_id looks like a flow id but order not cash_card ==");
            q(c, "SELECT id, code, trad_id, cash_card, amount, pay_time FROM `order` WHERE trad_id IS NOT NULL AND trad_id<>'' AND cash_card<=0 ORDER BY pay_time DESC LIMIT 5");
            System.out.println("== count order cash_card>0 total ==");
            q(c, "SELECT COUNT(*) FROM `order` WHERE cash_card>0");
        }
    }
    static void q(Connection c, String sql) throws SQLException {
        System.out.println("--- " + sql);
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            ResultSetMetaData md = rs.getMetaData();
            int n = md.getColumnCount();
            int rows = 0;
            while (rs.next() && rows < 25) {
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