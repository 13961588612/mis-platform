import java.sql.*;
import java.util.*;

public class CzkType3 {
    public static void main(String[] args) throws Exception {
        String czkUrl = "jdbc:oracle:thin:@10.254.16.211:1521:thdczk";
        String mysqlUrl = "jdbc:mysql://10.254.16.219:3306/huadi2?useUnicode=true&characterEncoding=UTF-8&serverTimezone=GMT%2B8&useSSL=false";

        try (Connection czk = DriverManager.getConnection(czkUrl, "bfcrm8", "DHHZDHHZ");
             Connection m = DriverManager.getConnection(mysqlUrl, "root", "mysql")) {

            // 1. ORIGIN_ID linkage: type=1 rows -> ORIGIN_ID -> type of origin row
            System.out.println("== type=1 ORIGIN_ID linkage (sample 5) ==");
            q(czk, "SELECT a.id, a.tran_id, a.amount, a.origin_id, b.type AS origin_type, b.amount AS origin_amount, b.is_cancel AS origin_cancel " +
                 "FROM ELEC_CASH_CARD_RECORD a LEFT JOIN ELEC_CASH_CARD_RECORD b ON a.origin_id = b.id " +
                 "WHERE a.type = 1 AND a.app_id = 4 AND a.is_cancel = 0 AND ROWNUM <= 5", 60);

            // 2. full type distribution incl cancel, by type
            System.out.println("== all rows app_id=4 group by type/is_cancel ==");
            q(czk, "SELECT type, is_cancel, COUNT(*) FROM ELEC_CASH_CARD_RECORD WHERE app_id = 4 GROUP BY type, is_cancel ORDER BY 1,2", 60);

            // 3. Java-side join: flow tran_id vs huadi2 order(id)
            Map<Integer, List<int[]>> flowByType = new LinkedHashMap<>(); // type -> [tran_id, amount*100]
            try (Statement st = czk.createStatement(); ResultSet rs = st.executeQuery(
                    "SELECT tran_id, type, amount FROM ELEC_CASH_CARD_RECORD WHERE app_id = 4 AND is_cancel = 0")) {
                while (rs.next()) {
                    int type = rs.getInt(2);
                    flowByType.computeIfAbsent(type, k -> new ArrayList<>())
                              .add(new int[]{rs.getInt(1), (int) Math.round(rs.getDouble(3) * 100)});
                }
            }
            Set<Integer> allTran = new HashSet<>();
            flowByType.values().forEach(l -> l.forEach(a -> allTran.add(a[0])));
            if (allTran.isEmpty()) { System.out.println("no flow rows"); return; }

            String inSql = String.join(",", Collections.nCopies(Math.min(allTran.size(), 900), "?"));
            if (inSql.isEmpty()) return;
            Map<Integer, Boolean> orderCash = new HashMap<>(); // order.id -> cash_card>0
            List<Integer> ids = new ArrayList<>(allTran).subList(0, Math.min(allTran.size(), 900));
            try (PreparedStatement ps = m.prepareStatement(
                    "SELECT id, cash_card FROM `order` WHERE id IN (" + inSql + ")")) {
                for (int i = 0; i < ids.size(); i++) ps.setInt(i + 1, ids.get(i));
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) orderCash.put(rs.getInt(1), rs.getDouble(2) > 0);
                }
            }
            for (Map.Entry<Integer, List<int[]>> e : flowByType.entrySet()) {
                int hit = 0, miss = 0;
                int cashHit = 0;
                for (int[] a : e.getValue()) {
                    Boolean b = orderCash.get(a[0]);
                    if (b != null) { hit++; if (b) cashHit++; } else miss++;
                }
                System.out.println("type=" + e.getKey() + " rows=" + e.getValue().size()
                        + " orderHit=" + hit + " orderMiss=" + miss + " orderCash>0=" + cashHit);
            }
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
                    sb.append(md.getColumnName(i)).append("=").append(v == null ? "NULL" : v.length() > 60 ? v.substring(0, 60) : v);
                }
                System.out.println("  " + sb);
                rows++;
            }
            if (rows == 0) System.out.println("  (no rows)");
        }
    }
}
