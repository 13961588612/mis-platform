package com.mis.kb.domain.service;

import com.mis.kb.api.dto.SynonymFileVO;
import com.mis.kb.api.dto.SynonymImportCommitVO;
import com.mis.kb.api.dto.SynonymImportPrecheckVO;
import com.mis.kb.api.dto.SynonymImportRowVO;
import com.mis.kb.domain.entity.KbSynonymConfig;
import com.mis.kb.domain.entity.KbSynonymGroup;
import com.mis.kb.domain.entity.KbSynonymImportBatch;
import com.mis.kb.domain.entity.KbSynonymTerm;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.model.SynonymImportPlan;
import com.mis.kb.domain.model.SynonymImportPlanRow;
import com.mis.kb.domain.model.SynonymParsedGroup;
import com.mis.kb.domain.model.SynonymTermNormalizer;
import com.mis.kb.domain.repository.KbSynonymConfigRepository;
import com.mis.kb.domain.repository.KbSynonymGroupRepository;
import com.mis.kb.domain.repository.KbSynonymImportBatchRepository;
import com.mis.kb.domain.repository.KbSynonymTermRepository;
import com.mis.kb.engine.SynonymProperties;
import com.mis.kb.support.IdGenerator;
import com.mis.kb.support.KbBusinessException;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 同义词批量导入 / 导出服务（Wave D · T08，WD-04 / WD-14）。
 *
 * <p><b>两段式的全部要点，改动前请逐条读完：</b>
 * <ol>
 *   <li><b>预检不写任何词表数据</b>，只 INSERT 一行 {@code kb_synonym_import_batch}
 *       （含 token、当时的 {@code dict_version}、完整 {@code plan_json}）；</li>
 *   <li><b>提交先校验 {@code dict_version}</b>（主理人 Q10 硬约束）：不等即
 *       {@link KbResultCode#KB_SYNONYM_IMPORT_STALE}，<b>一行都不写</b>。
 *       ⛔ 绝不允许「静默多跳几行照常提交」——预检报告承诺的「新增 38 / 并入 6 / 跳过 4」
 *       若在提交时被重算，回执上的数字就是一句没人能解释的谎话；</li>
 *   <li><b>提交严格照 {@code plan_json} 执行，不重新判定</b>。这是第 2 条的直接推论：
 *       版本没变 ⇒ 判定依据没变 ⇒ 重算是纯粹的浪费与风险；</li>
 *   <li><b>格式级错误整批拒绝，连 batch 行都不建</b>（PRD §4.4.4 分层处置）：
 *       编码不可识别 / JSON 语法错 / 缺 {@code canonical_term} 列 / 超体积 / 超组数。
 *       数据级错误（空规范词、词条冲突、文件内自冲突）则<b>逐行跳过</b>，其余照常导入。</li>
 * </ol>
 *
 * <p><b>为什么导出也放在这个类里：</b>导出与导入必须共用同一套 Codec 写/读口径，
 * 否则「导出 → 改两行 → 再导入」这条最常用的运维闭环会在某个转义细节上断掉。
 * 放在一起，任何人改写出逻辑时都会同时看见读入逻辑。
 *
 * <p><b>数据库往返预算</b>：预检固定 4 次查询（版本号、批量冲突检测、冲突组规范词、
 * 词条总数），<b>与文件行数无关</b>。⛔ 禁止在 {@link #buildPlan} 的循环里加任何查库调用——
 * 2000 组的文件会立刻变成 2000 次往返，这是本类能不能跑完一次真实导入的分水岭。
 */
@Service
public class SynonymImportService {

    private static final Logger log = LoggerFactory.getLogger(SynonymImportService.class);

    /** 预检令牌有效期。 */
    private static final Duration TOKEN_TTL = Duration.ofMinutes(30);

    /** 导出单次最大组数，超出即 {@link KbResultCode#KB_EXPORT_TOO_LARGE}。 */
    private static final int EXPORT_MAX_GROUPS = 10000;

    /** 词条原文最大长度，与 {@code kb_synonym_term.term VARCHAR(128)} 对齐。 */
    private static final int MAX_TERM_LENGTH = 128;

    /** 备注最大长度，与 {@code kb_synonym_group.remark VARCHAR(512)} 对齐。 */
    private static final int MAX_REMARK_LENGTH = 512;

    /** 水位提示触发比例（达建议线 80% 起提示）。 */
    private static final double WATERMARK_RATIO = 0.8d;

    /** 逐行明细的返回上限：超出部分不回前端，避免 2000 行报告撑爆响应体。 */
    private static final int MAX_REPORT_ROWS = 500;

    /**
     * {@code plan_json} 专用 mapper。
     *
     * <p>开启 {@code FAIL_ON_UNKNOWN_PROPERTIES=false}：老实例读到新版本写的计划
     * （多了字段）时要能降级解析，否则一次灰度发布就会让所有待提交的批次全部作废。
     */
    private static final ObjectMapper PLAN_MAPPER = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private final SynonymCsvCodec csvCodec;
    private final SynonymJsonCodec jsonCodec;
    private final KbSynonymImportBatchRepository batchRepository;
    private final KbSynonymGroupRepository groupRepository;
    private final KbSynonymTermRepository termRepository;
    private final KbSynonymConfigRepository configRepository;
    private final SynonymDictLoader dictLoader;
    private final SynonymProperties properties;

    /**
     * 构造。
     *
     * @param csvCodec         CSV 编解码
     * @param jsonCodec        JSON 编解码
     * @param batchRepository  导入批次仓储
     * @param groupRepository  术语组仓储
     * @param termRepository   词条仓储
     * @param configRepository 配置仓储（版本号）
     * @param dictLoader       词典加载器（提交后 L1 即时刷新）
     * @param properties       Nacos 配置（体积/组数闸、水位建议线）
     */
    public SynonymImportService(
            SynonymCsvCodec csvCodec,
            SynonymJsonCodec jsonCodec,
            KbSynonymImportBatchRepository batchRepository,
            KbSynonymGroupRepository groupRepository,
            KbSynonymTermRepository termRepository,
            KbSynonymConfigRepository configRepository,
            SynonymDictLoader dictLoader,
            SynonymProperties properties) {
        this.csvCodec = csvCodec;
        this.jsonCodec = jsonCodec;
        this.batchRepository = batchRepository;
        this.groupRepository = groupRepository;
        this.termRepository = termRepository;
        this.configRepository = configRepository;
        this.dictLoader = dictLoader;
        this.properties = properties;
    }

    // ================================================================ 阶段一 · 预检

    /**
     * 导入预检（阶段一，WD-04）。
     *
     * <p><b>本方法不写任何词表数据</b>，唯一的写操作是 INSERT 一行
     * {@code kb_synonym_import_batch}。格式级错误在建 batch 行<b>之前</b>抛出，
     * 因此「JSON 语法错误文件 → {@code SELECT count(*) FROM kb_synonym_import_batch} 不增」
     * 这条完成判据是由<b>代码顺序</b>保证的，改动时不要把 INSERT 提前。
     *
     * @param bytes    文件字节
     * @param filename 原始文件名（决定格式与回吐格式）
     * @param userId   操作人；可为 {@code null}
     * @return 预检报告
     * @throws KbBusinessException 超限 40929 / 格式非法 40928
     */
    @Transactional
    public SynonymImportPrecheckVO precheck(byte[] bytes, String filename, Long userId) {
        if (bytes == null || bytes.length == 0) {
            throw new KbBusinessException(
                    KbResultCode.KB_SYNONYM_IMPORT_FORMAT_INVALID,
                    "文件格式不合法：上传内容为空。请下载模板对照修改后重新上传。");
        }
        long maxBytes = properties.getImportMaxBytes();
        if (bytes.length > maxBytes) {
            throw new KbBusinessException(
                    KbResultCode.KB_SYNONYM_IMPORT_TOO_LARGE,
                    String.format(Locale.ROOT,
                            "导入内容超出上限：文件 %.2f MB，单次上限 %.2f MB。请拆分后分批导入。",
                            bytes.length / 1024.0 / 1024.0, maxBytes / 1024.0 / 1024.0));
        }

        String format = detectFormat(filename, bytes);
        List<SynonymParsedGroup> parsed = KbSynonymImportBatch.FORMAT_JSON.equals(format)
                ? jsonCodec.parse(bytes)
                : csvCodec.parse(bytes);

        int maxGroups = properties.getImportMaxGroups();
        if (parsed.size() > maxGroups) {
            throw new KbBusinessException(
                    KbResultCode.KB_SYNONYM_IMPORT_TOO_LARGE,
                    "导入内容超出上限：文件含 " + parsed.size() + " 个术语组，单次上限 "
                            + maxGroups + " 组。请拆分后分批导入。");
        }

        long dictVersion = currentVersion();
        SynonymImportPlan plan = buildPlan(parsed, format);
        List<String> warnings = buildWarnings(plan);

        Instant now = Instant.now();
        KbSynonymImportBatch batch = new KbSynonymImportBatch();
        batch.setId(IdGenerator.nextId());
        batch.setToken(UUID.randomUUID().toString().replace("-", ""));
        batch.setStatus(KbSynonymImportBatch.STATUS_PENDING);
        batch.setDictVersion(dictVersion);
        batch.setFileName(trimTo(filename, 255));
        batch.setFormat(format);
        batch.setPlanJson(writePlan(plan));
        batch.setPlannedCreate(plan.count(SynonymImportPlanRow.ACTION_CREATE));
        batch.setPlannedMerge(plan.count(SynonymImportPlanRow.ACTION_MERGE));
        batch.setPlannedSkip(plan.count(SynonymImportPlanRow.ACTION_SKIP));
        batch.setCreatedBy(userId);
        batch.setCreatedAt(now);
        batch.setExpiresAt(now.plus(TOKEN_TTL));
        batchRepository.save(batch);

        log.info("同义词导入预检 batchId={} format={} 新增={} 并入={} 跳过={} dictVersion={} operator={}",
                batch.getId(), format, batch.getPlannedCreate(), batch.getPlannedMerge(),
                batch.getPlannedSkip(), dictVersion, userId);

        return new SynonymImportPrecheckVO(
                batch.getToken(),
                batch.getId(),
                format,
                batch.getPlannedCreate(),
                batch.getPlannedMerge(),
                batch.getPlannedSkip(),
                toRowVOs(plan.rows()),
                warnings,
                batch.getExpiresAt());
    }

    // ================================================================ 阶段二 · 提交

    /**
     * 确认提交（阶段二，WD-04）。
     *
     * <p>执行顺序是硬约束：<b>token 有效性 → 版本校验 → 照计划落库 → bumpVersion →
     * 标记批次已提交 →（事务提交后）reloadNow</b>。任何一步前移都会破坏
     * 「要么一行不写、要么全部写完并即时生效」这个语义。
     *
     * @param token         预检令牌
     * @param mergeExisting 同名规范词是否合并（{@code false} 时 MERGE 行转为跳过）
     * @param userId        操作人；可为 {@code null}
     * @return 提交回执
     * @throws KbBusinessException 令牌失效 40931 / 词表已变更 40930
     */
    @Transactional
    public SynonymImportCommitVO commit(String token, boolean mergeExisting, Long userId) {
        if (token == null || token.isBlank()) {
            throw new KbBusinessException(KbResultCode.KB_SYNONYM_IMPORT_TOKEN_INVALID);
        }
        KbSynonymImportBatch batch = batchRepository.findByToken(token.trim())
                .orElseThrow(() -> new KbBusinessException(KbResultCode.KB_SYNONYM_IMPORT_TOKEN_INVALID));

        Instant now = Instant.now();
        if (!batch.isCommittable(now)) {
            throw new KbBusinessException(KbResultCode.KB_SYNONYM_IMPORT_TOKEN_INVALID);
        }

        long dictVersion = currentVersion();
        if (batch.getDictVersion() == null || batch.getDictVersion() != dictVersion) {
            // ⛔ Q10 硬约束：预检期与提交期之间词表被改过，报告里的计数已不可信。
            // 这里必须拒绝而不是重算——重算出来的结果与用户在屏幕上看到并点了确认的
            // 那份报告不是同一份东西。
            log.info("同义词导入提交被拒（词表已变更）batchId={} 预检版本={} 当前版本={}",
                    batch.getId(), batch.getDictVersion(), dictVersion);
            throw new KbBusinessException(KbResultCode.KB_SYNONYM_IMPORT_STALE);
        }

        SynonymImportPlan plan = readPlan(batch.getPlanJson());
        int created = 0;
        int merged = 0;
        int skipped = 0;

        try {
            for (SynonymImportPlanRow row : plan.rows()) {
                if (row.isSkip()) {
                    skipped++;
                } else if (row.isMerge()) {
                    if (!mergeExisting) {
                        // 用户在预检面板上把「合并」切成了「跳过」——这是他主动改变的意图，
                        // 不是系统静默行为，因此计入 skipped 是诚实的。
                        skipped++;
                        continue;
                    }
                    executeMerge(row, now, userId);
                    merged++;
                } else if (row.isCreate()) {
                    executeCreate(row, now, userId);
                    created++;
                } else {
                    // 计划里出现未知动作码：说明 plan_json 与当前代码版本不匹配，
                    // 按跳过处理并留日志，绝不猜测用户意图。
                    log.warn("导入计划含未知动作 batchId={} lineNo={} action={}",
                            batch.getId(), row.lineNo(), row.action());
                    skipped++;
                }
            }
            // 显式 flush：唯一约束冲突默认要到事务提交时才炸，那时已经出了本方法的
            // try 块，捕不到，用户看到的会是一个 500 而不是可操作的 40930。
            termRepository.flush();
        } catch (DataIntegrityViolationException e) {
            // 理论上已被版本校验挡住（能改词表就必然涨版本）。真到了这里说明有旁路写入，
            // 语义与「词表已变更」完全一致，返回同一个错误码，整批回滚由事务负责。
            log.warn("同义词导入提交撞唯一约束，整批回滚 batchId={}", batch.getId(), e);
            throw new KbBusinessException(KbResultCode.KB_SYNONYM_IMPORT_STALE);
        }

        configRepository.bumpVersion(now, userId);
        batch.setStatus(KbSynonymImportBatch.STATUS_COMMITTED);
        batch.setCommittedAt(now);
        batchRepository.save(batch);

        Long newVersion = configRepository.findVersionById(KbSynonymConfig.SINGLETON_ID);
        if (newVersion != null) {
            // 事务提交后再 reloadNow：顺序理由见 SynonymGroupService#scheduleReload，
            // 全模块只此一份实现，不允许各写各的。
            SynonymGroupService.scheduleReload(dictLoader, newVersion);
        } else {
            log.warn("kb_synonym_config 单行缺失，跳过词典即时刷新；下一轮轮询将自愈");
        }

        log.info("同义词导入提交完成 batchId={} 新增={} 并入={} 跳过={} mergeExisting={} operator={}",
                batch.getId(), created, merged, skipped, mergeExisting, userId);
        return new SynonymImportCommitVO(batch.getId(), created, merged, skipped);
    }

    // ================================================================ 阶段三 · 未导入行

    /**
     * 下载未导入行（阶段三，PRD §4.4.4 第 3 条前置条件）。
     *
     * <p><b>直接读 {@code plan_json}，不重解析原文件</b>——原文件根本没留存。
     * 按<b>原格式</b>回吐（CSV 传的还 CSV），并追加 {@code skip_reason} 列/字段，
     * 管理员改完可以直接再传一次形成闭环。
     *
     * @param batchId 批次 ID
     * @param userId  操作人（仅日志）；可为 {@code null}
     * @return 可下载的文件载荷
     * @throws KbBusinessException 批次不存在时抛 40931
     */
    @Transactional(readOnly = true)
    public SynonymFileVO rejectedRows(Long batchId, Long userId) {
        if (batchId == null) {
            throw new KbBusinessException(KbResultCode.KB_SYNONYM_IMPORT_TOKEN_INVALID);
        }
        KbSynonymImportBatch batch = batchRepository.findById(batchId)
                .orElseThrow(() -> new KbBusinessException(KbResultCode.KB_SYNONYM_IMPORT_TOKEN_INVALID));

        SynonymImportPlan plan = readPlan(batch.getPlanJson());
        List<SynonymImportPlanRow> skipped = new ArrayList<>();
        for (SynonymImportPlanRow row : plan.rows()) {
            if (row.isSkip()) {
                skipped.add(row);
            }
        }

        boolean json = KbSynonymImportBatch.FORMAT_JSON.equals(batch.getFormat());
        String content = json ? jsonCodec.writeRejected(skipped) : csvCodec.writeRejected(skipped);
        log.info("下载未导入行 batchId={} 行数={} format={} operator={}",
                batchId, skipped.size(), batch.getFormat(), userId);
        return new SynonymFileVO(
                "kb-synonyms-rejected-" + batchId + (json ? ".json" : ".csv"),
                json ? SynonymFileVO.CONTENT_TYPE_JSON : SynonymFileVO.CONTENT_TYPE_CSV,
                content);
    }

    // ================================================================ 导出（WD-14）

    /**
     * 导出词表（WD-14，P1）。
     *
     * <p>导出结果<b>可直接作为导入模板</b>：列/字段、别名分隔符、状态文本、转义口径
     * 全部与解析侧同源。这条性质由 AC-09 兜底（CSV/JSON 往返内容一致）。
     *
     * @param keyword 关键词过滤；可为 {@code null}
     * @param status  状态过滤；可为 {@code null}
     * @param format  {@code CSV} / {@code JSON}；其它值一律按 CSV
     * @return 可下载的文件载荷
     * @throws KbBusinessException 组数超 {@link #EXPORT_MAX_GROUPS} 时抛 40926
     */
    @Transactional(readOnly = true)
    public SynonymFileVO export(String keyword, Integer status, String format) {
        String trimmed = keyword == null ? null : keyword.trim();
        String likeKeyword = trimmed == null || trimmed.isEmpty()
                ? null
                : "%" + trimmed.toLowerCase(Locale.ROOT) + "%";

        // 走与列表页同一个查询，保证「筛什么就导什么」；size 取硬上限而非 Integer.MAX_VALUE，
        // 后者会让某些方言生成 LIMIT 2147483647 的荒唐语句。
        Page<KbSynonymGroup> page = groupRepository.search(
                likeKeyword, status,
                PageRequest.of(0, EXPORT_MAX_GROUPS, Sort.by(Sort.Direction.ASC, "id")));
        if (page.getTotalElements() > EXPORT_MAX_GROUPS) {
            throw new KbBusinessException(
                    KbResultCode.KB_EXPORT_TOO_LARGE,
                    "导出数据量超出上限：共 " + page.getTotalElements() + " 个术语组，单次上限 "
                            + EXPORT_MAX_GROUPS + " 组。请缩小筛选范围。");
        }

        List<KbSynonymGroup> groups = page.getContent();
        Map<Long, List<KbSynonymTerm>> termsByGroup = groups.isEmpty()
                ? Map.of()
                : groupTerms(groups.stream().map(KbSynonymGroup::getId).toList());

        List<SynonymParsedGroup> exported = new ArrayList<>(groups.size());
        for (int i = 0; i < groups.size(); i++) {
            KbSynonymGroup group = groups.get(i);
            List<String> aliases = new ArrayList<>();
            for (KbSynonymTerm term : termsByGroup.getOrDefault(group.getId(), List.of())) {
                if (!term.isCanonical()) {
                    aliases.add(term.getTerm());
                }
            }
            exported.add(new SynonymParsedGroup(
                    i + 1, group.getCanonicalTerm(), aliases, group.getRemark(), group.getStatus()));
        }

        boolean json = KbSynonymImportBatch.FORMAT_JSON.equalsIgnoreCase(format);
        String content = json ? jsonCodec.writeGroups(exported) : csvCodec.writeGroups(exported);
        return new SynonymFileVO(
                "kb-synonyms-" + Instant.now().toEpochMilli() + (json ? ".json" : ".csv"),
                json ? SynonymFileVO.CONTENT_TYPE_JSON : SynonymFileVO.CONTENT_TYPE_CSV,
                content);
    }

    // ================================================================ 内部 · 计划生成

    /**
     * 由解析产物生成行级计划。
     *
     * <p><b>整个方法固定 2 次查库</b>（批量冲突检测 + 冲突组规范词），<b>与文件行数无关</b>。
     * 逐行判定放在 {@link #planRow} 里，该方法<b>不接触任何仓储</b>——这是纪律，不是巧合。
     * 一旦有人为了「顺手取个字段」在循环里加一次查询，2000 组的文件就变成 2000 次往返。
     *
     * <p>判定优先级（顺序即语义，不可调换）：
     * <ol>
     *   <li>规范词为空 → SKIP；</li>
     *   <li>本行任一词形在<b>文件内更靠前的行</b>已出现 → SKIP（附上那一行的行号）；</li>
     *   <li>规范词命中库内某组的<b>规范词</b> → MERGE（目标组已定）；</li>
     *   <li>规范词命中库内某组的<b>别名</b> → SKIP（不能建一个以别人别名为规范词的组）；</li>
     *   <li>任一别名被<b>其它组</b>占用 → SKIP；被<b>目标组自己</b>占用则忽略（并入时天然去重）；</li>
     *   <li>其余 → CREATE。</li>
     * </ol>
     *
     * @param parsed 解析产物
     * @param format 文件格式
     * @return 行级计划
     */
    private SynonymImportPlan buildPlan(List<SynonymParsedGroup> parsed, String format) {
        List<SynonymParsedGroup> cleaned = new ArrayList<>(parsed.size());
        Set<String> allNorms = new HashSet<>(parsed.size() * 4);
        for (SynonymParsedGroup raw : parsed) {
            SynonymParsedGroup clean = sanitize(raw);
            cleaned.add(clean);
            String canonicalNorm = SynonymTermNormalizer.normalize(clean.canonicalTerm());
            if (!canonicalNorm.isEmpty()) {
                allNorms.add(canonicalNorm);
            }
            for (String alias : clean.aliases()) {
                String norm = SynonymTermNormalizer.normalize(alias);
                if (!norm.isEmpty()) {
                    allNorms.add(norm);
                }
            }
        }

        // 查库 ①：一次批量拿回所有已被占用的词形。
        // 不过滤 status —— 停用组仍占用唯一性（Q3 裁决），导入侧与 WD-01 表单侧必须同口径，
        // 否则会出现「表单加不进去、导入却加进去了」这种能直接撞唯一索引的裂缝。
        Map<String, KbSynonymTerm> occupied = new HashMap<>(allNorms.size() * 2);
        if (!allNorms.isEmpty()) {
            for (KbSynonymTerm term : termRepository.findByTermNormIn(allNorms)) {
                occupied.putIfAbsent(term.getTermNorm(), term);
            }
        }

        // 查库 ②：冲突组的规范词。前端要拼「已属于术语组「关键结果法」」，
        // 只给 ownerGroupId 的话它只能显示 #1234，等于没说。
        Set<Long> ownerIds = new HashSet<>();
        for (KbSynonymTerm term : occupied.values()) {
            if (term.getGroupId() != null) {
                ownerIds.add(term.getGroupId());
            }
        }
        Map<Long, String> ownerCanonical = new HashMap<>(ownerIds.size() * 2);
        if (!ownerIds.isEmpty()) {
            for (KbSynonymGroup group : groupRepository.findAllById(ownerIds)) {
                ownerCanonical.put(group.getId(), group.getCanonicalTerm());
            }
        }

        // norm → 本文件中最先占用它的行号
        Map<String, Integer> claimedBy = new HashMap<>(allNorms.size() * 2);
        List<SynonymImportPlanRow> rows = new ArrayList<>(cleaned.size());
        for (SynonymParsedGroup group : cleaned) {
            rows.add(planRow(group, occupied, ownerCanonical, claimedBy));
        }
        return SynonymImportPlan.of(format, rows);
    }

    /**
     * 单行判定（<b>纯函数，不查库</b>）。
     *
     * @param group          已清洗的解析组
     * @param occupied       词形 → 库内占用它的词条
     * @param ownerCanonical 组 ID → 规范词
     * @param claimedBy      词形 → 本文件中最先占用它的行号；命中即判自冲突，判定通过后写入
     * @return 计划行
     */
    private SynonymImportPlanRow planRow(
            SynonymParsedGroup group,
            Map<String, KbSynonymTerm> occupied,
            Map<Long, String> ownerCanonical,
            Map<String, Integer> claimedBy) {

        String canonicalNorm = SynonymTermNormalizer.normalize(group.canonicalTerm());
        if (canonicalNorm.isEmpty()) {
            return SynonymImportPlanRow.skip(
                    group, "规范词为空，本行已跳过。", null, null, null);
        }

        // 词形 → 本行内的原文写法。用 LinkedHashMap 是为了让「多个词都冲突」时，
        // 报出来的永远是最靠前那个 —— 与管理员从左到右的阅读顺序一致，可复现。
        Map<String, String> normToRaw = new LinkedHashMap<>(group.aliases().size() * 2 + 2);
        normToRaw.put(canonicalNorm, group.canonicalTerm());
        for (String alias : group.aliases()) {
            String norm = SynonymTermNormalizer.normalize(alias);
            if (!norm.isEmpty()) {
                normToRaw.putIfAbsent(norm, alias);
            }
        }

        // ① 文件内自冲突。这个信息只有「另一行的行号」才说得清楚，
        // 所以原因文案里必须带行号（回吐的 CSV 里没有行号列，全靠这句话）。
        for (Map.Entry<String, String> entry : normToRaw.entrySet()) {
            Integer firstLine = claimedBy.get(entry.getKey());
            if (firstLine != null) {
                return SynonymImportPlanRow.skip(
                        group,
                        "「" + entry.getValue() + "」在本文件第 " + firstLine + " 行已出现，本行已跳过。",
                        entry.getValue(), null, null);
            }
        }

        // ② 规范词与库内的关系，决定 MERGE 还是 CREATE
        Long targetGroupId = null;
        KbSynonymTerm canonicalOwner = occupied.get(canonicalNorm);
        if (canonicalOwner != null) {
            if (canonicalOwner.isCanonical()) {
                targetGroupId = canonicalOwner.getGroupId();
            } else {
                // 规范词撞上了别人的别名：既不能建新组（唯一索引），也不该并入
                // （并入会让「A 组的规范词是 B 组的别名」这种半冲突状态落地）。
                return SynonymImportPlanRow.skip(
                        group,
                        conflictReason(group.canonicalTerm(), ownerCanonical.get(canonicalOwner.getGroupId()),
                                canonicalOwner.getGroupId()),
                        group.canonicalTerm(),
                        canonicalOwner.getGroupId(),
                        ownerCanonical.get(canonicalOwner.getGroupId()));
            }
        }

        // ③ 别名冲突。属于目标组自己的别名不算冲突 —— 那正是「并入」要做的事。
        for (Map.Entry<String, String> entry : normToRaw.entrySet()) {
            if (entry.getKey().equals(canonicalNorm)) {
                continue;
            }
            KbSynonymTerm owner = occupied.get(entry.getKey());
            if (owner == null || (targetGroupId != null && targetGroupId.equals(owner.getGroupId()))) {
                continue;
            }
            return SynonymImportPlanRow.skip(
                    group,
                    conflictReason(entry.getValue(), ownerCanonical.get(owner.getGroupId()), owner.getGroupId()),
                    entry.getValue(),
                    owner.getGroupId(),
                    ownerCanonical.get(owner.getGroupId()));
        }

        // ④ 判定通过才占位：跳过的行不占用词形，否则「第 5 行冲突被跳过」会连累
        // 第 9 行同名的那一行，报出一个它自己完全没有的问题。
        for (String norm : normToRaw.keySet()) {
            claimedBy.put(norm, group.lineNo());
        }
        return targetGroupId == null
                ? SynonymImportPlanRow.create(group)
                : SynonymImportPlanRow.merge(group, targetGroupId);
    }

    /**
     * 拼冲突原因文案。
     *
     * <p>刻意<b>不</b>带「第 N 行」前缀：预检报告里行号是独立一列，回吐文件里则由
     * 内容本身定位，两处都不需要重复。但必须点明<b>停用组同样占用</b>（Q3），
     * 否则「我明明已经停用了那个组」是必然会收到的追问。
     *
     * @param term      冲突词原文
     * @param ownerTerm 现属组规范词；可为 {@code null}
     * @param ownerId   现属组 ID
     * @return 面向管理员的原因文案
     */
    private static String conflictReason(String term, String ownerTerm, Long ownerId) {
        String owner = ownerTerm == null || ownerTerm.isBlank() ? "#" + ownerId : ownerTerm;
        return "「" + term + "」已属于术语组「" + owner + "」（已停用的术语组同样占用），本行已跳过。";
    }

    /**
     * 生成非阻断提示（WD-15 水位 + 两条低效用提醒）。
     *
     * <p>这里的第 3 次查库（{@code countAll}）是唯一一次为「提示」而付出的代价，值得：
     * 水位提示是 D6 约束 5 落地的唯一抓手，管理员在导入前看不到它，就只能在扩展效果
     * 变差之后才发现词表早已超出建议规模。
     *
     * <p>新增词条数是<b>上限估算</b>：MERGE 行的别名可能已存在于目标组，实际入库会更少。
     * 提示允许略保守，不允许漏报。
     *
     * @param plan 行级计划
     * @return 提示列表，恒非 {@code null}
     */
    private List<String> buildWarnings(SynonymImportPlan plan) {
        List<String> warnings = new ArrayList<>(3);
        int newTerms = 0;
        int aliasFreeGroups = 0;
        int shortAliases = 0;
        int minTermLength = properties.getMinTermLength();

        for (SynonymImportPlanRow row : plan.rows()) {
            if (row.isSkip()) {
                continue;
            }
            newTerms += row.isCreate() ? row.aliases().size() + 1 : row.aliases().size();
            if (row.aliases().isEmpty()) {
                aliasFreeGroups++;
            }
            for (String alias : row.aliases()) {
                if (SynonymTermNormalizer.tooShort(
                        SynonymTermNormalizer.normalize(alias), minTermLength)) {
                    shortAliases++;
                }
            }
        }

        // 查库 ③：词条总数
        long after = termRepository.countAll() + newTerms;
        int limit = properties.getRecommendedTermLimit();
        if (limit > 0 && after > limit) {
            warnings.add("导入后词条总数约 " + after + " 条，已超过建议规模 " + limit
                    + " 条。词表过大会拖慢检索，建议清理低频术语（仅提示，不阻断导入）。");
        } else if (limit > 0 && after >= limit * WATERMARK_RATIO) {
            warnings.add("导入后词条总数约 " + after + " 条，已达建议规模 " + limit
                    + " 条的 80%。建议关注词表规模（仅提示，不阻断导入）。");
        }
        if (aliasFreeGroups > 0) {
            warnings.add("有 " + aliasFreeGroups + " 个术语组只有规范词、没有任何别名，"
                    + "导入后不会产生任何扩展效果。");
        }
        if (shortAliases > 0) {
            warnings.add("有 " + shortAliases + " 个别名短于 " + minTermLength
                    + " 个字符，不参与自动匹配（可在命中测试中验证）。");
        }
        return warnings;
    }

    /**
     * 计划行投影为报告行，并施加 {@link #MAX_REPORT_ROWS} 上限。
     *
     * <p>超限时<b>优先保留 SKIP 行</b>：管理员打开报告是为了看「哪些没进去、为什么」，
     * 1900 条「将新增」对他毫无信息量。挑完之后按行号重排，阅读顺序仍与文件一致。
     *
     * @param rows 全量计划行
     * @return 报告行；恒非 {@code null}
     */
    private static List<SynonymImportRowVO> toRowVOs(List<SynonymImportPlanRow> rows) {
        if (rows == null || rows.isEmpty()) {
            return List.of();
        }
        List<SynonymImportPlanRow> picked;
        if (rows.size() <= MAX_REPORT_ROWS) {
            picked = rows;
        } else {
            picked = new ArrayList<>(MAX_REPORT_ROWS);
            for (SynonymImportPlanRow row : rows) {
                if (row.isSkip() && picked.size() < MAX_REPORT_ROWS) {
                    picked.add(row);
                }
            }
            for (SynonymImportPlanRow row : rows) {
                if (!row.isSkip() && picked.size() < MAX_REPORT_ROWS) {
                    picked.add(row);
                }
            }
            picked.sort(Comparator.comparingInt(
                    (SynonymImportPlanRow row) -> row.lineNo() == null ? 0 : row.lineNo()));
        }
        List<SynonymImportRowVO> vos = new ArrayList<>(picked.size());
        for (SynonymImportPlanRow row : picked) {
            vos.add(SynonymImportRowVO.from(row));
        }
        return vos;
    }

    // ================================================================ 内部 · 执行

    /**
     * 执行一条 CREATE：建组 + 落词条（规范词恒 {@code canonical=1, sortNo=0}）。
     *
     * <p>落库口径与 {@code SynonymGroupService.insertTerms} 完全一致 —— 手工新建与批量导入
     * 产出的数据必须无法区分，否则「导入进来的组编辑一次就变样」会成为长期投诉源。
     *
     * @param row    计划行
     * @param now    操作时刻
     * @param userId 操作人；可为 {@code null}
     */
    private void executeCreate(SynonymImportPlanRow row, Instant now, Long userId) {
        KbSynonymGroup group = new KbSynonymGroup();
        group.setId(IdGenerator.nextId());
        group.setCanonicalTerm(row.canonicalTerm());
        group.setStatus(row.status() != null && row.status() == KbSynonymGroup.STATUS_DISABLED
                ? KbSynonymGroup.STATUS_DISABLED
                : KbSynonymGroup.STATUS_ENABLED);
        group.setRemark(trimTo(row.remark(), MAX_REMARK_LENGTH));
        group.setCreatedAt(now);
        group.setUpdatedAt(now);
        group.setUpdatedBy(userId);
        groupRepository.save(group);

        List<KbSynonymTerm> terms = new ArrayList<>(row.aliases().size() + 1);
        Set<String> seen = new HashSet<>(row.aliases().size() * 2 + 2);
        seen.add(SynonymTermNormalizer.normalize(row.canonicalTerm()));
        terms.add(newTerm(group.getId(), row.canonicalTerm(),
                KbSynonymTerm.CANONICAL_YES, KbSynonymTerm.CANONICAL_SORT_NO, now));

        int sortNo = KbSynonymTerm.CANONICAL_SORT_NO + 1;
        for (String alias : row.aliases()) {
            String norm = SynonymTermNormalizer.normalize(alias);
            if (norm.isEmpty() || !seen.add(norm)) {
                continue;
            }
            terms.add(newTerm(group.getId(), alias, KbSynonymTerm.CANONICAL_NO, sortNo, now));
            sortNo++;
        }
        termRepository.saveAll(terms);
    }

    /**
     * 执行一条 MERGE：把本行别名<b>追加</b>到目标组尾部。
     *
     * <p><b>三件明确不做的事</b>（都会让「合并」变成「覆盖」，那是另一种语义）：
     * <ol>
     *   <li>不改目标组的规范词 —— 同名只是归一化后相等，库里那个写法是管理员选定的；</li>
     *   <li>不改目标组的状态 —— 文件里写 {@code enabled} 不该把一个刻意停用的组悄悄启用；</li>
     *   <li>不覆盖已有备注 —— 仅在目标组备注为空时补写。</li>
     * </ol>
     *
     * @param row    计划行（{@code targetGroupId} 非空）
     * @param now    操作时刻
     * @param userId 操作人；可为 {@code null}
     */
    private void executeMerge(SynonymImportPlanRow row, Instant now, Long userId) {
        Long targetGroupId = row.targetGroupId();
        KbSynonymGroup group = targetGroupId == null
                ? null
                : groupRepository.findById(targetGroupId).orElse(null);
        if (group == null) {
            // 版本校验本该挡住这种情况（删组必然涨版本）。真到了这里说明有旁路写入，
            // 语义与「词表已变更」一致，整批回滚比写进去一半更可解释。
            log.warn("并入目标组已不存在，整批回滚 targetGroupId={} lineNo={}", targetGroupId, row.lineNo());
            throw new KbBusinessException(KbResultCode.KB_SYNONYM_IMPORT_STALE);
        }

        List<KbSynonymTerm> existing = termRepository.findByGroupIdOrderBySortNo(targetGroupId);
        Set<String> seen = new HashSet<>(existing.size() * 2 + row.aliases().size() * 2);
        int maxSortNo = KbSynonymTerm.CANONICAL_SORT_NO;
        for (KbSynonymTerm term : existing) {
            seen.add(term.getTermNorm());
            if (term.getSortNo() != null && term.getSortNo() > maxSortNo) {
                maxSortNo = term.getSortNo();
            }
        }

        List<KbSynonymTerm> added = new ArrayList<>(row.aliases().size());
        int sortNo = maxSortNo + 1;
        for (String alias : row.aliases()) {
            String norm = SynonymTermNormalizer.normalize(alias);
            if (norm.isEmpty() || !seen.add(norm)) {
                continue;
            }
            added.add(newTerm(targetGroupId, alias, KbSynonymTerm.CANONICAL_NO, sortNo, now));
            sortNo++;
        }
        if (!added.isEmpty()) {
            termRepository.saveAll(added);
        }

        String remark = trimTo(row.remark(), MAX_REMARK_LENGTH);
        if (remark != null && (group.getRemark() == null || group.getRemark().isBlank())) {
            group.setRemark(remark);
        }
        group.setUpdatedAt(now);
        group.setUpdatedBy(userId);
        groupRepository.save(group);
    }

    /**
     * 造一条词条实体。
     *
     * @param groupId   所属组
     * @param raw       词条原文
     * @param canonical {@link KbSynonymTerm#CANONICAL_YES} / {@link KbSynonymTerm#CANONICAL_NO}
     * @param sortNo    组内排序号
     * @param now       创建时刻
     * @return 未落库的实体
     */
    private static KbSynonymTerm newTerm(Long groupId, String raw, int canonical, int sortNo, Instant now) {
        KbSynonymTerm term = new KbSynonymTerm();
        term.setId(IdGenerator.nextId());
        term.setGroupId(groupId);
        term.setTerm(raw);
        term.setTermNorm(SynonymTermNormalizer.normalize(raw));
        term.setCanonical(canonical);
        term.setSortNo(sortNo);
        term.setCreatedAt(now);
        return term;
    }

    // ================================================================ 内部 · 工具

    /**
     * 判定文件格式。
     *
     * <p>先看扩展名；扩展名缺失（部分网关会丢掉 {@code filename}）时嗅探首个非空白字符。
     * 嗅探失败一律按 CSV —— CSV 解析器遇到 JSON 会报「缺少必需列 canonical_term」，
     * 这句提示比「JSON 语法错误」更接近真实原因（用户传的确实不是 CSV）。
     *
     * @param filename 原始文件名；可为 {@code null}
     * @param bytes    文件字节
     * @return {@code CSV} 或 {@code JSON}
     */
    private static String detectFormat(String filename, byte[] bytes) {
        if (filename != null) {
            String lower = filename.trim().toLowerCase(Locale.ROOT);
            if (lower.endsWith(".json")) {
                return KbSynonymImportBatch.FORMAT_JSON;
            }
            if (lower.endsWith(".csv")) {
                return KbSynonymImportBatch.FORMAT_CSV;
            }
        }
        for (byte b : bytes) {
            if (b == ' ' || b == '\t' || b == '\r' || b == '\n'
                    || b == (byte) 0xEF || b == (byte) 0xBB || b == (byte) 0xBF) {
                continue;
            }
            return b == '{' || b == '[' ? KbSynonymImportBatch.FORMAT_JSON : KbSynonymImportBatch.FORMAT_CSV;
        }
        return KbSynonymImportBatch.FORMAT_CSV;
    }

    /**
     * 清洗一条解析产物：裁剪长度、丢空别名、按<b>归一化词形</b>行内去重。
     *
     * <p>去重按词形而非原文：同一行里同时写了「OKR」与「ＯＫＲ」时，若按原文去重会双双入库，
     * 随即撞上 {@code uk_synonym_term_norm} 抛出一个用户完全看不懂的 500。
     * 这里静默合并（保留先出现的写法），与 {@code SynonymGroupService.mergeTerms} 同口径。
     *
     * @param raw 解析产物
     * @return 清洗后的产物
     */
    private static SynonymParsedGroup sanitize(SynonymParsedGroup raw) {
        String canonical = trimTo(raw.canonicalTerm(), MAX_TERM_LENGTH);
        Map<String, String> byNorm = new LinkedHashMap<>(raw.aliases().size() * 2 + 2);
        String canonicalNorm = SynonymTermNormalizer.normalize(canonical);
        if (!canonicalNorm.isEmpty()) {
            byNorm.put(canonicalNorm, canonical);
        }
        List<String> aliases = new ArrayList<>(raw.aliases().size());
        for (String alias : raw.aliases()) {
            String trimmed = trimTo(alias, MAX_TERM_LENGTH);
            if (trimmed == null) {
                continue;
            }
            String norm = SynonymTermNormalizer.normalize(trimmed);
            if (norm.isEmpty() || byNorm.putIfAbsent(norm, trimmed) != null) {
                continue;
            }
            aliases.add(trimmed);
        }
        return new SynonymParsedGroup(
                raw.lineNo(), canonical, aliases, trimTo(raw.remark(), MAX_REMARK_LENGTH), raw.status());
    }

    /**
     * 序列化计划。
     *
     * @param plan 行级计划
     * @return JSON 文本
     */
    private static String writePlan(SynonymImportPlan plan) {
        try {
            return PLAN_MAPPER.writeValueAsString(plan);
        } catch (JsonProcessingException e) {
            // 序列化自己造的对象都会失败，说明是代码缺陷而非用户输入问题，不该伪装成业务错误。
            throw new IllegalStateException("导入计划序列化失败", e);
        }
    }

    /**
     * 反序列化计划。
     *
     * @param json {@code plan_json} 全文
     * @return 行级计划
     * @throws KbBusinessException 内容缺失或损坏时抛 40931（可操作：重新预检）
     */
    private static SynonymImportPlan readPlan(String json) {
        if (json == null || json.isBlank()) {
            throw new KbBusinessException(KbResultCode.KB_SYNONYM_IMPORT_TOKEN_INVALID);
        }
        try {
            return PLAN_MAPPER.readValue(json, SynonymImportPlan.class);
        } catch (JsonProcessingException e) {
            log.warn("导入计划反序列化失败", e);
            throw new KbBusinessException(
                    KbResultCode.KB_SYNONYM_IMPORT_TOKEN_INVALID,
                    "预检批次数据已损坏，请重新预检后再提交。");
        }
    }

    /**
     * 读当前词表版本号。
     *
     * @return 版本号；单行缺失时返回 0 并记警告（与 {@code SynonymGroupService} 同一降级口径）
     */
    private long currentVersion() {
        Long version = configRepository.findVersionById(KbSynonymConfig.SINGLETON_ID);
        if (version == null) {
            log.warn("kb_synonym_config 单行缺失，导入版本校验降级为 0");
            return 0L;
        }
        return version;
    }

    /**
     * 批量取各组词条并按组分桶（{@code sortNo} 升序，规范词恒在首位）。
     *
     * @param groupIds 组 ID 集合
     * @return 组 ID → 词条列表
     */
    private Map<Long, List<KbSynonymTerm>> groupTerms(Collection<Long> groupIds) {
        List<KbSynonymTerm> terms = termRepository.findByGroupIdInOrderBySortNo(groupIds);
        Map<Long, List<KbSynonymTerm>> byGroup = new HashMap<>(groupIds.size() * 2);
        for (KbSynonymTerm term : terms) {
            byGroup.computeIfAbsent(term.getGroupId(), key -> new ArrayList<>()).add(term);
        }
        return byGroup;
    }

    /**
     * trim 后按上限截断，空白转 {@code null}。
     *
     * <p>截断而非报错：128 / 512 这两个上限已远超正常用法，为一个多粘进来的尾注
     * 让整行导入失败不划算。
     *
     * @param raw       原文
     * @param maxLength 长度上限
     * @return 处理后的文本；空白返回 {@code null}
     */
    private static String trimTo(String raw, int maxLength) {
        if (raw == null) {
            return null;
        }
        String trimmed = raw.trim();
        if (trimmed.isEmpty()) {
            return null;
        }
        return trimmed.length() > maxLength ? trimmed.substring(0, maxLength) : trimmed;
    }
}
