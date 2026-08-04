package com.mis.kb.domain.service;

import com.mis.kb.domain.entity.KbSynonymConfig;
import com.mis.kb.domain.entity.KbSynonymGroup;
import com.mis.kb.domain.entity.KbSynonymTerm;
import com.mis.kb.domain.model.GroupEntry;
import com.mis.kb.domain.model.SynonymDictionary;
import com.mis.kb.domain.repository.KbSynonymConfigRepository;
import com.mis.kb.domain.repository.KbSynonymGroupRepository;
import com.mis.kb.domain.repository.KbSynonymTermRepository;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 同义词内存词典加载器 —— <b>跨实例一致性的三层机制</b>（设计 §4.2 / Q7）。
 *
 * <table border="1">
 *   <caption>三层机制</caption>
 *   <tr><th>层</th><th>机制</th><th>延迟</th></tr>
 *   <tr><td><b>L1 写实例即时</b></td>
 *       <td>写事务<b>提交后</b>调 {@link #reloadNow(long)}</td><td>0</td></tr>
 *   <tr><td><b>L2 其它实例轮询</b></td>
 *       <td>{@link #pollForChanges()} 每 {@code refresh-interval-ms}（默认 3s）只读
 *           {@code kb_synonym_config} 单行主键，版本变了才全量重载</td><td>≤3 秒</td></tr>
 *   <tr><td><b>L3 命中测试强一致</b></td>
 *       <td>{@link #ensureFresh()} 同步查一次版本，落后即就地重载</td><td>0</td></tr>
 * </table>
 *
 * <p><b>热路径 {@code KbRetrieveService} 不调用 {@code ensureFresh()}</b>，只用 {@link #current()}
 * —— 这是 AC-06 的关键：问答链路上一次数据库都不碰。
 *
 * <p><b>部署形态假设（主理人裁决 U1）：</b>按「可能多副本」设计，L1+L2+L3 三层都保留。
 * 若实际长期单实例，L2 是一份冗余保险，成本为每 3 秒一次主键查询（可忽略），
 * 未来扩副本时<b>零代码改动</b>。
 *
 * <p><b>可观测（主理人裁决 U3）：</b>暴露两个 actuator 指标 ——
 * {@code dict_load_total}（累计全量加载次数，Counter）与 {@code dict_version}（当前版本，Gauge）。
 * AC-06 的验收方式：连续跑 20 次命中测试，{@code dict_load_total} <b>不增长</b>即为通过。
 * 这比翻日志更可证伪。
 */
@Component
public class SynonymDictLoader {

    private static final Logger log = LoggerFactory.getLogger(SynonymDictLoader.class);

    /** 累计全量加载次数指标名（AC-06 佐证）。 */
    public static final String METRIC_DICT_LOAD_TOTAL = "dict_load_total";
    /** 当前词典版本号指标名。 */
    public static final String METRIC_DICT_VERSION = "dict_version";

    private final KbSynonymConfigRepository configRepository;
    private final KbSynonymGroupRepository groupRepository;
    private final KbSynonymTermRepository termRepository;

    /** 当前快照；刷新 = 整体替换引用，读侧零锁。 */
    private volatile SynonymDictionary current = SynonymDictionary.empty();

    /** 库内业务开关的内存快照，随每次加载同步刷新。 */
    private volatile boolean enabledSnapshot = true;

    /** Gauge 的取数源（Micrometer 的 Gauge 只持弱引用，必须自己留强引用）。 */
    private final AtomicLong versionGaugeSource = new AtomicLong(SynonymDictionary.EMPTY_VERSION);

    /** 累计全量加载次数；registry 缺失时仍然计数，便于单测断言。 */
    private final AtomicLong loadCounterFallback = new AtomicLong(0L);

    private final Counter loadCounter;

    /** 重载临界区锁：避免 L1/L2/L3 三路同时触发全量加载。 */
    private final Object reloadLock = new Object();

    /**
     * 构造。
     *
     * @param configRepository 配置仓储
     * @param groupRepository  术语组仓储
     * @param termRepository   词条仓储
     * @param meterRegistry    指标注册表；允许为 {@code null}（单测场景）
     */
    public SynonymDictLoader(
            KbSynonymConfigRepository configRepository,
            KbSynonymGroupRepository groupRepository,
            KbSynonymTermRepository termRepository,
            MeterRegistry meterRegistry) {
        this.configRepository = configRepository;
        this.groupRepository = groupRepository;
        this.termRepository = termRepository;
        if (meterRegistry != null) {
            this.loadCounter = Counter.builder(METRIC_DICT_LOAD_TOTAL)
                    .description("同义词词典全量加载累计次数（AC-06：热路径不应使其增长）")
                    .register(meterRegistry);
            Gauge.builder(METRIC_DICT_VERSION, versionGaugeSource, AtomicLong::get)
                    .description("当前内存词典对应的 kb_synonym_config.dict_version")
                    .register(meterRegistry);
        } else {
            this.loadCounter = null;
        }
    }

    // ---------------------------------------------------------------- 生命周期

    /**
     * 启动期初始加载。
     *
     * <p><b>失败不得让应用启动失败</b>：{@code current} 兜底为 {@link SynonymDictionary#empty()}
     * 并打 ERROR，下一次 L2 轮询会自愈。词表是增强能力，不是启动前置条件 ——
     * 让一张业务表把整个知识库服务拖死是不可接受的。
     */
    @PostConstruct
    public void initialLoad() {
        try {
            reloadFromDbIfStale(true);
            log.info("同义词词典初始加载完成 version={} groups={} terms={} enabled={}",
                    current.version(), current.groupCount(), current.termCount(), enabledSnapshot);
        } catch (RuntimeException ex) {
            this.current = SynonymDictionary.empty();
            this.versionGaugeSource.set(SynonymDictionary.EMPTY_VERSION);
            log.error("同义词词典初始加载失败，已回落空词典；下一次轮询将自愈", ex);
        }
    }

    // ---------------------------------------------------------------- 读侧 API

    /**
     * 取当前快照（<b>热路径唯一入口</b>，零查询）。
     *
     * @return 当前不可变词典快照，恒非 {@code null}
     */
    public SynonymDictionary current() {
        return current;
    }

    /**
     * 库内业务开关的内存快照。
     *
     * <p>注意这只是<b>双闸之一</b>；另一闸是 Nacos 的 {@code mis.kb.synonym.enabled}。
     * 生效开关 = 两者相与（Q2）。
     *
     * @return 库内开关为开返回 {@code true}
     */
    public boolean enabled() {
        return enabledSnapshot;
    }

    /**
     * L3：强一致读取（<b>仅命中测试调用</b>）。
     *
     * <p>同步查一次版本号，落后即就地重载，然后返回最新快照。
     * 这是 Q7「已保存，可立即在命中测试中验证」这句承诺的兑现点。
     *
     * @return 与数据库版本一致的词典快照
     */
    public SynonymDictionary ensureFresh() {
        try {
            reloadFromDbIfStale(false);
        } catch (RuntimeException ex) {
            log.error("同义词词典强一致刷新失败，本次沿用旧快照 version={}", current.version(), ex);
        }
        return current;
    }

    // ---------------------------------------------------------------- 写侧回调

    /**
     * L1：写实例即时刷新。
     *
     * <p>⛔ <b>必须在写事务提交之后调用</b>（{@code TransactionSynchronization.afterCommit}）。
     * 放在事务体内会读到尚未提交的旧数据，反而把错误的快照固化下来。
     *
     * @param newVersion 写操作产生的新版本号；小于等于当前快照版本时跳过
     */
    public void reloadNow(long newVersion) {
        synchronized (reloadLock) {
            if (newVersion <= current.version()) {
                log.debug("同义词词典无需刷新 current={} incoming={}", current.version(), newVersion);
                return;
            }
            try {
                doLoad(newVersion);
                log.info("词典已刷新 version={} groups={} terms={} 触发源=写实例即时(L1)",
                        current.version(), current.groupCount(), current.termCount());
            } catch (RuntimeException ex) {
                log.error("同义词词典即时刷新失败 targetVersion={}，等待轮询自愈", newVersion, ex);
            }
        }
    }

    /**
     * L2：定时轮询。
     *
     * <p>只读 {@code kb_synonym_config} 单行主键（一次索引命中），
     * <b>版本没变就直接返回，不碰词表</b>。绝大多数轮次的开销就是这一次主键查询。
     */
    @Scheduled(fixedDelayString = "${mis.kb.synonym.refresh-interval-ms:3000}")
    public void pollForChanges() {
        try {
            reloadFromDbIfStale(false);
        } catch (RuntimeException ex) {
            // 轮询失败只记 WARN 不抛：抛出会让 Spring 的调度线程打满错误日志，且下一轮自然重试
            log.warn("同义词词典轮询刷新失败，将在下一轮重试：{}", ex.getMessage());
        }
    }

    // ---------------------------------------------------------------- 内部实现

    /**
     * 比版本 → 决定是否全量加载。
     *
     * @param forceOnFirstLoad 首次加载时即使版本相同也强制装载一次
     */
    private void reloadFromDbIfStale(boolean forceOnFirstLoad) {
        Long dbVersion = configRepository.findVersionById(KbSynonymConfig.SINGLETON_ID);
        if (dbVersion == null) {
            // 单行种子由 V18 迁移写入；缺失说明迁移未执行，此时保持空词典即可
            if (forceOnFirstLoad) {
                log.warn("kb_synonym_config 单行配置缺失（id=1），同义词功能暂以空词典运行");
            }
            return;
        }
        boolean stale = dbVersion != current.version();
        if (!stale && !forceOnFirstLoad) {
            return;
        }
        synchronized (reloadLock) {
            // 双检：等锁期间可能已被别的线程刷过
            if (dbVersion == current.version() && !forceOnFirstLoad) {
                return;
            }
            long before = current.version();
            doLoad(dbVersion);
            if (before != current.version()) {
                log.info("词典已刷新 version={} groups={} terms={} 触发源=版本比对",
                        current.version(), current.groupCount(), current.termCount());
            }
        }
    }

    /**
     * 全量加载。
     *
     * <p><b>顺序铁律：先读 version，再读数据。</b>反过来会漏掉「两次读之间发生的写入」——
     * 那种情况下我们会用一个偏新的版本号去标记一份偏旧的数据，之后任何版本比对都不会再触发刷新，
     * 错误会永久固化。这里传入的 {@code version} 已经是调用方先取好的。
     *
     * <p>只装载 {@code status = 1} 的组：停用组仍占用词条唯一性（Q3），但不参与扩展。
     *
     * <p><b>刻意不加 {@code @Transactional}：</b>本方法只在类内部被调用，加了也会因自调用绕过代理
     * 而失效 —— 一个永远不生效的注解比没有注解更危险。这里的两次仓储查询各自跑在 Spring Data
     * 的默认只读事务里，而版本号已在调用方先行取好，即使两次查询之间发生写入，
     * 也只会让本次快照偏旧一个版本，下一轮轮询即修正。
     *
     * @param version 本次快照标记的版本号
     */
    private void doLoad(long version) {
        List<KbSynonymGroup> enabledGroups =
                groupRepository.findByStatus(KbSynonymGroup.STATUS_ENABLED);
        Integer dbEnabled = configRepository.findEnabledById(KbSynonymConfig.SINGLETON_ID);
        boolean nextEnabled = dbEnabled == null || dbEnabled == KbSynonymConfig.ENABLED_YES;

        if (enabledGroups.isEmpty()) {
            this.current = new SynonymDictionary(version, Map.of(), Map.of());
            this.enabledSnapshot = nextEnabled;
            this.versionGaugeSource.set(version);
            countLoad();
            return;
        }

        List<Long> groupIds = new ArrayList<>(enabledGroups.size());
        Map<Long, String> canonicalByGroup = new HashMap<>(enabledGroups.size() * 2);
        for (KbSynonymGroup g : enabledGroups) {
            groupIds.add(g.getId());
            canonicalByGroup.put(g.getId(), g.getCanonicalTerm());
        }

        List<KbSynonymTerm> terms = termRepository.findByGroupIdInOrderBySortNo(groupIds);

        // groupId → 组内词条原文（sortNo 升序，规范词在首位）
        Map<Long, List<String>> orderedByGroup = new LinkedHashMap<>(groupIds.size() * 2);
        Map<String, Long> termIndex = new HashMap<>(Math.max(16, terms.size() * 2));
        for (KbSynonymTerm t : terms) {
            if (t.getTermNorm() == null || t.getTermNorm().isEmpty()) {
                continue;
            }
            orderedByGroup
                    .computeIfAbsent(t.getGroupId(), k -> new ArrayList<>())
                    .add(t.getTerm());
            // uk_synonym_term_norm 保证全局唯一，理论上不会覆盖；putIfAbsent 是防御性写法
            termIndex.putIfAbsent(t.getTermNorm(), t.getGroupId());
        }

        Map<Long, GroupEntry> groups = new HashMap<>(groupIds.size() * 2);
        for (Long gid : groupIds) {
            List<String> ordered = orderedByGroup.getOrDefault(gid, List.of());
            groups.put(gid, new GroupEntry(gid, canonicalByGroup.get(gid), ordered));
        }

        this.current = new SynonymDictionary(version, termIndex, groups);
        this.enabledSnapshot = nextEnabled;
        this.versionGaugeSource.set(version);
        countLoad();
    }

    /** 全量加载计数（AC-06 的可证伪证据）。 */
    private void countLoad() {
        loadCounterFallback.incrementAndGet();
        if (loadCounter != null) {
            loadCounter.increment();
        }
    }

    /**
     * 累计全量加载次数（与 {@code dict_load_total} 指标同源，供单测与自检使用）。
     *
     * @return 自进程启动以来的全量加载次数
     */
    public long loadCount() {
        return loadCounterFallback.get();
    }
}
