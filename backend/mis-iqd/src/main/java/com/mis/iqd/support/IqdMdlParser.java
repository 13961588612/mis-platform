package com.mis.iqd.support;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.iqd.api.dto.IqdCatalogItemSaveRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;

/**
 * WrenAI MDL 快照 → 清单项（iqd_catalog_item）解析器（B3 / T-W2-01）。
 *
 * <p>从 WrenAI ``get_mdl`` / ``list_models`` / ``describe_model`` 产出的 MDL JSON
 * 提取 catalog 快照：models → table + column + model；relationships → relationship；
 * metrics → metric；dimensions → dimension；views → view。分类对齐
 * architecture §4.2 ``iqd_catalog_item.kind``。
 *
 * <p>解析失败/字段缺失一律跳过（不阻断整体）；调用方（IqdAdminService）负责落库
 * upsert 与 last_seen_at 标记。
 */
public class IqdMdlParser {

    private static final Logger log = LoggerFactory.getLogger(IqdMdlParser.class);

    private final ObjectMapper objectMapper;

    public IqdMdlParser(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    /**
     * 解析 MDL JSON 字符串为清单项保存请求列表。
     *
     * @param mdlJson    WrenAI MDL JSON（models / relationships / metrics / dimensions / views）
     * @param datasource 数据源前缀（如 pg_main；用于拼接表 item_key）
     * @param schema     schema 名（如 public；缺省取 MDL 顶层 schema）
     * @return 解析出的清单项列表（空列表表示无可用项）
     */
    public List<IqdCatalogItemSaveRequest> parse(String mdlJson, String datasource, String schema) {
        List<IqdCatalogItemSaveRequest> items = new ArrayList<>();
        if (mdlJson == null || mdlJson.isBlank()) {
            return items;
        }
        JsonNode root;
        try {
            root = objectMapper.readTree(mdlJson);
        } catch (Exception exc) {
            log.warn("IQD MDL parse failed (malformed json)", exc);
            return items;
        }
        String effectiveSchema = schema != null && !schema.isBlank() ? schema : text(root, "schema", "public");
        String ds = datasource != null && !datasource.isBlank() ? datasource : "pg_main";

        JsonNode models = root.get("models");
        if (models != null && models.isArray()) {
            for (JsonNode model : models) {
                if (model == null || !model.isObject()) {
                    continue;
                }
                parseModel(model, ds, effectiveSchema, items);
            }
        }
        parseSemantics(root, "relationships", "relationship", items);
        parseSemantics(root, "metrics", "metric", items);
        parseSemantics(root, "dimensions", "dimension", items);
        parseSemantics(root, "views", "view", items);

        log.info("IQD MDL parsed items={} datasource={} schema={}", items.size(), ds, effectiveSchema);
        return items;
    }

    // ================================================================ 内部

    private void parseModel(JsonNode model, String ds, String schema, List<IqdCatalogItemSaveRequest> out) {
        String name = text(model, "name", "");
        if (name.isBlank()) {
            return;
        }
        // 表名：优先 refSql 中的 FROM 表，否则取模型名
        String tableName = extractTableName(text(model, "refSql", ""), name);
        String tableKey = (ds + "." + schema + "." + tableName).toLowerCase();

        // model 项
        out.add(new IqdCatalogItemSaveRequest(
                "model", null, "mdl:model:" + name, name,
                null, null, null, null,
                text(model, "description", null), text(model, "expression", null),
                "mdl", false, "none", null));

        // table 项
        out.add(new IqdCatalogItemSaveRequest(
                "table", null, tableKey, tableName,
                null, null, null, null,
                text(model, "description", null), null,
                "mdl", false, "none", null));

        // column 项
        JsonNode columns = model.get("columns");
        if (columns != null && columns.isArray()) {
            for (JsonNode col : columns) {
                if (col == null || !col.isObject()) {
                    continue;
                }
                String colName = text(col, "name", "");
                if (colName.isBlank()) {
                    continue;
                }
                String colKey = tableKey + "." + colName;
                out.add(new IqdCatalogItemSaveRequest(
                        "column", tableKey, colKey, colName,
                        text(col, "type", "text"),
                        bool(col, "isPrimaryKey", false),
                        bool(col, "isTimeDimension", false),
                        bool(col, "isEmail", false),
                        text(col, "description", null), null,
                        "mdl", false, "none", null));
            }
        }

        // 模型内嵌 relationships（描述模型间关系）
        JsonNode rels = model.get("relationships");
        if (rels != null && rels.isArray()) {
            for (JsonNode rel : rels) {
                if (rel == null || !rel.isObject()) {
                    continue;
                }
                String relName = text(rel, "name", "");
                if (relName.isBlank()) {
                    continue;
                }
                out.add(new IqdCatalogItemSaveRequest(
                        "relationship", "mdl:model:" + name, "mdl:relationship:" + relName, relName,
                        null, null, null, null,
                        text(rel, "condition", null), text(rel, "condition", null),
                        "mdl", false, "none", null));
            }
        }
    }

    private void parseSemantics(JsonNode root, String field, String kind, List<IqdCatalogItemSaveRequest> out) {
        JsonNode arr = root.get(field);
        if (arr == null || !arr.isArray()) {
            return;
        }
        for (JsonNode node : arr) {
            if (node == null || !node.isObject()) {
                continue;
            }
            String name = text(node, "name", "");
            if (name.isBlank()) {
                continue;
            }
            out.add(new IqdCatalogItemSaveRequest(
                    kind, null, "mdl:" + kind + ":" + name, name,
                    null, null, null, null,
                    text(node, "description", null), text(node, "expression", text(node, "baseObject", null)),
                    "mdl", false, "none", null));
        }
    }

    /** 从 refSql（如 "select * from public.orders"）提取表名；失败回退默认名。 */
    private static String extractTableName(String refSql, String fallback) {
        if (refSql == null || refSql.isBlank()) {
            return fallback;
        }
        String lower = refSql.toLowerCase();
        int fromIdx = lower.lastIndexOf(" from ");
        if (fromIdx < 0) {
            return fallback;
        }
        String rest = refSql.substring(fromIdx + 6).trim();
        // 取第一个 token（可能带 schema 前缀，去引号）
        String[] parts = rest.split("[\\s,;()]");
        for (String part : parts) {
            if (part.isBlank()) {
                continue;
            }
            String cleaned = part.trim().replace("\"", "").replace("`", "");
            if (cleaned.isEmpty()) {
                continue;
            }
            // 仅取最后一段（表名）；schema 由外部参数提供
            int dot = cleaned.lastIndexOf('.');
            return dot >= 0 ? cleaned.substring(dot + 1) : cleaned;
        }
        return fallback;
    }

    private static String text(JsonNode node, String field, String def) {
        JsonNode v = node.get(field);
        if (v == null || v.isNull()) {
            return def;
        }
        String s = v.asText("").trim();
        return s.isEmpty() ? def : s;
    }

    private static boolean bool(JsonNode node, String field, boolean def) {
        JsonNode v = node.get(field);
        return v != null && !v.isNull() ? v.asBoolean(def) : def;
    }
}
