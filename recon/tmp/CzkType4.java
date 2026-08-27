import java.sql.*;
import java.util.*;

public class CzkType4 {
    public static void main(String[] args) throws Exception {
        String czkUrl = "jdbc:oracle:thin:@10.254.16.211:1521:thdczk";
        String mysqlUrl = "jdbc:mysql://10.254.16.219:3306/huadi2?useUnicode=true&characterEncoding=UTF-8&serverTimezone=GMT%2B8&useSSL=false";

        try (Connection czk = DriverManager.getConnection(czkUrl, "bfcrm8", "DHHZDHHZ");
             Connection m = DriverManager.getConnection(mysqlUrl, "root", "mysql")) {

            // type=0 消费流水（当前 SQL 口径）
            Map<Integer, Double> flow0 = new LinkedHashMap<>(); // tran_id -> amount
            try (Statement st = czk.createStatement(); ResultSet rs = st.executeQuery(
                    "SELECT tran_id, amount FROM ELEC_CASH_CARD_RECORD WHERE type = 0 AND is_cancel = 0 AND app_id = 4")) {
                while (rs.next()) flow0.put(rs.getInt(1), rs.getDouble(2));
            }
            System.out.println("== type=0 flow rows = " + flow0.size());

            // 关联到 huadi2 order：按 id 或 trad_id
            String inSql = String.join(",", Collections.nCopies(flow0.size(), "?"));
            Map<Integer, Boolean> byId = new HashMap<>();   // order.id -> cash_card>0
            Map<Integer, Boolean> byTrad = new HashMap<>(); // order.trad_id -> cash_card>0
            List<Integer> ids = new ArrayList<>(flow0.keySet());
            try (PreparedStatement ps = m.prepareStatement(
                    "SELECT id, trad_id, cash_card FROM `order` WHERE id IN (" + inSql + ") OR trad_id IN (" + inSql + ")")) {
                for (int i = 0; i < ids.size(); i++) { ps.setInt(i + 1, ids.get(i)); ps.setInt(i + 1 + ids.size(), ids.get(i)); }
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) {
                        int id = rs.getInt(1);
                        String trad = rs.getString(2);
                        boolean cash = rs.getDouble(3) > 0;
                        byId.put(id, cash);
                        if (trad != null && !trad.trim().isEmpty()) {
                            try { byTrad.put(Integer.parseInt(trad.trim()), cash); }
                            catch (NumberFormatException ignore) {}
                        }
                    }
                }
            }
            int hitById = 0, hitByIdCash = 0, hitByTrad = 0, hitByTradCash = 0, miss = 0;
            for (int t : flow0.keySet()) {
                Boolean b1 = byId.get(t);
                if (b1 != null) { hitById++; if (b1) hitByIdCash++; }
                Boolean b2 = byTrad.get(t);
                if (b2 != null) { hitByTrad++; if (b2) hitByTradCash++; }
                if (b1 == null && b2 == null) miss++;
            }
            System.out.println("link by order.id:     hit=" + hitById + " cash>0=" + hitByIdCash);
            System.out.println("link by order.trad_id: hit=" + hitByTrad + " cash>0=" + hitByTradCash);
            System.out.println("no order found: " + miss);

            // 订单侧：cash_card>0 的订单有多少、trad_id 分布
            System.out.println("== order cash_card>0 total & has trad_id (2026) ==");
            q(m, "SELECT COUNT(*), SUM(trad_id IS NOT NULL AND trad_id<>'' ) FROM `order` WHERE cash_card>0 AND pay_time >= '2026-01-01'", 60);
            System.out.println("== order cash_card>0 且 trad_id 在 type=0 流水中的数量 ==");
            q(m, "SELECT COUNT(*) FROM `order` o WHERE o.cash_card>0 AND o.pay_time >= '2026-01-01' " +
                 "AND o.trad_id IN (SELECT DISTINCT tran_id FROM `order`) ", 60);
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
