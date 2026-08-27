import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.sql.*;
import java.util.*;

/**
 * 全库 alias 统一为 ds_code 迁移（配合前端"别名恒 = ds_code"）：
 * 1) recon_check.consume_json：key(alias) -> ds_code
 * 2) recon_match_rule.datasets_json：数组元素 alias -> ds_code
 * 3) recon_match_rule.key_fields_json：key(alias) -> ds_code
 * 4) recon_match_rule.field_transform_json：dataset 字段 alias -> ds_code
 * 5) recon_match_rule.multi_row_json：key(alias) -> ds_code
 * 6) recon_compare_rule.rules_json：left_field/right_field 前缀 "alias." -> "ds_code."
 * 未在 consume_json 出现的前缀（如错别字 alias）按同场景已知 alias 的包含关系推断。
 * 用法：args[0]=preview|apply
 */
public class FixAliasToDsCode {
    static final ObjectMapper M = new ObjectMapper();

    public static void main(String[] args) throws Exception {
        boolean apply = args.length > 0 && "apply".equals(args[0]);
        String url = "jdbc:postgresql://10.254.16.6:5432/recon";
        Properties p = new Properties();
        p.setProperty("user", "mis");
        p.setProperty("password", "mis123");
        try (Connection c = DriverManager.getConnection(url, p)) {
            // 1) 扫描所有 check 的 consume_json（alias->ds）、key_fields/field_transform/rules 中出现的前缀候选
            Map<String, Map<String, String>> sceneAlias = new LinkedHashMap<>(); // scenario -> alias -> ds(null 待推断)
            Map<String, Set<String>> sceneCandidates = new LinkedHashMap<>();     // scenario -> 候选前缀集合
            try (Statement st = c.createStatement();
                 ResultSet rs = st.executeQuery(
                         "SELECT rc.scenario_code, rc.consume_json, "
                                 + "rm.datasets_json, rm.key_fields_json, rm.field_transform_json, "
                                 + "cr.rules_json "
                                 + "FROM recon_check rc "
                                 + "LEFT JOIN recon_match_rule rm ON rm.scenario_code=rc.scenario_code AND rm.check_name=rc.check_name "
                                 + "LEFT JOIN recon_compare_rule cr ON cr.scenario_code=rc.scenario_code AND cr.check_name=rc.check_name "
                                 + "ORDER BY rc.scenario_code, rc.seq_no")) {
                while (rs.next()) {
                    String sc = rs.getString(1);
                    Map<String, String> m = sceneAlias.computeIfAbsent(sc, k -> new LinkedHashMap<>());
                    Set<String> cand = sceneCandidates.computeIfAbsent(sc, k -> new LinkedHashSet<>());
                    String cj = rs.getString(2);
                    if (cj != null) {
                        JsonNode n = M.readTree(cj);
                        if (n.isObject()) {
                            Iterator<Map.Entry<String, JsonNode>> it = n.fields();
                            while (it.hasNext()) {
                                Map.Entry<String, JsonNode> e = it.next();
                                JsonNode row = e.getValue();
                                if (row != null && row.isObject() && row.hasNonNull("ds_code")) {
                                    m.putIfAbsent(e.getKey(), row.get("ds_code").asText());
                                    cand.add(e.getKey());
                                }
                            }
                        }
                    }
                    String dj = rs.getString(3);
                    if (dj != null) try { for (JsonNode x : M.readTree(dj)) cand.add(x.asText()); } catch (Exception ignored) {}
                    String kj = rs.getString(4);
                    if (kj != null) try { Iterator<String> it = M.readTree(kj).fieldNames(); while (it.hasNext()) cand.add(it.next()); } catch (Exception ignored) {}
                    String fj = rs.getString(5);
                    if (fj != null && !"null".equals(fj)) try {
                        for (JsonNode x : M.readTree(fj)) if (x.isObject() && x.has("dataset")) cand.add(x.get("dataset").asText());
                    } catch (Exception ignored) {}
                    String rj = rs.getString(6);
                    if (rj != null) try {
                        for (JsonNode r : M.readTree(rj)) {
                            if (!r.isObject()) continue;
                            for (String f : new String[]{"left_field", "right_field"}) {
                                if (!r.has(f)) continue;
                                String v = r.get(f).asText();
                                int dot = v.indexOf('.');
                                if (dot > 0) cand.add(v.substring(0, dot));
                            }
                        }
                    } catch (Exception ignored) {}
                }
            }
            // 推断：候选前缀未在 consume 定义（value 为 null）且包含某已知 alias -> 同 ds（处理"智慧购销售"这类错别字）
            for (String sc : sceneCandidates.keySet()) {
                Map<String, String> m = sceneAlias.get(sc);
                if (m == null) continue;
                for (String cand : sceneCandidates.get(sc)) {
                    if (m.containsKey(cand)) continue;
                    for (Map.Entry<String, String> known : m.entrySet()) {
                        if (known.getValue() != null && cand.contains(known.getKey())) {
                            m.put(cand, known.getValue());
                            break;
                        }
                    }
                }
            }

            // 2) 逐 check 迁移：match_rule 四列合并在一次 UPDATE；其余单列
            List<Object[]> updates = new ArrayList<>(); // {table, scenario, check, colName, newJson}
            Map<String, Map<String, String>> mrMerge = new LinkedHashMap<>(); // scenario|check -> col->json
            Map<String, Map<String, String>> rcMerge = new LinkedHashMap<>();
            Map<String, Map<String, String>> crMerge = new LinkedHashMap<>();
            try (Statement st = c.createStatement();
                 ResultSet rs = st.executeQuery(
                         "SELECT rc.scenario_code, rc.check_name, rc.consume_json, "
                                 + "rm.datasets_json, rm.key_fields_json, rm.field_transform_json, rm.multi_row_json, "
                                 + "cr.rules_json "
                                 + "FROM recon_check rc "
                                 + "LEFT JOIN recon_match_rule rm ON rm.scenario_code=rc.scenario_code AND rm.check_name=rc.check_name "
                                 + "LEFT JOIN recon_compare_rule cr ON cr.scenario_code=rc.scenario_code AND cr.check_name=rc.check_name "
                                 + "ORDER BY rc.scenario_code, rc.seq_no")) {
                while (rs.next()) {
                    String sc = rs.getString(1), cn = rs.getString(2);
                    Map<String, String> alias2ds = sceneAlias.getOrDefault(sc, Collections.emptyMap());
                    String cj = rs.getString(3);
                    if (cj != null) {
                        String nv = migrateConsume(cj, alias2ds);
                        if (!nv.equals(cj)) rcMerge.computeIfAbsent(sc + "|" + cn, k -> new LinkedHashMap<>()).put("consume_json", nv);
                    }
                    Map<String, String> mrCols = new LinkedHashMap<>();
                    String dj = rs.getString(4);
                    if (dj != null) {
                        String nv = migrateDatasets(dj, alias2ds);
                        if (!nv.equals(dj)) mrCols.put("datasets_json", nv);
                    }
                    String kj = rs.getString(5);
                    if (kj != null) {
                        String nv = migrateKeyFields(kj, alias2ds);
                        if (!nv.equals(kj)) mrCols.put("key_fields_json", nv);
                    }
                    String fj = rs.getString(6);
                    if (fj != null && !"null".equals(fj)) {
                        String nv = migrateTransforms(fj, alias2ds);
                        if (!nv.equals(fj)) mrCols.put("field_transform_json", nv);
                    }
                    String mj = rs.getString(7);
                    if (mj != null && !"null".equals(mj)) {
                        String nv = migrateMultiRow(mj, alias2ds);
                        if (!nv.equals(mj)) mrCols.put("multi_row_json", nv);
                    }
                    if (!mrCols.isEmpty()) mrMerge.put(sc + "|" + cn, mrCols);
                    String rj = rs.getString(8);
                    if (rj != null) {
                        String nv = migrateRules(rj, alias2ds);
                        if (!nv.equals(rj)) crMerge.computeIfAbsent(sc + "|" + cn, k -> new LinkedHashMap<>()).put("rules_json", nv);
                    }
                }
            }
            int total = rcMerge.size() + mrMerge.size() + crMerge.size();
            System.out.println("== 待迁移 check: rc=" + rcMerge.size() + " mr=" + mrMerge.size() + " cr=" + crMerge.size() + " (共" + total + " 行) ==");
            for (Map.Entry<String, Map<String, String>> e : rcMerge.entrySet())
                System.out.println("  [recon_check] " + e.getKey() + " -> " + e.getValue());
            for (Map.Entry<String, Map<String, String>> e : mrMerge.entrySet())
                System.out.println("  [recon_match_rule] " + e.getKey() + " -> " + e.getValue());
            for (Map.Entry<String, Map<String, String>> e : crMerge.entrySet())
                System.out.println("  [recon_compare_rule] " + e.getKey() + " -> " + e.getValue());
            if (!apply) {
                System.out.println("(预览模式，未写库；确认后加 apply 参数执行)");
                return;
            }

            // 3) apply
            for (Map.Entry<String, Map<String, String>> e : rcMerge.entrySet()) {
                String[] key = e.getKey().split("\\|", 2);
                try (PreparedStatement ps = c.prepareStatement(
                        "UPDATE recon_check SET consume_json=?::jsonb WHERE scenario_code=? AND check_name=?")) {
                    ps.setString(1, e.getValue().get("consume_json"));
                    ps.setString(2, key[0]); ps.setString(3, key[1]);
                    ps.executeUpdate();
                }
            }
            for (Map.Entry<String, Map<String, String>> e : mrMerge.entrySet()) {
                String[] key = e.getKey().split("\\|", 2);
                StringBuilder sql = new StringBuilder("UPDATE recon_match_rule SET ");
                List<String> cols = new ArrayList<>();
                Map<String, String> vals = e.getValue();
                if (vals.containsKey("datasets_json")) cols.add("datasets_json");
                if (vals.containsKey("key_fields_json")) cols.add("key_fields_json");
                if (vals.containsKey("field_transform_json")) cols.add("field_transform_json");
                if (vals.containsKey("multi_row_json")) cols.add("multi_row_json");
                sql.append(String.join("=?::jsonb, ", cols)).append("=?::jsonb WHERE scenario_code=? AND check_name=?");
                try (PreparedStatement ps = c.prepareStatement(sql.toString())) {
                    int i = 1;
                    for (String col : cols) ps.setString(i++, vals.get(col));
                    ps.setString(i++, key[0]); ps.setString(i, key[1]);
                    ps.executeUpdate();
                }
            }
            for (Map.Entry<String, Map<String, String>> e : crMerge.entrySet()) {
                String[] key = e.getKey().split("\\|", 2);
                try (PreparedStatement ps = c.prepareStatement(
                        "UPDATE recon_compare_rule SET rules_json=?::jsonb WHERE scenario_code=? AND check_name=?")) {
                    ps.setString(1, e.getValue().get("rules_json"));
                    ps.setString(2, key[0]); ps.setString(3, key[1]);
                    ps.executeUpdate();
                }
            }
            System.out.println("== 迁移完成 ==");
        }
    }

