# 将 deploy/nacos-config/{namespace}/ 下的 YAML 推送到 Nacos 配置中心
param(
    [Parameter(Mandatory = $true)]
    [string]$Namespace,
    [string]$Group = "MIS_GROUP",
    [string]$NacosServer = "http://localhost:8848",
    [string]$Username = "nacos",
    [string]$Password = "nacos"
)

$ErrorActionPreference = "Stop"
$Root = Join-Path $PSScriptRoot ".."
$importDir = Join-Path $Root "deploy\nacos-config\$Namespace"

if (-not (Test-Path $importDir)) {
    Write-Error "Config directory not found: $importDir"
}

Write-Host "Push $importDir -> namespace=$Namespace" -ForegroundColor Cyan

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
    $dataId = $_.BaseName
    $content = Get-Content $_.FullName -Raw -Encoding UTF8
    $body = @{
        dataId  = $dataId
        group   = $Group
        content = $content
        tenant  = $Namespace
        type    = "yaml"
    }
    Invoke-RestMethod -Method Post -Uri "$NacosServer/nacos/v1/cs/configs" -Headers $headers -Body $body | Out-Null
    Write-Host "Pushed $dataId -> namespace=$Namespace group=$Group"
}

Write-Host "Done. Verify at $NacosServer/nacos (namespace: $Namespace)"
