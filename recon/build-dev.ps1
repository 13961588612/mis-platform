# recon 后端编译脚本（与 backend\build-dev.ps1 同风格）
# 用法:
#   .\build-dev.ps1              # 编译并跳过测试
#   .\build-dev.ps1 -WithTests   # 编译并运行全部单测
param(
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

# ---------- 工具函数 ----------
function Find-Jdk17 {
    $candidates = @()
    if ($env:JAVA_HOME_17) { $candidates += $env:JAVA_HOME_17 }
    $candidates += 'D:\Program Files\Java\jdk-17.0.18'
    foreach ($c in $candidates) {
        if ($c -and (Test-Path (Join-Path $c 'bin\javac.exe'))) { return $c }
    }
    return $null
}

function Find-MavenCmd {
    if ($env:MAVEN_HOME -and (Test-Path (Join-Path $env:MAVEN_HOME 'bin\mvn.cmd'))) {
        return (Join-Path $env:MAVEN_HOME 'bin\mvn.cmd')
    }
    if (Test-Path 'D:\apache-maven-3.9.9\bin\mvn.cmd') { return 'D:\apache-maven-3.9.9\bin\mvn.cmd' }
    $m = Get-Command mvn.cmd -ErrorAction SilentlyContinue
    if ($m) { return $m.Source }
    return $null
}

$Jdk17 = Find-Jdk17
if (-not $Jdk17) {
    Write-Host '未找到 JDK 17：请设置环境变量 JAVA_HOME_17，或安装到 D:\Program Files\Java\jdk-17.0.18' -ForegroundColor Red
    exit 1
}
$Mvn = Find-MavenCmd
if (-not $Mvn) {
    Write-Host '未找到 Maven（需 >= 3.9）：请设置 MAVEN_HOME，或使用 D:\apache-maven-3.9.9' -ForegroundColor Red
    exit 1
}

Push-Location $Root
try {
    $env:JAVA_HOME = $Jdk17
    Write-Host "JDK17 : $Jdk17" -ForegroundColor Cyan
    Write-Host "Maven : $Mvn" -ForegroundColor Cyan
    if ($WithTests) {
        Write-Host '正在编译安装 recon（mvn install，含测试）...' -ForegroundColor Cyan
        & $Mvn --% install
    } else {
        Write-Host '正在编译安装 recon（mvn install -DskipTests）...' -ForegroundColor Cyan
        & $Mvn --% install -DskipTests
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Host "mvn install 失败（exit=$LASTEXITCODE）" -ForegroundColor Red
        exit $LASTEXITCODE
    }
    Write-Host '编译安装完成' -ForegroundColor Green
} finally {
    Pop-Location
}
