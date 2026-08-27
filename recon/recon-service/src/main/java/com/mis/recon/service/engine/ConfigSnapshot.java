package com.mis.recon.service.engine;

import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;
import com.mis.recon.domain.config.ReconCheck;
import com.mis.recon.domain.config.ReconScenario;
import com.mis.recon.repository.CheckRepository;
import com.mis.recon.repository.ScenarioRepository;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 对账配置快照（T05-spec §4）：从 JPA Repository 读取场景/check 并解析运行期语义。
 * <p>解析细节在 {@link SnapshotParser}；统一口径：consume_json / datasets_json / key_fields_json 等
 * 数据集键一律 <b>alias</b>，解析时转换为引擎所需的 ds_code 视角。</p>
 */
@Component
public class ConfigSnapshot {

    /** 场景快照 */
    public static class LoadedScenario {
        public String scenarioCode;
        public int poolMaxAgeDays = 30;
        public int pendingMaxWaitHours = 24;
        public String onDegraded = "proceed";
        public String onEmpty = "proceed";
        public String onError = "proceed";
        public List<CheckSpec> checks = new ArrayList<>();
        public Set<String> usesDsCodes = new HashSet<>();   // 健康闸门：本场景全部使用 ds
    }

    /** check 快照 */
    public static class CheckSpec {
        public String checkName;
        public String runMode = "formal";
        public String strategy = "exact_key";        // exact_key / composite_key / sum_check / custom / custom_check
        public List<DsConsume> consumes = new ArrayList<>();   // 有序（第 1=left，第 2=right）
        public MatchEngine.MatchRuleConfig match;              // sum_check 为 null（无两两匹配）
        public List<CompareEngine.RuleConfig> compareRules = new ArrayList<>();
        public List<CompareEngine.SumRuleConfig> sumRules = new ArrayList<>();   // sum_check 勾稽规则
        public Map<String, String> unitByField = new HashMap<>();   // "alias.field" → yuan/point
        public boolean hasTimeWindow;
        public String customClass;                          // strategy=custom/custom_check 全限定类名
        public Map<String, Object> customParams = new HashMap<>();   // config_json 除 class 外键值（原样透传实现类）
    }

    /** 消费条目 */
    public static class DsConsume {
        public String alias;
        public String dsCode;
        public String mode;        // incremental / time_window
        public String timeField;
        public String start;       // time_window 窗口（绝对时间或相对表达式）
        public String end;
    }

    private final ScenarioRepository scenarioRepo;
    private final CheckRepository checkRepo;
    private final SnapshotParser parser;

    public ConfigSnapshot(ScenarioRepository scenarioRepo, CheckRepository checkRepo, SnapshotParser parser) {
        this.scenarioRepo = scenarioRepo;
        this.checkRepo = checkRepo;
        this.parser = parser;
    }

    public LoadedScenario load(String scenarioCode) {
        ReconScenario scenario = scenarioRepo.findByScenarioCode(scenarioCode)
                .orElseThrow(() -> new BizException(ErrorCode.SCENARIO_NOT_FOUND));

        LoadedScenario loaded = new LoadedScenario();
        loaded.scenarioCode = scenarioCode;
        if (scenario.getPoolMaxAgeDays() != null) {
            loaded.poolMaxAgeDays = scenario.getPoolMaxAgeDays();
        }
        if (scenario.getPendingMaxWaitHours() != null) {
            loaded.pendingMaxWaitHours = scenario.getPendingMaxWaitHours();
        }
        loaded.onDegraded = scenario.getOnDegraded() == null ? "proceed" : scenario.getOnDegraded();
        loaded.onEmpty = scenario.getOnEmpty() == null ? "proceed" : scenario.getOnEmpty();
        loaded.onError = scenario.getOnError() == null ? "proceed" : scenario.getOnError();

        for (ReconCheck check : checkRepo.findByScenarioCodeAndEnabled(scenarioCode, 1)) {
            CheckSpec spec = parser.buildCheck(check);
            if (spec == null) {
                continue;   // 配置不完整：跳过该 check（per-check 隔离精神），其余照常
            }
            loaded.checks.add(spec);
            spec.consumes.forEach(c -> loaded.usesDsCodes.add(c.dsCode));
        }
        return loaded;
    }
}
