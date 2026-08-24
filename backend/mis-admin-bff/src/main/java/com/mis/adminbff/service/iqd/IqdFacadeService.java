package com.mis.adminbff.service.iqd;

import com.mis.adminbff.client.IqdClient;
import com.mis.adminbff.config.IqdProperties;
import com.mis.adminbff.dto.iqd.IqdAclSaveRequest;
import com.mis.adminbff.dto.iqd.IqdAclVO;
import com.mis.adminbff.dto.iqd.IqdAskLogVO;
import com.mis.adminbff.dto.iqd.IqdCatalogItemSaveRequest;
import com.mis.adminbff.dto.iqd.IqdCatalogItemVO;
import com.mis.adminbff.dto.iqd.IqdConnectionConfigVO;
import com.mis.adminbff.dto.iqd.IqdConnectionSaveRequest;
import com.mis.adminbff.dto.iqd.IqdConnectionTestVO;
import com.mis.adminbff.dto.iqd.IqdKnowledgeSaveRequest;
import com.mis.adminbff.dto.iqd.IqdKnowledgeVO;
import com.mis.adminbff.dto.iqd.IqdMaskRuleSaveRequest;
import com.mis.adminbff.dto.iqd.IqdMaskRuleVO;
import com.mis.adminbff.dto.iqd.IqdScopeDimensionVO;
import com.mis.adminbff.dto.iqd.IqdScopePolicySaveRequest;
import com.mis.adminbff.dto.iqd.IqdScopePolicyVO;
import com.mis.adminbff.dto.iqd.IqdSqlPairSaveRequest;
import com.mis.adminbff.dto.iqd.IqdSqlPairVO;
import com.mis.adminbff.security.UserPermissionLoader;
import com.mis.adminbff.support.RequestContext;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.security.context.LoginUser;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 问数管理面门面（BFF 代理 mis-iqd 连接配置 + W2 清单/范围/ACL/脱敏/维度 CRUD）。
 *
 * <p>权限双闸门：
 * <ol>
 *   <li>主路径：{@code ApiPermissionInterceptor} + sys_api 注册表（V72/V73 绑定权限码）</li>
 *   <li>兜底：注册表未生效空窗期读 {@link UserPermissionLoader#load}（与 KB 同款口径）</li>
 * </ol>
 */
@Service
public class IqdFacadeService {

    private final IqdClient iqdClient;
    private final IqdProperties properties;
    private final UserPermissionLoader userPermissionLoader;

    public IqdFacadeService(
            IqdClient iqdClient,
            IqdProperties properties,
            UserPermissionLoader userPermissionLoader) {
        this.iqdClient = iqdClient;
        this.properties = properties;
        this.userPermissionLoader = userPermissionLoader;
    }

    // ================================================================ 连接配置

    /**
     * 取连接配置（需 iqd:config:view）。
     */
    public IqdConnectionConfigVO getConfig() {
        requirePermission(properties.getConfigViewPermission());
        return iqdClient.getConfig();
    }

    /**
     * 保存连接配置（需 iqd:config:save）。
     */
    public IqdConnectionConfigVO saveConfig(IqdConnectionSaveRequest dto) {
        requirePermission(properties.getConfigSavePermission());
        return iqdClient.saveConfig(dto);
    }

    /**
     * 连通性自检（需 iqd:config:test）。
     */
    public IqdConnectionTestVO testConfig() {
        requirePermission(properties.getConfigTestPermission());
        return iqdClient.testConfig();
    }

    // ================================================================ W2 管理面

    /**
     * 查询清单（需 iqd:catalog:view）。
     */
    public List<IqdCatalogItemVO> listCatalog(Long connectionId) {
        requirePermission(properties.getCatalogPermission());
        return iqdClient.listCatalog(connectionId);
    }

    /**
     * 批量 upsert 清单（需 iqd:catalog:view）。
     */
    public Map<String, Object> saveCatalogBatch(Long connectionId, List<IqdCatalogItemSaveRequest> items) {
        requirePermission(properties.getCatalogPermission());
        return iqdClient.saveCatalogBatch(connectionId, items);
    }

    /**
     * 勾选纳入问数范围（需 iqd:scope:save）。
     */
    public Map<String, Object> setCatalogInScope(Long connectionId, boolean inScope, List<String> itemKeys) {
        requirePermission(properties.getScopeSavePermission());
        return iqdClient.setCatalogInScope(connectionId, inScope, itemKeys);
    }

    /**
     * 查询范围策略（需 iqd:scope:view）。
     */
    public List<IqdScopePolicyVO> listScopePolicies(Long connectionId) {
        requirePermission(properties.getScopeViewPermission());
        return iqdClient.listScopePolicies(connectionId);
    }

    /**
     * 批量保存范围策略（需 iqd:scope:save）。
     */
    public Map<String, Object> saveScopePolicies(Long connectionId, List<IqdScopePolicySaveRequest> items) {
        requirePermission(properties.getScopeSavePermission());
        return iqdClient.saveScopePolicies(connectionId, items);
    }

    /**
     * 查询表级 ACL（需 iqd:acl:view）。
     */
    public List<IqdAclVO> listAcls(Long connectionId) {
        requirePermission(properties.getAclViewPermission());
        return iqdClient.listAcls(connectionId);
    }

    /**
     * 批量保存表级 ACL（需 iqd:acl:save）。
     */
    public Map<String, Object> saveAcls(Long connectionId, List<IqdAclSaveRequest> items) {
        requirePermission(properties.getAclSavePermission());
        return iqdClient.saveAcls(connectionId, items);
    }

    /**
     * 删除单条 ACL（需 iqd:acl:save）。
     */
    public void deleteAcl(Long id) {
        requirePermission(properties.getAclSavePermission());
        iqdClient.deleteAcl(id);
    }

    /**
     * 查询脱敏规则（需 iqd:mask:view）。
     */
    public List<IqdMaskRuleVO> listMaskRules() {
        requirePermission(properties.getMaskViewPermission());
        return iqdClient.listMaskRules();
    }

    /**
     * 保存脱敏规则（需 iqd:mask:save）。
     */
    public IqdMaskRuleVO saveMaskRule(IqdMaskRuleSaveRequest dto) {
        requirePermission(properties.getMaskSavePermission());
        return iqdClient.saveMaskRule(dto);
    }

    /**
     * 删除脱敏规则（需 iqd:mask:save）。
     */
    public void deleteMaskRule(Long id) {
        requirePermission(properties.getMaskSavePermission());
        iqdClient.deleteMaskRule(id);
    }

    /**
     * 查询维度注册表（需 iqd:dimension:view）。
     */
    public List<IqdScopeDimensionVO> listDimensions() {
        requirePermission(properties.getDimensionViewPermission());
        return iqdClient.listDimensions();
    }

    /**
     * 保存维度注册表条目（需 iqd:dimension:save）。
     */
    public IqdScopeDimensionVO saveDimension(Map<String, Object> dto) {
        requirePermission(properties.getDimensionSavePermission());
        return iqdClient.saveDimension(dto);
    }

    /**
     * 删除维度注册表条目（需 iqd:dimension:save）。
     */
    public void deleteDimension(Long id) {
        requirePermission(properties.getDimensionSavePermission());
        iqdClient.deleteDimension(id);
    }

    /**
     * 触发单维度字典同步（需 iqd:scope:sync）。
     */
    public Map<String, Object> syncDimension(String dimensionCode) {
        requirePermission(properties.getSyncPermission());
        return iqdClient.syncDimension(dimensionCode);
    }

    /**
     * 拉取字典同步状态（需 iqd:scope:view）。
     */
    public List<Map<String, Object>> listDictSyncStatus() {
        requirePermission(properties.getScopeViewPermission());
        return iqdClient.listDictSyncStatus();
    }

    // ================================================================ W3 审计回查

    /**
     * 分页回查问数审计日志（需 iqd:trace:view）。
     */
    public List<IqdAskLogVO> listTraces(Integer limit, String status, Long userId) {
        requirePermission(properties.getTraceViewPermission());
        return iqdClient.listTraces(limit, status, userId);
    }

    /**
     * 取单条审计日志详情（需 iqd:trace:view）。
     */
    public IqdAskLogVO getTrace(Long id) {
        requirePermission(properties.getTraceViewPermission());
        return iqdClient.getTrace(id);
    }

    // ================================================================ W4 增强物料

    /**
     * 查询连接下样本对（需 iqd:enhance:view）。
     */
    public List<IqdSqlPairVO> listSqlPairs(Long connectionId) {
        requirePermission(properties.getEnhanceViewPermission());
        return iqdClient.listSqlPairs(connectionId);
    }

    /**
     * 保存样本对（需 iqd:enhance:save）。
     */
    public IqdSqlPairVO saveSqlPair(IqdSqlPairSaveRequest dto) {
        requirePermission(properties.getEnhanceSavePermission());
        return iqdClient.saveSqlPair(dto);
    }

    /**
     * 删除样本对（需 iqd:enhance:save）。
     */
    public void deleteSqlPair(Long id) {
        requirePermission(properties.getEnhanceSavePermission());
        iqdClient.deleteSqlPair(id);
    }

    /**
     * 查询连接下知识/术语/口径（需 iqd:enhance:view）。
     */
    public List<IqdKnowledgeVO> listKnowledge(Long connectionId, String kind) {
        requirePermission(properties.getEnhanceViewPermission());
        return iqdClient.listKnowledge(connectionId, kind);
    }

    /**
     * 保存知识/术语/口径（需 iqd:enhance:save）。
     */
    public IqdKnowledgeVO saveKnowledge(IqdKnowledgeSaveRequest dto) {
        requirePermission(properties.getEnhanceSavePermission());
        return iqdClient.saveKnowledge(dto);
    }

    /**
     * 删除知识/术语/口径（需 iqd:enhance:save）。
     */
    public void deleteKnowledge(Long id) {
        requirePermission(properties.getEnhanceSavePermission());
        iqdClient.deleteKnowledge(id);
    }

    /**
     * 从 S-07 单向拉入知识（需 iqd:enhance:save）。
     */
    public Map<String, Object> importS07Knowledge(Long connectionId) {
        requirePermission(properties.getEnhanceSavePermission());
        return iqdClient.importS07Knowledge(connectionId);
    }

    /**
     * 取待推送增强物料（需 iqd:enhance:sync）。
     */
    public Map<String, Object> pushEnhancements(Long connectionId) {
        requirePermission(properties.getEnhanceSyncPermission());
        return iqdClient.pushEnhancements(connectionId);
    }

    /** 兜底判权：注册表未生效空窗期（与 KB {@code requirePermission} 同款口径）。 */
    private void requirePermission(String permissionCode) {
        LoginUser user = RequestContext.requireLoginUser();
        if (user.getUserId() == null) {
            throw new BusinessException(ResultCode.UNAUTHORIZED);
        }
        Set<String> permissions = userPermissionLoader.load(user);
        if (permissions == null || !permissions.contains(permissionCode)) {
            throw new BusinessException(ResultCode.FORBIDDEN);
        }
    }
}