    /** consume_json：key alias -> ds_code（保留行内容与顺序） */
    static String migrateConsume(String json, Map<String, String> alias2ds) throws Exception {
        ObjectNode root = (ObjectNode) M.readTree(json);
        ObjectNode out = M.createObjectNode();
        boolean changed = false;
        Iterator<Map.Entry<String, JsonNode>> it = root.fields();
        while (it.hasNext()) {
            Map.Entry<String, JsonNode> e = it.next();
            String alias = e.getKey();
            String ds = alias2ds.get(alias);
            String newKey = ds != null ? ds : alias;
            if (!newKey.equals(alias)) changed = true;
            out.set(newKey, e.getValue());
        }
        return changed ? M.writeValueAsString(out) : json;
    }

    /** datasets_json：数组元素 alias -> ds_code */
    static String migrateDatasets(String json, Map<String, String> alias2ds) throws Exception {
        ArrayNode arr = (ArrayNode) M.readTree(json);
        boolean changed = false;
        for (int i = 0; i < arr.size(); i++) {
            String alias = arr.get(i).asText();
            String ds = alias2ds.get(alias);
            if (ds != null && !ds.equals(alias)) {
                arr.set(i, M.getNodeFactory().textNode(ds));
                changed = true;
            }
        }
        return changed ? M.writeValueAsString(arr) : json;
    }

