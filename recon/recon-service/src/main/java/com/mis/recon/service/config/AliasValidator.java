package com.mis.recon.service.config;

import com.fasterxml.jackson.databind.JsonNode;
import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;
import com.mis.recon.domain.config.ReconCheck;
import org.springframework.util.StringUtils;

import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/**
 * 5003 alias 唯一性校验（ConfigValidationService 子功能拆分，满足单文件 300 行门禁）。
 * 规则：alias 场景内唯一、同 ds_code 复用 alias；范围含本 check 之外的其他 check 与本次提交行。
 */
final class AliasValidator {

    private AliasValidator() {
    }

    /** 校验失败抛 5003（ALIAS_CONFLICT）。 */
    static void validate(List<ReconCheck> existingChecks, Map<String, String> aliasDs) {
        Map<String, String> dsAlias = new HashMap<>();
        Map<String, String> alias2ds = new HashMap<>();
        if (existingChecks != null) {
            for (ReconCheck c : existingChecks) {
                if (!StringUtils.hasText(c.getConsumeJson())) {
                    continue;
                }
                JsonNode n = JsonSupport.parse(c.getConsumeJson());
                if (n == null || !n.isObject()) {
                    continue;
                }
                Iterator<Map.Entry<String, JsonNode>> it = n.fields();
                while (it.hasNext()) {
                    Map.Entry<String, JsonNode> e = it.next();
                    JsonNode row = e.getValue();
                    if (row == null || !row.isObject() || !row.hasNonNull("ds_code")) {
                        continue;
                    }
                    register(dsAlias, alias2ds, e.getKey(), row.get("ds_code").asText());
                }
            }
        }
        for (Map.Entry<String, String> e : aliasDs.entrySet()) {
            register(dsAlias, alias2ds, e.getKey(), e.getValue());
        }
    }

    private static void register(Map<String, String> dsAlias, Map<String, String> alias2ds, String alias, String ds) {
        if (dsAlias.containsKey(ds) && !dsAlias.get(ds).equals(alias)) {
            throw new BizException(ErrorCode.ALIAS_CONFLICT,
                    "数据源别名场景内冲突: ds_code=" + ds + "，已有 alias=" + dsAlias.get(ds) + "，本次 alias=" + alias);
        }
        if (alias2ds.containsKey(alias) && !alias2ds.get(alias).equals(ds)) {
            throw new BizException(ErrorCode.ALIAS_CONFLICT,
                    "数据源别名场景内冲突: alias=" + alias + "，已有 ds_code=" + alias2ds.get(alias) + "，本次 ds_code=" + ds);
        }
        dsAlias.put(ds, alias);
        alias2ds.put(alias, ds);
    }
}
