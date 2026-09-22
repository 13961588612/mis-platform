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
 * <h2>T02a 已实现 / 未实现</h2>
 * 已实现：{@link #createModelFromTable}、{@link #validateExpression}。
 * 仍为 T03 stub：{@link #createModel}、{@link #createRelationship}、{@link #createCube}、
 * {@link #createCalculatedColumn}。{@link #listDependents} 复用
 * {@link IqdAdminService#validateCatalogRefs}。
 *
 * <p>命名边界：路径/权限码一律 {@code iqd}（platform 域）；仅对接 WrenAI 处保留
 * {@code wren}（{@code wren_ref_id} / {@code mdl:*}）。
 */
@Service
public class IqdCatalogNodeService {

    private static final Logger log = LoggerFactory.getLogger(IqdCatalogNodeService.class);

    /** 物理表 item_key 的数据源前缀缺省值（与 {@code IqdMdlParser} / {@code syncCatalogFromMdl} 同口径）。 */
    private static final String DEFAULT_DATASOURCE = "pg_main";

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

        // ---------- 连接存在 + 写回闸门 ----------
        IqdConnection conn = connectionRepository.findById(connectionId)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND,
                        "问数连接不存在: " + connectionId));
        if (!Boolean.TRUE.equals(conn.getMdlWritebackEnabled())) {
            throw new BusinessException(40300, "该连接未开启 MDL 写回（mdl_writeback_enabled=false）", null);
        }

        // ---------- 1. 幂等：① 幂等键命中 → 返回首次结果，不 bump ----------
        if (idempotencyKey != null && !idempotencyKey.isBlank()) {
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
        Optional<IqdCatalogItem> existingModel =
                catalogItemRepository.findByConnectionIdAndItemKey(connectionId, effectiveModelKey);
        if (existingModel.isPresent()) {
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
                null, null, null, null, null, inScope ? 1 : 0, next, now);

        Map<String, String> columnMapping = new LinkedHashMap<>();
        for (Map<String, Object> col : resolved.columns()) {
            String colName = str(col.get("name"));
            if (colName == null || colName.isBlank()) {
                continue;
            }
            String colKey = tableKey + "." + colName.toLowerCase(LOWER);
            columnMapping.put(colName, colKey);
            upsertNode(connectionId, colKey, "column", tableKey, colName,
                    str(col.get("type")), null,
                    toBoolean(col.get("is_primary_key")), null, null,
                    str(col.get("comment")), inScope ? 1 : 0, next, now);
        }

        upsertNode(connectionId, effectiveModelKey, "model", null, tableName.trim(), null,
                null, null, null, null, refSql, inScope ? 1 : 0, next, now);

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

        String stripped = STRING_LITERAL.matcher(expression).replaceAll("''");
        Set<String> unknown = new LinkedHashSet<>();
        var matcher = IDENTIFIER.matcher(stripped);
        while (matcher.find()) {
            String token = matcher.group();
            String lower = token.toLowerCase(LOWER);
            if (SQL_KEYWORDS.contains(lower)) {
                continue;
            }
            // 逐级回退匹配：a.b.c → 允许 a.b.c / b.c / c 任一命中（兼容 schema.table.col / table.col / col）
            if (matchesAny(allowed, lower)) {
                continue;
            }
            // 纯数字/数值字面量不会进入 IDENTIFIER，无需处理
            unknown.add(token);
        }
        for (String token : unknown) {
            errors.add("未知字段: " + token);
        }
        return new ValidateExprResult(errors.isEmpty(), errors);
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
            if ("table".equals(it.getKind()) && it.getItemKey() != null
                    && it.getItemKey().toLowerCase(LOWER).endsWith("." + tableNameGuess.toLowerCase(LOWER))) {
                tableKey = it.getItemKey();
                break;
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

    // ------------------------------------------------------------------ T03 stub（保持不变）

    /**
     * 空白模型创建（T03 实现）。
     *
     * @param connectionId   问数连接 id
     * @param itemKey        模型稳定键
     * @param patch          模型补丁 {@code {display_name,description,primary_keys,is_time_dimension,is_email,ref_sql}}
     * @param baseRevision   乐观并发基线
     * @param idempotencyKey 幂等键
     * @return 新建结果
     */
    public IqdModelingCreateResponse createModel(
            Long connectionId,
            String itemKey,
            Map<String, Object> patch,
            Long baseRevision,
            String idempotencyKey) {
        throw new UnsupportedOperationException("T03 实现");
    }

    /**
     * 建关系（画布连线即关系；T03 实现）。
     *
     * @param connectionId   问数连接 id
     * @param itemKey        关系稳定键（§8.6 {@code mdl:relationship:<name>}）
     * @param patch          {@code {join_type,cardinality,condition,source_model,target_model}}
     * @param baseRevision   乐观并发基线
     * @param idempotencyKey 幂等键
     * @return 新建结果
     */
    public IqdModelingCreateResponse createRelationship(
            Long connectionId,
            String itemKey,
            Map<String, Object> patch,
            Long baseRevision,
            String idempotencyKey) {
        throw new UnsupportedOperationException("T03 实现");
    }

    /**
     * 建 Cube（measures + dimensions 子节点；T03 实现）。
     *
     * @param connectionId   问数连接 id
     * @param itemKey        Cube 稳定键（§8.6 {@code mdl:cube:<name>}）
     * @param patch          {@code {display_name,model_ref,measures[],dimensions[]}}
     * @param baseRevision   乐观并发基线
     * @param idempotencyKey 幂等键
     * @return 新建结果
     */
    public IqdModelingCreateResponse createCube(
            Long connectionId,
            String itemKey,
            Map<String, Object> patch,
            Long baseRevision,
            String idempotencyKey) {
        throw new UnsupportedOperationException("T03 实现");
    }

    /**
     * 建计算列（T03 实现）。
     *
     * @param connectionId   问数连接 id
     * @param modelItemKey   宿主模型稳定键
     * @param columnName     计算列名
     * @param expression     表达式（CodeMirror 录入）
     * @param baseRevision   乐观并发基线
     * @param idempotencyKey 幂等键
     * @return 新建结果
     */
    public IqdModelingCreateResponse createCalculatedColumn(
            Long connectionId,
            String modelItemKey,
            String columnName,
            String expression,
            Long baseRevision,
            String idempotencyKey) {
        throw new UnsupportedOperationException("T03 实现");
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

    // ------------------------------------------------------------------ 内部

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
        for (IqdCatalogItem it : catalogItemRepository.findByConnectionId(connectionId)) {
            if ("table".equals(it.getKind()) && it.getItemKey() != null
                    && it.getItemKey().toLowerCase(LOWER).endsWith(suffix)) {
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
            Boolean isTimeDimension, Boolean isEmail, String description, int inScope,
            long revision, Instant now) {
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
        entity.setSource("modeling");
        entity.setInScope(inScope);
        entity.setEditRevision(revision);
        entity.setLastSeenAt(now);
        entity.setUpdatedAt(now);
        catalogItemRepository.save(entity);
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

    /** item_key 末段（{@code a.b.c} → {@code c}）。 */
    private static String lastSegment(String itemKey) {
        if (itemKey == null) {
            return null;
        }
        int dot = itemKey.lastIndexOf('.');
        return dot >= 0 ? itemKey.substring(dot + 1) : itemKey;
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