    /** key_fields_json：key alias -> ds_code（值模板不动） */
    static String migrateKeyFields(String json, Map<String, String> alias2ds) throws Exception {
        ObjectNode root = (ObjectNode) M.readTree(json);
        ObjectNode out = M.createObjectNode();
        boolean changed = false;
        Iterator<Map.Entry<String, JsonNode>> it = root.fields();
        while (it.hasNext()) {
            Map.Entry<String, JsonNode> e = it.next();
            String alias = e.getKey();
            String ds = alias2ds.get(alias);
            String newKey = ds != null ? ds : alias;
            if (!newKey.equals(alias)) changed = true;
            out.set(newKey, e.getValue());
        }
        return changed ? M.writeValueAsString(out) : json;
    }

    /** field_transform_json：[{dataset,field,...}] 的 dataset alias -> ds_code */
    static String migrateTransforms(String json, Map<String, String> alias2ds) throws Exception {
        ArrayNode arr = (ArrayNode) M.readTree(json);
        boolean changed = false;
        for (JsonNode n : arr) {
            if (n.isObject() && n.has("dataset")) {
                String alias = n.get("dataset").asText();
                String ds = alias2ds.get(alias);
                if (ds != null && !ds.equals(alias)) {
                    ((ObjectNode) n).put("dataset", ds);
                    changed = true;
                }
            }
        }
        return changed ? M.writeValueAsString(arr) : json;
    }

