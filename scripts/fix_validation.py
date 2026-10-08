path = r"D:\code\mis-platform\backend\mis-iam\src\main\java\com\mis\iam\service\RolePermissionService.java"
with open(path, "r", encoding="utf-8") as f:
    lines = f.readlines()

out = []
i = 0
while i < len(lines):
    line = lines[i]
    
    # Fix: add storeIds declaration after deptIds
    if "List<Long> deptIds = request.deptIds()" in line:
        out.append(line)
        i += 1
        # Insert storeIds after this line
        indent = "        "
        out.append(indent + 'List<Long> storeIds = request.storeIds() != null ? request.storeIds() : List.of();\n')
        continue
    
    # Fix: replace validation check to include storeIds and update message
    if 'if (scope == 5 && CollectionUtils.isEmpty(orgIds) && CollectionUtils.isEmpty(deptIds)) {' in line:
        indent = "        "
        out.append(indent + 'if (scope == 5 && CollectionUtils.isEmpty(orgIds) && CollectionUtils.isEmpty(deptIds) && CollectionUtils.isEmpty(storeIds)) {\n')
        i += 1
        # Replace the error message
        if '"自定义数据范围需至少指定组织或部门"' in lines[i]:
            out.append(lines[i].replace("自定义数据范围需至少指定组织或部门", "自定义数据范围需至少指定组织、部门或门店"))
        else:
            out.append(lines[i])
        i += 1
        continue
    
    out.append(line)
    i += 1

with open(path, "w", encoding="utf-8") as f:
    f.writelines(out)

print("Fixed: added storeIds declaration and updated validation")
