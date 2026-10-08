# Step 2e: Add findByEmployeeIdOrderByEffectiveStartAsc to SysEmployeePostRepository
repo_path = r'D:\\code\\mis-platform\\backend\\mis-org\\src\\main\\java\\com\\mis\\org\\domain\\repository\\SysEmployeePostRepository.java'
with open(repo_path, 'r', encoding='utf-8') as f:
    content = f.read()

new_method = '''
    /** order by effective_start asc */
    List<SysEmployeePost> findByEmployeeIdOrderByEffectiveStartAsc(Long employeeId);
'''

idx = content.rfind('}')
if idx != -1:
    while idx > 0 and content[idx-1] in (' ', '\\t'):
        idx -= 1
    content = content[:idx] + chr(10) + new_method + content[idx:]
    with open(repo_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('Repo: added method')
else:
    print('WARNING')
