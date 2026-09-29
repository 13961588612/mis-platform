package com.mis.iqd.domain.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.iqd.api.dto.IqdDependents;
import com.mis.iqd.api.dto.IqdModelingCreateResponse;
import com.mis.iqd.api.dto.ValidateExprResult;
import com.mis.iqd.domain.entity.IqdCatalogItem;
import com.mis.iqd.domain.entity.IqdConnection;
import com.mis.iqd.domain.entity.IqdEditIdempotency;
import com.mis.iqd.domain.repository.IqdCatalogItemRepository;
import com.mis.iqd.domain.repository.IqdConnectionRepository;
import com.mis.iqd.domain.repository.IqdEditIdempotencyRepository;
import com.mis.iqd.support.IdGenerator;
import com.mis.iqd.support.IqdMdlParser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 建模台「新建节点端点族」服务（v1.11 MR-S2 / 系统设计 §4.3 c 点）。
 *
 * <p><b>职责</b>：把建模台的「新建模型 / 关系 / Cube / 计算列」统一落到
 * {@code iqd_catalog_item}（{@code source='modeling'}），复用二/四期已落地的编辑权威闭环。
 *
 * <h2>编辑权威闭环（Q1 方案甲，不直写 MDL）</h2>
 * <pre>
 *   幂等键查重 → 语义幂等（同源表重复导入）→ base_revision 乐观并发 → 引用完整性预校验
 *   → @Transactional 落 iqd_catalog_item（kind=table/model/column, source='modeling'）
 *   → bump current_edit_revision → 写 iqd_edit_idempotency → 发 iqd.catalog.changed
 * </pre>
 * 第 8 步 {@code triggerSyncBestEffort(scope='model', wait=false)} 由 **BFF**
 * {@code IqdFacadeService} 承担（与既有 {@code updateCatalogNode} 完全同口径，见
 * {@code mis-iqd-edit-design.md} §191）：mis-iqd 只发布变更事件，不反向调用 ai-platform，
 * 避免下游服务反向依赖上游。
 *
 * <h2>实现状态</h2>
 * <ul>
 *   <li><b>T02a</b>：{@link #createModelFromTable}、{@link #validateExpression}、{@link #listDependents}</li>
 *   <li><b>T03</b>：{@link #createModel}（空白模型）、{@link #createRelationship}、
 *       {@link #createCube}（含 measures/dimensions 子节点 + {@code model_ref} 落库）、
 *       {@link #createCalculatedColumn}</li>
 *   <li><b>T04a</b>：{@link #upsertCube}（更新既有 Cube：自身字段 + measures/dimensions
 *       子节点增删改 + 孤儿清理）—— 补齐 T03c 暴露的「既有 Cube 改不了」缺口</li>
 * </ul>
 * 四个 {@code createXxx} 共用同一前置链：连接存在 + 写回闸门（40300）→ 幂等键查重
 * （命中返回首次结果）→ 语义幂等（同 item_key 已存在）→ {@code base_revision} 乐观并发
 * （40900）→ 引用完整性预校验 → {@code @Transactional} 落 {@code iqd_catalog_item}
 * （{@code source='modeling'}）→ bump {@code current_edit_revision} → 写
 * {@code iqd_edit_idempotency}（40901）→ 发 {@code iqd.catalog.changed}。
 *
 * <p>命名边界：路径/权限码一律 {@code iqd}（platform 域）；仅对接 WrenAI 处保留
 * {@code wren}（{@code wren_ref_id} / {@code mdl:*}）。
 */
@Service
public class IqdCatalogNodeService {

    private static final Logger log = LoggerFactory.getLogger(IqdCatalogNodeService.class);

    /** 物理表 item_key 的数据源前缀缺省值（与 {@code IqdMdlParser} / {@code syncCatalogFromMdl} 同口径）。 */
    private static final String DEFAULT_DATASOURCE = "pg_main";

    /** §8.6 item_key 前缀（新建节点族统一校验 + 子节点键构造）。 */
    private static final String MODEL_ITEM_PREFIX = "mdl:model:";
    private static final String RELATIONSHIP_ITEM_PREFIX = "mdl:relationship:";
    private static final String CUBE_ITEM_PREFIX = "mdl:cube:";
    private static final String MEASURE_ITEM_PREFIX = "mdl:measure:";
    private static final String DIMENSION_ITEM_PREFIX = "mdl:dimension:";
    /** 计算列稳定键前缀（§8.6 {@code calc:<model>.<column_name>}）。 */
    private static final String CALC_ITEM_PREFIX = "calc:";

    /** 派生编辑态（新建后恒定；build 成功后由 backfill 推进）。 */
    private static final String EDITED_UNSYNCED = "EDITED_UNSYNCED";

    /**
     * item_key 形态的 token（如 {@code mdl:model:orders} / {@code calc:orders.margin}）：
     * 关系信封 JSON 里会出现这些键，扫描 condition 字段引用前先剔除，避免把
     * {@code mdl}/{@code model}/{@code orders} 误判为字段。
     */
    private static final Pattern ITEM_KEY_TOKEN = Pattern.compile("[A-Za-z_][A-Za-z0-9_]*:[A-Za-z0-9_.:\\-]+");

    /** 表/列 item_key 统一小写（对齐 {@code IqdMdlParser.parseModel} 的 {@code tableKey.toLowerCase()}）。 */
    private static final Locale LOWER = Locale.ROOT;

    /** 表达式里的标识符（字段引用）：字母/下划线开头，允许点号（schema.table.col）。 */
    private static final Pattern IDENTIFIER = Pattern.compile("[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)*");

    /** 单引号字符串字面量（校验前先剔除，避免把字符串内容误判为字段）。 */
    private static final Pattern STRING_LITERAL = Pattern.compile("'([^']|'')*'");

    /**
     * SQL 关键字 / 函数白名单（非字段引用）。**只做「非字段」判定，不做语法解析**：
     * 目标是「引用字段存在性」预校验（A-10），不是完整 SQL 语法校验（后者交 WrenAI build）。
     */
    private static final Set<String> SQL_KEYWORDS = Set.of(
            "select", "from", "where", "and", "or", "not", "null", "is", "in", "like", "between",
            "case", "when", "then", "else", "end", "as", "distinct", "group", "by", "order", "having",
            "asc", "desc", "limit", "offset", "union", "all", "join", "left", "right", "inner", "outer",
            "full", "on", "using", "cast", "true", "false", "interval", "current_date", "current_timestamp",
            "count", "sum", "avg", "min", "max", "coalesce", "nullif", "abs", "round", "floor", "ceil",
            "ceiling", "length", "lower", "upper", "trim", "substr", "substring", "concat", "replace",
            "date_trunc", "extract", "now", "greatest", "least", "integer", "numeric", "text", "varchar",
            "decimal", "float", "double", "bigint", "smallint", "boolean", "date", "timestamp", "json",
            "array", "unnest", "row_number", "rank", "dense_rank", "over", "partition", "filter",
            "stddev", "variance", "percentile_cont", "string_agg", "array_agg", "jsonb", "to_char",
            "to_date", "to_number", "nulls", "first", "last", "values", "with", "exists", "any", "some");

    private final IqdConnectionRepository connectionRepository;
    private final IqdCatalogItemRepository catalogItemRepository;
    private final IqdEditIdempotencyRepository idempotencyRepository;
    /** 引用完整性预校验 / 依赖方清单（二/四期已落地，直接复用不重写）。 */
    private final IqdAdminService adminService;
    /** 变更事件发布（{@code iqd.catalog.changed} → Worker 失效 catalog 缓存 + SyncCoordinator）。 */
    private final IqdChangeEventPublisher changeEventPublisher;
    /** MDL 基线解析（回退路径：从 {@code mdl_raw} 解析源表列）。 */
    private final IqdMdlParser mdlParser;

    public IqdCatalogNodeService(
            IqdConnectionRepository connectionRepository,
            IqdCatalogItemRepository catalogItemRepository,
            IqdEditIdempotencyRepository idempotencyRepository,
            IqdAdminService adminService,
            IqdChangeEventPublisher changeEventPublisher,
            ObjectMapper objectMapper) {
        this.connectionRepository = connectionRepository;
        this.catalogItemRepository = catalogItemRepository;
        this.idempotencyRepository = idempotencyRepository;
        this.adminService = adminService;
        this.changeEventPublisher = changeEventPublisher;
        this.mdlParser = new IqdMdlParser(objectMapper);
    }

    // ------------------------------------------------------------------ createModelFromTable（T02a 实现）

    /**
     * 由物理表生成模型（M1 黄金路径 M-G1 核心）。
     *
     * <p>设计签名（system-design §4.3）保持不变；{@code options} 为**可选**附加位
     * （当前仅 {@code in_scope}，**默认 {@code false}**，见 PRD §6.3「导入 ≠ 可问」）——
     * 重载而非改签名，既有调用方不受影响。
     *
     * @param connectionId   问数连接 id
     * @param sourceTable    源表引用 {@code {schema, name, columns?, ref_sql?}}
     * @param modelItemKey   目标模型稳定键（缺省 {@code mdl:model:<tableName>}）
     * @param baseRevision   乐观并发基线（{@code null} = 不做并发校验）
     * @param idempotencyKey 幂等键（§8.4；from-table 推荐 {@code {connId}+{sha1(source_table)}}）
     * @return {@code {edit_revision, edit_status, item_key, column_mapping, wren_ref_id}}
     */
    @PreAuthorize("hasAuthority('iqd:modeling:edit')")
    @Transactional
    public Map<String, Object> createModelFromTable(
            Long connectionId,
            Map<String, Object> sourceTable,
            String modelItemKey,
            Long baseRevision,
            String idempotencyKey) {
        return createModelFromTable(connectionId, sourceTable, modelItemKey, baseRevision, idempotencyKey, null);
    }

    /**
     * 由物理表生成模型（带可选参数重载）。
     *
     * @param options 可选：{@code in_scope}（**默认 false**；仅显式 true 才纳入问数范围，PRD §6.3）
     * @return 同 {@link #createModelFromTable(Long, Map, String, Long, String)}
     */
    @PreAuthorize("hasAuthority('iqd:modeling:edit')")
    @Transactional
    public Map<String, Object> createModelFromTable(
            Long connectionId,
            Map<String, Object> sourceTable,
            String modelItemKey,
            Long baseRevision,
            String idempotencyKey,
            Map<String, Object> options) {

        // ---------- 0. 参数校验（42200） ----------
        if (connectionId == null) {
            throw new BusinessException(42200, "connectionId 不能为空", null);
        }
        String schema = str(sourceTable == null ? null : sourceTable.get("schema"));
        String tableName = str(sourceTable == null ? null : sourceTable.get("name"));
        if (tableName == null || tableName.isBlank()) {
            throw new BusinessException(42200, "source_table.name 不能为空", null);
        }
        String effectiveSchema = (schema == null || schema.isBlank()) ? "public" : schema.trim();
        String effectiveModelKey = (modelItemKey == null || modelItemKey.isBlank())
                ? "mdl:model:" + tableName.trim()
                : modelItemKey.trim();
        if (!effectiveModelKey.startsWith("mdl:model:")) {
            throw new BusinessException(42200, "model_item_key 必须形如 mdl:model:<name>", null);
        }
        // in_scope **默认 false**（PRD §6.3「导入 ≠ 可问」）：建模/导入便利不得顺手把表开给
        // 所有持有问数权限的人。仅当调用方**显式**传 in_scope=true 才纳入范围；
        // 其余（缺省 / null / false）一律不纳入，引导用户去 /iqd/scope 勾选（治理边界）。
        boolean inScope = options != null && Boolean.TRUE.equals(toBoolean(options.get("in_scope")));
        boolean refreshColumns = options != null
                && Boolean.TRUE.equals(toBoolean(options.get("refresh_columns")));

        // ---------- 连接存在 + 写回闸门 ----------
        IqdConnection conn = connectionRepository.findById(connectionId)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND,
                        "问数连接不存在: " + connectionId));
        if (!Boolean.TRUE.equals(conn.getMdlWritebackEnabled())) {
            throw new BusinessException(40300, "该连接未开启 MDL 写回（mdl_writeback_enabled=false）", null);
        }

        // ---------- 1. 幂等：① 幂等键命中 → 返回首次结果，不 bump ----------
        if (!refreshColumns && idempotencyKey != null && !idempotencyKey.isBlank()) {
            Optional<IqdEditIdempotency> prev =
                    idempotencyRepository.findByConnectionIdAndIdempotencyKey(connectionId, idempotencyKey);
            if (prev.isPresent()) {
                log.info("IQD from-table idempotent hit by key connectionId={} key={}",
                        connectionId, idempotencyKey);
                return createResult(prev.get().getEditRevision(), effectiveModelKey, existingColumnMapping(connectionId, effectiveModelKey));
            }
        }

        // ---------- 1b. 幂等：② 同源表重复导入（语义幂等）→ 返回首次结果，不 bump ----------
        //   与「幂等键」互补：前端每次提交用新 uuid（§8.4），若只认 key，重复导入会反复 bump。
        //   refresh_columns=true 时跳过：表发现「更新导入」需重写列 type/PK/comment。
        Optional<IqdCatalogItem> existingModel =
                catalogItemRepository.findByConnectionIdAndItemKey(connectionId, effectiveModelKey);
        if (existingModel.isPresent() && !refreshColumns) {
            long rev = conn.getCurrentEditRevision() == null ? 0L : conn.getCurrentEditRevision();
            log.info("IQD from-table semantic idempotent hit connectionId={} modelKey={}",
                    connectionId, effectiveModelKey);
            return createResult(existingModel.get().getEditRevision() == null ? rev : existingModel.get().getEditRevision(),
                    effectiveModelKey, existingColumnMapping(connectionId, effectiveModelKey));
        }

        // ---------- 2. 乐观并发（40900 + current_edit_revision） ----------
        long current = conn.getCurrentEditRevision() == null ? 0L : conn.getCurrentEditRevision();
        if (baseRevision != null && !baseRevision.equals(current)) {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("current_edit_revision", current);
            throw new BusinessException(40900, "并发编辑冲突：当前版本已变更", data);
        }

        // ---------- 3. 引用完整性预校验：源表 + 源列存在性（42200） ----------
        SourceTable resolved = resolveSourceTable(connectionId, effectiveSchema, tableName.trim(), sourceTable);
        if (resolved == null || resolved.columns().isEmpty()) {
            throw new BusinessException(42200,
                    "源表不存在或无可导入字段: " + effectiveSchema + "." + tableName.trim(), null);
        }
        // 复用二/四期引用扫描（CREATE 语义：把直接引用方作为预校验证据返回，仅供日志/诊断；
        // 与 RENAME 不同，CREATE 不阻断 —— 覆盖既存语义节点由其自身幂等分支处理）。
        List<Map<String, Object>> refs =
                adminService.validateCatalogRefs(connectionId, effectiveModelKey, "CREATE");
        if (!refs.isEmpty()) {
            log.info("IQD from-table refs pre-check connectionId={} modelKey={} deps={}",
                    connectionId, effectiveModelKey, refs.size());
        }

        // ---------- 4. 落 iqd_catalog_item（kind=table/model/column, source='modeling'） ----------
        //   形态与 IqdMdlParser 完全一致（table=tableKey；column.parent_key=tableKey；
        //   model=mdl:model:<name>），保证「MDL 同步」与「建模台新建」两条来源在 catalog 里同构。
        long next = current + 1;
        Instant now = Instant.now();
        String tableKey = resolved.tableKey();
        String refSql = str(sourceTable == null ? null : sourceTable.get("ref_sql"));

        upsertNode(connectionId, tableKey, "table", null, tableName.trim(), null,
                null, null, null, null, null, null, inScope ? 1 : 0, next, now);

        Map<String, String> columnMapping = new LinkedHashMap<>();
        for (Map<String, Object> col : resolved.columns()) {
            String colName = str(col.get("name"));
            if (colName == null || colName.isBlank()) {
                continue;
            }
            String colKey = tableKey + "." + colName.toLowerCase(LOWER);
            columnMapping.put(colName, colKey);
            Boolean isPk = toBoolean(col.get("is_primary_key"));
            if (isPk == null) {
                // 表发现向导预览字段名为 is_pk_inferred；落库兼容双写
                isPk = toBoolean(col.get("is_pk_inferred"));
            }
            upsertNode(connectionId, colKey, "column", tableKey, colName,
                    str(col.get("type")), null,
                    isPk, null, null,
                    str(col.get("comment")), null, inScope ? 1 : 0, next, now);
        }

        upsertNode(connectionId, effectiveModelKey, "model", null, tableName.trim(), null,
                null, null, null, null, refSql, null, inScope ? 1 : 0, next, now);

        // ---------- 5. bump current_edit_revision ----------
        conn.setCurrentEditRevision(next);
        conn.setUpdatedAt(now);
        connectionRepository.save(conn);

        // ---------- 6. 写 iqd_edit_idempotency ----------
        if (idempotencyKey != null && !idempotencyKey.isBlank()) {
            try {
                idempotencyRepository.save(new IqdEditIdempotency(connectionId, idempotencyKey, next));
            } catch (DataIntegrityViolationException ex) {
                // 40901：同 key **并发**双提交（步骤 1 查重与实际落库之间的竞态窗口）。
                // 与「顺序重复提交」不同：那种情况在步骤 1 已返回首次结果（不报错）；
                // 这里撞的是 iqd_edit_idempotency 的 PK (connection_id, idempotency_key)，
                // 说明另一事务正在写同一 key ⇒ 回滚本次（含节点写入与 bump），
                // 由调用方重读后重试，避免双 bump 与半成品节点。
                Map<String, Object> data = new LinkedHashMap<>();
                data.put("idempotency_key", idempotencyKey);
                data.put("current_edit_revision", current);
                throw new BusinessException(40901, "幂等键重复提交（同 key 并发）", data);
            }
        }

        // ---------- 7. 发 iqd.catalog.changed（Worker 失效 catalog 缓存；BFF 触发 best-effort build） ----------
        changeEventPublisher.publish("iqd.catalog.changed",
                "from_table=" + effectiveSchema + "." + tableName.trim() + ";model=" + effectiveModelKey);

        log.info("IQD from-table created connectionId={} modelKey={} tableKey={} columns={} revision={}",
                connectionId, effectiveModelKey, tableKey, columnMapping.size(), next);

        Map<String, Object> result = createResult(next, effectiveModelKey, columnMapping);
        result.put("table_key", tableKey);
        return result;
    }

    // ------------------------------------------------------------------ validateExpression（T02a 实现）

    /**
     * 表达式静态校验（T02a 实现；A-10 提交前同步校验）。
     *
     * <p>语义：解析 expression 里的**字段引用标识符**，逐个核对是否落在
     * {@code modelItemKey} 的可见字段集合内。可见字段 =
     * ①模型自身（{@code mdl:model:<name>} 的 display_name）
     * ②模型对应物理表的列（{@code kind=column, parent_key=<tableKey>}）
     * ③挂在该模型下的计算列（{@code kind=column, parent_key=<modelItemKey>}）。
     *
     * <p>**只做「引用字段存在性」预校验，不做 SQL 语法/类型校验**（后者交 WrenAI build）：
     * 字符串字面量先剔除，SQL 关键字/函数走白名单，括号做配对检查。
     *
     * @param connectionId 问数连接 id
     * @param modelItemKey 模型稳定键（字段存在性范围）
     * @param expression   待校验表达式
     * @return {@code {valid, errors}}
     */
    @Transactional(readOnly = true)
    public ValidateExprResult validateExpression(Long connectionId, String modelItemKey, String expression) {
        List<String> errors = new ArrayList<>();
        if (connectionId == null) {
            return new ValidateExprResult(false, List.of("connectionId 不能为空"));
        }
        if (expression == null || expression.isBlank()) {
            return new ValidateExprResult(false, List.of("表达式为空"));
        }
        if (modelItemKey == null || modelItemKey.isBlank()) {
            return new ValidateExprResult(false, List.of("model_item_key 不能为空"));
        }
        if (!connectionRepository.existsById(connectionId)) {
            return new ValidateExprResult(false, List.of("问数连接不存在: " + connectionId));
        }
        if (!isBalanced(expression)) {
            errors.add("括号不匹配");
        }

        Set<String> allowed = collectModelFields(connectionId, modelItemKey);
        if (allowed.isEmpty()) {
            errors.add("模型不存在或无可引用字段: " + modelItemKey);
            return new ValidateExprResult(false, errors);
        }

        for (String token : scanUnknownIdentifiers(expression, allowed)) {
            errors.add("未知字段: " + token);
        }
        return new ValidateExprResult(errors.isEmpty(), errors);
    }

    /**
     * 扫描表达式里的**未知字段标识符**（引用字段存在性预校验，A-10）。
     *
     * <p>规则：① 剔除单引号字符串字面量；② 剔除 item_key 形态 token
     * （{@code mdl:model:orders} 等 —— 关系信封 JSON 里会出现，否则会被拆成
     * {@code mdl}/{@code model}/{@code orders} 误判为字段）；③ SQL 关键字 / 函数走白名单；
     * ④ 其余标识符按「逐级回退」与 {@code allowed} 匹配
     * （{@code a.b.c} 命中 {@code a.b.c} / {@code b.c} / {@code c} 任一即可）。
     *
     * <p><b>只做「引用字段存在性」，不做 SQL 语法 / 类型校验</b>（后者交 WrenAI build）。
     *
     * @param expression 待扫描表达式
     * @param allowed    允许的字段名集合（小写）
     * @return 未知标识符集合（保序；空集合 = 全部命中）
     */
    private static Set<String> scanUnknownIdentifiers(String expression, Set<String> allowed) {
        Set<String> unknown = new LinkedHashSet<>();
        if (expression == null || expression.isBlank() || allowed == null || allowed.isEmpty()) {
            return unknown;
        }
        String stripped = STRING_LITERAL.matcher(expression).replaceAll("''");
        stripped = ITEM_KEY_TOKEN.matcher(stripped).replaceAll(" ");
        var matcher = IDENTIFIER.matcher(stripped);
        while (matcher.find()) {
            String token = matcher.group();
            String lower = token.toLowerCase(LOWER);
            if (SQL_KEYWORDS.contains(lower)) {
                continue;
            }
            if (matchesAny(allowed, lower)) {
                continue;
            }
            unknown.add(token);
        }
        return unknown;
    }

    /** 逐级回退匹配：{@code a.b.c} 命中 {@code a.b.c} / {@code b.c} / {@code c} 任一即可。 */
    private static boolean matchesAny(Set<String> allowed, String lower) {
        if (allowed.contains(lower)) {
            return true;
        }
        int idx = lower.indexOf('.');
        while (idx >= 0) {
            String tail = lower.substring(idx + 1);
            if (allowed.contains(tail)) {
                return true;
            }
            idx = lower.indexOf('.', idx + 1);
        }
        // 末段（仅列名）
        int lastDot = lower.lastIndexOf('.');
        return false || (lastDot >= 0 && allowed.contains(lower.substring(lastDot + 1)));
    }

    /** 收集模型可见字段名（小写集合）：模型名 + 物理表列 + 模型计算列。 */
    private Set<String> collectModelFields(Long connectionId, String modelItemKey) {
        Set<String> allowed = new LinkedHashSet<>();
        List<IqdCatalogItem> items = catalogItemRepository.findByConnectionId(connectionId);
        String modelName = null;
        String tableKey = null;
        for (IqdCatalogItem it : items) {
            if ("model".equals(it.getKind()) && modelItemKey.equals(it.getItemKey())) {
                modelName = it.getDisplayName();
            }
        }
        if (modelName != null) {
            allowed.add(modelName.toLowerCase(LOWER));
        }
        // 物理表：优先按「模型名 == 表名」找 tableKey，其次取模型 item_key 末段
        String tableNameGuess = modelName != null ? modelName
                : modelItemKey.substring(modelItemKey.lastIndexOf(':') + 1);
        for (IqdCatalogItem it : items) {
            if ("table".equals(it.getKind()) && it.getItemKey() != null) {
                String key = it.getItemKey().toLowerCase(LOWER);
                String guess = tableNameGuess.toLowerCase(LOWER);
                if (key.endsWith("." + guess) || key.equals(guess)
                        || key.endsWith(":" + guess)) {
                    tableKey = it.getItemKey();
                    break;
                }
            }
        }
        for (IqdCatalogItem it : items) {
            if (!"column".equals(it.getKind()) || it.getItemKey() == null) {
                continue;
            }
            String parent = it.getParentKey();
            boolean belongs = (tableKey != null && tableKey.equals(parent))
                    || modelItemKey.equals(parent);
            if (!belongs) {
                continue;
            }
            if (it.getDisplayName() != null && !it.getDisplayName().isBlank()) {
                allowed.add(it.getDisplayName().toLowerCase(LOWER));
            }
            String key = it.getItemKey().toLowerCase(LOWER);
            allowed.add(key);
            int dot = key.lastIndexOf('.');
            if (dot >= 0) {
                allowed.add(key.substring(dot + 1));
            }
        }
        return allowed;
    }

    /** 括号配对检查（忽略字符串字面量内部）。 */
    private static boolean isBalanced(String expr) {
        String stripped = STRING_LITERAL.matcher(expr).replaceAll("''");
        int depth = 0;
        for (int i = 0; i < stripped.length(); i++) {
            char c = stripped.charAt(i);
            if (c == '(') {
                depth++;
            } else if (c == ')') {
                depth--;
                if (depth < 0) {
                    return false;
                }
            }
        }
        return depth == 0;
    }

    // ------------------------------------------------------------------ createModel（T03 实现）

    /**
     * 空白模型创建（v1.11 §3.3 {@code POST /api/v1/iqd/catalog/model}）。
     *
     * <p>与 {@link #createModelFromTable} 同口径（幂等键查重 → 语义幂等 → 乐观并发 →
     * 引用预校验 → 落库 → bump → 幂等键 → 变更事件），差异仅在**无源表**：
     * 只落一个 {@code kind=model} 节点（无 table/column 子节点），
     * {@code patch.primary_keys / is_time_dimension / is_email} 在该模型**已有字段**上生效
     * （空白模型无字段时应为空操作，待用户后续补字段）。
     *
     * <p>{@code patch.ref_sql} 落节点 {@code expression} 字段（模型定义体；与
     * {@code IqdMdlParser} 把 MDL model.expression 落 catalog expression 同构）。
     * {@code in_scope} 恒 0：语义对象默认不自动纳入问数范围（PRD §6.3「导入 ≠ 可问」），
     * 由 {@code /iqd/scope} 治理层显式勾选。
     *
     * @param connectionId   问数连接 id
     * @param itemKey        模型稳定键（须 {@code mdl:model:<name>}）
     * @param patch          {@code {display_name, description, primary_keys[], is_time_dimension{}, is_email{}, ref_sql?}}
     * @param baseRevision   乐观并发基线（null = 不校验）
     * @param idempotencyKey 幂等键（§8.4）
     * @return {@code {edit_revision, edit_status, wren_ref_id}}
     */
    @PreAuthorize("hasAuthority('iqd:modeling:edit')")
    @Transactional
    public IqdModelingCreateResponse createModel(
            Long connectionId,
            String itemKey,
            Map<String, Object> patch,
            Long baseRevision,
            String idempotencyKey) {

        // ---------- 0. 参数校验（42200） ----------
        if (itemKey == null || itemKey.isBlank() || !itemKey.startsWith(MODEL_ITEM_PREFIX)) {
            throw new BusinessException(42200, "item_key 必须形如 mdl:model:<name>", null);
        }
        String effectiveKey = itemKey.trim();

        // ---------- 连接存在 + 写回闸门（40300） ----------
        IqdConnection conn = requireWritableConnection(connectionId);

        // ---------- 1. 幂等键命中 → 返回首次结果，不 bump ----------
        Optional<IqdEditIdempotency> prev = findIdempotent(connectionId, idempotencyKey);
        if (prev.isPresent()) {
            log.info("IQD createModel idempotent hit by key connectionId={} key={}", connectionId, idempotencyKey);
            return created(prev.get().getEditRevision(), null);
        }

        // ---------- 1b. 语义幂等：同 item_key 已存在 → 返回首次结果，不 bump ----------
        Optional<IqdCatalogItem> existing =
                catalogItemRepository.findByConnectionIdAndItemKey(connectionId, effectiveKey);
        if (existing.isPresent()) {
            long rev = existing.get().getEditRevision() != null ? existing.get().getEditRevision()
                    : currentRevision(conn);
            log.info("IQD createModel semantic idempotent hit connectionId={} itemKey={}", connectionId, effectiveKey);
            return created(rev, existing.get().getWrenRefId());
        }

        // ---------- 2. 乐观并发（40900 + current_edit_revision） ----------
        long current = currentRevision(conn);
        checkBaseRevision(conn, baseRevision, current);

        // ---------- 3. 引用完整性预校验（CREATE：仅记录直接引用方，不阻断） ----------
        logRefs(connectionId, effectiveKey);

        // ---------- 4. 落 iqd_catalog_item（kind=model, source='modeling'） ----------
        long next = current + 1;
        Instant now = Instant.now();
        String displayName = patchText(patch, "display_name", nodeName(effectiveKey));
        String description = patchText(patch, "description", null);
        String refSql = patchText(patch, "ref_sql", null);
        upsertNode(connectionId, effectiveKey, "model", null, displayName, null, refSql,
                null, null, null, description, null, 0, next, now);
        applyModelPatchToColumns(connectionId, effectiveKey, patch, next, now);

        // ---------- 5. bump current_edit_revision ----------
        bumpRevision(conn, next, now);

        // ---------- 6. 写 iqd_edit_idempotency（40901 竞态） ----------
        recordIdempotency(connectionId, idempotencyKey, next, current);

        // ---------- 7. 发 iqd.catalog.changed ----------
        changeEventPublisher.publish("iqd.catalog.changed", "model=" + effectiveKey);

        log.info("IQD createModel created connectionId={} itemKey={} revision={}", connectionId, effectiveKey, next);
        return created(next, null);
    }

    // ------------------------------------------------------------------ createRelationship（T03 实现）

    /**
     * 建关系（画布连线即关系；v1.11 §3.3 {@code POST /api/v1/iqd/catalog/relationship}）。
     *
     * <p><b>校验链</b>：① 源/目标 model 均存在（42200，{@code data.field} +
     * {@code data.model_item_key}）→ ② {@code condition} 里的字段引用必须落在
     * 「源模型字段 ∪ 目标模型字段」内（42200，{@code data.unknown_fields}）。
     *
     * <p><b>落库形态</b>：{@code kind=relationship}，{@code parent_key}=源模型键，
     * {@code expression} = 关系信封 JSON
     * {@code {"join_type","cardinality","condition","source_model","target_model"}}。
     * 用 JSON 信封而非裸 condition 的理由：① 五个字段在 {@code iqd_catalog_item} 里
     * 没有专属列，信封保证**可无损回读**（ai-platform {@code build_mdl_from_catalog}
     * 据此物化 MDL relationship 的 models/joinType/condition）；② 信封内含
     * {@code mdl:model:*} 键 → 既有 {@code validateCatalogRefs} 的
     * {@code expression.contains(item_key)} 反向扫描天然把「删除被关系引用的模型」识别为阻断。
     *
     * @param connectionId   问数连接 id
     * @param itemKey        关系稳定键（§8.6 {@code mdl:relationship:<name>}）
     * @param patch          {@code {join_type,cardinality,condition,source_model,target_model}}
     * @param baseRevision   乐观并发基线（null = 不校验）
     * @param idempotencyKey 幂等键（§8.4）
     * @return {@code {edit_revision, edit_status, wren_ref_id}}
     */
    @PreAuthorize("hasAuthority('iqd:modeling:edit')")
    @Transactional
    public IqdModelingCreateResponse createRelationship(
            Long connectionId,
            String itemKey,
            Map<String, Object> patch,
            Long baseRevision,
            String idempotencyKey) {

        if (itemKey == null || itemKey.isBlank() || !itemKey.startsWith(RELATIONSHIP_ITEM_PREFIX)) {
            throw new BusinessException(42200, "item_key 必须形如 mdl:relationship:<name>", null);
        }
        if (patch == null) {
            throw new BusinessException(42200, "patch 不能为空", null);
        }
        String effectiveKey = itemKey.trim();

        IqdConnection conn = requireWritableConnection(connectionId);

        Optional<IqdEditIdempotency> prev = findIdempotent(connectionId, idempotencyKey);
        if (prev.isPresent()) {
            return created(prev.get().getEditRevision(), null);
        }
        Optional<IqdCatalogItem> existing =
                catalogItemRepository.findByConnectionIdAndItemKey(connectionId, effectiveKey);
        if (existing.isPresent()) {
            long rev = existing.get().getEditRevision() != null ? existing.get().getEditRevision()
                    : currentRevision(conn);
            return created(rev, existing.get().getWrenRefId());
        }

        long current = currentRevision(conn);
        checkBaseRevision(conn, baseRevision, current);

        // 关系语义字段
        String sourceModel = normalizeModelRef(str(patch.get("source_model")));
        String targetModel = normalizeModelRef(str(patch.get("target_model")));
        if (sourceModel == null || targetModel == null) {
            throw new BusinessException(42200, "source_model / target_model 不能为空", null);
        }
        String condition = str(patch.get("condition"));
        if (condition == null || condition.isBlank()) {
            throw new BusinessException(42200, "condition 不能为空", null);
        }
        String joinType = orDefault(str(patch.get("join_type")), "inner");
        String cardinality = orDefault(str(patch.get("cardinality")), "1:N");

        // ① 源/目标 model 存在性
        requireModel(connectionId, sourceModel, "source_model");
        requireModel(connectionId, targetModel, "target_model");

        // ② condition 引用字段存在性（源模型字段 ∪ 目标模型字段）
        Set<String> allowed = new LinkedHashSet<>(collectModelFields(connectionId, sourceModel));
        allowed.addAll(collectModelFields(connectionId, targetModel));
        Set<String> unknown = scanUnknownIdentifiers(condition, allowed);
        if (!unknown.isEmpty()) {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("unknown_fields", new ArrayList<>(unknown));
            data.put("source_model", sourceModel);
            data.put("target_model", targetModel);
            throw new BusinessException(42200, "condition 引用了不存在的字段", data);
        }

        long next = current + 1;
        Instant now = Instant.now();
        String envelope = relationshipEnvelope(joinType, cardinality, condition, sourceModel, targetModel);
        upsertNode(connectionId, effectiveKey, "relationship", sourceModel,
                nodeName(effectiveKey), null, envelope, null, null, null, null, null, 0, next, now);

        bumpRevision(conn, next, now);
        recordIdempotency(connectionId, idempotencyKey, next, current);
        changeEventPublisher.publish("iqd.catalog.changed", "relationship=" + effectiveKey);

        log.info("IQD createRelationship created connectionId={} itemKey={} {}->{} revision={}",
                connectionId, effectiveKey, sourceModel, targetModel, next);
        return created(next, null);
    }

    // ------------------------------------------------------------------ createCube（T03 实现）

    /**
     * 建 Cube + measures + dimensions 子节点（v1.11 §3.3 {@code POST /api/v1/iqd/catalog/cube}）。
     *
     * <p><b>校验链</b>：① {@code model_ref} 指向的模型必须存在（42200）→ ② 每个
     * measure 的 {@code expression} 与每个 dimension 的 {@code ref_model_field} 必须落在
     * **该模型可见字段**内（42201 + {@code data.errors}，沿用 {@link #validateExpression}
     * 的字段存在性扫描，保存前阻断）。
     *
     * <p><b>落库形态</b>（§8.6）：
     * <ul>
     *   <li>{@code kind=cube}，{@code item_key=mdl:cube:<name>}，{@code parent_key=model_ref}，
     *       <b>{@code model_ref} 列必须写入</b>（V89；这是 T02b-1 暴露的缺口——
     *       前端据此精确挂靠 cube 到模型节点，不再靠 expression 启发式猜测）；
     *       {@code expression} 保持 {@code NULL}（cube 的 expression 是二义列，不写）；</li>
     *   <li>{@code kind=measure}，{@code item_key=mdl:measure:<cube>.<name>}，
     *       {@code parent_key=mdl:cube:<cube>}，{@code expression}=measure 表达式，
     *       {@code data_type}=format；</li>
     *   <li>{@code kind=dimension}，{@code item_key=mdl:dimension:<cube>.<name>}，
     *       {@code parent_key=mdl:cube:<cube>}，{@code expression}=ref_model_field。</li>
     * </ul>
     *
     * @param connectionId   问数连接 id
     * @param itemKey        Cube 稳定键（§8.6 {@code mdl:cube:<name>}）
     * @param patch          {@code {display_name, model_ref, measures:[{name,expression,format?}], dimensions:[{name,ref_model_field}]}}
     * @param baseRevision   乐观并发基线（null = 不校验）
     * @param idempotencyKey 幂等键（§8.4）
     * @return {@code {edit_revision, edit_status, wren_ref_id}}
     */
    @PreAuthorize("hasAuthority('iqd:modeling:edit')")
    @Transactional
    public IqdModelingCreateResponse createCube(
            Long connectionId,
            String itemKey,
            Map<String, Object> patch,
            Long baseRevision,
            String idempotencyKey) {

        if (itemKey == null || itemKey.isBlank() || !itemKey.startsWith(CUBE_ITEM_PREFIX)) {
            throw new BusinessException(42200, "item_key 必须形如 mdl:cube:<name>", null);
        }
        if (patch == null) {
            throw new BusinessException(42200, "patch 不能为空", null);
        }
        String effectiveKey = itemKey.trim();

        IqdConnection conn = requireWritableConnection(connectionId);

        Optional<IqdEditIdempotency> prev = findIdempotent(connectionId, idempotencyKey);
        if (prev.isPresent()) {
            return created(prev.get().getEditRevision(), null);
        }
        Optional<IqdCatalogItem> existing =
                catalogItemRepository.findByConnectionIdAndItemKey(connectionId, effectiveKey);
        if (existing.isPresent()) {
            long rev = existing.get().getEditRevision() != null ? existing.get().getEditRevision()
                    : currentRevision(conn);
            return created(rev, existing.get().getWrenRefId());
        }

        long current = currentRevision(conn);
        checkBaseRevision(conn, baseRevision, current);

        // ① model_ref 指向的模型必须存在
        String modelRef = normalizeModelRef(str(patch.get("model_ref")));
        if (modelRef == null) {
            throw new BusinessException(42200, "model_ref 不能为空（cube 必须挂靠一个模型）", null);
        }
        requireModel(connectionId, modelRef, "model_ref");

        List<Map<String, Object>> measures = asMapList(patch.get("measures"));
        List<Map<String, Object>> dimensions = asMapList(patch.get("dimensions"));
        Set<String> allowed = collectModelFields(connectionId, modelRef);
        List<String> errors = new ArrayList<>();

        for (Map<String, Object> measure : measures) {
            String name = str(measure.get("name"));
            String expr = str(measure.get("expression"));
            if (name == null || name.isBlank() || expr == null || expr.isBlank()) {
                throw new BusinessException(42200, "measures[].name / measures[].expression 不能为空", null);
            }
            for (String token : scanUnknownIdentifiers(expr, allowed)) {
                errors.add("measure " + name + " 引用不存在字段: " + token);
            }
        }
        for (Map<String, Object> dimension : dimensions) {
            String name = str(dimension.get("name"));
            String refField = str(dimension.get("ref_model_field"));
            if (name == null || name.isBlank() || refField == null || refField.isBlank()) {
                throw new BusinessException(42200, "dimensions[].name / dimensions[].ref_model_field 不能为空", null);
            }
            if (!matchesAny(allowed, refField.toLowerCase(LOWER))) {
                errors.add("dimension " + name + " 引用不存在字段: " + refField);
            }
        }
        if (!errors.isEmpty()) {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("errors", errors);
            data.put("model_ref", modelRef);
            throw new BusinessException(42201, "cube 引用了不存在的字段", data);
        }

        long next = current + 1;
        Instant now = Instant.now();
        String cubeName = nodeName(effectiveKey);
        String displayName = patchText(patch, "display_name", cubeName);

        // ② 落 cube 节点（**必须写 model_ref**）
        upsertNode(connectionId, effectiveKey, "cube", modelRef, displayName, null, null,
                null, null, null, null, modelRef, 0, next, now);

        // ③ 落 measures 子节点
        for (Map<String, Object> measure : measures) {
            String name = str(measure.get("name")).trim();
            String measureKey = MEASURE_ITEM_PREFIX + cubeName + "." + name;
            upsertNode(connectionId, measureKey, "measure", effectiveKey, name,
                    str(measure.get("format")), str(measure.get("expression")),
                    null, null, null, null, null, 0, next, now);
        }

        // ④ 落 dimensions 子节点
        for (Map<String, Object> dimension : dimensions) {
            String name = str(dimension.get("name")).trim();
            String dimensionKey = DIMENSION_ITEM_PREFIX + cubeName + "." + name;
            upsertNode(connectionId, dimensionKey, "dimension", effectiveKey, name,
                    null, str(dimension.get("ref_model_field")),
                    null, null, null, null, null, 0, next, now);
        }

        bumpRevision(conn, next, now);
        recordIdempotency(connectionId, idempotencyKey, next, current);
        changeEventPublisher.publish("iqd.catalog.changed", "cube=" + effectiveKey + ";model=" + modelRef);

        log.info("IQD createCube created connectionId={} itemKey={} modelRef={} measures={} dimensions={} revision={}",
                connectionId, effectiveKey, modelRef, measures.size(), dimensions.size(), next);
        return created(next, null);
    }

    // ------------------------------------------------------------------ upsertCube（T04a 实现）

    /**
     * 更新既有 Cube（自身字段 + measures/dimensions 子节点增删改 + 孤儿清理）。
     * v1.11 §3.3 {@code PUT /api/v1/iqd/catalog/cube}（与 {@link #createCube} 的
     * {@code POST /catalog/cube} 并列，语义为「更新既有」）。
     *
     * <h2>为什么单开一个端点（T03c 验证的缺口）</h2>
     * 三条既有路径都无法「编辑既有 Cube」：
     * <ol>
     *   <li>{@code POST /catalog/cube} 是 <b>create-only + 双幂等</b>：同 key 返回首次结果、
     *       <b>不应用新字段</b>；若拿它当「可编辑」用，表现为「提示保存成功但实际没改」的静默缺陷；</li>
     *   <li>{@code PUT /catalog/node} 只能改<b>单节点自身字段</b>，动不了 measure/dimension 子节点；</li>
     *   <li>{@code POST /catalog/batch} 是「MDL/物料镜像」语义、<b>不写 {@code edit_revision}</b>；
     *       派生用 {@code findEditedItems}（{@code edit_revision IS NOT NULL}）取编辑节点，
     *       用它改子节点会让 Cube <b>永远进不了 build</b>（比不支持编辑更糟）。</li>
     * </ol>
     *
     * <h2>patch = 全量替换语义（PUT）</h2>
     * {@code measures / dimensions} 传<b>完整目标集合</b>：服务端按 {@code item_key} 与之求差 ——
     * 传入的 upsert、本次未出现（且既存）的子节点 <b>删除</b>（孤儿清理，见
     * {@link #pruneOrphanChildren}）。缺省/空列表 = 清空该类子节点（符合 PUT 语义）。
     *
     * <h2>校验链</h2>
     * 写回闸门（40300）→ 幂等键命中（返回首次结果，不 bump）→ cube 存在性（42200）→
     * {@code base_revision} 乐观并发（40900）→ {@code model_ref} 归一（patch 优先、缺省沿用既有列值；
     * 仍缺失 → 42200，见下）→ {@code model_ref} 指向模型存在（42200）→
     * measure/dimension 引用字段存在性（42201 + {@code data.errors}）。
     *
     * <p><b>T04a 加固</b>：cube 的 {@code model_ref} 缺失时，派生侧
     * {@code _materialize_missing_nodes} 会创建一个<b>没有 {@code baseObject} 的 cube</b>
     * （静默降级，可能产出非法 cube）。故创建（{@link #createCube}）与更新（本方法）
     * <b>均强制要求 {@code model_ref}</b>，缺失即 42200 打回，从写入侧关闭该缺口。
     *
     * <p>{@code in_scope} 恒 0：与 T03a 确立的口径一致 —— 新建/更新的语义对象
     * <b>不自动纳入问数范围</b>（PRD §6.3「导入 ≠ 可问」）。
     *
     * @param connectionId   问数连接 id
     * @param itemKey        Cube 稳定键（§8.6 {@code mdl:cube:<name>}）
     * @param patch          {@code {display_name?, model_ref?, measures:[{name,expression,format?}], dimensions:[{name,ref_model_field}]}}
     * @param baseRevision   乐观并发基线（null = 不校验）
     * @param idempotencyKey 幂等键（§8.4；同 key 重放返回首次结果，见 §8.4「每次提交用新 uuid」）
     * @return {@code {edit_revision, edit_status, wren_ref_id}}
     */
    @PreAuthorize("hasAuthority('iqd:modeling:edit')")
    @Transactional
    public IqdModelingCreateResponse upsertCube(
            Long connectionId,
            String itemKey,
            Map<String, Object> patch,
            Long baseRevision,
            String idempotencyKey) {

        // ---------- 0. 参数校验（42200） ----------
        if (itemKey == null || itemKey.isBlank() || !itemKey.startsWith(CUBE_ITEM_PREFIX)) {
            throw new BusinessException(42200, "item_key 必须形如 mdl:cube:<name>", null);
        }
        if (patch == null) {
            throw new BusinessException(42200, "patch 不能为空", null);
        }
        String effectiveKey = itemKey.trim();

        // ---------- 连接存在 + 写回闸门（40300） ----------
        IqdConnection conn = requireWritableConnection(connectionId);

        // ---------- 1. 幂等键命中 → 返回首次结果，不 bump ----------
        //    PUT 语义下同 key 重放 = 同一逻辑请求的断线重试（§8.4：每次**新**提交用新 uuid）。
        Optional<IqdEditIdempotency> prev = findIdempotent(connectionId, idempotencyKey);
        if (prev.isPresent()) {
            log.info("IQD upsertCube idempotent hit by key connectionId={} key={}", connectionId, idempotencyKey);
            return created(prev.get().getEditRevision(), null);
        }

        // ---------- 2. cube 必须已存在（本端点是「更新既有」，非 create） ----------
        IqdCatalogItem existingCube = catalogItemRepository
                .findByConnectionIdAndItemKey(connectionId, effectiveKey).orElse(null);
        if (existingCube == null || !"cube".equals(existingCube.getKind())) {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("field", "item_key");
            data.put("item_key", effectiveKey);
            throw new BusinessException(42200, "被更新的 cube 不存在: " + effectiveKey, data);
        }

        // ---------- 3. 乐观并发（40900 + current_edit_revision） ----------
        long current = currentRevision(conn);
        checkBaseRevision(conn, baseRevision, current);

        // ---------- 4. model_ref：patch 优先；缺省沿用既有列值；仍缺失 → 42200（T04a 加固） ----------
        String modelRef = normalizeModelRef(str(patch.get("model_ref")));
        if (modelRef == null) {
            modelRef = existingCube.getModelRef();
        }
        if (modelRef == null) {
            throw new BusinessException(42200, "model_ref 不能为空（cube 必须挂靠一个模型）", null);
        }
        requireModel(connectionId, modelRef, "model_ref");

        // ---------- 5. measures/dimensions 引用字段存在性（保存前阻断 → 42201） ----------
        List<Map<String, Object>> measures = asMapList(patch.get("measures"));
        List<Map<String, Object>> dimensions = asMapList(patch.get("dimensions"));
        Set<String> allowed = collectModelFields(connectionId, modelRef);
        List<String> errors = new ArrayList<>();
        for (Map<String, Object> measure : measures) {
            String name = str(measure.get("name"));
            String expr = str(measure.get("expression"));
            if (name == null || name.isBlank() || expr == null || expr.isBlank()) {
                throw new BusinessException(42200, "measures[].name / measures[].expression 不能为空", null);
            }
            for (String token : scanUnknownIdentifiers(expr, allowed)) {
                errors.add("measure " + name + " 引用不存在字段: " + token);
            }
        }
        for (Map<String, Object> dimension : dimensions) {
            String name = str(dimension.get("name"));
            String refField = str(dimension.get("ref_model_field"));
            if (name == null || name.isBlank() || refField == null || refField.isBlank()) {
                throw new BusinessException(42200, "dimensions[].name / dimensions[].ref_model_field 不能为空", null);
            }
            if (!matchesAny(allowed, refField.toLowerCase(LOWER))) {
                errors.add("dimension " + name + " 引用不存在字段: " + refField);
            }
        }
        if (!errors.isEmpty()) {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("errors", errors);
            data.put("model_ref", modelRef);
            throw new BusinessException(42201, "cube 引用了不存在的字段", data);
        }

        long next = current + 1;
        Instant now = Instant.now();
        String cubeName = nodeName(effectiveKey);
        String existingDisplay = (existingCube.getDisplayName() != null && !existingCube.getDisplayName().isBlank())
                ? existingCube.getDisplayName() : cubeName;
        String displayName = patchText(patch, "display_name", existingDisplay);

        // ---------- 6. 更新 cube 自身（display_name / model_ref；expression 保持 NULL —— 二义列不写） ----------
        upsertNode(connectionId, effectiveKey, "cube", modelRef, displayName, null, null,
                null, null, null, null, modelRef, 0, next, now);

        // ---------- 7. 子节点 upsert（in_scope=0 与 T03a 同口径；item_key 与 createCube 对齐） ----------
        Set<String> incomingKeys = new LinkedHashSet<>();
        for (Map<String, Object> measure : measures) {
            String name = str(measure.get("name")).trim();
            String measureKey = MEASURE_ITEM_PREFIX + cubeName + "." + name;
            incomingKeys.add(measureKey);
            upsertNode(connectionId, measureKey, "measure", effectiveKey, name,
                    str(measure.get("format")), str(measure.get("expression")),
                    null, null, null, null, null, 0, next, now);
        }
        for (Map<String, Object> dimension : dimensions) {
            String name = str(dimension.get("name")).trim();
            String dimensionKey = DIMENSION_ITEM_PREFIX + cubeName + "." + name;
            incomingKeys.add(dimensionKey);
            upsertNode(connectionId, dimensionKey, "dimension", effectiveKey, name,
                    null, str(dimension.get("ref_model_field")),
                    null, null, null, null, null, 0, next, now);
        }

        // ---------- 8. 孤儿清理：本次未出现的既有 measure/dimension 子节点删除 ----------
        int pruned = pruneOrphanChildren(connectionId, effectiveKey, incomingKeys);

        // ---------- 9. bump current_edit_revision（必须，否则进不了 build） ----------
        bumpRevision(conn, next, now);

        // ---------- 10. 写 iqd_edit_idempotency（40901 竞态） ----------
        recordIdempotency(connectionId, idempotencyKey, next, current);

        // ---------- 11. 发 iqd.catalog.changed ----------
        changeEventPublisher.publish("iqd.catalog.changed", "cube=" + effectiveKey + ";model=" + modelRef);

        log.info("IQD upsertCube updated connectionId={} itemKey={} modelRef={} measures={} dimensions={} pruned={} revision={}",
                connectionId, effectiveKey, modelRef, measures.size(), dimensions.size(), pruned, next);
        return created(next, existingCube.getWrenRefId());
    }

    // ------------------------------------------------------------------ createCalculatedColumn（T03 实现）

    /**
     * 建计算列（MR-04；v1.11 §3.3 {@code POST /api/v1/iqd/catalog/calculated-column}）。
     *
     * <p><b>校验链</b>：① 宿主模型存在（42200）→ ② {@code expression} 引用字段须在
     * **本模型内**存在（42201 + {@code data.errors}）。复用 T02a 的
     * {@link #validateExpression}，语义完全一致（字符串字面量剔除 + SQL 关键字白名单 +
     * 逐级回退匹配），前端提交前亦可先调 {@code GET /catalog/validate-expression} 预校验（A-10）。
     *
     * <p><b>落库形态</b>（§8.6 {@code calc:<model>.<column_name>}）：
     * {@code kind=column}、{@code parent_key=<model_item_key>}、{@code expression=<expr>}。
     * 落库后 build 会把该表达式物化进派生 MDL 的 model.columns，问数即可按其聚合/过滤。
     *
     * <p><b>返回类型说明</b>：返回 {@code Map}（而非 {@code IqdModelingCreateResponse}），
     * 因为 §3.3 的出参契约为
     * {@code {edit_revision, edit_status, item_key, validated, errors?}} —— 多出
     * {@code item_key/validated} 两个字段（前端 {@code CreateCalculatedColumnResponse}
     * 依赖）。§5 类图对该方法只写了统一出参，此处以**端点契约**为准（与
     * {@link #createModelFromTable} 返回 {@code Map} 同例）。
     *
     * @param connectionId   问数连接 id
     * @param modelItemKey   宿主模型稳定键（{@code mdl:model:<name>}）
     * @param columnName     计算列名
     * @param expression     表达式（CodeMirror 录入）
     * @param baseRevision   乐观并发基线（null = 不校验）
     * @param idempotencyKey 幂等键（§8.4）
     * @return {@code {edit_revision, edit_status, wren_ref_id, item_key, validated, errors}}
     */
    @PreAuthorize("hasAuthority('iqd:modeling:edit')")
    @Transactional
    public Map<String, Object> createCalculatedColumn(
            Long connectionId,
            String modelItemKey,
            String columnName,
            String expression,
            Long baseRevision,
            String idempotencyKey) {

        if (modelItemKey == null || modelItemKey.isBlank()) {
            throw new BusinessException(42200, "model_item_key 不能为空", null);
        }
        if (columnName == null || columnName.isBlank()) {
            throw new BusinessException(42200, "column_name 不能为空", null);
        }
        if (expression == null || expression.isBlank()) {
            throw new BusinessException(42200, "expression 不能为空", null);
        }
        String hostModel = modelItemKey.trim();
        String colName = columnName.trim();

        IqdConnection conn = requireWritableConnection(connectionId);

        // 宿主模型存在性 + 计算列稳定键（§8.6 calc:<model>.<column_name>）
        IqdCatalogItem model = requireModel(connectionId, hostModel, "model_item_key");
        String modelName = (model.getDisplayName() != null && !model.getDisplayName().isBlank())
                ? model.getDisplayName() : nodeName(hostModel);
        String calcKey = CALC_ITEM_PREFIX + modelName + "." + colName;

        Optional<IqdEditIdempotency> prev = findIdempotent(connectionId, idempotencyKey);
        if (prev.isPresent()) {
            return calcResult(prev.get().getEditRevision(), calcKey, List.of());
        }
        Optional<IqdCatalogItem> existing =
                catalogItemRepository.findByConnectionIdAndItemKey(connectionId, calcKey);
        if (existing.isPresent()) {
            long rev = existing.get().getEditRevision() != null ? existing.get().getEditRevision()
                    : currentRevision(conn);
            return calcResult(rev, calcKey, List.of());
        }

        long current = currentRevision(conn);
        checkBaseRevision(conn, baseRevision, current);

        // 表达式引用字段存在性（保存前阻断 → 42201）
        ValidateExprResult validated = validateExpression(connectionId, hostModel, expression);
        if (!validated.isValid()) {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("errors", validated.getErrors());
            data.put("item_key", calcKey);
            data.put("model_item_key", hostModel);
            throw new BusinessException(42201, "计算列表达式引用了不存在的字段", data);
        }

        long next = current + 1;
        Instant now = Instant.now();
        upsertNode(connectionId, calcKey, "column", hostModel, colName, null, expression,
                null, null, null, null, null, 0, next, now);

        bumpRevision(conn, next, now);
        recordIdempotency(connectionId, idempotencyKey, next, current);
        changeEventPublisher.publish("iqd.catalog.changed", "calculated_column=" + calcKey);

        log.info("IQD createCalculatedColumn created connectionId={} itemKey={} model={} revision={}",
                connectionId, calcKey, hostModel, next);
        return calcResult(next, calcKey, List.of());
    }


    // ------------------------------------------------------------------ 删除关系（T03c 删除路径）

    /**
     * 删除关系（{@code DELETE /api/v1/iqd/catalog/relationship/{itemKey}}；T03c）。
     *
     * <p><b>为什么单独建删除端点而不给 {@code PUT /catalog/node} 加 delete 语义</b>：
     * 关系是**叶子节点**（不承载列语义、不被其它节点以 {@code expression} 引用），
     * 删除风险最低；而通用节点删除会牵动模型/字段/父子清理，属另一档工作量。
     * 先只做关系删除，符合「最小可用 + fail-closed」。
     *
     * <p><b>校验链</b>：① {@code itemKey} 形态（42200）→ ② 连接存在 + 写回闸门（40300）
     * → ③ 关系节点存在且 {@code kind=relationship}（40400）→ ④ {@code base_revision}
     * 乐观并发（40900）→ ⑤ 物理删除 → ⑥ bump {@code current_edit_revision}
     * → ⑦ 幂等记录 + 变更事件。
     *
     * <p><b>为何物理删除</b>：与 T04a cube 子节点孤儿清理同口径 —— 关系没有历史语义，
     * 软删除会让「删了还在」的悬挂引用长期存在；行消失即天然排除在 MDL 派生之外。
     *
     * @param connectionId   问数连接 id
     * @param itemKey        关系稳定键（{@code mdl:relationship:<name>}）
     * @param baseRevision   乐观并发基线（null = 不校验）
     * @param idempotencyKey 幂等键（§8.4）
     * @return {@code {edit_revision, edit_status, deleted_item_key}}
     */
    @PreAuthorize("hasAuthority('iqd:modeling:edit')")
    @Transactional
    public Map<String, Object> deleteRelationship(
            Long connectionId,
            String itemKey,
            Long baseRevision,
            String idempotencyKey) {

        if (itemKey == null || itemKey.isBlank() || !itemKey.startsWith(RELATIONSHIP_ITEM_PREFIX)) {
            throw new BusinessException(42200, "item_key 必须形如 mdl:relationship:<name>", null);
        }
        String effectiveKey = itemKey.trim();

        IqdConnection conn = requireWritableConnection(connectionId);

        // 幂等命中：返回首次结果，不二次删除、不二次 bump
        Optional<IqdEditIdempotency> prev = findIdempotent(connectionId, idempotencyKey);
        if (prev.isPresent()) {
            return deleted(prev.get().getEditRevision(), effectiveKey);
        }

        IqdCatalogItem item = catalogItemRepository
                .findByConnectionIdAndItemKey(connectionId, effectiveKey)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND.getCode(),
                        "关系不存在: " + effectiveKey,
                        Map.of("item_key", effectiveKey)));
        if (!"relationship".equals(item.getKind())) {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("item_key", effectiveKey);
            data.put("actual_kind", item.getKind());
            throw new BusinessException(42200, "该节点不是关系，无法用本端点删除", data);
        }

        long current = currentRevision(conn);
        checkBaseRevision(conn, baseRevision, current);

        // 引用阻断：关系被其它节点直接引用时不允许删除（当前无此类引用，属兜底；与改名同口径）
        List<Map<String, Object>> dependents =
                adminService.validateCatalogRefs(connectionId, effectiveKey, "DELETE");
        if (!dependents.isEmpty()) {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("dependents", dependents);
            throw new BusinessException(42200, "该关系被引用，禁止删除", data);
        }

        long next = current + 1;
        Instant now = Instant.now();
        catalogItemRepository.delete(item);

        bumpRevision(conn, next, now);
        recordIdempotency(connectionId, idempotencyKey, next, current);
        changeEventPublisher.publish("iqd.catalog.changed", "relationship_deleted=" + effectiveKey);

        log.info("IQD deleteRelationship connectionId={} itemKey={} revision={}",
                connectionId, effectiveKey, next);
        return deleted(next, effectiveKey);
    }

    /** 删除关系结果（{@code {edit_revision, edit_status, deleted_item_key}}）。 */
    private static Map<String, Object> deleted(long revision, String itemKey) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("edit_revision", revision);
        r.put("edit_status", EDITED_UNSYNCED);
        r.put("deleted_item_key", itemKey);
        return r;
    }

    // ------------------------------------------------------------------ 依赖方（复用二/四期）

    /**
     * 列出直接引用方（复用 {@link IqdAdminService#validateCatalogRefs}，不重写扫描逻辑）。
     *
     * @param connectionId 问数连接 id
     * @param itemKey      被查节点稳定键
     * @return {@code {dependents:[{item_key,kind}], total}}
     */
    @Transactional(readOnly = true)
    public IqdDependents listDependents(Long connectionId, String itemKey) {
        List<Map<String, Object>> deps = adminService.validateCatalogRefs(connectionId, itemKey, "EDIT");
        List<com.mis.iqd.api.dto.Dependent> out = new ArrayList<>();
        for (Map<String, Object> d : deps) {
            out.add(new com.mis.iqd.api.dto.Dependent(str(d.get("item_key")), str(d.get("kind"))));
        }
        return new IqdDependents(out);
    }

    // ------------------------------------------------------------------ 新建节点族内部辅助（T03）

    /** 新建节点统一结果（§3.3 {@code {edit_revision, edit_status, wren_ref_id}}）。 */
    private static IqdModelingCreateResponse created(long revision, String wrenRefId) {
        return new IqdModelingCreateResponse(revision, EDITED_UNSYNCED, wrenRefId);
    }

    /** 计算列出参（§3.3 额外携带 {@code item_key / validated / errors}）。 */
    private static Map<String, Object> calcResult(long revision, String itemKey, List<String> errors) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("edit_revision", revision);
        r.put("edit_status", EDITED_UNSYNCED);
        r.put("wren_ref_id", null);
        r.put("item_key", itemKey);
        r.put("validated", errors == null || errors.isEmpty());
        r.put("errors", errors == null ? List.of() : errors);
        return r;
    }

    private static long currentRevision(IqdConnection conn) {
        return conn.getCurrentEditRevision() == null ? 0L : conn.getCurrentEditRevision();
    }

    /** 连接存在性 + MDL 写回闸门（{@code 40300}）。 */
    private IqdConnection requireWritableConnection(Long connectionId) {
        if (connectionId == null) {
            throw new BusinessException(42200, "connectionId 不能为空", null);
        }
        IqdConnection conn = connectionRepository.findById(connectionId)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND,
                        "问数连接不存在: " + connectionId));
        if (!Boolean.TRUE.equals(conn.getMdlWritebackEnabled())) {
            throw new BusinessException(40300, "该连接未开启 MDL 写回（mdl_writeback_enabled=false）", null);
        }
        return conn;
    }

    /** 幂等键查重（空键 → 不查，调用方视为「不做幂等」）。 */
    private Optional<IqdEditIdempotency> findIdempotent(Long connectionId, String idempotencyKey) {
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            return Optional.empty();
        }
        return idempotencyRepository.findByConnectionIdAndIdempotencyKey(connectionId, idempotencyKey);
    }

    /** 乐观并发（{@code 40900} + {@code data.current_edit_revision}）。 */
    private static void checkBaseRevision(IqdConnection conn, Long baseRevision, long current) {
        if (baseRevision != null && !baseRevision.equals(current)) {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("current_edit_revision", current);
            throw new BusinessException(40900, "并发编辑冲突：当前版本已变更", data);
        }
    }

    /** bump 连接级编辑版本（并发编辑冲突的判据来源）。 */
    private void bumpRevision(IqdConnection conn, long next, Instant now) {
        conn.setCurrentEditRevision(next);
        conn.setUpdatedAt(now);
        connectionRepository.save(conn);
    }

    /** 写幂等键；撞 PK（同 key **并发**双提交）→ {@code 40901}，回滚本次事务（含节点写入与 bump）。 */
    private void recordIdempotency(Long connectionId, String idempotencyKey, long next, long current) {
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            return;
        }
        try {
            idempotencyRepository.save(new IqdEditIdempotency(connectionId, idempotencyKey, next));
        } catch (DataIntegrityViolationException ex) {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("idempotency_key", idempotencyKey);
            data.put("current_edit_revision", current);
            throw new BusinessException(40901, "幂等键重复提交（同 key 并发）", data);
        }
    }

    /** 引用完整性预校验（{@code CREATE} 语义：仅记录直接引用方，不阻断创建）。 */
    private void logRefs(Long connectionId, String itemKey) {
        List<Map<String, Object>> refs = adminService.validateCatalogRefs(connectionId, itemKey, "CREATE");
        if (!refs.isEmpty()) {
            log.info("IQD create refs pre-check connectionId={} itemKey={} deps={}",
                    connectionId, itemKey, refs.size());
        }
    }

    /** 归一 model 引用：{@code orders} / {@code mdl:model:orders} → {@code mdl:model:orders}；空 → {@code null}。 */
    private static String normalizeModelRef(String modelRef) {
        if (modelRef == null || modelRef.isBlank()) {
            return null;
        }
        String v = modelRef.trim();
        return v.startsWith(MODEL_ITEM_PREFIX) ? v : MODEL_ITEM_PREFIX + v;
    }

    /** 断言模型存在（{@code 42200} + {@code data.field} / {@code data.model_item_key}）。 */
    private IqdCatalogItem requireModel(Long connectionId, String modelItemKey, String field) {
        IqdCatalogItem model = catalogItemRepository
                .findByConnectionIdAndItemKey(connectionId, modelItemKey).orElse(null);
        if (model == null || !"model".equals(model.getKind())) {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("field", field);
            data.put("model_item_key", modelItemKey);
            throw new BusinessException(42200, "被引用的模型不存在: " + modelItemKey, data);
        }
        return model;
    }

    /**
     * 关系信封 JSON（五字段全部可无损回读；ai-platform {@code build_mdl_from_catalog}
     * 据此物化 MDL relationship 的 {@code models / joinType / condition}）。
     */
    private static String relationshipEnvelope(String joinType, String cardinality, String condition,
            String sourceModel, String targetModel) {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("join_type", joinType);
        fields.put("cardinality", cardinality);
        fields.put("condition", condition);
        fields.put("source_model", sourceModel);
        fields.put("target_model", targetModel);
        StringBuilder sb = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, Object> e : fields.entrySet()) {
            if (!first) {
                sb.append(',');
            }
            first = false;
            sb.append('"').append(jsonEscape(e.getKey())).append("\":");
            if (e.getValue() == null) {
                sb.append("null");
            } else {
                sb.append('"').append(jsonEscape(String.valueOf(e.getValue()))).append('"');
            }
        }
        return sb.append('}').toString();
    }

    private static String jsonEscape(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    /**
     * 应用模型 patch 到**该模型已有字段**：{@code primary_keys[]} /
     * {@code is_time_dimension{}} / {@code is_email{}}（按字段名匹配）。
     * 空白模型（尚无字段）时为空操作 —— patch 待后续编辑抽屉落到具体字段上。
     */
    private void applyModelPatchToColumns(Long connectionId, String modelItemKey,
            Map<String, Object> patch, long revision, Instant now) {
        if (patch == null) {
            return;
        }
        Set<String> primaryKeys = asStringSet(patch.get("primary_keys"));
        Map<String, Object> timeDims = asMap(patch.get("is_time_dimension"));
        Map<String, Object> emails = asMap(patch.get("is_email"));
        if (primaryKeys.isEmpty() && timeDims.isEmpty() && emails.isEmpty()) {
            return;
        }
        IqdCatalogItem model = catalogItemRepository
                .findByConnectionIdAndItemKey(connectionId, modelItemKey).orElse(null);
        String modelName = model != null ? model.getDisplayName() : null;
        String tableKey = null;
        if (modelName != null && !modelName.isBlank()) {
            for (IqdCatalogItem it : catalogItemRepository.findByConnectionId(connectionId)) {
                if ("table".equals(it.getKind()) && it.getItemKey() != null
                        && it.getItemKey().toLowerCase(LOWER).endsWith("." + modelName.toLowerCase(LOWER))) {
                    tableKey = it.getItemKey();
                    break;
                }
            }
        }
        for (IqdCatalogItem col : catalogItemRepository.findByConnectionId(connectionId)) {
            if (!"column".equals(col.getKind())) {
                continue;
            }
            boolean belongs = modelItemKey.equals(col.getParentKey())
                    || (tableKey != null && tableKey.equals(col.getParentKey()));
            if (!belongs) {
                continue;
            }
            String name = col.getDisplayName() != null ? col.getDisplayName() : lastSegment(col.getItemKey());
            if (name == null) {
                continue;
            }
            boolean dirty = false;
            if (primaryKeys.contains(name)) {
                col.setIsPrimaryKey(1);
                dirty = true;
            }
            if (timeDims.containsKey(name)) {
                col.setIsTimeDimension(Boolean.TRUE.equals(toBoolean(timeDims.get(name))) ? 1 : 0);
                dirty = true;
            }
            if (emails.containsKey(name)) {
                col.setIsEmail(Boolean.TRUE.equals(toBoolean(emails.get(name))) ? 1 : 0);
                dirty = true;
            }
            if (dirty) {
                col.setSource("modeling");
                col.setEditRevision(revision);
                col.setUpdatedAt(now);
                col.setLastSeenAt(now);
                catalogItemRepository.save(col);
            }
        }
    }

    /** wire 值 → 字符串 Map（非 Map → 空 Map；键统一 String）。 */
    private static Map<String, Object> asMap(Object value) {
        if (value instanceof Map<?, ?> m) {
            Map<String, Object> out = new LinkedHashMap<>();
            for (Map.Entry<?, ?> e : m.entrySet()) {
                out.put(String.valueOf(e.getKey()), e.getValue());
            }
            return out;
        }
        return Map.of();
    }

    /** wire 值 → {@code List<Map>}（非 List / 非 Map 元素一律跳过）。 */
    private static List<Map<String, Object>> asMapList(Object value) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (value instanceof List<?> list) {
            for (Object o : list) {
                if (o instanceof Map<?, ?> m) {
                    Map<String, Object> item = new LinkedHashMap<>();
                    for (Map.Entry<?, ?> e : m.entrySet()) {
                        item.put(String.valueOf(e.getKey()), e.getValue());
                    }
                    out.add(item);
                }
            }
        }
        return out;
    }

    /** wire 值 → 字符串集合（非 List → 空集合；去空白）。 */
    private static Set<String> asStringSet(Object value) {
        Set<String> out = new LinkedHashSet<>();
        if (value instanceof List<?> list) {
            for (Object o : list) {
                if (o != null && !String.valueOf(o).isBlank()) {
                    out.add(String.valueOf(o).trim());
                }
            }
        }
        return out;
    }

    /** 取非空白值，否则 fallback。 */
    private static String orDefault(String value, String fallback) {
        return (value == null || value.isBlank()) ? fallback : value.trim();
    }

    /** 取 patch 里的文本字段（缺失 / 空白 → fallback）。 */
    private static String patchText(Map<String, Object> patch, String key, String fallback) {
        if (patch == null) {
            return fallback;
        }
        String v = str(patch.get(key));
        return (v == null || v.isBlank()) ? fallback : v.trim();
    }

    // ------------------------------------------------------------------ 源表解析内部

    /** 源表解析结果：物理表 key + 列定义。 */
    private record SourceTable(String tableKey, List<Map<String, Object>> columns) {
    }

    /**
     * 解析源表列，优先级：① 请求携带的 {@code source_table.columns}（Worker 经
     * {@code wren describe-model} 取得，导入路径主用）→ ② catalog 既有 table/column 行 →
     * ③ 连接 MDL 基线 {@code mdl_raw}（经 {@link IqdMdlParser}）。
     *
     * <p>三级回退的理由：M-G1 的连接是**新建**的，既无 catalog 行也未必有 mdl_raw；
     * 让 Worker 顺带把列元数据（它本来就要读）带下来，导入路径即可自足，无需强制
     * 先跑一次 MDL 同步。
     *
     * @return 解析结果；三级都取不到返回 {@code null}（调用方转 42200）
     */
    @SuppressWarnings("unchecked")
    private SourceTable resolveSourceTable(Long connectionId, String schema, String table, Map<String, Object> sourceTable) {
        String tableKey = findExistingTableKey(connectionId, schema, table)
                .orElseGet(() -> defaultTableKey(schema, table));

        // ① 请求携带列
        Object provided = sourceTable == null ? null : sourceTable.get("columns");
        if (provided instanceof List<?> list && !list.isEmpty()) {
            List<Map<String, Object>> cols = new ArrayList<>();
            for (Object o : list) {
                if (o instanceof Map<?, ?> m) {
                    cols.add((Map<String, Object>) m);
                }
            }
            if (!cols.isEmpty()) {
                return new SourceTable(tableKey, cols);
            }
        }
        // ② catalog 既有列行
        List<Map<String, Object>> existing = collectColumns(connectionId, tableKey);
        if (!existing.isEmpty()) {
            return new SourceTable(tableKey, existing);
        }
        // ③ MDL 基线上找同名列
        return resolveFromMdlBaseline(connectionId, schema, table);
    }

    /** 在 catalog 里找该物理表的既有 table 行 item_key（大小写不敏感后缀匹配）。 */
    private Optional<String> findExistingTableKey(Long connectionId, String schema, String table) {
        String suffix = ("." + schema + "." + table).toLowerCase(LOWER);
        String bare = table.toLowerCase(LOWER);
        for (IqdCatalogItem it : catalogItemRepository.findByConnectionId(connectionId)) {
            if (!"table".equals(it.getKind()) || it.getItemKey() == null) {
                continue;
            }
            String key = it.getItemKey().toLowerCase(LOWER);
            // 兼容：完整 {ds}.{schema}.{table} / 仅表名 / 任意前缀.表名
            if (key.endsWith(suffix) || key.equals(bare) || key.endsWith("." + bare)) {
                return Optional.of(it.getItemKey());
            }
        }
        return Optional.empty();
    }

    /** 缺省物理表 key：{@code {datasource}.{schema}.{table}}（小写，datasource 缺省 pg_main）。 */
    private String defaultTableKey(String schema, String table) {
        return (DEFAULT_DATASOURCE + "." + schema + "." + table).toLowerCase(LOWER);
    }

    /** 取 catalog 中 {@code parent_key = tableKey} 的列行，转为列定义 Map 列表。 */
    private List<Map<String, Object>> collectColumns(Long connectionId, String tableKey) {
        List<Map<String, Object>> cols = new ArrayList<>();
        for (IqdCatalogItem it : catalogItemRepository.findByConnectionIdAndParentKey(connectionId, tableKey)) {
            if (!"column".equals(it.getKind())) {
                continue;
            }
            Map<String, Object> col = new LinkedHashMap<>();
            col.put("name", it.getDisplayName() != null ? it.getDisplayName() : lastSegment(it.getItemKey()));
            col.put("type", it.getDataType());
            col.put("comment", it.getDescription());
            col.put("is_primary_key", it.getIsPrimaryKey() != null && it.getIsPrimaryKey() == 1);
            cols.add(col);
        }
        return cols;
    }

    /** 从连接 mdl_raw 基线解析同名表（经 {@link IqdMdlParser}，与 syncCatalogFromMdl 同构）。 */
    private SourceTable resolveFromMdlBaseline(Long connectionId, String schema, String table) {
        IqdConnection conn = connectionRepository.findById(connectionId).orElse(null);
        if (conn == null || conn.getMdlRaw() == null || conn.getMdlRaw().isBlank()) {
            return null;
        }
        String suffix = ("." + schema + "." + table).toLowerCase(LOWER);
        try {
            List<com.mis.iqd.api.dto.IqdCatalogItemSaveRequest> items =
                    mdlParser.parse(conn.getMdlRaw(), DEFAULT_DATASOURCE, schema);
            String tableKey = null;
            for (com.mis.iqd.api.dto.IqdCatalogItemSaveRequest it : items) {
                if ("table".equals(it.kind()) && it.itemKey() != null
                        && it.itemKey().toLowerCase(LOWER).endsWith(suffix)) {
                    tableKey = it.itemKey();
                    break;
                }
            }
            if (tableKey == null) {
                return null;
            }
            List<Map<String, Object>> cols = new ArrayList<>();
            for (com.mis.iqd.api.dto.IqdCatalogItemSaveRequest it : items) {
                if ("column".equals(it.kind()) && tableKey.equals(it.parentKey())) {
                    Map<String, Object> col = new LinkedHashMap<>();
                    col.put("name", it.displayName());
                    col.put("type", it.dataType());
                    col.put("is_primary_key", Boolean.TRUE.equals(it.isPrimaryKey()));
                    cols.add(col);
                }
            }
            return cols.isEmpty() ? null : new SourceTable(tableKey, cols);
        } catch (Exception exc) {
            log.warn("IQD from-table mdl baseline resolve failed connectionId={} error={}",
                    connectionId, exc.getMessage());
            return null;
        }
    }

    /**
     * upsert 单个 catalog 节点（{@code source='modeling'}，{@code edit_revision=revision}）。
     *
     * <p>与 {@link IqdAdminService#saveCatalogBatch} 的区别：后者面向「MDL/物料镜像」
     * （不写 {@code edit_revision}、发 {@code iqd.scope.changed}）；本方法面向
     * **建模台编辑**（必写 {@code edit_revision}、{@code source='modeling'}，
     * 由调用方统一发 {@code iqd.catalog.changed}），故不直接复用以免污染既有语义。
     */
    private void upsertNode(Long connectionId, String itemKey, String kind, String parentKey,
            String displayName, String dataType, String expression, Boolean isPrimaryKey,
            Boolean isTimeDimension, Boolean isEmail, String description, String modelRef,
            int inScope, long revision, Instant now) {
        Optional<IqdCatalogItem> existing =
                catalogItemRepository.findByConnectionIdAndItemKey(connectionId, itemKey);
        IqdCatalogItem entity = existing.orElseGet(IqdCatalogItem::new);
        if (entity.getId() == null) {
            entity.setId(IdGenerator.nextId());
            entity.setConnectionId(connectionId);
            entity.setCreatedAt(now);
        }
        entity.setKind(kind);
        entity.setParentKey(parentKey);
        entity.setItemKey(itemKey);
        entity.setDisplayName(displayName);
        if (dataType != null) {
            entity.setDataType(dataType);
        }
        if (expression != null) {
            entity.setExpression(expression);
        }
        if (isPrimaryKey != null) {
            entity.setIsPrimaryKey(isPrimaryKey ? 1 : 0);
        }
        if (isTimeDimension != null) {
            entity.setIsTimeDimension(isTimeDimension ? 1 : 0);
        }
        if (isEmail != null) {
            entity.setIsEmail(isEmail ? 1 : 0);
        }
        if (description != null) {
            entity.setDescription(description);
        }
        // V89：cube 的所属模型写独立列（仅 cube 传非 null；其余节点传 null 表示「不触碰」）
        if (modelRef != null) {
            entity.setModelRef(modelRef);
        }
        entity.setSource("modeling");
        entity.setInScope(inScope);
        entity.setEditRevision(revision);
        entity.setLastSeenAt(now);
        entity.setUpdatedAt(now);
        catalogItemRepository.save(entity);
    }

    /**
     * 孤儿清理：删除本 cube 下「本次 patch 未出现」的既有 measure/dimension 子节点（T04a）。
     *
     * <p><b>选物理删除（非软删除）的理由</b>：
     * <ol>
     *   <li>measure/dimension 是<b>叶子节点</b>，无任何节点反向引用它们
     *       （{@code validateCatalogRefs} 只扫 expression / model_ref，不含子节点键），
     *       物理删除无悬挂引用；</li>
     *   <li>{@code iqd_catalog_item} <b>无软删除列</b>，引入需改表结构（超出 T04a 范围）；</li>
     *   <li><b>关键失效</b>：派生用 {@code findEditedItems}（{@code edit_revision IS NOT NULL}）
     *       取编辑节点，软删除若保留 {@code edit_revision}，被删子节点仍会被物化进 MDL
     *       → 删除<b>静默不生效</b>（比不支持删除更糟）；若不保留则须显式置 NULL，
     *       语义上等同「从未编辑」，反而更绕。故物理删除最干净 —— 行消失即天然排除在
     *       {@code findEditedItems} 之外。</li>
     * </ol>
     *
     * <p><b>可回滚</b>：全程在调用方 {@code @Transactional} 内，任一失败整体回滚。
     * <b>可见痕迹</b>：每条删除打 WARN 结构化日志（含 {@code item_key} / {@code cube} /
     * {@code connection_id} / {@code kind}），便于事后追溯「我的 measure 怎么没了」。
     *
     * @param connectionId 问数连接 id
     * @param cubeItemKey  Cube 稳定键（子节点的 {@code parent_key}）
     * @param incomingKeys 本次 patch 出现的子节点 item_key 集合（保留集）
     * @return 被删除的子节点数
     */
    private int pruneOrphanChildren(Long connectionId, String cubeItemKey, Set<String> incomingKeys) {
        int pruned = 0;
        for (IqdCatalogItem child : catalogItemRepository
                .findByConnectionIdAndParentKey(connectionId, cubeItemKey)) {
            String kind = child.getKind();
            if (!"measure".equals(kind) && !"dimension".equals(kind)) {
                continue;
            }
            if (incomingKeys.contains(child.getItemKey())) {
                continue;
            }
            catalogItemRepository.delete(child);
            pruned++;
            log.warn("IQD cube child pruned (orphan cleanup) connectionId={} cube={} item_key={} kind={}",
                    connectionId, cubeItemKey, child.getItemKey(), kind);
        }
        return pruned;
    }

    /** 既有模型的列映射（item_key → 源列名），供幂等分支回放首次结果。 */
    private Map<String, String> existingColumnMapping(Long connectionId, String modelItemKey) {
        Map<String, String> mapping = new LinkedHashMap<>();
        IqdCatalogItem model = catalogItemRepository.findByConnectionIdAndItemKey(connectionId, modelItemKey)
                .orElse(null);
        if (model == null || model.getDisplayName() == null) {
            return mapping;
        }
        String tableName = model.getDisplayName().toLowerCase(LOWER);
        for (IqdCatalogItem it : catalogItemRepository.findByConnectionId(connectionId)) {
            if (!"column".equals(it.getKind()) || it.getItemKey() == null) {
                continue;
            }
            if (it.getItemKey().toLowerCase(LOWER).contains("." + tableName + ".")) {
                mapping.put(it.getDisplayName() == null ? lastSegment(it.getItemKey()) : it.getDisplayName(),
                        it.getItemKey());
            }
        }
        return mapping;
    }

    /** 统一构造 from-table 出参（§3.3：{@code {edit_revision, edit_status, item_key, column_mapping}}）。 */
    private Map<String, Object> createResult(long revision, String itemKey, Map<String, String> columnMapping) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("edit_revision", revision);
        result.put("edit_status", "EDITED_UNSYNCED");
        result.put("item_key", itemKey);
        result.put("column_mapping", columnMapping == null ? Map.of() : columnMapping);
        result.put("wren_ref_id", null);
        return result;
    }

    /** item_key 末段（{@code a.b.c} → {@code c}；用于物理表/列的 {@code ds.schema.table.col} 形态）。 */
    private static String lastSegment(String itemKey) {
        if (itemKey == null) {
            return null;
        }
        int dot = itemKey.lastIndexOf('.');
        return dot >= 0 ? itemKey.substring(dot + 1) : itemKey;
    }

    /**
     * 语义节点名（§8.6 语义键的末段）：{@code mdl:model:orders} → {@code orders}，
     * {@code mdl:cube:revenue} → {@code revenue}，{@code mdl:relationship:a_b} → {@code a_b}；
     * 无冒号时回退 {@link #lastSegment}（物理键形态）。
     *
     * <p><b>不要用 {@link #lastSegment} 处理 {@code mdl:*} 键</b>：它按 {@code .} 切分，
     * 而 {@code mdl:cube:revenue} 里没有点 → 会原样返回整串（曾导致 cube 子节点键错成
     * {@code mdl:measure:mdl:cube:revenue.total}）。
     */
    private static String nodeName(String itemKey) {
        if (itemKey == null) {
            return null;
        }
        int colon = itemKey.lastIndexOf(':');
        if (colon >= 0 && colon < itemKey.length() - 1) {
            return itemKey.substring(colon + 1);
        }
        return lastSegment(itemKey);
    }

    /** wire 值 → String（null 安全）。 */
    private static String str(Object value) {
        if (value == null) {
            return null;
        }
        return value instanceof String s ? s : String.valueOf(value);
    }

    /** wire 值 → Boolean（字符串 "true"/"1" 也认）。 */
    private static Boolean toBoolean(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Boolean b) {
            return b;
        }
        String s = String.valueOf(value).trim();
        return "true".equalsIgnoreCase(s) || "1".equals(s);
    }
}
