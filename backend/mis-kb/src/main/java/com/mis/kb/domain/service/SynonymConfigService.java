package com.mis.kb.domain.service;

import com.mis.kb.api.dto.SynonymConfigVO;
import com.mis.kb.api.dto.SynonymExpansionVO.SynonymBudgetVO;
import com.mis.kb.domain.entity.KbSynonymConfig;
import com.mis.kb.domain.repository.KbSynonymConfigRepository;
import com.mis.kb.domain.repository.KbSynonymGroupRepository;
import com.mis.kb.domain.repository.KbSynonymTermRepository;
import com.mis.kb.engine.SynonymProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;

/**
 * 同义词全局配置服务（Wave D · T07，WD-07 / WD-15）。
 *
 * <p><b>双闸语义（Q2 裁决）</b>：库内业务开关 {@code kb_synonym_config.enabled}（页面可写）
 * 与 Nacos 熔断闸 {@code mis.kb.synonym.enabled}（页面只读）<b>任一为 false 即不扩展</b>。
 * {@code effective} 由本服务算好下发，前端直读——让「生效状态」只有一个定义处。
 *
 * <p><b>关开关不动词表</b>（AC-02 的核心）：{@link #setEnabled} 只改 {@code enabled} 一列，
 * 词条一条不删。这是「熔断」而非「清空」，恢复时把开关拨回来即可，无需重新导入。
 * 检索侧看到的是 {@code SynonymExpansion.status == DISABLED_GLOBAL}，
 * 而不是「词表为空」——两者对管理员意味着完全不同的排查方向。
 *
 * <p><b>为什么切开关也要 {@code bumpVersion()}</b>：开关值随词典快照一起被缓存在各实例内存里
 * （{@code SynonymDictLoader.enabled()}），而 L2 轮询只比对版本号。不涨版本，
 * 其它实例就要等到下一次词表变更才会感知到开关已经关掉——熔断闸失去即时性，形同虚设。
 */
@Service
public class SynonymConfigService {

    private static final Logger log = LoggerFactory.getLogger(SynonymConfigService.class);

    private final KbSynonymConfigRepository configRepository;
    private final KbSynonymGroupRepository groupRepository;
    private final KbSynonymTermRepository termRepository;
    private final SynonymProperties properties;
    private final SynonymDictLoader dictLoader;

    /**
     * 构造。
     *
     * @param configRepository 配置仓储
     * @param groupRepository  术语组仓储（规模水位）
     * @param termRepository   词条仓储（规模水位）
     * @param properties       Nacos 配置（熔断闸 + 预算 + 建议线）
     * @param dictLoader       词典加载器（L1 即时刷新）
     */
    public SynonymConfigService(
            KbSynonymConfigRepository configRepository,
            KbSynonymGroupRepository groupRepository,
            KbSynonymTermRepository termRepository,
            SynonymProperties properties,
            SynonymDictLoader dictLoader) {
        this.configRepository = configRepository;
        this.groupRepository = groupRepository;
        this.termRepository = termRepository;
        this.properties = properties;
        this.dictLoader = dictLoader;
    }

    /**
     * 一次取回 S-07 页面需要的全部状态（WD-07）。
     *
     * <p>包含：{@code enabled} / {@code killSwitchEnabled} / {@code effective} /
     * {@code budget} / {@code scale} / {@code dictVersion}。
     *
     * <p><b>库内开关直接读库而不是读内存快照</b>：本接口是管理页的数据源，
     * 管理员刚点完开关就刷新页面，读快照可能还差最多 3 秒（L2 轮询间隔），
     * 界面会「弹回去」。管理页要的是强一致，这一次多查一行完全值得。
     *
     * @return 配置视图，恒非 {@code null}
     */
    @Transactional(readOnly = true)
    public SynonymConfigVO get() {
        Integer dbEnabled = configRepository.findEnabledById(KbSynonymConfig.SINGLETON_ID);
        Long version = configRepository.findVersionById(KbSynonymConfig.SINGLETON_ID);

        // 单行种子由 V18 迁移写入；缺失时按「开」处理，与 SynonymDictLoader.doLoad 的兜底口径一致，
        // 避免同一异常状态在两处得出相反结论。
        boolean enabled = dbEnabled == null || dbEnabled == KbSynonymConfig.ENABLED_YES;
        boolean killSwitch = properties.isEnabled();

        return new SynonymConfigVO(
                enabled,
                killSwitch,
                enabled && killSwitch,
                SynonymBudgetVO.from(properties.toBudget()),
                new SynonymConfigVO.SynonymScaleVO(
                        groupRepository.countAll(),
                        termRepository.countAll(),
                        properties.getRecommendedTermLimit()),
                version == null ? 0L : version);
    }

    /**
     * 切换库内业务开关（WD-07 / AC-02）。
     *
     * <p><b>只改开关位，词表一条不动。</b>同一事务内 {@code bumpVersion()}，
     * 事务提交后 {@code reloadNow()} —— 顺序理由见
     * {@link SynonymGroupService#scheduleReload}，此处复用同一份实现，
     * 不允许各写各的。
     *
     * <p><b>不校验熔断闸</b>：即便 Nacos 侧 {@code killSwitchEnabled=false}，
     * 库内开关依然可写。理由是运维熔断是临时措施，管理员在熔断期间调整业务开关的意图
     * 应当被保存下来，等熔断解除后按其最后一次设置生效。前端此时会把开关置灰，
     * 属于交互层的提示，不是后端的拒绝条件。
     *
     * @param enabled 目标状态
     * @param userId  操作人；可为 {@code null}
     * @return 切换后的配置视图
     */
    @Transactional
    public SynonymConfigVO setEnabled(boolean enabled, Long userId) {
        Instant now = Instant.now();
        int flag = enabled ? KbSynonymConfig.ENABLED_YES : KbSynonymConfig.ENABLED_NO;

        configRepository.updateEnabled(flag, now, userId);
        // updateEnabled 刻意不动 dictVersion（见仓储注释），版本自增在这里单独做一次，
        // 这样其它实例的 L2 轮询才能在 3 秒内感知到开关变化。
        configRepository.bumpVersion(now, userId);

        Long newVersion = configRepository.findVersionById(KbSynonymConfig.SINGLETON_ID);
        if (newVersion != null) {
            SynonymGroupService.scheduleReload(dictLoader, newVersion);
        } else {
            log.warn("kb_synonym_config 单行缺失，跳过词典即时刷新；下一轮轮询将自愈");
        }

        log.info("切换同义词全局开关 enabled={} version={} operator={}", enabled, newVersion, userId);

        boolean killSwitch = properties.isEnabled();
        return new SynonymConfigVO(
                enabled,
                killSwitch,
                enabled && killSwitch,
                SynonymBudgetVO.from(properties.toBudget()),
                new SynonymConfigVO.SynonymScaleVO(
                        groupRepository.countAll(),
                        termRepository.countAll(),
                        properties.getRecommendedTermLimit()),
                newVersion == null ? 0L : newVersion);
    }
}
