# 下载 Nacos PostgreSQL 插件 + JDBC（版本必须与 Nacos Server 对齐）
#   2.3.2 → 0.0.3（旧 artifact: nacos-datasource-plugin-pg）
#   2.5.x → 0.0.5（新 artifact: nacos-datasource-plugin-postgresql）
param(
    [string]$PluginsDir = (Join-Path $PSScriptRoot "..\deploy\nacos\plugins"),
    [string]$NacosVersion = "2.3.2"
)

$ErrorActionPreference = "Stop"

$pluginVer = switch -Wildcard ($NacosVersion) {
    "2.2.*" { "0.0.2" }
    "2.3.0" { "0.0.2" }
    "2.3.*" { "0.0.3" }
    "2.4.*" { "0.0.4" }
    "2.5.*" { "0.0.5" }
    "3.0.0*" { "0.0.6" }
    "3.*" { "0.0.7" }
    default { "0.0.3" }
}

# ≤0.0.4 旧 artifactId；≥0.0.5 新名
$artifact = if ($pluginVer -match '^0\.0\.[1-4]$') {
    "nacos-datasource-plugin-pg"
} else {
    "nacos-datasource-plugin-postgresql"
}

if (-not (Test-Path $PluginsDir)) {
    New-Item -ItemType Directory -Path $PluginsDir -Force | Out-Null
}

Get-ChildItem -Path $PluginsDir -Filter "nacos-datasource-plugin-postgresql-*.jar" -ErrorAction SilentlyContinue |
    Remove-Item -Force
Get-ChildItem -Path $PluginsDir -Filter "nacos-datasource-plugin-pg-*.jar" -ErrorAction SilentlyContinue |
    Remove-Item -Force

$jarName = "$artifact-$pluginVer.jar"
$files = @(
    @{
        Name = $jarName
        Url  = "https://repo1.maven.org/maven2/com/pig4cloud/plugin/$artifact/$pluginVer/$jarName"
    },
    @{
        Name = "postgresql-42.7.3.jar"
        Url  = "https://repo1.maven.org/maven2/org/postgresql/postgresql/42.7.3/postgresql-42.7.3.jar"
    }
)

foreach ($f in $files) {
    $dest = Join-Path $PluginsDir $f.Name
    if (Test-Path $dest) {
        Write-Host "OK exists: $($f.Name)" -ForegroundColor Green
        continue
    }
    Write-Host "Downloading $($f.Name) ..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri $f.Url -OutFile $dest -UseBasicParsing
    Write-Host "Saved $dest" -ForegroundColor Green
}

Write-Host "Nacos PG plugins ready: Nacos=$NacosVersion → ${artifact}:$pluginVer  dir=$PluginsDir" -ForegroundColor Green
