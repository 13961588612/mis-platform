import re

path = r"D:\code\mis-platform\backend\mis-admin-bff\src\main\java\com\mis\adminbff\client\AiPlatformClient.java"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

print("Original size:", len(content))

# 1) Add imports before SecurityConstants
marker1 = "import com.mis.common.core.constant.SecurityConstants;"
if marker1 in content:
    idx = content.find(marker1)
    end = content.index("\n", idx) + 1
    content = content[:idx] + 'import com.fasterxml.jackson.core.JsonProcessingException;\nimport com.mis.adminbff.client.model.UserDataSetScopeVO;\nimport com.mis.common.core.exception.BusinessException;\n' + content[end:]
    print("Imports added OK")
