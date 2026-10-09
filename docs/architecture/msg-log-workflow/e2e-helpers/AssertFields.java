import java.sql.*;
import java.util.*;

/**
 * 字段名一致性断言：DB form_data 的 key 集合 vs pur-form.tsx 的 PUR_FIELDS。
 * 用 Java 做集合比对，避免 shell 文本处理的脆弱性。
 */
public class AssertFields {
    // PUR_FIELDS 逐字摘自 frontend/mis-admin-web/src/features/biz/forms/forms/pur-form.tsx:63-72
    private static final List<String> EXPECTED = Arrays.asList(
            "orderNo", "supplier", "amount", "applyDate",
            "priority", "categories", "urgent", "reason");

    public static void main(String[] args) throws Exception {
        String url = "jdbc:postgresql://10.254.16.6:5432/mis_platform";
        boolean allOk = true;
        try (Connection c = DriverManager.getConnection(url, "mis", "mis123")) {
            System.out.println("期望 key（pur-form.tsx PUR_FIELDS，顺序即源码顺序）：");
            System.out.println("  " + String.join(", ", EXPECTED));
            System.out.println();

            for (long id : new long[]{960101, 960102, 960103, 960104}) {
                List<String> actual = new ArrayList<>();
                List<String> types = new ArrayList<>();
                try (PreparedStatement ps = c.prepareStatement(
                        "SELECT jsonb_object_keys(form_data)::text FROM wf_instance WHERE id=? ORDER BY 1")) {
                    ps.setLong(1, id);
                    try (ResultSet rs = ps.executeQuery()) {
                        while (rs.next()) actual.add(rs.getString(1));
                    }
                }
                try (PreparedStatement ps = c.prepareStatement(
                        "SELECT jsonb_typeof(form_data->'amount'), jsonb_typeof(form_data->'urgent'),"
                        + " jsonb_typeof(form_data->'categories'), jsonb_typeof(form_data->'applyDate')"
                        + " FROM wf_instance WHERE id=?")) {
                    ps.setLong(1, id);
                    try (ResultSet rs = ps.executeQuery()) {
                        if (rs.next()) {
                            types.add("amount=" + rs.getString(1));
                            types.add("urgent=" + rs.getString(2));
                            types.add("categories=" + rs.getString(3));
                            types.add("applyDate=" + rs.getString(4));
                        }
                    }
                }

                List<String> expSorted = new ArrayList<>(EXPECTED);
                Collections.sort(expSorted);
                List<String> actSorted = new ArrayList<>(actual);
                Collections.sort(actSorted);

                List<String> missing = new ArrayList<>(expSorted);
                missing.removeAll(actSorted);
                List<String> extra = new ArrayList<>(actSorted);
                extra.removeAll(expSorted);

                boolean ok = missing.isEmpty() && extra.isEmpty();
                allOk &= ok;
                System.out.println("instance " + id + " -> " + (ok ? "PASS" : "FAIL")
                        + "  实际 key(" + actual.size() + "): " + String.join(", ", actual));
                System.out.println("    类型: " + String.join(", ", types));
                if (!ok) {
                    System.out.println("    缺失: " + missing + "  多余: " + extra);
                }
            }
        }
        System.out.println();
        System.out.println(allOk
                ? "总结论：[PASS] 4 条实例的 form_data key 均与 PUR_FIELDS 逐字一致（8/8）"
                : "总结论：[FAIL] 存在 key 不一致");
        if (!allOk) System.exit(1);
    }
}