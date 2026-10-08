# ========== Fix Step 2: Complete implementation ==========

# 2a. Add employee-id endpoint to mis-iam UserController
 = r'D:\code\mis-platform\backend\mis-iam\src\main\java\com\mis\iam\controller\UserController.java'
with open(, 'r', encoding='utf-8') as f:
    content = f.read()

old_import_end = '''import com.mis.iam.support.RbacCacheSupport;'''
if old_import_end not in content:
    print('WARNING: could not find import end for adding EmployeeIdResult')
else:
    print('UserController already has imports')

# Add a simple query method to UserService and expose in UserController
# First add resolveEmployeeId to UserService
 = r'D:\code\mis-platform\backend\mis-iam\src\main\java\com\mis\iam\service\UserService.java'
with open(, 'r', encoding='utf-8') as f:
    userSvcContent = f.read()

# Add resolveEmployeeId method before requireUser
method_to_add = '''
    /** Retrieve the bound employeeId for a user. */
    @Transactional(readOnly = true)
    public Long resolveEmployeeId(Long userId) {
        SysUser user = requireUser(userId);
        return user.getEmployeeId();
    }
'''

# Insert before the last private method (requireUser)
last_require_user = userSvcContent.rfind('    private SysUser requireUser(')
if last_require_user != -1:
    userSvcContent = userSvcContent[:last_require_user] + method_to_add + '\n' + userSvcContent[last_require_user:]
    with open(userService_path, 'w', encoding='utf-8') as f:
        f.write(userSvcContent)
    print('UserService: added resolveEmployeeId')
else:
    print('WARNING: could not find requireUser method in UserService')

# Now add endpoint to UserController
userCtrlPath = 
with open(userCtrlPath, 'r', encoding='utf-8') as f:
    ctrlContent = f.read()

# Find the position after dataScope endpoint in controller
data_scope_line = '@GetMapping(\"/{id}/data-scope\")\n    public Result<DataScopeVO> dataScope(@PathVariable Long id) {\n        return Result.ok(userService.resolveDataScope(id));\n    }'
if data_scope_line in ctrlContent:
    # After this block, add the new endpoint
    new_endpoint = '''

    /** mis-org 查询用户绑定的 employeeId。*/
    @GetMapping(\"/{id}/employee-id\")
    public Result<Long> employeeId(@PathVariable Long id) {
        return Result.ok(userService.resolveEmployeeId(id));
    }'''
    ctrlContent = ctrlContent.replace(data_scope_line, data_scope_line + new_endpoint)
    with open(userCtrlPath, 'w', encoding='utf-8') as f:
        f.write(ctrlContent)
    print('UserController: added employee-id endpoint')
else:
    print('WARNING: did not find dataScope line in UserController')

print('=' * 60)
print('Step 2a/b: mis-iam employee-id endpoint done')
