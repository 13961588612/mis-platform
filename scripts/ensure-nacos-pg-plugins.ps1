# 下载 Nacos PostgreSQL 插件（Java 17 字节码）+ JDBC
# 配合 mis-nacos:2.3.2-jdk17（Server 跑在 JDK 17 上）
param(
    [string]$PluginsDir = (Join-Path $PSScriptRoot "..\deploy\nacos\plugins")
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $PluginsDir)) {
    New-Item -ItemType Directory -Path $PluginsDir -Force | Out-Null
}

$files = @(
    @{
        # 0.0.7 = Java17，仅当 Nacos Server 也用 JDK17 时可加载
        Name = "nacos-datasource-plugin-postgresql-0.0.7.jar"
        Url  = "https://repo1.maven.org/maven2/com/pig4cloud/plugin/nacos-datasource-plugin-postgresql/0.0.7/nacos-datasource-plugin-postgresql-0.0.7.jar"
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

Write-Host "Nacos PG plugins ready (JDK17): $PluginsDir" -ForegroundColor Green
