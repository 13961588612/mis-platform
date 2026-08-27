# recon 前后端启动脚本（与 backend\start-dev.ps1 同风格）
# 用法:
#   .\start-dev.ps1               # 启动后端(8110) + 前端(5176)
#   .\start-dev.ps1 -Backend      # 仅启动后端
#   .\start-dev.ps1 -Frontend     # 仅启动前端
#   .\start-dev.ps1 -Restart      # 端口已监听也强制重启
#   .\start-dev.ps1 -Build        # 启动前先编译后端（首次 / 改代码后）
param(
    [switch]$Backend,
    [switch]$Frontend,
    [switch]$Restart,
    [switch]$Build
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
$LogDir = Join-Path $Root 'logs'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

$SvcDir       = Join-Path $Root 'recon-service'
$FeDir        = Join-Path $Root 'recon-admin-web'
$BackendLog   = Join-Path $LogDir 'recon-service.log'
$FrontendLog  = Join-Path $LogDir 'recon-admin-web.log'

# ---------- 环境变量（已设置则保留，未设置用默认；验收期默认连远程 PG、关 Nacos/调度） ----------
function Set-DefaultEnv {
    param([string]$Name, [string]$Value)
    if ([string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($Name, 'Process'))) {
        Set-Item -Path "Env:$Name" -Value $Value
    }
}
Set-DefaultEnv 'MIS_REMOTE' 'false'
Set-DefaultEnv 'DB_HOST' '10.254.16.6'
Set-DefaultEnv 'DB_PORT' '5432'
Set-DefaultEnv 'DB_NAME' 'recon'
Set-DefaultEnv 'DB_USER' 'mis'
Set-DefaultEnv 'DB_PASSWORD' 'mis123'
Set-DefaultEnv 'RECON_SCHEDULER_ENABLED' 'true'

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

function Find-PnpmCmd {
    $p = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
    if ($p) { return $p.Source }
    return $null
}

function Test-PortListening {
    param([int]$Port)
    $c = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    return ($c.Count -gt 0)
}

function Test-HttpHealth {
    param([int]$Port, [int]$TimeoutSec = 3)
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/actuator/health" -TimeoutSec $TimeoutSec -UseBasicParsing
        return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300)
    } catch { return $false }
}

function Wait-PortListening {
    param([int]$Port, [int]$TimeoutSec = 180, [string]$Label = '')
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-PortListening -Port $Port) { return $true }
        Start-Sleep -Seconds 2
    }
    if ($Label) { Write-Host "  ! 等待 $Label :$Port 监听超时（${TimeoutSec}s），请查看日志: $LogDir" -ForegroundColor Red }
    return $false
}

