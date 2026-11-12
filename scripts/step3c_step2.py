path = r'D:\\code\\mis-platform\\backend\\mis-admin-bff\\src\\main\\java\\com\\mis\\adminbff\\client\\AiPlatformClient.java'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 2) Add header constants
marker2 = '    private static final String HEADER_MIS_ROLES = \"X-Mis-Roles\";'
if marker2 in content:
    idx = content.find(marker2)
    end = content.index(chr(10), idx) + 1
    replacement = marker2 + chr(10) + chr(10) + '    private static final String HEADER_MIS_DEPT_SCOPE = \"X-Mis-Dept-Scope\";\n    private static final String HEADER_MIS_STORES = \"X-Mis-Stores\";\n    private static final String HEADER_MIS_DATA_SCOPE = \"X-Mis-Data-Scope\";\n'
    content = content[:idx] + replacement + content[end:]
    print('Header constants added OK')

# 3) Add fields after iamCache
marker3 = '    private final Map<Long, IamCacheEntry> iamCache = new ConcurrentHashMap<>();'
replacement3 = marker3 + '\n    private final OrgWebClient orgWebClient;\n    private final Map<Long, OrgCacheEntry> orgCache = new ConcurrentHashMap<>();'
content = content.replace(marker3, replacement3)
print('Fields added:', 'OK' if 'orgWebClient' in content else 'FAIL')

# 4) Replace constructor
marker4 = chr(10) + '            IamWebClient iamWebClient)' + chr(10) + '        super(' + chr(10) + '                plainBuilder.baseUrl(properties.getBaseUrl()).build(),' + chr(10) + '                properties.getChatTimeoutMs());' + chr(10) + '        this.iamWebClient = iamWebClient;' + chr(10) + '    }'
replacement4 = chr(10) + '            IamWebClient iamWebClient,' + chr(10) + '            OrgWebClient orgWebClient)' + chr(10) + '        super(' + chr(10) + '                plainBuilder.baseUrl(properties.getBaseUrl()).build(),' + chr(10) + '                properties.getChatTimeoutMs());' + chr(10) + '        this.iamWebClient = iamWebClient;' + chr(10) + '        this.orgWebClient = orgWebClient;' + chr(10) + '    }'
if marker4 in content:
    content = content.replace(marker4, replacement4)
    print('Constructor replaced: OK')
else:
    print('WARNING: could not find marker4')
    # Try finding it differently
    lines = content.split(chr(10))
    for i, line in enumerate(lines):
        if 'IamWebClient iamWebClient)' in line and '@Qualifier' not in line:
            print(f'Found at line {i}: {line.strip()}')

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Step 3c step2 done')
