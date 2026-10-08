path = r'D:\code\mis-platform\backend\mis-org\src\main\java\com\mis\org\client\IamDataScopeClient.java'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Add customStoreIds to the DataScopePayload record
old_record = """    public record DataScopePayload(
            int dataScope,
            List<Long> customOrgIds,
            List<Long> customDeptIds
    ) {
        public DataScopePayload {
            customOrgIds = customOrgIds != null ? customOrgIds : List.of();
            customDeptIds = customDeptIds != null ? customDeptIds : List.of();
        }
    }"""

new_record = """    public record DataScopePayload(
            int dataScope,
            List<Long> customOrgIds,
            List<Long> customDeptIds,
            List<Long> customStoreIds
    ) {
        public DataScopePayload {
            customOrgIds = customOrgIds != null ? customOrgIds : List.of();
            customDeptIds = customDeptIds != null ? customDeptIds : List.of();
            customStoreIds = customStoreIds != null ? customStoreIds : List.of();
        }
    }"""

content = content.replace(old_record, new_record)
print("IamDataScopeClient: DataScopePayload patched" if old_record not in content else "WARNING: not found")

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Step 2a: IamDataScopeClient done")
