# 本机手工启动 Nacos 2.3.2（JDK 17，与 mis-auth 共用 JAVA_HOME_17）
# 用法：
#   .\scripts\start-nacos-native.ps1              # 内嵌存储
#   .\scripts\start-nacos-native.ps1 -UsePostgres # PG 外置（需本地 PG nacos 库 + 插件）
param(
    [switch]$UsePostgres,
    [string]$NacosHome = "",
    [string]$Version = "2.3.2"
)

$ErrorActionPreference = "Stop"

if (-not $env:JAVA_HOME_17) {
    Write-Error "请先设置 JAVA_HOME_17（与 mis-auth 相同）"
}
$env:JAVA_HOME = $env:JAVA_HOME_17
$env:PATH = "$env:JAVA_HOME\bin;" + $env:PATH

$javaVer = & java -version 2>&1 | Select-Object -First 1
Write-Host "Java: $javaVer" -ForegroundColor Cyan

$Root = Split-Path -Parent $PSScriptRoot
if (-not $NacosHome) {
    $NacosHome = Join-Path $Root "deploy\nacos\runtime\nacos"
}

$zipUrl = "https://github.com/alibaba/nacos/releases/download/$Version/nacos-server-$Version.zip"
$runtimeRoot = Join-Path $Root "deploy\nacos\runtime"
$zipPath = Join-Path $runtimeRoot "nacos-server-$Version.zip"

if (-not (Test-Path (Join-Path $NacosHome "target\nacos-server.jar"))) {
    New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
    if (-not (Test-Path $zipPath)) {
        Write-Host "Downloading Nacos $Version ..." -ForegroundColor Cyan
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
    }
    Write-Host "Extracting..." -ForegroundColor Cyan
    if (Test-Path $NacosHome) { Remove-Item $NacosHome -Recurse -Force }
    Expand-Archive -Path $zipPath -DestinationPath $runtimeRoot -Force
    # zip 解压出 nacos/ 目录
    $extracted = Join-Path $runtimeRoot "nacos"
    if ((Test-Path $extracted) -and ($extracted -ne $NacosHome)) {
        if (Test-Path $NacosHome) { Remove-Item $NacosHome -Recurse -Force }
        Rename-Item $extracted $NacosHome
    }
}

$pluginsDir = Join-Path $Root "deploy\nacos\plugins"
$nacosPlugins = Join-Path $NacosHome "plugins"
New-Item -ItemType Directory -Path $nacosPlugins -Force | Out-Null

if ($UsePostgres) {
    & (Join-Path $PSScriptRoot "ensure-nacos-pg-plugins.ps1") -PluginsDir $pluginsDir
    Copy-Item (Join-Path $pluginsDir "nacos-datasource-plugin-postgresql-0.0.7.jar") $nacosPlugins -Force
    Copy-Item (Join-Path $pluginsDir "postgresql-42.7.3.jar") $nacosPlugins -Force
    Copy-Item (Join-Path $Root "deploy\nacos\server\application-native-pg.properties") `
        (Join-Path $NacosHome "conf\application.properties") -Force
    Write-Host "Storage: PostgreSQL @ 127.0.0.1:5432/nacos" -ForegroundColor Yellow
} else {
    Write-Host "Storage: embedded" -ForegroundColor Yellow
}

$javaArgs = @(
    "-Xms256m", "-Xmx512m", "-Xmn128m", "-XX:+UseG1GC",
    "-Dnacos.standalone=true",
    "-Dnacos.core.auth.enabled=false",
    "-Dloader.path=$nacosPlugins",
    "-Dnacos.home=$NacosHome",
    "-jar", ".\target\nacos-server.jar",
    "--spring.config.additional-location=file:$NacosHome\conf\",
    "--spring.config.name=application"
)

Write-Host "Starting Nacos $Version (foreground). Ctrl+C to stop." -ForegroundColor Green
Write-Host "Console: http://127.0.0.1:8848/nacos  (nacos/nacos)" -ForegroundColor Green

Set-Location $NacosHome
& java @javaArgs
