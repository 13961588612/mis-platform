path = r"D:\code\mis-platform\backend\mis-org\src\main\java\com\mis\org\controller\OrgController.java"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()
marker = "import com.mis.org.dto.OrgVO;"
idx = content.find(marker)
if idx >= 0:
    end_idx = content.index("\n", idx) + 1
    new_imports = marker + "\n" + "import com.mis.org.dto.UserDataSetScopeVO;\n" + "import com.mis.org.service.DataSetScopeService;\n"
    content = content[:end_idx] + new_imports + content[end_idx:]
    print("OK imports")
old_ctor = "    private final OrgService orgService;\n\n    public OrgController(OrgService orgService) {\n        this.orgService = orgService;\n    }"
new_ctor = "    private final OrgService orgService;\n    private final DataSetScopeService dataSetScopeService;\n\n    public OrgController(OrgService orgService, DataSetScopeService dataSetScopeService) {\n        this.orgService = orgService;\n        this.dataSetScopeService = dataSetScopeService;\n    }"
content = content.replace(old_ctor, new_ctor)
print("ctor:", "OK" if new_ctor in content else "FAIL")
old_delete = '@DeleteMapping("/{id}")\n    public Result<Void> delete(@PathVariable Long id) {'
new_ep = "/** Data scope view for IQD Worker. */\n    @GetMapping(\"/users/{userId}/data-scope\")\n    public Result<UserDataSetScopeVO> userDataScope(@PathVariable Long userId) {\n        return Result.ok(dataSetScopeService.getUserDataSetScope(userId));\n    }\n\n    "
content = content.replace(old_delete, new_ep + old_delete)
print("endpoint:", "OK" if "userDataScope" in content else "FAIL")
with open(path, "w", encoding="utf-8") as f:
    f.write(content)
