# Ensure Nacos namespace exists (PowerShell 5.1: keep this file UTF-8 with BOM or ASCII-only strings)
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
    Write-Host "Nacos namespace '$Namespace' already exists"
    return
}

$body = @{
    customNamespaceId = $Namespace
    namespaceName     = $Namespace
    namespaceDesc     = "MIS integration profile"
}
Invoke-RestMethod -Method Post -Uri "$NacosServer/nacos/v1/console/namespaces" -Body $body | Out-Null
Write-Host "Created Nacos namespace '$Namespace'"
