# Step 3a: Add getUserDataSetScope to OrgWebClient
path = r"D:\code\mis-platform\backend\mis-admin-bff\src\main\java\com\mis\adminbff\client\OrgWebClient.java"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Add import for UserDataSetScopeVO after existing model imports
marker = 'import com.mis.adminbff.client.model.OrgVO;'
idx = content.find(marker)
if idx >= 0:
    end_idx = content.index("\n", idx) + 1
    content = content[:end_idx] + 'import com.mis.adminbff.client.model.UserDataSetScopeVO;\n' + content[end_idx:]
    print("Import added")

# Add TypeRef at top of class type refs
old_void = '    private static final ParameterizedTypeReference<Result<Void>> VOID ='
new_types = '''    private static final ParameterizedTypeReference<Result<UserDataSetScopeVO>> DATA_SCOPE =
            new ParameterizedTypeReference<>() {};

    ''' + old_void
content = content.replace(old_void, new_types)
print("TypeRef added:", "OK" if "DATA_SCOPE" in content else "FAIL")

# Add method after employeeCreateBody at the end
old_end = '''    public static Map<String, Object> employeeCreateBody(
            Long tenantId, Long deptId, String employeeNo, String realName, String email, String phone) {
        Map<String, Object> body = new HashMap<>();
        body.put("tenantId", tenantId);
        body.put("deptId", deptId);
        body.put("employeeNo", employeeNo);
        body.put("realName", realName);
        body.put("email", email);
        body.put("phone", phone);
        return body;
    }'''

new_method = '''    /** Query user data scope view from mis-org (for IQD header injection). */
    public UserDataSetScopeVO getUserDataSetScope(Long userId) {
        return block(client().get()
                .uri("/internal/v1/orgs/users/{userId}/data-scope", userId)
                .retrieve()
                .bodyToMono(DATA_SCOPE));
    }
'''

if old_end in content:
    content = content.replace(old_end, old_end + "\n" + new_method)
    print("Method added")
else:
    print("WARNING: did not find old_end marker")

with open(path, "w", encoding="utf-8") as f:
    f.write(content)
print("Step 3a done")
