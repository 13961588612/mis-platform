package com.mis.adminbff.service;

import com.mis.adminbff.client.SystemWebClient;
import com.mis.adminbff.dto.ApiVO;
import com.mis.adminbff.dto.ModuleApiBindingVO;
import com.mis.adminbff.dto.ModuleApiCreateRequest;
import com.mis.adminbff.dto.ModuleApiUpdateRequest;
import com.mis.adminbff.dto.ModuleCreateRequest;
import com.mis.adminbff.dto.ModuleUpdateRequest;
import com.mis.adminbff.dto.ModuleVO;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 接口模块管理（平台级，无租户归属）。透传 mis-system /internal/v1/modules 与 /internal/v1/apis。
 */
@Service
public class ModuleFacadeService {

    private final SystemWebClient systemWebClient;

    public ModuleFacadeService(SystemWebClient systemWebClient) {
        this.systemWebClient = systemWebClient;
    }

    public List<ModuleVO> list() {
        return systemWebClient.listModules();
    }

    public ModuleVO get(Long id) {
        return systemWebClient.getModule(id);
    }

    public ModuleVO create(ModuleCreateRequest request) {
        Map<String, Object> body = new HashMap<>();
        body.put("code", request.code());
        body.put("name", request.name());
        body.put("serviceName", request.serviceName());
        body.put("sort", request.sort());
        return systemWebClient.createModule(body);
    }

    public ModuleVO update(Long id, ModuleUpdateRequest request) {
        Map<String, Object> body = new HashMap<>();
        body.put("name", request.name());
        body.put("serviceName", request.serviceName());
        body.put("sort", request.sort());
        body.put("status", request.status());
        return systemWebClient.updateModule(id, body);
    }

    public void delete(Long id) {
        systemWebClient.deleteModule(id);
    }

    public List<ApiVO> apiTree(Long moduleId) {
        return systemWebClient.moduleApiTree(moduleId);
    }

    public List<ModuleApiBindingVO> bindings(Long moduleId) {
        return systemWebClient.moduleBindings(moduleId);
    }

    public ApiVO createApi(ModuleApiCreateRequest request) {
        Map<String, Object> body = new HashMap<>();
        body.put("moduleId", request.moduleId());
        body.put("parentId", request.parentId());
        body.put("code", request.code());
        body.put("type", request.type());
        body.put("name", request.name());
        body.put("httpMethod", request.httpMethod());
        body.put("pathPattern", request.pathPattern());
        body.put("sort", request.sort());
        body.put("status", request.status());
        return systemWebClient.createApi(body);
    }

    public ApiVO updateApi(Long id, ModuleApiUpdateRequest request) {
        Map<String, Object> body = new HashMap<>();
        body.put("parentId", request.parentId());
        body.put("code", request.code());
        body.put("type", request.type());
        body.put("name", request.name());
        body.put("httpMethod", request.httpMethod());
        body.put("pathPattern", request.pathPattern());
        body.put("sort", request.sort());
        body.put("status", request.status());
        return systemWebClient.updateApi(id, body);
    }

    public void deleteApi(Long id) {
        systemWebClient.deleteApi(id);
    }
}