# 子进程环境变量块（Hidden 窗口需显式写出关键键，避免继承遗漏）
function Get-ChildEnvBlock {
    $keys = @('JAVA_HOME', 'MIS_REMOTE', 'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'RECON_SCHEDULER_ENABLED')
    $lines = @()
    foreach ($k in $keys) {
        $v = [Environment]::GetEnvironmentVariable($k, 'Process')
        if (-not [string]::IsNullOrEmpty($v)) {
            $escaped = $v.Replace("'", "''")
            $lines += "`$env:$k = '$escaped'"
        }
    }
    return ($lines -join "`n")
}

$Jdk17 = Find-Jdk17
$Mvn   = Find-MavenCmd
$Pnpm  = Find-PnpmCmd
if (-not $Jdk17) { Write-Host '未找到 JDK 17：请设置 JAVA_HOME_17，或安装到 D:\Program Files\Java\jdk-17.0.18' -ForegroundColor Red; exit 1 }
if (-not $Mvn)   { Write-Host '未找到 Maven（需 >= 3.9）：请设置 MAVEN_HOME，或使用 D:\apache-maven-3.9.9' -ForegroundColor Red; exit 1 }
if (-not $Pnpm)  { Write-Host '未找到 pnpm：请先执行 npm i -g pnpm' -ForegroundColor Red; exit 1 }

# 显式覆盖当前进程的 JAVA_HOME（系统默认可能是 JDK 1.8），供 Get-ChildEnvBlock 透传给子进程
$env:JAVA_HOME = $Jdk17
Write-Host "JDK17 : $Jdk17" -ForegroundColor Cyan
Write-Host "Maven : $Mvn" -ForegroundColor Cyan

# ---------- 目标计算（默认全启动） ----------
$wantBackend  = $Backend  -or (-not $Backend  -and -not $Frontend)
$wantFrontend = $Frontend -or (-not $Backend  -and -not $Frontend)

$failed = @()

# ---------- 编译（可选） ----------
if ($Build) {
    Write-Host '检测到 -Build，先编译后端...' -ForegroundColor Cyan
    & (Join-Path $Root 'build-dev.ps1')
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

# ---------- 后端 recon-service (8110) ----------
if ($wantBackend) {
    $parentDir = Join-Path $env:USERPROFILE '.m2\repository\com\mis\recon-parent\0.1.0-SNAPSHOT'
    if (-not (Test-Path $parentDir)) {
        Write-Host 'recon-parent 尚未安装到本地 Maven 仓库，请先执行 .\build-dev.ps1 或 .\start-dev.ps1 -Build' -ForegroundColor Yellow
        exit 1
    }

    $skipBackend = $false
    if (Test-PortListening -Port 8110) {
        if ($Restart) {
            Write-Host '  ~ recon-service :8110 占用中，先停止...' -ForegroundColor Yellow
            & (Join-Path $Root 'stop-dev.ps1') backend
        } elseif (Test-HttpHealth -Port 8110) {
            Write-Host '  = recon-service 已在 :8110 监听且 health 正常，跳过（需要重启用 -Restart）' -ForegroundColor Green
            $skipBackend = $true
        } else {
            Write-Host '  ! :8110 端口在听但 health 失败（可能是旧进程/错库），将停掉再启' -ForegroundColor Yellow
            & (Join-Path $Root 'stop-dev.ps1') backend
        }
    }

    if (-not $skipBackend) {
        if (Test-Path $BackendLog) { Copy-Item $BackendLog ($BackendLog + '.prev') -Force -ErrorAction SilentlyContinue }
        Write-Host "  -> 启动 recon-service（:8110，日志: $BackendLog）" -ForegroundColor Yellow
        $envBlock = Get-ChildEnvBlock
        $childCmd = "cd '$SvcDir'`n$envBlock`n& '$Mvn' spring-boot:run *>&1 | Tee-Object -FilePath '$BackendLog'"
        Start-Process powershell -ArgumentList @('-NoExit', '-Command', $childCmd) -WindowStyle Hidden | Out-Null
        if (Wait-PortListening -Port 8110 -TimeoutSec 240 -Label 'recon-service') {
            Write-Host '  ok recon-service 已监听 :8110' -ForegroundColor Green
        } else {
            $failed += 'recon-service'
        }
    }
}

# ---------- 前端 recon-admin-web (5176) ----------
if ($wantFrontend) {
    if (Test-PortListening -Port 5176 -and -not $Restart) {
        Write-Host '  = recon-admin-web 已在 :5176 监听，跳过（需要重启用 -Restart）' -ForegroundColor Green
    } else {
        if (-not (Test-Path (Join-Path $FeDir 'node_modules'))) {
            Write-Host '  ~ 首次运行，安装前端依赖（pnpm install --store-dir ./.pnpm-store）...' -ForegroundColor Cyan
            Push-Location $FeDir
            & $Pnpm install --store-dir "./.pnpm-store"
            $code = $LASTEXITCODE
            Pop-Location
            if ($code -ne 0) {
                Write-Host '  x pnpm install 失败' -ForegroundColor Red
                $failed += 'recon-admin-web(install)'
            }
        }
        if ($failed.Count -eq 0) {
            if (Test-Path $FrontendLog) { Copy-Item $FrontendLog ($FrontendLog + '.prev') -Force -ErrorAction SilentlyContinue }
            Write-Host "  -> 启动 recon-admin-web（:5176，日志: $FrontendLog）" -ForegroundColor Yellow
            $childCmd = "cd '$FeDir'`n& '$Pnpm' dev *>&1 | Tee-Object -FilePath '$FrontendLog'"
            Start-Process powershell -ArgumentList @('-NoExit', '-Command', $childCmd) -WindowStyle Hidden | Out-Null
            if (Wait-PortListening -Port 5176 -TimeoutSec 90 -Label 'recon-admin-web') {
                Write-Host '  ok recon-admin-web 已监听 :5176' -ForegroundColor Green
            } else {
                $failed += 'recon-admin-web'
            }
        }
    }
}

# ---------- 结果汇总 ----------
Write-Host ''
if ($failed.Count -gt 0) {
    Write-Host "以下服务未就绪: $($failed -join ', ')" -ForegroundColor Red
    Write-Host '可执行: .\stop-dev.ps1; .\start-dev.ps1 -Restart' -ForegroundColor Yellow
    exit 1
}
Write-Host 'recon 前后端已就绪' -ForegroundColor Green
Write-Host '  后端 API : http://localhost:8110/actuator/health' -ForegroundColor Cyan
Write-Host '  管理后台 : http://localhost:5176' -ForegroundColor Cyan
Write-Host "  日志目录 : $LogDir" -ForegroundColor Cyan
Write-Host '  停止命令 : .\stop-dev.ps1' -ForegroundColor Cyan
