# 确保 Nacos 命名空间存在
param(
    [string]$Namespace = "integration",
    [string]$NacosServer = "http://localhost:8848"
)

$ErrorActionPreference = "SilentlyContinue"
$list = Invoke-RestMethod -Uri "$NacosServer/nacos/v1/console/namespaces" -Method Get
$exists = $false
if ($list.data) {
    foreach ($item in $list.data) {
        if ($item.namespace -eq $Namespace) { $exists = $true; break }
    }
}
$ErrorActionPreference = "Stop"

if ($exists) {
    Write-Host "Nacos namespace '$Namespace' 已存在"
    return
}

$body = @{
    customNamespaceId = $Namespace
    namespaceName     = $Namespace
    namespaceDesc     = "MIS integration profile"
}
Invoke-RestMethod -Method Post -Uri "$NacosServer/nacos/v1/console/namespaces" -Body $body | Out-Null
Write-Host "已创建 Nacos namespace '$Namespace'"