    /** multi_row_json：key alias -> ds_code */
    static String migrateMultiRow(String json, Map<String, String> alias2ds) throws Exception {
        ObjectNode root = (ObjectNode) M.readTree(json);
        ObjectNode out = M.createObjectNode();
        boolean changed = false;
        Iterator<Map.Entry<String, JsonNode>> it = root.fields();
        while (it.hasNext()) {
            Map.Entry<String, JsonNode> e = it.next();
            String alias = e.getKey();
            String ds = alias2ds.get(alias);
            String newKey = ds != null ? ds : alias;
            if (!newKey.equals(alias)) changed = true;
            out.set(newKey, e.getValue());
        }
        return changed ? M.writeValueAsString(out) : json;
    }

    /** rules_json：left_field/right_field 前缀 "alias." -> "ds_code." */
    static String migrateRules(String json, Map<String, String> alias2ds) throws Exception {
        ArrayNode arr = (ArrayNode) M.readTree(json);
        boolean changed = false;
        for (JsonNode n : arr) {
            if (!n.isObject()) continue;
            ObjectNode o = (ObjectNode) n;
            for (String f : new String[]{"left_field", "right_field"}) {
                if (!o.has(f)) continue;
                String v = o.get(f).asText();
                int dot = v.indexOf('.');
                if (dot <= 0) continue;
                String prefix = v.substring(0, dot);
                String ds = alias2ds.get(prefix);
                if (ds != null && !ds.equals(prefix)) {
                    o.put(f, ds + v.substring(dot));
                    changed = true;
                }
            }
        }
        return changed ? M.writeValueAsString(arr) : json;
    }
}