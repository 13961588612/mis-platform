package com.mis.aireport.domain.param;

import com.mis.aireport.client.IamUserClient;
import com.mis.aireport.domain.entity.AiParamSource;
import com.mis.aireport.domain.entity.AiReportStoreDim;
import com.mis.aireport.domain.repository.AiReportStoreDimRepository;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 按当前用户 IAM 门店范围 ∩ {@code ai_report_store_dim} 取可选门店。
 *
 * <p>dataScope=1（全部）→ 全量启用门店；CUSTOM(5) → customStoreIds；其余无门店扩展则空。
 */
@Component("AuthStoreSourceHandler")
public class AuthStoreSourceHandler implements ParamSourceHandler {

    private final IamUserClient iamUserClient;
    private final AiReportStoreDimRepository storeDimRepository;

    public AuthStoreSourceHandler(
            IamUserClient iamUserClient, AiReportStoreDimRepository storeDimRepository) {
        this.iamUserClient = iamUserClient;
        this.storeDimRepository = storeDimRepository;
    }

    @Override
    public String beanName() {
        return "AuthStoreSourceHandler";
    }

    @Override
    public ParamResolveResult resolve(Long userId, AiParamSource source) {
        List<AiReportStoreDim> stores = visibleStores(userId);
        List<ParamOption> options = stores.stream()
                .map(s -> {
                    Map<String, Object> extra = new HashMap<>();
                    extra.put("storeId", s.getId());
                    extra.put("storeCode", s.getStoreCode());
                    extra.put("storeName", s.getStoreName());
                    return new ParamOption(s.getStoreCode(), s.getStoreName(), extra);
                })
                .toList();
        String defaultValue = options.isEmpty() ? null : options.get(0).value();
        return new ParamResolveResult(
                source.getSourceCode(),
                source.getValueType(),
                source.getWireKey(),
                source.getName(),
                options,
                defaultValue);
    }

    @Override
    public boolean accepts(Long userId, AiParamSource source, String value) {
        if (!StringUtils.hasText(value)) {
            return false;
        }
        return visibleStores(userId).stream().anyMatch(s -> value.equals(s.getStoreCode()));
    }

    private List<AiReportStoreDim> visibleStores(Long userId) {
        IamUserClient.DataScopeDto scope = iamUserClient.fetchDataScope(userId);
        if (scope.dataScope() == 1) {
            return storeDimRepository.findByEnabledOrderByStoreCodeAsc(1);
        }
        List<Long> ids = scope.customStoreIds();
        if (ids == null || ids.isEmpty()) {
            return List.of();
        }
        return storeDimRepository.findByIdInAndEnabledOrderByStoreCodeAsc(ids, 1);
    }
}
