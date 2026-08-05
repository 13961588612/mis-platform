param(
    [Parameter(Position = 0)]
    [string]$Service,

    # 已在监听时仍强制停掉再启
    [switch]$Restart
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
# 避免 Windows 上 localhost→::1 连不上仅听 IPv4 的 Docker 端口
if (-not $env:REDIS_HOST) { $env:REDIS_HOST = '127.0.0.1' }
if (-not $env:AI_PLATFORM_BASE_URL) { $env:AI_PLATFORM_BASE_URL = 'http://127.0.0.1:8000' }
if (-not $env:AI_PLATFORM_SSE_ENABLED) { $env:AI_PLATFORM_SSE_ENABLED = 'true' }

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogDir = Join-Path $Root "logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

# 启动顺序：领域服务 → BFF → Gateway（BFF 依赖下游与 Redis，不宜与首批并发抢 Maven）
$servicePorts = [ordered]@{
    'mis-auth'      = 8101
    'mis-iam'       = 8102
    'mis-org'       = 8103
    'mis-system'    = 8105
    'mis-audit'     = 8106
    'mis-kb'        = 8108
    'mis-admin-bff' = 8081
    'mis-gateway'   = 8080
}
$all = @($servicePorts.Keys)

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

if (-not $env:JAVA_HOME_17) {
    Write-Host "JAVA_HOME_17 未设置，请先配置 JDK 17 路径" -ForegroundColor Red
    exit 1
}

function Test-PortListening {
    param([int]$Port)
    $c = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    return ($c.Count -gt 0)
}

function Wait-PortListening {
    param(
        [int]$Port,
        [int]$TimeoutSec = 180,
        [string]$Label = ''
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-PortListening -Port $Port) { return $true }
        Start-Sleep -Seconds 2
    }
    if ($Label) {
        Write-Host "  ! 等待 $Label :$Port 监听超时（${TimeoutSec}s）" -ForegroundColor Red
    }
    return $false
}

function Wait-PortFree {
    param(
        [int]$Port,
        [int]$TimeoutSec = 45
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (-not (Test-PortListening -Port $Port)) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Stop-DevService {
    param([string]$Name)
    $stopScript = Join-Path $Root 'stop-dev.ps1'
    & $stopScript $Name | Out-Null
}

Push-Location $Root
$failed = @()
try {
    Write-Host "正在启动后端服务（不含编译；请先运行 .\build-dev.ps1）..." -ForegroundColor Cyan
    if ($Restart) {
        Write-Host "模式: -Restart（已监听也会停掉再启）" -ForegroundColor Yellow
    }

    foreach ($svc in $targets) {
        $port = [int]$servicePorts[$svc]
        $log = Join-Path $LogDir "$svc.log"

        if ((Test-PortListening -Port $port) -and -not $Restart) {
            Write-Host "  = $svc 已在 :$port 监听，跳过（需要重启用 -Restart）" -ForegroundColor Green
            continue
        }

        if (Test-PortListening -Port $port) {
            Write-Host "  ~ $svc 端口 $port 占用中，先停止..." -ForegroundColor Yellow
            Stop-DevService -Name $svc
            if (-not (Wait-PortFree -Port $port -TimeoutSec 45)) {
                Write-Host "  x $svc 端口 $port 仍被占用，跳过启动" -ForegroundColor Red
                $failed += $svc
                continue
            }
        }

        # 保留上一份日志，避免失败原因被 Tee 截断冲掉
        if (Test-Path $log) {
            Copy-Item -Path $log -Destination ($log + '.prev') -Force -ErrorAction SilentlyContinue
        }

        Write-Host "  -> $svc (port $port, 日志: $log)" -ForegroundColor Yellow

        # 显式传入关键环境，避免 Hidden 子进程丢变量
        $childCmd = @"
cd '$Root'
`$env:JAVA_HOME = '$($env:JAVA_HOME_17)'
`$env:JWT_PRIVATE_KEY_PATH = '$($env:JWT_PRIVATE_KEY_PATH)'
`$env:JWT_PUBLIC_KEY_PATH = '$($env:JWT_PUBLIC_KEY_PATH)'
`$env:REDIS_HOST = '$($env:REDIS_HOST)'
`$env:AI_PLATFORM_BASE_URL = '$($env:AI_PLATFORM_BASE_URL)'
`$env:AI_PLATFORM_SSE_ENABLED = '$($env:AI_PLATFORM_SSE_ENABLED)'
& mvn spring-boot:run -pl $svc *>&1 | Tee-Object -FilePath '$log'
"@

        Start-Process powershell -ArgumentList @('-NoExit', '-Command', $childCmd) -WindowStyle Hidden | Out-Null

        # BFF/Gateway 较重；领域服务给短等待，减少同时抢 Maven/CPU
        $waitSec = if ($svc -eq 'mis-admin-bff' -or $svc -eq 'mis-gateway') { 180 } else { 120 }
        if (Wait-PortListening -Port $port -TimeoutSec $waitSec -Label $svc) {
            Write-Host "  ok $svc 已监听 :$port" -ForegroundColor Green
        } else {
            Write-Host "  x $svc 启动失败，请查看 $log （上一份: $log.prev）" -ForegroundColor Red
            $failed += $svc
        }
    }
} finally {
    Pop-Location
}

Write-Host ""
if ($failed.Count -gt 0) {
    Write-Host "以下服务未就绪: $($failed -join ', ')" -ForegroundColor Red
    Write-Host "可执行: .\stop-dev.ps1 <服务名>; .\start-dev.ps1 <服务名> -Restart" -ForegroundColor Yellow
    exit 1
}

if ($Service) {
    Write-Host "$Service 已就绪" -ForegroundColor Green
} else {
    Write-Host "全部目标服务已就绪，日志目录: $LogDir" -ForegroundColor Green
}
