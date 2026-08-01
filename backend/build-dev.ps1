param(
    # 默认跳过测试；需要跑测试时加 -WithTests
    [switch]$WithTests
)

# Windows PowerShell 5.1：脚本须带 UTF-8 BOM；并设置控制台 UTF-8，避免中文乱码
if ($PSVersionTable.PSVersion.Major -lt 6) {
    try {
        chcp 65001 | Out-Null
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        $OutputEncoding = [System.Text.Encoding]::UTF8
    } catch {}
}

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $env:JAVA_HOME_17) {
    Write-Host "JAVA_HOME_17 未设置，请先配置 JDK 17 路径" -ForegroundColor Red
    exit 1
}

Push-Location $Root
try {
    $env:JAVA_HOME = $env:JAVA_HOME_17
    if ($WithTests) {
        Write-Host "正在编译安装 backend（mvn install）..." -ForegroundColor Cyan
        & "$Root\mvn.ps1" --% install
    } else {
        Write-Host "正在编译安装 backend（mvn install -DskipTests）..." -ForegroundColor Cyan
        # --% 后参数原样交给脚本，避免 -DskipTests 被 PowerShell 解析/合并
        & "$Root\mvn.ps1" --% install -DskipTests
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Host "mvn install 失败（exit=$LASTEXITCODE）" -ForegroundColor Red
        exit $LASTEXITCODE
    }
    Write-Host "编译安装完成" -ForegroundColor Green
} finally {
    Pop-Location
}
