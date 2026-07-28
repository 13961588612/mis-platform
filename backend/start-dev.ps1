param(
    [Parameter(Position = 0)]
    [string]$Service,

    # 跳过启动前的 mvn install（仅改业务服务、公共模块未变时可用）
    [switch]$SkipInstall
)

# Windows PowerShell 5.1：脚本须带 UTF-8 BOM；并设置控制台 UTF-8，避免中文乱码
if ($PSVersionTable.PSVersion.Major -lt 6) {
    try {
        chcp 65001 | Out-Null
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        $OutputEncoding = [System.Text.Encoding]::UTF8
    } catch {}
}

$env:JWT_PRIVATE_KEY_PATH = "D:\code\mis-platform\backend\keys\private.pem"
$env:JWT_PUBLIC_KEY_PATH  = "D:\code\mis-platform\backend\keys\public.pem"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogDir = Join-Path $Root "logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

$all = @(
    'mis-auth', 'mis-iam', 'mis-org', 'mis-system',
    'mis-audit', 'mis-admin-bff', 'mis-gateway'
)

if ($Service) {
    if ($Service -notin $all) {
        Write-Host "未知服务: $Service" -ForegroundColor Red
        Write-Host "可用服务: $($all -join ', ')" -ForegroundColor Yellow
        exit 1
    }
    $targets = @($Service)
} else {
    $targets = $all
}

Push-Location $Root
try {
    if (-not $SkipInstall) {
        if (-not $env:JAVA_HOME_17) {
            Write-Host "JAVA_HOME_17 未设置，请先配置 JDK 17 路径" -ForegroundColor Red
            exit 1
        }
        Write-Host "正在编译安装 backend（mvn install -DskipTests）..." -ForegroundColor Cyan
        $env:JAVA_HOME = $env:JAVA_HOME_17
        # --% 后参数原样交给脚本，避免 -DskipTests 被 PowerShell 解析/合并
        & "$Root\mvn.ps1" --% install -DskipTests
        if ($LASTEXITCODE -ne 0) {
            Write-Host "mvn install 失败（exit=$LASTEXITCODE），已中止启动" -ForegroundColor Red
            exit $LASTEXITCODE
        }
        Write-Host "编译安装完成" -ForegroundColor Green
    } else {
        Write-Host "已跳过 mvn install（-SkipInstall）" -ForegroundColor Yellow
    }

    Write-Host "正在启动后端服务 ..." -ForegroundColor Cyan

    foreach ($svc in $targets) {
        $log = Join-Path $LogDir "$svc.log"
        Write-Host "  -> $svc (日志: $log)" -ForegroundColor Yellow
        Start-Process powershell -ArgumentList @(
            "-NoExit", "-Command",
            "cd '$Root'; `$env:JAVA_HOME = `$env:JAVA_HOME_17; & mvn spring-boot:run -pl $svc -q *>&1 | Tee-Object -FilePath '$log'"
        ) -WindowStyle Hidden
        Start-Sleep -Seconds 3
    }
} finally {
    Pop-Location
}

if ($Service) {
    Write-Host "$Service 已在后台启动，日志: $LogDir\$Service.log" -ForegroundColor Green
} else {
    Write-Host "全部服务已在后台启动，日志路径: $LogDir" -ForegroundColor Green
}
