# Step 2: Add resolveEmployeeId to UserService
userService_path = r'D:\\code\\mis-platform\\backend\\mis-iam\\src\\main\\java\\com\\mis\\iam\\service\\UserService.java'
with open(userService_path, 'r', encoding='utf-8') as f:
    content = f.read()

method_to_add = '''
    /** Retrieve the bound employeeId for a user (for mis-org DataSetScopeService). */
    @Transactional(readOnly = true)
    public Long resolveEmployeeId(Long userId) {
        SysUser user = requireUser(userId);
        return user.getEmployeeId();
    }
'''

idx = content.rfind('    private SysUser requireUser(')
if idx != -1:
    content = content[:idx] + method_to_add + chr(10) + content[idx:]
    with open(userService_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('UserService: added resolveEmployeeId')
else:
    print('WARNING: could not find requireUser')

print('=' * 60)
print('Step 2a: done')
