# Step 3c Complete: Modify AiPlatformClient.java

path = r"D:\code\mis-platform\backend\mis-admin-bff\src\main\java\com\mis\adminbff\client\AiPlatformClient.java"
with open(path, "r", encoding="utf-8") as f:
    lines = f.readlines()

result = []
i = 0
while i < len(lines):
    line = lines[i]
    
    # 1) Add imports: insert JsonProcessingException after ObjectMapper import
    if "import com.fasterxml.jackson.databind.ObjectMapper;" in line and "JsonProcessingException" not in "".join(lines[:i+5]):
        result.append(line)
        result.append("import com.fasterxml.jackson.core.JsonProcessingException;\n")
        result.append("import com.mis.adminbff.client.model.UserDataSetScopeVO;\n")
        i += 1
        continue
    
    # 2) Add header constants after HEADER_MIS_ROLES
    if 'private static final String HEADER_MIS_ROLES = "X-Mis-Roles";' in line:
        result.append(line)
        result.append('\n')
        result.append('    private static final String HEADER_MIS_DEPT_SCOPE = "X-Mis-Dept-Scope";\n')
        result.append('    private static final String HEADER_MIS_STORES = "X-Mis-Stores";\n')
        result.append('    private static final String HEADER_MIS_DATA_SCOPE = "X-Mis-Data-Scope";\n')
        i += 1
        continue
    
    # 3) Add fields after iamCache field
    if '    private final Map<Long, IamCacheEntry> iamCache = new ConcurrentHashMap<>();' in line:
        result.append(line)
        result.append('    private final OrgWebClient orgWebClient;\n')
        result.append('    private final Map<Long, OrgCacheEntry> orgCache = new ConcurrentHashMap<>();\n')
        i += 1
        continue
    
    # 4) Fix constructor - split iamWebClient param across two lines and add orgWebClient
    if '            IamWebClient iamWebClient) {' in line:
        result.append('            IamWebClient iamWebClient,\n')
        result.append('            OrgWebClient orgWebClient) {\n')
        i += 1
        continue
    
    # 5) Add orgWebClient assignment after iamWebClient assignment in constructor
    if '        this.iamWebClient = iamWebClient;' in line and i < 100:
        result.append(line)
        result.append('        this.orgWebClient = orgWebClient;\n')
        i += 1
        continue
    
    # 6) Replace buildMisEnrichmentHeaders method entirely
    if '    /**\n     * 从安全上下文取 LoginUser -> 调 MIS IAM' in line or \
       ('从安全上下文取 LoginUser' in line and i > 0 and '/**' in ''.join(lines[max(0,i-2):i])):
        # Check if this is the buildMisEnrichmentHeaders Javadoc
        javadoc_start = i
        # Look back for /**
        while i > 0 and '/**' not in lines[i-1]:
            i -= 1
            javadoc_start = i
            break
        
        # Write the entire new method
        result.extend([
            '    /**\n',
            '     * 从安全上下文取 LoginUser -> 调 MIS IAM 取 roles + deptId -> 组装 X-Mis-Depts / X-Mis-Orgs / X-Mis-Roles。\n',
            '     *\n',
            '     * <p>取值约定（docs/identity-enrichment-task-list.md §4）：\n',
            '     * <ul>\n',
            '     *   <li>X-Mis-Depts：[{@code {"id": deptId}}]（本阶段单部门，见 R1）</li>\n',
            '     *   <li>X-Mis-Orgs：[{@code {"id": tenantId}}]（主租户，见决策#3）</li>\n',
            '     *   <li>X-Mis-Roles：[{@code {"id": roleId, "code": roleCode}}]（以 code 为主键）</li>\n',
            '     * </ul>\n',
            '     *\n',
            '     * <p>IAM 调用异常 / 空结果时<b>降级</b>（不加头），不阻断主流程；平台将退化为阶段1/2 行为。\n',
            '     */\n',
            '    private Consumer<HttpHeaders> buildMisEnrichmentHeaders() {\n',
            '        return headers -> {\n',
            '            try {\n',
            '                LoginUser user = SecurityContextHolder.getOptional().orElse(null);\n',
            '                if (user == null || user.getUserId() == null) {\n',
            '                    return;\n',
            '                }\n',
            '\n',
            '                IamUserVO iamUser = lookupIamUser(user.getUserId());\n',
            '                if (iamUser == null) {\n',
            '                    return;\n',
            '                }\n',
            '\n',
            '                // X-Mis-Depts：本阶段单部门（R1）\n',
            '                List<Map<String, String>> depts = new ArrayList<>();\n',
            '                if (iamUser.deptId() != null && !iamUser.deptId().isBlank()) {\n',
            '                    depts.add(Map.of("id", iamUser.deptId()));\n',
            '                }\n',
            '\n',
            '                // X-Mis-Orgs：主租户（决策#3，单 tenant + 多 dept）\n',
            '                List<Map<String, String>> orgs = new ArrayList<>();\n',
            '                if (user.getTenantId() != null) {\n',
            '                    orgs.add(Map.of("id", String.valueOf(user.getTenantId())));\n',
            '                }\n',
            '\n',
            '                // X-Mis-Roles：以 code 为主键（与 JWT roles / 平台 PermissionEngine 命名空间一致）\n',
            '                List<Map<String, String>> roles = new ArrayList<>();\n',
            '                if (iamUser.roles() != null) {\n',
            '                    for (IamRoleVO r : iamUser.roles()) {\n',
            '                        if (r == null) {\n',
            '                            continue;\n',
            '                        }\n',
            '                        String code = r.code();\n',
            '                        if (code == null) {\n',
            '                            code = r.id();\n',
            '                        }\n',
            '                        if (code != null && !code.isBlank()) {\n',
            '                            String id = r.id() != null ? r.id() : code;\n',
            '                            roles.add(Map.of("id", id, "code", code));\n',
            '                        }\n',
            '                    }\n',
            '                }\n',
            '\n',
            '                if (!depts.isEmpty()) {\n',
            '                    headers.set(HEADER_MIS_DEPTS, objectMapper.writeValueAsString(depts));\n',
            '                }\n',
            '                if (!orgs.isEmpty()) {\n',
            '                    headers.set(HEADER_MIS_ORGS, objectMapper.writeValueAsString(orgs));\n',
            '                }\n',
            '                if (!roles.isEmpty()) {\n',
            '                    headers.set(HEADER_MIS_ROLES, objectMapper.writeValueAsString(roles));\n',
            '                }\n',
            '\n',
            '            // --- IQD 行级数据范围头注入 ---\n',
            '            try {\n',
            '                LoginUser iqdcUser = SecurityContextHolder.getOptional().orElse(null);\n',
            '                if (iqdcUser != null && iqdcUser.getUserId() != null) {\n',
            '                    injectDataRowScopeHeaders(headers, iqdcUser.getUserId());\n',
            '                }\n',
            '            } catch (Exception ignored) {\n',
            '                // mis-org 不可达 / 解析失败 -> 不加范围头，Worker 侧 fail-closed\n',
            '            }\n',
            '        };\n',
            '    }\n',
            '\n',
            '    /**\n',
            '     * 从 mis-org 查询用户数据范围并注入问数 Worker 范围控制头。\n',
            '     */\n',
            '    private void injectDataRowScopeHeaders(HttpHeaders headers, Long userId) {\n',
            '        UserDataSetScopeVO scope = lookupOrgDataScope(userId);\n',
            '        if (scope == null) return;\n',
            '\n',
            '        // ALL 显式放行\n',
            '        if (Boolean.TRUE.equals(scope.all())) {\n',
            '            headers.set(HEADER_MIS_DATA_SCOPE, "all");\n',
            '            return;\n',
            '        }\n',
            '\n',
            '        // deptAnchors -> PATH_PREFIX range header\n',
            '        List<UserDataSetScopeVO.DeptAnchor> anchors = scope.deptAnchors();\n',
            '        if (anchors != null && !anchors.isEmpty()) {\n',
            '            List<Map<String, Object>> anchorJsonList = new ArrayList<>();\n',
            '            for (UserDataSetScopeVO.DeptAnchor a : anchors) {\n',
            '                Map<String, Object> m = new LinkedHashMap<>();\n',
            '                m.put("id", String.valueOf(a.id()));\n',
            '                if (a.path() != null && !a.path().isEmpty()) m.put("path", a.path());\n',
            '                if (a.scope() != null && !a.scope().isEmpty()) m.put("scope", a.scope());\n',
            '                anchorJsonList.add(m);\n',
            '            }\n',
            '            try {\n',
            '                headers.set(HEADER_MIS_DEPT_SCOPE, objectMapper.writeValueAsString(anchorJsonList));\n',
            '            } catch (JsonProcessingException e) {\n',
            '                // ignore serialization error\n',
            '            }\n',
            '        }\n',
            '\n',
            '        // storeIds -> ENUM range header\n',
            '        List<Long> storeIds = scope.storeIds();\n',
            '        if (storeIds != null && !storeIds.isEmpty()) {\n',
            '            List<String> storeCodes = new ArrayList<>(storeIds.size());\n',
            '            for (Long sid : storeIds) storeCodes.add(String.valueOf(sid));\n',
            '            try {\n',
            '                headers.set(HEADER_MIS_STORES, objectMapper.writeValueAsString(storeCodes));\n',
            '            } catch (JsonProcessingException e) {\n',
            '                // ignore serialization error\n',
            '            }\n',
            '        }\n',
            '    }\n',
            '\n',
            '    /** Cache lookup for mis-org data scope view (~60s TTL). Returns null on failure. */\n',
            '    private UserDataSetScopeVO lookupOrgDataScope(Long userId) {\n',
            '        OrgCacheEntry entry = orgCache.get(userId);\n',
            '        if (entry != null && entry.isAlive()) return entry.scope();\n',
            '        try {\n',
            '            UserDataSetScopeVO scope = orgWebClient.getUserDataSetScope(userId);\n',
            '            if (scope != null) {\n',
            '                orgCache.put(userId, new OrgCacheEntry(scope, System.currentTimeMillis() + IAM_CACHE_TTL_MS));\n',
            '            }\n',
            '            return scope;\n',
            '        } catch (Exception e) {\n',
            '            return null;\n',
            '        }\n',
            '    }\n',
            '\n',
            '    private record OrgCacheEntry(UserDataSetScopeVO scope, long expireAt) {\n',
            '        boolean isAlive() { return System.currentTimeMillis() < expireAt; }\n',
            '    }\n',
            '\n',
        ])
        
        # Skip until we find the next non-Javadoc, non-method part
        # Find the closing brace of buildMisEnrichmentHeaders by counting braces
        brace_count = 0
        found_open = False
        search_from = max(javadoc_start + 1, i + 1)
        j = search_from
        while j < len(lines):
            for ch in lines[j]:
                if ch == '{':
                    brace_count += 1
                    found_open = True
                elif ch == '}':
                    brace_count -= 1
            
            if found_open and brace_count == 0:
                # Found end of method
                i = j + 1
                break
            j += 1
        else:
            # Method extends past what we expected; skip to the "取 MIS IAM" marker
            for k in range(search_from, len(lines)):
                if '取 MIS IAM' in lines[k]:
                    i = k
                    break
            else:
                i = len(lines)
        continue
    
    # 7) Remove the now-redundant "取 MIS IAM" javadoc + lookupIamUser method block
    # Instead, keep it - it's still needed
    result.append(line)
    i += 1

with open(path, "w", encoding="utf-8") as f:
    f.writelines(result)

print(f"AiPlatformClient rebuilt: {len(lines)} -> {len(result)} lines")
