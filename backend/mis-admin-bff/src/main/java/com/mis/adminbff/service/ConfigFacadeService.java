package com.mis.adminbff.service;

import com.mis.adminbff.client.SystemWebClient;
import com.mis.adminbff.client.model.ConfigVO;
import com.mis.adminbff.dto.ConfigCreateRequest;
import com.mis.adminbff.dto.ConfigUpdateRequest;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 系统参数透传（对齐 DictFacadeService 模式 → SystemWebClient → mis-system）。
 */
@Service
public class ConfigFacadeService {

    private final SystemWebClient systemWebClient;

    public ConfigFacadeService(SystemWebClient systemWebClient) {
        this.systemWebClient = systemWebClient;
    }

    public List<ConfigVO> listConfigs() {
        return systemWebClient.listConfigs();
    }

    public ConfigVO getConfig(Long id) {
        return systemWebClient.getConfig(id);
    }

    public ConfigVO getConfigByKey(String key) {
        return systemWebClient.getConfigByKey(key);
    }

    public ConfigVO createConfig(ConfigCreateRequest request) {
        Map<String, Object> body = new HashMap<>();
        body.put("configKey", request.configKey());
        body.put("configValue", request.configValue());
        body.put("remark", request.remark());
        return systemWebClient.createConfig(body);
    }

    public ConfigVO updateConfig(Long id, ConfigUpdateRequest request) {
        Map<String, Object> body = new HashMap<>();
        body.put("configValue", request.configValue());
        body.put("remark", request.remark());
        return systemWebClient.updateConfig(id, body);
    }

    public void deleteConfig(Long id) {
        systemWebClient.deleteConfig(id);
    }
}
