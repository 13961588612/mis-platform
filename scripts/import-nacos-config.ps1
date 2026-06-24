# 将 deploy/nacos/import/*.yaml 导入 Nacos 配置中心
param(
    [string]$Namespace = "test",
    [string]$Group = "MIS_GROUP",
    [string]$NacosServer = "http://localhost:8848",
    [string]$Username = "nacos",
    [string]$Password = "nacos"
)

$ErrorActionPreference = "Stop"
$importDir = Join-Path $PSScriptRoot "..\deploy\nacos\import"

if (-not (Test-Path $importDir)) {
    Write-Error "Import directory not found: $importDir"
}

# 登录获取 accessToken（Nacos 2.x）
$loginBody = @{ username = $Username; password = $Password } | ConvertTo-Json
$token = $null
try {
    $loginResp = Invoke-RestMethod -Method Post -Uri "$NacosServer/nacos/v1/auth/login" `
        -Body "username=$Username&password=$Password" -ContentType "application/x-www-form-urlencoded"
    $token = $loginResp.accessToken
} catch {
    Write-Host "Nacos auth disabled or login skipped, continuing without token..."
}

$headers = @{}
if ($token) { $headers["Authorization"] = "Bearer $token" }

Get-ChildItem $importDir -Filter "*.yaml" | ForEach-Object {
    $dataId = $_.Name
    $content = Get-Content $_.FullName -Raw -Encoding UTF8
    $body = @{
        dataId  = $dataId
        group   = $Group
        content = $content
        tenant  = $Namespace
        type    = "yaml"
    }
    Invoke-RestMethod -Method Post -Uri "$NacosServer/nacos/v1/cs/configs" -Headers $headers -Body $body | Out-Null
    Write-Host "Imported $dataId -> namespace=$Namespace group=$Group"
}

Write-Host "Done. Verify at $NacosServer/nacos"
