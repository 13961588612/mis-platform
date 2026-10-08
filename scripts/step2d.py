# Step 2d: Add findDescendantIdsById to SysDeptRepository
repo_path = r'D:\\code\\mis-platform\\backend\\mis-org\\src\\main\\java\\com\\mis\\org\\domain\\repository\\SysDeptRepository.java'
with open(repo_path, 'r', encoding='utf-8') as f:
    content = f.read()

new_method = '''
    /** Convenience: find descendant IDs for a department (by ID only, org from internal query). */
    @Query(\"\"\"
            SELECT d.id FROM SysDept d
            WHERE CONCAT(',', d.ancestors, ',') LIKE CONCAT('%,', CAST(:deptId AS STRING), ',%')
            \"\"\")
    List<Long> findDescendantIdsById(@Param(\"deptId\") Long deptId);
'''

# Insert before the closing brace of the interface
idx = content.rfind('}')
if idx != -1:
    # Find newline before }
    while idx > 0 and content[idx-1] in (' ', '\\t'):
        idx -= 1
    content = content[:idx] + chr(10) + new_method + content[idx:]
    with open(repo_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('SysDeptRepository: added findDescendantIdsById')
else:
    print('WARNING: could not find } in SysDeptRepository')
