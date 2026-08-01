package com.mis.org.service;

import com.mis.org.domain.entity.SysOrg;
import com.mis.org.domain.repository.OrgMcpRepository;
import com.mis.org.dto.OrgCandidate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * MCP 工具服务层：将 MCP JSON-RPC 调用路由到组织查询逻辑。
 */
@Service
public class OrgMcpService {

    private final OrgMcpRepository orgMcpRepository;

    public OrgMcpService(OrgMcpRepository orgMcpRepository) {
        this.orgMcpRepository = orgMcpRepository;
    }

    /**
     * 根据组织名称模糊搜索候选组织，限定用户可见范围。
     *
     * @param name     组织名称关键词
     * @param userId   当前用户 ID
     * @param tenantId 当前租户 ID
     * @return 候选组织列表（最多 5 条，按名称长度升序）
     */
    @Transactional(readOnly = true)
    public List<OrgCandidate> queryOrgByName(String name, Long userId, Long tenantId) {
        if (name == null || name.isBlank()) {
            return Collections.emptyList();
        }

        List<SysOrg> orgs = orgMcpRepository.findByNameLikeWithUserScope(name, userId, tenantId);
        List<OrgCandidate> result = new ArrayList<>(orgs.size());
        for (SysOrg org : orgs) {
            OrgCandidate candidate = new OrgCandidate();
            candidate.setId(org.getId());
            candidate.setName(org.getName());
            candidate.setAliases(Collections.emptyList());
            candidate.setContext("code=" + org.getCode());
            result.add(candidate);
        }
        return result;
    }
}
