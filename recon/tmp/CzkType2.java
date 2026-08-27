import java.sql.*;

public class CzkType2 {
    public static void main(String[] args) throws Exception {
        String czkUrl = "jdbc:oracle:thin:@10.254.16.211:1521:thdczk";
        String mysqlUrl = "jdbc:mysql://10.254.16.219:3306/huadi2?useUnicode=true&characterEncoding=UTF-8&serverTimezone=GMT%2B8&useSSL=false";

        try (Connection czk = DriverManager.getConnection(czkUrl, "bfcrm8", "DHHZDHHZ");
             Connection m = DriverManager.getConnection(mysqlUrl, "root", "mysql")) {

            System.out.println("== ELEC_CASH_CARD_RECORD columns ==");
            q(czk, "SELECT column_name, data_type, data_length FROM user_tab_columns WHERE table_name='ELEC_CASH_CARD_RECORD' ORDER BY column_id", 60);

            System.out.println("== type=0 full row (1) ==");
            q(czk, "SELECT * FROM ELEC_CASH_CARD_RECORD WHERE type = 0 AND is_cancel = 0 AND app_id = 4 AND ROWNUM <= 1", 60);
            System.out.println("== type=1 full row (1) ==");
            q(czk, "SELECT * FROM ELEC_CASH_CARD_RECORD WHERE type = 1 AND is_cancel = 0 AND app_id = 4 AND ROWNUM <= 1", 60);

            System.out.println("== huadi2 order count cash_card>0 ==");
            q(m, "SELECT COUNT(*) FROM `order` WHERE cash_card>0", 60);
            System.out.println("== huadi2 order with trad_id in flow (type0/type1 vs cash_card) ==");
            q(m, "SELECT CASE WHEN o.cash_card>0 THEN 'cash>0' ELSE 'cash<=0' END tag, COUNT(*) FROM `order` o " +
                 "WHERE o.id IN (SELECT TRAN_ID FROM ELEC_CASH_CARD_RECORD) GROUP BY tag", 60);
            System.out.println("== flow type0/type1 with trad_id matched to order cash_card ==");
            q(m, "SELECT o.cash_card>0 AS order_has_cash, COUNT(*) FROM `order` o " +
                 "JOIN (SELECT DISTINCT TRAN_ID, TYPE FROM ELEC_CASH_CARD_RECORD) f ON o.id = f.TRAN_ID " +
                 "GROUP BY o.cash_card>0", 60);
        }
    }
    static void q(Connection c, String sql, int maxRows) throws SQLException {
        System.out.println("--- " + sql);
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            ResultSetMetaData md = rs.getMetaData();
            int n = md.getColumnCount();
            int rows = 0;
            while (rs.next() && rows < maxRows) {
                StringBuilder sb = new StringBuilder();
                for (int i = 1; i <= n; i++) {
                    if (i > 1) sb.append(" | ");
                    String v = rs.getString(i);
                    sb.append(md.getColumnName(i)).append("=").append(v == null ? "NULL" : v.length() > 80 ? v.substring(0, 80) : v);
                }
                System.out.println("  " + sb);
                rows++;
            }
            if (rows == 0) System.out.println("  (no rows)");
        }
    }
}
