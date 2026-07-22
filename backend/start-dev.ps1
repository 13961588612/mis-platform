param(
    [Parameter(Position = 0)]
    [string]$Service
)

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

if ($Service) {
    Write-Host "$Service 已在后台启动，日志: $LogDir\$Service.log" -ForegroundColor Green
} else {
    Write-Host "全部服务已在后台启动，日志路径: $LogDir" -ForegroundColor Green
}
