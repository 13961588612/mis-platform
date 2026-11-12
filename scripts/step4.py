import json

path = r'D:\code\mis-platform\agent\ai-platform\backend\src\agent\mis_iqd\scope_resolver.py'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

print(f'Original size: {len(content)} chars')

# 1) Add data_scope_all to AskIdentity dataclass fields
old_fields = '    real_role_codes: list[str] = field(default_factory=list)'
new_fields = old_fields + '\n    data_scope_all: bool = False'

if old_fields in content:
    content = content.replace(old_fields, new_fields)
    print('Step A: Added data_scope_all field OK')
else:
    print('WARNING: could not find real_role_codes field marker')

# 2) Update with_simulated_role and real_identity to pass data_scope_all
sim_marker = '            real_role_codes=list(self.real_role_codes),'
if sim_marker in content:
    content = content.replace(sim_marker, 
        '            real_role_codes=list(self.real_role_codes),\n            data_scope_all=self.data_scope_all,')
    count = content.count('data_scope_all=self.data_scope_all,')
    print(f'Step B: Updated {count} AskIdentity calls with data_scope_all')

# Also fix the real_identity case where it uses empty list
real_id_marker = '            real_role_codes=[],\n        )'
search_idx = 0
while True:
    pos = content.find(real_id_marker, search_idx)
    if pos == -1:
        break
    # Check if this is inside an AskIdentity call (within ~5 lines before)
    ctx_before = content[max(0, pos-300):pos]
    if 'AskIdentity(' in ctx_before:
        # Replace just this occurrence
        replacement = '            real_role_codes=[],\n            data_scope_all=self.data_scope_all,\n        )'
        content = content[:pos] + replacement + content[pos+len(real_id_marker):]
        print(f'Step B2: Updated real_identity at position {pos}')
    search_idx = pos + 1

# 3) Add from_request_headers class method before RowScopeDimension
rd_marker = '@dataclass\nclass RowScopeDimension:'
if rd_marker in content:
    insertion = '''
@staticmethod
def from_request_headers(raw_headers: dict[str, str]) -> "AskIdentity":
    """From BFF X-Mis-* headers into an AskIdentity."""
    identity = AskIdentity(
        user_id=int(raw_headers.get("X-Mis-User-Id")) if raw_headers.get("X-Mis-User-Id") else None,
        employee_id=raw_headers.get("X-Mis-Employee-Id"),
        role_codes=json.loads(raw_headers.get("X-Mis-Roles", "[]")) if raw_headers.get("X-Mis-Roles") else [],
        dept_ids=[],
        store_codes=json.loads(raw_headers.get("X-Mis-Stores", "[]")) if raw_headers.get("X-Mis-Stores") else [],
        org_ids=json.loads(raw_headers.get("X-Mis-Orgs", "[]")) if raw_headers.get("X-Mis-Orgs") else [],
        raw_headers=dict(raw_headers),
    )

    ds = raw_headers.get("X-Mis-Data-Scope", "").strip().lower()
    if ds == "all":
        identity.data_scope_all = True

    dept_raw = raw_headers.get("X-Mis-Dept-Scope", "")
    if dept_raw:
        try:
            anchors = json.loads(dept_raw)
            identity.dept_ids = [str(a["id"]) for a in anchors if isinstance(a, dict) and a.get("id")]
        except (json.JSONDecodeError, TypeError, KeyError):
            pass

    return identity


'''
    content = content.replace(rd_marker, insertion + rd_marker)
    print('Step C: Added from_request_headers method OK')
else:
    print('WARNING: could not find @dataclass class RowScopeDimension marker')

# 4) Modify inject_row_scope to skip when data_scope_all=True
fc_pattern = '        if not resolution.has_row_scope:\n            return RowScopeInjectOutcome(sql=sql, original_sql=sql)'
if fc_pattern in content:
    new_check = '''        if not resolution.has_row_scope:
            if identity.data_scope_all:
                return RowScopeInjectOutcome(sql=sql, original_sql=sql)
            raise ScopeDeniedError(detail="no row-level conditions matched, deny execution")'''
    content = content.replace(fc_pattern, new_check)
    print('Step D: Modified FAIL_CLOSED check to honor data_scope_all OK')
else:
    print('WARNING: could not find has_row_scope check pattern')
    # Try to find it
    idx = content.find('has_row_scope')
    if idx >= 0:
        print(f'Found has_row_scope at index {idx}: {content[idx-50:idx+100]}')

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print('=' * 60)
print('Step 4 complete - scope_resolver.py modified')
