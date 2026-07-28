package com.mis.adminbff.service;

import com.mis.adminbff.client.SystemWebClient;
import com.mis.adminbff.support.RequestContext;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class DictFacadeService {

    private final SystemWebClient systemWebClient;

    public DictFacadeService(SystemWebClient systemWebClient) {
        this.systemWebClient = systemWebClient;
    }

    public List<Map<String, Object>> listTypes() {
        return systemWebClient.listDictTypes(RequestContext.requireTenantId());
    }

    public Map<String, Object> createType(String code, String name, String remark) {
        Map<String, Object> body = new HashMap<>();
        body.put("tenantId", RequestContext.requireTenantId());
        body.put("code", code);
        body.put("name", name);
        body.put("remark", remark);
        return systemWebClient.createDictType(body);
    }

    public Map<String, Object> updateType(Long id, String name, Integer status, String remark) {
        Map<String, Object> body = new HashMap<>();
        body.put("name", name);
        body.put("status", status);
        body.put("remark", remark);
        return systemWebClient.updateDictType(id, body);
    }

    public void deleteType(Long id) {
        systemWebClient.deleteDictType(id);
    }

    public List<Map<String, Object>> listItems(Long typeId) {
        return systemWebClient.listDictItems(typeId);
    }

    public Map<String, Object> createItem(Long typeId, String label, String value, Integer sort, String cssClass) {
        Map<String, Object> body = new HashMap<>();
        body.put("typeId", typeId);
        body.put("label", label);
        body.put("value", value);
        body.put("sort", sort);
        body.put("cssClass", cssClass);
        return systemWebClient.createDictItem(body);
    }

    public Map<String, Object> updateItem(
            Long id, String label, String value, Integer sort, Integer status, String cssClass) {
        Map<String, Object> body = new HashMap<>();
        body.put("label", label);
        body.put("value", value);
        body.put("sort", sort);
        body.put("status", status);
        body.put("cssClass", cssClass);
        return systemWebClient.updateDictItem(id, body);
    }

    public void deleteItem(Long id) {
        systemWebClient.deleteDictItem(id);
    }
}
