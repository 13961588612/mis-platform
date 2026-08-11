# Diff deploy/nacos-config/{Namespace}/*.yaml against live Nacos Data IDs (L2 verify).
param(
    [Parameter(Mandatory = $true)]
    [string]$Namespace,
    [string]$Group = "MIS_GROUP",
    [string]$NacosServer = "http://localhost:8848",
    [string]$Username = "nacos",
    [string]$Password = "nacos",
    [string]$DataId = ""
)

$ErrorActionPreference = "Stop"
$Root = Join-Path $PSScriptRoot ".."
$importDir = Join-Path $Root "deploy\nacos-config\$Namespace"

if (-not (Test-Path $importDir)) {
    Write-Error "Config directory not found: $importDir"
}

$token = $null
try {
    $loginResp = Invoke-RestMethod -Method Post -Uri "$NacosServer/nacos/v1/auth/login" `
        -Body "username=$Username&password=$Password" -ContentType "application/x-www-form-urlencoded"
    $token = $loginResp.accessToken
} catch {
    Write-Host "Nacos auth disabled or login skipped, continuing without token..."
}

function Get-NacosConfig([string]$id) {
    $uri = "$NacosServer/nacos/v1/cs/configs?dataId=$id&group=$Group&tenant=$Namespace"
    if ($token) { $uri += "&accessToken=$token" }
    try {
        return (Invoke-WebRequest -Uri $uri -UseBasicParsing).Content
    } catch {
        return $null
    }
}

function Normalize-Yaml([string]$text) {
    if ($null -eq $text) { return $null }
    return (($text -replace "`r`n", "`n") -replace "`r", "`n").TrimEnd() + "`n"
}

$files = Get-ChildItem $importDir -Filter "*.yaml"
if ($DataId) {
    $files = $files | Where-Object { $_.BaseName -eq $DataId }
    if (-not $files) { Write-Error "No local file for DataId=$DataId in $importDir" }
}

$mismatch = 0
$missing = 0
$ok = 0

Write-Host "Diff $importDir <-> $NacosServer namespace=$Namespace group=$Group" -ForegroundColor Cyan

foreach ($f in $files) {
    $id = $f.BaseName
    $local = Normalize-Yaml (Get-Content $f.FullName -Raw -Encoding UTF8)
    $remote = Normalize-Yaml (Get-NacosConfig $id)
    if ($null -eq $remote -or $remote.Trim().Length -eq 0) {
        Write-Host "[MISSING] $id" -ForegroundColor Red
        $missing++
        continue
    }
    if ($local -eq $remote) {
        Write-Host "[OK]      $id" -ForegroundColor Green
        $ok++
    } else {
        Write-Host "[DIFF]    $id" -ForegroundColor Yellow
        $mismatch++
        $tmpLocal = Join-Path $env:TEMP "nacos-diff-$id-local.yaml"
        $tmpRemote = Join-Path $env:TEMP "nacos-diff-$id-remote.yaml"
        [System.IO.File]::WriteAllText($tmpLocal, $local)
        [System.IO.File]::WriteAllText($tmpRemote, $remote)
        Write-Host "  local : $tmpLocal"
        Write-Host "  remote: $tmpRemote"
    }
}

Write-Host ""
Write-Host "Summary: ok=$ok diff=$mismatch missing=$missing" -ForegroundColor Cyan
if ($mismatch -gt 0 -or $missing -gt 0) { exit 1 }
exit 0
