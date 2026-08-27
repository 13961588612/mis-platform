param(
    # 与 start-dev.ps1 一致：可指定单个服务模块；省略则编译整个 backend
    [Parameter(Position = 0)]
    [string]$Service,

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

# 与 start-dev.ps1 可启动服务对齐（-pl 目标）
$knownServices = @(
    'mis-auth',
    'mis-iam',
    'mis-org',
    'mis-system',
    'mis-audit',
    'mis-kb',
    'mis-admin-bff',
    'mis-gateway'
)

if ($Service) {
    if ($Service -notin $knownServices) {
        Write-Host "未知服务: $Service" -ForegroundColor Red
        Write-Host "可用服务: $($knownServices -join ', ')" -ForegroundColor Yellow
        exit 1
    }
}

if (-not $env:JAVA_HOME_17) {
    Write-Host "JAVA_HOME_17 未设置，请先配置 JDK 17 路径" -ForegroundColor Red
    exit 1
}

Push-Location $Root
try {
    $env:JAVA_HOME = $env:JAVA_HOME_17

    # 单模块：-pl + -am（一并安装上游依赖，如 mis-common-*）
    # 全量：根工程 install
    # -DskipTests 用带引号字符串传入，避免被 PowerShell 当成命名参数拆掉
    $mvnArgs = @('install')
    if ($Service) {
        $mvnArgs += @('-pl', $Service, '-am')
    }
    if (-not $WithTests) {
        $mvnArgs += '-DskipTests'
    }

    if ($Service) {
        $scope = $Service
        if ($WithTests) {
            Write-Host "正在编译安装 $scope（mvn install -pl $Service -am）..." -ForegroundColor Cyan
        } else {
            Write-Host "正在编译安装 $scope（mvn install -pl $Service -am -DskipTests）..." -ForegroundColor Cyan
        }
    } else {
        if ($WithTests) {
            Write-Host "正在编译安装 backend（mvn install）..." -ForegroundColor Cyan
        } else {
            Write-Host "正在编译安装 backend（mvn install -DskipTests）..." -ForegroundColor Cyan
        }
    }

    & "$Root\mvn.ps1" @mvnArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Host "mvn install 失败（exit=$LASTEXITCODE）" -ForegroundColor Red
        exit $LASTEXITCODE
    }

    if ($Service) {
        Write-Host "$Service 编译安装完成" -ForegroundColor Green
    } else {
        Write-Host "编译安装完成" -ForegroundColor Green
    }
} finally {
    Pop-Location
}
