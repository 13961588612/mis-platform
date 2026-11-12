# Step 2b: Add employee-id endpoint to UserController
ctrl_path = r'D:\\code\\mis-platform\\backend\\mis-iam\\src\\main\\java\\com\\mis\\iam\\controller\\UserController.java'
with open(ctrl_path, 'r', encoding='utf-8') as f:
    ctrl_content = f.read()

new_endpoint = chr(10) + '''
    /** mis-org query employeeId for DataSetScopeService. */
    @GetMapping(\"/{id}/employee-id\")
    public Result<Long> getEmployeeId(@PathVariable Long id) {
        return Result.ok(userService.resolveEmployeeId(id));
    }
'''

marker = '@GetMapping(\"/{id}/data-scope\")'
idx = ctrl_content.find(marker)
if idx != -1:
    brace_count = 0
    found_open = False
    i = idx
    while i < len(ctrl_content):
        if ctrl_content[i] == '{':
            brace_count += 1
            found_open = True
        elif ctrl_content[i] == '}':
            brace_count -= 1
            if found_open and brace_count == 0:
                insert_pos = i + 1
                while insert_pos < len(ctrl_content) and ctrl_content[insert_pos] in (' ', '\\t'):
                    insert_pos += 1
                ctrl_content = ctrl_content[:insert_pos] + new_endpoint + ctrl_content[insert_pos:]
                break
        i += 1
    with open(ctrl_path, 'w', encoding='utf-8') as f:
        f.write(ctrl_content)
    print('UserController: added employee-id endpoint')
else:
    print('WARNING: could not find dataScope marker')
