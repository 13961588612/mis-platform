package com.mis.kb.domain.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.PageResult;
import com.mis.kb.api.dto.SynonymGroupVO;
import com.mis.kb.domain.entity.KbSynonymConfig;
import com.mis.kb.domain.entity.KbSynonymGroup;
import com.mis.kb.domain.entity.KbSynonymTerm;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.model.SynonymTermNormalizer;
import com.mis.kb.domain.repository.KbSynonymConfigRepository;
import com.mis.kb.domain.repository.KbSynonymGroupRepository;
import com.mis.kb.domain.repository.KbSynonymTermRepository;
import com.mis.kb.support.IdGenerator;
import com.mis.kb.support.KbBusinessException;
import com.mis.kb.support.KbSynonymConflictException;
import com.mis.kb.support.SynonymConflictDetail;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.util.StringUtils;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 术语组服务（Wave D · T07，WD-01 / WD-02 / WD-03）。
 *
 * <p><b>本类的三条硬约束，任何改动都要先读完：</b>
 *
 * <ol>
 *   <li><b>冲突检测只允许查一次库。</b>{@link #checkTermConflicts} 用
 *       {@code findByTermNormIn} 批量查。用 N 次单查代替它，导入两千组就是两千次往返，
 *       这是 T08 批量导入能不能跑完的分水岭。</li>
 *   <li><b>{@code bumpVersion()} 在写事务内，{@code reloadNow()} 在事务提交后。</b>
 *       顺序反了会读到未提交的旧数据，并把这份错误快照连同新版本号一起固化下来——
 *       之后任何版本比对都不会再触发刷新，错误<b>永久</b>存在。
 *       实现见 {@link #bumpVersionAndScheduleReload}。</li>
 *   <li><b>停用组仍占用词条唯一性</b>（Q3 裁决）。{@code uk_synonym_term_norm} 不带 status 条件，
 *       冲突检测也<b>不过滤</b> status。产品理由：否则会出现「停用 A 组 → 词被 B 组抢走 →
 *       A 组再也启用不了」的死结。40927 的 message 因此必须点明「已停用的术语组同样占用」。</li>
 * </ol>
 *
 * <p><b>为什么编辑走「先删后插」而不是逐条 diff：</b>组内词条量级是个位数到几十，
 * diff 的复杂度（判等、判序、判 canonical 迁移）远高于收益，而且顺序变更本身就是全量语义
 * ——用户拖拽调序后，整个列表的 {@code sortNo} 都变了。全删全插反而更不容易出错。
 */
@Service
public class SynonymGroupService {

    private static final Logger log = LoggerFactory.getLogger(SynonymGroupService.class);

    /** 分页兜底大小；前端不传时用它，避免 {@code size=0} 触发全表扫描。 */
    private static final int DEFAULT_PAGE_SIZE = 20;

    /** 单页硬上限（WD-03：任何情况下不一次性拉全表）。 */
    private static final int MAX_PAGE_SIZE = 200;

    /** 词条原文最大长度，与 {@code kb_synonym_term.term VARCHAR(128)} 对齐。 */
    private static final int MAX_TERM_LENGTH = 128;

    /** 备注最大长度，与 {@code kb_synonym_group.remark VARCHAR(512)} 对齐。 */
    private static final int MAX_REMARK_LENGTH = 512;

    private final KbSynonymGroupRepository groupRepository;
    private final KbSynonymTermRepository termRepository;
    private final KbSynonymConfigRepository configRepository;
    private final SynonymDictLoader dictLoader;

    /**
     * 构造。
     *
     * @param groupRepository  术语组仓储
     * @param termRepository   词条仓储
     * @param configRepository 配置仓储（版本自增）
     * @param dictLoader       词典加载器（L1 即时刷新）
     */
    public SynonymGroupService(
            KbSynonymGroupRepository groupRepository,
            KbSynonymTermRepository termRepository,
            KbSynonymConfigRepository configRepository,
            SynonymDictLoader dictLoader) {
        this.groupRepository = groupRepository;
        this.termRepository = termRepository;
        this.configRepository = configRepository;
        this.dictLoader = dictLoader;
    }

    // ---------------------------------------------------------------- 查询

    /**
     * 分页搜索术语组（WD-03）。
     *
     * <p>搜索范围是「规范词 <b>或</b> 任意别名」，大小写不敏感。命中别名时回填
     * {@code matchedAlias} 供列表展示「命中别名：X」——否则用户搜「OKR」却看到一行
     * 「关键结果法」，会以为搜错了。
     *
     * @param keyword 关键词；空白视为不过滤
     * @param status  状态过滤；{@code null} 表示不过滤
     * @param page    页码，从 <b>1</b> 开始（与 {@code docs/api/api-specification.md} 一致）；
     *                {@code null} / ≤0 收敛为 1
     * @param size    每页条数；非正数回落默认值，超过 {@link #MAX_PAGE_SIZE} 被截断
     * @return 分页结果，恒非 {@code null}；{@code page} 字段回传 1-based 页码
     */
    @Transactional(readOnly = true)
    public PageResult<SynonymGroupVO> search(String keyword, Integer status, Integer page, Integer size) {
        int pageNo = page == null || page < 1 ? 1 : page;
        int pageSize = size == null || size <= 0 ? DEFAULT_PAGE_SIZE : Math.min(size, MAX_PAGE_SIZE);
        // Spring Data 页码从 0 起；对外契约是 1-based，这里只在进仓储时减一。
        Pageable pageable = PageRequest.of(pageNo - 1, pageSize, Sort.by(Sort.Direction.DESC, "updatedAt"));

        String trimmed = keyword == null ? null : keyword.trim();
        // 仓储侧的 LIKE 已对列做 LOWER()，这里把参数也转小写，两边口径才对齐。
        String likeKeyword = StringUtils.hasText(trimmed)
                ? "%" + trimmed.toLowerCase(Locale.ROOT) + "%"
                : null;

        Page<KbSynonymGroup> groups = groupRepository.search(likeKeyword, status, pageable);
        List<KbSynonymGroup> content = groups.getContent();
        if (content.isEmpty()) {
            return PageResult.of(pageNo, pageSize, groups.getTotalElements(), List.of());
        }

        // 只为「本页」这几十组取词条：计数与 matchedAlias 都要用，一次批量查搞定。
        List<Long> ids = content.stream().map(KbSynonymGroup::getId).toList();
        Map<Long, List<KbSynonymTerm>> termsByGroup = groupTermsByGroupId(ids);

        List<SynonymGroupVO> list = new ArrayList<>(content.size());
        for (KbSynonymGroup group : content) {
            List<KbSynonymTerm> terms = termsByGroup.getOrDefault(group.getId(), List.of());
            list.add(SynonymGroupVO.ofSummary(
                    group, terms.size(), matchedAlias(group, terms, trimmed)));
        }
        return PageResult.of(pageNo, pageSize, groups.getTotalElements(), list);
    }

    /**
     * 术语组详情（含完整词条列表）。
     *
     * @param id 组 ID
     * @return 详情视图
     * @throws KbBusinessException 组不存在时抛 {@code KB_SYNONYM_GROUP_NOT_FOUND}
     */
    @Transactional(readOnly = true)
    public SynonymGroupVO get(Long id) {
        KbSynonymGroup group = requireGroup(id);
        return SynonymGroupVO.ofDetail(group, termRepository.findByGroupIdOrderBySortNo(id));
    }

    // ---------------------------------------------------------------- 写入

    /**
     * 新建术语组（WD-01 / WD-02）。
     *
     * @param canonicalTerm 规范词原文
     * @param aliases       别名列表（有序，顺序即预算截断优先级）；可为 {@code null}
     * @param remark        备注；可为 {@code null}
     * @param status        1=启用 0=停用；{@code null} 视为启用
     * @param userId        操作人；可为 {@code null}
     * @return 新建后的详情视图
     */
    @Transactional
    public SynonymGroupVO create(
            String canonicalTerm, List<String> aliases, String remark, Integer status, Long userId) {
        String canonical = requireCanonicalTerm(canonicalTerm);
        List<String> orderedTerms = mergeTerms(canonical, aliases);
        // selfGroupId 传 null：新建时没有「自己」可以豁免，任何已存在的词形都是冲突。
        checkTermConflicts(null, orderedTerms);

        Instant now = Instant.now();
        KbSynonymGroup group = new KbSynonymGroup();
        group.setId(IdGenerator.nextId());
        group.setCanonicalTerm(canonical);
        group.setStatus(normalizeStatus(status));
        group.setRemark(trimToNull(remark, MAX_REMARK_LENGTH));
        group.setCreatedAt(now);
        group.setUpdatedAt(now);
        group.setUpdatedBy(userId);
        groupRepository.save(group);

        List<KbSynonymTerm> saved = insertTerms(group.getId(), orderedTerms, now);
        bumpVersionAndScheduleReload(now, userId);
        log.info("新建术语组 id={} canonical={} terms={} operator={}",
                group.getId(), canonical, saved.size(), userId);
        return SynonymGroupVO.ofDetail(group, saved);
    }

    /**
     * 编辑术语组（WD-02）。
     *
     * <p>词条走<b>先删后插</b>：{@code sortNo} 全量重排，规范词恒回到 {@code canonical=1, sortNo=0}。
     *
     * @param id            组 ID
     * @param canonicalTerm 规范词原文
     * @param aliases       别名列表（有序）；可为 {@code null}
     * @param remark        备注；可为 {@code null}
     * @param status        1=启用 0=停用；{@code null} 视为启用
     * @param userId        操作人；可为 {@code null}
     * @return 保存后的详情视图
     */
    @Transactional
    public SynonymGroupVO update(
            Long id, String canonicalTerm, List<String> aliases, String remark, Integer status, Long userId) {
        KbSynonymGroup group = requireGroup(id);
        String canonical = requireCanonicalTerm(canonicalTerm);
        List<String> orderedTerms = mergeTerms(canonical, aliases);
        // selfGroupId 传 id：本组自己已占用的词形不算冲突，否则「只改备注」也会撞上自己。
        checkTermConflicts(id, orderedTerms);

        Instant now = Instant.now();
        group.setCanonicalTerm(canonical);
        group.setStatus(normalizeStatus(status));
        group.setRemark(trimToNull(remark, MAX_REMARK_LENGTH));
        group.setUpdatedAt(now);
        group.setUpdatedBy(userId);
        groupRepository.save(group);

        // 先删后插：deleteByGroupId 是 @Modifying 批量语句，需要 flush 掉再插，
        // 否则同一 term_norm 的「删」还挂在持久化上下文里没落库，「插」就会撞唯一索引。
        termRepository.deleteByGroupId(id);
        termRepository.flush();
        List<KbSynonymTerm> saved = insertTerms(id, orderedTerms, now);

        bumpVersionAndScheduleReload(now, userId);
        log.info("编辑术语组 id={} canonical={} terms={} operator={}", id, canonical, saved.size(), userId);
        return SynonymGroupVO.ofDetail(group, saved);
    }

    /**
     * 删除术语组（硬删，Q4；词条随 FK {@code ON DELETE CASCADE} 一并消失）。
     *
     * <p>误删恢复靠 BFF 的 {@code @OperLog(recordParams = true)} 落的「删除前快照」（§7.7），
     * 因此<b>不做软删</b>——软删会让 {@code term_norm} 唯一性语义变得含混：
     * 一个「已删除」的组还占着词，用户完全无法理解。
     *
     * @param id     组 ID
     * @param userId 操作人；可为 {@code null}
     */
    @Transactional
    public void delete(Long id, Long userId) {
        KbSynonymGroup group = requireGroup(id);
        // 显式删词条而不是只依赖 DB 级联：H2 等测试库的 FK 级联行为与 MySQL 不完全一致，
        // 显式删一次既保证测试环境语义相同，也让「删了什么」在应用日志里可追。
        termRepository.deleteByGroupId(id);
        groupRepository.delete(group);
        bumpVersionAndScheduleReload(Instant.now(), userId);
        log.info("删除术语组 id={} canonical={} operator={}", id, group.getCanonicalTerm(), userId);
    }

    // ---------------------------------------------------------------- 冲突检测

    /**
     * <b>批量</b>词条冲突检测（WD-01，40927 的产生点）。
     *
     * <p><b>只查一次库</b>：一次 {@code findByTermNormIn} 拿回所有已被占用的词形。
     *
     * <p><b>不过滤 status</b>：停用组仍占用（Q3）。这是完成判据「停用 A 组后再把 OKR
     * 加进 B 组仍然 40927」的实现依据。
     *
     * <p>抛出的 {@link KbSynonymConflictException} 携带
     * {@code {term, ownerGroupId, ownerCanonicalTerm}} 三样，其中两个「词」都是<b>原文</b>：
     * 判重在 {@code term_norm} 上做，回显给用户的必须是他实际看到的写法（U4 衍生裁决）。
     *
     * @param selfGroupId 本组 ID；编辑场景传它以豁免自己占用的词形，新建场景传 {@code null}
     * @param rawTerms    本次提交的词条原文（规范词 + 别名，已去重去空）
     */
    @Transactional(readOnly = true)
    public void checkTermConflicts(Long selfGroupId, List<String> rawTerms) {
        if (rawTerms == null || rawTerms.isEmpty()) {
            return;
        }
        // norm → 本次提交里对应的原文。用 LinkedHashSet 的插入序保证：同一批里有多个冲突时，
        // 报出来的永远是「最靠前」那个，与用户在表单里从上往下的阅读顺序一致。
        Map<String, String> rawByNorm = new LinkedHashMap<>(rawTerms.size() * 2);
        for (String raw : rawTerms) {
            String norm = SynonymTermNormalizer.normalize(raw);
            if (!norm.isEmpty()) {
                rawByNorm.putIfAbsent(norm, raw);
            }
        }
        if (rawByNorm.isEmpty()) {
            return;
        }

        List<KbSynonymTerm> occupied = termRepository.findByTermNormIn(rawByNorm.keySet());
        if (occupied.isEmpty()) {
            return;
        }

        // norm → 占用它的组 ID（排除本组）
        Map<String, Long> ownerByNorm = new HashMap<>(occupied.size() * 2);
        for (KbSynonymTerm term : occupied) {
            if (selfGroupId != null && selfGroupId.equals(term.getGroupId())) {
                continue;
            }
            ownerByNorm.putIfAbsent(term.getTermNorm(), term.getGroupId());
        }
        if (ownerByNorm.isEmpty()) {
            return;
        }

        // 按提交顺序找出第一个冲突项，保证报错稳定可复现
        for (Map.Entry<String, String> entry : rawByNorm.entrySet()) {
            Long ownerGroupId = ownerByNorm.get(entry.getKey());
            if (ownerGroupId == null) {
                continue;
            }
            throw new KbSynonymConflictException(new SynonymConflictDetail(
                    entry.getValue(), ownerGroupId, canonicalTermOf(ownerGroupId)));
        }
    }

    /**
     * 批量取「词形 → 占用组 ID」映射（供 T08 导入预检复用，同样只查一次库）。
     *
     * <p>与 {@link #checkTermConflicts} 的区别：本方法<b>不抛异常</b>，把全部冲突一次报回。
     * 导入场景要的是「逐行报告」而不是「撞上第一个就中止」——用户需要一次看完所有问题行。
     *
     * @param selfGroupId 需要豁免的组 ID；无则传 {@code null}
     * @param norms       已归一化的词形集合
     * @return 发生冲突的「词形 → 占用组 ID」；无冲突返回空 Map
     */
    @Transactional(readOnly = true)
    public Map<String, Long> findConflictOwners(Long selfGroupId, Set<String> norms) {
        if (norms == null || norms.isEmpty()) {
            return Map.of();
        }
        List<KbSynonymTerm> occupied = termRepository.findByTermNormIn(norms);
        if (occupied.isEmpty()) {
            return Map.of();
        }
        Map<String, Long> owners = new HashMap<>(occupied.size() * 2);
        for (KbSynonymTerm term : occupied) {
            if (selfGroupId != null && selfGroupId.equals(term.getGroupId())) {
                continue;
            }
            owners.putIfAbsent(term.getTermNorm(), term.getGroupId());
        }
        return owners;
    }

    /**
     * 取某组的规范词原文（冲突提示用）。
     *
     * @param groupId 组 ID
     * @return 规范词；组已不存在时返回 {@code null}
     */
    @Transactional(readOnly = true)
    public String canonicalTermOf(Long groupId) {
        if (groupId == null) {
            return null;
        }
        return groupRepository.findById(groupId)
                .map(KbSynonymGroup::getCanonicalTerm)
                .orElse(null);
    }

    // ---------------------------------------------------------------- 版本与刷新

    /**
     * 写事务内自增版本号，并<b>登记事务提交后</b>的词典即时刷新（L1）。
     *
     * <p>⛔ <b>这两步的顺序是本波次最容易踩的坑，务必看完再改：</b>
     * <ul>
     *   <li>{@code bumpVersion()} 必须在<b>事务内</b>——它和词表写入要么一起成功，
     *       要么一起回滚。若版本涨了而数据回滚了，其它实例会白重载一次；
     *       更糟的是若数据落了而版本没涨，其它实例<b>永远</b>发现不了这次变更。</li>
     *   <li>{@code reloadNow()} 必须在<b>事务提交后</b>——事务未提交时重载读到的是旧数据，
     *       却会被打上新版本号。此后版本比对永远相等，这份错误快照将<b>永久</b>固化，
     *       连 L2 轮询都救不回来。</li>
     * </ul>
     * 因此这里用 {@link TransactionSynchronizationManager} 注册 {@code afterCommit} 回调，
     * 而不是在方法体末尾直接调 {@code reloadNow}。
     *
     * <p>无活跃事务时（理论上不会发生，防御性分支）直接同步刷新，避免回调被丢弃。
     *
     * @param now    操作时刻
     * @param userId 操作人；可为 {@code null}
     */
    private void bumpVersionAndScheduleReload(Instant now, Long userId) {
        configRepository.bumpVersion(now, userId);
        Long newVersion = configRepository.findVersionById(KbSynonymConfig.SINGLETON_ID);
        if (newVersion == null) {
            log.warn("kb_synonym_config 单行缺失，跳过词典即时刷新；下一轮轮询将自愈");
            return;
        }
        scheduleReload(dictLoader, newVersion);
    }

    /**
     * 登记「事务提交后刷新词典」。
     *
     * <p>抽成静态方法是为了让 {@code SynonymConfigService} 与 T08 的导入服务复用同一份
     * 顺序保证——这条规则只要有一处写错，跨实例一致性就破了，绝不允许各写各的。
     *
     * @param loader     词典加载器
     * @param newVersion 新版本号
     */
    static void scheduleReload(SynonymDictLoader loader, long newVersion) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            loader.reloadNow(newVersion);
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                loader.reloadNow(newVersion);
            }
        });
    }

    // ---------------------------------------------------------------- 内部工具

    /**
     * 组装组内有序词条：规范词恒在首位，别名去重后按原顺序跟随。
     *
     * <p>去重按<b>归一化词形</b>做而不是按原文：用户同时录入「OKR」与「ＯＫＲ」时，
     * 若按原文去重会双双入库，随即撞上 {@code uk_synonym_term_norm} 抛数据库异常——
     * 那是一个用户完全看不懂的 500。在这里静默合并（保留先出现的写法）才是正确处理。
     *
     * @param canonical 规范词原文（已校验非空）
     * @param aliases   别名列表；可为 {@code null}
     * @return 有序词条原文列表，首位为规范词
     */
    private List<String> mergeTerms(String canonical, List<String> aliases) {
        Set<String> seenNorms = new LinkedHashSet<>();
        List<String> ordered = new ArrayList<>();
        seenNorms.add(SynonymTermNormalizer.normalize(canonical));
        ordered.add(canonical);
        if (aliases == null) {
            return ordered;
        }
        for (String alias : aliases) {
            String trimmed = trimToNull(alias, MAX_TERM_LENGTH);
            if (trimmed == null) {
                continue;
            }
            String norm = SynonymTermNormalizer.normalize(trimmed);
            if (norm.isEmpty() || !seenNorms.add(norm)) {
                continue;
            }
            ordered.add(trimmed);
        }
        return ordered;
    }

    /**
     * 落库组内词条：首位为规范词（{@code canonical=1, sortNo=0}），别名 {@code sortNo} 从 1 递增。
     *
     * @param groupId 组 ID
     * @param ordered 有序词条原文
     * @param now     创建时刻
     * @return 已落库的词条实体，顺序与入参一致
     */
    private List<KbSynonymTerm> insertTerms(Long groupId, List<String> ordered, Instant now) {
        List<KbSynonymTerm> entities = new ArrayList<>(ordered.size());
        for (int i = 0; i < ordered.size(); i++) {
            String raw = ordered.get(i);
            KbSynonymTerm term = new KbSynonymTerm();
            term.setId(IdGenerator.nextId());
            term.setGroupId(groupId);
            term.setTerm(raw);
            term.setTermNorm(SynonymTermNormalizer.normalize(raw));
            term.setCanonical(i == 0 ? KbSynonymTerm.CANONICAL_YES : KbSynonymTerm.CANONICAL_NO);
            term.setSortNo(i);
            term.setCreatedAt(now);
            entities.add(term);
        }
        return termRepository.saveAll(entities);
    }

    /**
     * 批量取本页各组的词条，按组分桶（保持 {@code sortNo} 升序）。
     *
     * @param groupIds 组 ID 列表
     * @return 组 ID → 词条列表
     */
    private Map<Long, List<KbSynonymTerm>> groupTermsByGroupId(List<Long> groupIds) {
        List<KbSynonymTerm> terms = termRepository.findByGroupIdInOrderBySortNo(groupIds);
        Map<Long, List<KbSynonymTerm>> byGroup = new HashMap<>(groupIds.size() * 2);
        for (KbSynonymTerm term : terms) {
            byGroup.computeIfAbsent(term.getGroupId(), k -> new ArrayList<>()).add(term);
        }
        return byGroup;
    }

    /**
     * 判定本次搜索命中的是否为别名，是则回填该别名原文。
     *
     * <p>只有「规范词没命中、而某个别名命中了」才算命中别名——规范词本身已经显示在列表上，
     * 再提示一次「命中别名：关键结果法」纯属噪声。
     *
     * @param group   组实体
     * @param terms   组内词条
     * @param keyword 原始关键词（未加通配符）；空白返回 {@code null}
     * @return 命中的别名原文；未命中别名返回 {@code null}
     */
    private String matchedAlias(KbSynonymGroup group, List<KbSynonymTerm> terms, String keyword) {
        if (!StringUtils.hasText(keyword)) {
            return null;
        }
        String needle = keyword.toLowerCase(Locale.ROOT);
        String canonical = group.getCanonicalTerm();
        if (canonical != null && canonical.toLowerCase(Locale.ROOT).contains(needle)) {
            return null;
        }
        for (KbSynonymTerm term : terms) {
            if (term.isCanonical() || term.getTerm() == null) {
                continue;
            }
            if (term.getTerm().toLowerCase(Locale.ROOT).contains(needle)) {
                return term.getTerm();
            }
        }
        return null;
    }

    /**
     * 取组实体，不存在即抛 40415。
     *
     * @param id 组 ID
     * @return 组实体
     */
    private KbSynonymGroup requireGroup(Long id) {
        if (id == null) {
            throw new KbBusinessException(KbResultCode.KB_SYNONYM_GROUP_NOT_FOUND);
        }
        return groupRepository.findById(id)
                .orElseThrow(() -> new KbBusinessException(KbResultCode.KB_SYNONYM_GROUP_NOT_FOUND));
    }

    /**
     * 校验并裁剪规范词。
     *
     * @param raw 规范词原文
     * @return 已 trim 的规范词
     * @throws BusinessException 空白或归一化后为空时抛参数校验错
     */
    private String requireCanonicalTerm(String raw) {
        String trimmed = trimToNull(raw, MAX_TERM_LENGTH);
        if (trimmed == null || SynonymTermNormalizer.normalize(trimmed).isEmpty()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "规范词不能为空");
        }
        return trimmed;
    }

    /**
     * 归一化状态码：只认 0 与 1，其余（含 {@code null}）一律视为启用。
     *
     * @param status 入参状态
     * @return 0 或 1
     */
    private int normalizeStatus(Integer status) {
        return status != null && status == KbSynonymGroup.STATUS_DISABLED
                ? KbSynonymGroup.STATUS_DISABLED
                : KbSynonymGroup.STATUS_ENABLED;
    }

    /**
     * trim 后转 null，并按上限截断。
     *
     * <p>截断而非报错：多打一个空格或粘贴带尾注的文本不该让整次保存失败，
     * 而 128/512 这两个上限本身已远超正常用法。
     *
     * @param raw       原文
     * @param maxLength 长度上限
     * @return 处理后的字符串；空白返回 {@code null}
     */
    private static String trimToNull(String raw, int maxLength) {
        if (!StringUtils.hasText(raw)) {
            return null;
        }
        String trimmed = raw.trim();
        return trimmed.length() > maxLength ? trimmed.substring(0, maxLength) : trimmed;
    }
}
