import java.sql.*;
import java.util.*;

public class CzkType6 {
    public static void main(String[] args) throws Exception {
        String czkUrl = "jdbc:oracle:thin:@10.254.16.211:1521:thdczk";
        String mysqlUrl = "jdbc:mysql://10.254.16.219:3306/huadi2?useUnicode=true&characterEncoding=UTF-8&serverTimezone=GMT%2B8&useSSL=false";

        try (Connection czk = DriverManager.getConnection(czkUrl, "bfcrm8", "DHHZDHHZ");
             Connection m = DriverManager.getConnection(mysqlUrl, "root", "mysql")) {

            // flow type=0: order_no set?
            System.out.println("== type=0 flow ORDER_NO stats ==");
            q(czk, "SELECT COUNT(*), SUM(CASE WHEN ORDER_NO IS NOT NULL AND LENGTH(TRIM(ORDER_NO)) > 0 THEN 1 ELSE 0 END) FROM ELEC_CASH_CARD_RECORD WHERE type = 0 AND is_cancel = 0 AND app_id = 4", 60);
            System.out.println("== type=0 flow sample (id, tran_id, order_no, amount, create_time) recent ==");
            q(czk, "SELECT id, tran_id, order_no, amount, create_time FROM ELEC_CASH_CARD_RECORD WHERE type = 0 AND is_cancel = 0 AND app_id = 4 ORDER BY create_time DESC", 40);

            // orders cash_card>0 sample codes
            System.out.println("== order cash_card>0 (2026) sample code/trad_id/cash_card ==");
            q(m, "SELECT code, trad_id, cash_card, amount, pay_time FROM `order` WHERE cash_card>0 AND pay_time >= '2026-08-01' ORDER BY pay_time DESC LIMIT 10", 60);
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
                    sb.append(md.getColumnName(i)).append("=").append(v == null ? "NULL" : v);
                }
                System.out.println("  " + sb);
                rows++;
            }
            if (rows == 0) System.out.println("  (no rows)");
        }
    }
}
