param(
    [Parameter(Position = 0)]
    [string]$Service,

    # 已在监听时仍强制停掉再启
    [switch]$Restart,

    # 加载仓库根目录 .env.integration（远程 PG/Redis/Nacos）；默认若该文件存在则自动加载
    [switch]$Integration
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
$RepoRoot = Split-Path -Parent $Root
$LogDir = Join-Path $Root "logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

function Import-DotEnvFile {
    param(
        [string]$Path,
        # 为 true 时用文件值覆盖进程内已有同名变量（.env.integration 作为联调画像时应覆盖）
        [switch]$Override
    )
    if (-not (Test-Path $Path)) { return $false }
    Get-Content -Path $Path -Encoding UTF8 | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith('#')) { return }
        $i = $line.IndexOf('=')
        if ($i -lt 1) { return }
        $k = $line.Substring(0, $i).Trim()
        $v = $line.Substring($i + 1).Trim()
        $existing = [Environment]::GetEnvironmentVariable($k, 'Process')
        if ($Override -or [string]::IsNullOrEmpty($existing)) {
            Set-Item -Path "Env:$k" -Value $v
        }
    }
    return $true
}

# 远程联调 / 混合环境：优先 .env.integration（存在则加载并以文件为准覆盖）
$integrationEnv = Join-Path $RepoRoot '.env.integration'
$localEnv = Join-Path $RepoRoot '.env'
$loadedEnv = $null
if ($Integration -or (Test-Path $integrationEnv)) {
    if (Import-DotEnvFile -Path $integrationEnv -Override) {
        $loadedEnv = $integrationEnv
    }
}
if (-not $loadedEnv) {
    # .env：不覆盖调用方已显式导出的变量
    if (Import-DotEnvFile -Path $localEnv) {
        $loadedEnv = $localEnv
    }
}

$env:JWT_PRIVATE_KEY_PATH = "D:\code\mis-platform\backend\keys\private.pem"
$env:JWT_PUBLIC_KEY_PATH  = "D:\code\mis-platform\backend\keys\public.pem"
# 仅在仍未配置时回落本机；已从 .env.integration 读到远程地址则不要改回 127.0.0.1
if (-not $env:REDIS_HOST) { $env:REDIS_HOST = '127.0.0.1' }
if (-not $env:DB_HOST) { $env:DB_HOST = 'localhost' }
if (-not $env:AI_PLATFORM_BASE_URL) { $env:AI_PLATFORM_BASE_URL = 'http://127.0.0.1:8000' }
if (-not $env:AI_PLATFORM_SSE_ENABLED) { $env:AI_PLATFORM_SSE_ENABLED = 'true' }

if ($loadedEnv) {
    Write-Host "已加载环境: $loadedEnv" -ForegroundColor Cyan
    Write-Host ("  DB_HOST={0}  REDIS_HOST={1}  MIS_REMOTE={2}" -f $env:DB_HOST, $env:REDIS_HOST, $env:MIS_REMOTE) -ForegroundColor Cyan
}
if ($env:DB_HOST -eq 'localhost' -or $env:DB_HOST -eq '127.0.0.1') {
    Write-Host "提示: DB_HOST 仍为本机。若 PG 在远程，请配置仓库根 .env.integration 或先 `$env:DB_HOST=...` 再运行本脚本。" -ForegroundColor Yellow
}

# 启动顺序：领域服务 → BFF → Gateway（BFF 依赖下游与 Redis，不宜与首批并发抢 Maven）
$servicePorts = [ordered]@{
    'mis-auth'      = 8101
    'mis-iam'       = 8102
    'mis-org'       = 8103
    'mis-system'    = 8105
    'mis-audit'     = 8106
    'mis-kb'        = 8108
    'mis-iqd'       = 8109
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

# ---------------------------------------------------------------- 进程/端口原语
#
# <背景> 本环境（受限权限）下 Get-NetTCPConnection / Get-CimInstance / Get-WmiObject
# 均以 CimException「拒绝访问」失败：Test-PortListening 恒返回 false，于是
# 「已在监听」判断失效 → stop 找不到进程 → 端口不释放 → start 却以为可以启动，
# 结果新进程 Address already in use 或**继续复用旧 JVM**（改了代码却像没生效）。
# 现有两条**不依赖 WMI/CIM** 的主路径（本环境已验证可用）：
#   ① netstat -ano 解析监听 PID；② taskkill /T /F 结束进程树。

function Get-PortListenerPids {
    param([int]$Port)
    $found = @()
    try { $rows = & netstat.exe -ano 2>$null } catch { return @() }
    if (-not $rows) { return @() }
    $pattern = '(?m)^\s*TCP\s+\S+:' + $Port + '\s+\S+\s+LISTENING\s+(\d+)\s*$'
    foreach ($m in [regex]::Matches(($rows -join "`n"), $pattern)) {
        $found += [int]$m.Groups[1].Value
    }
    return @($found | Select-Object -Unique)
}

function Test-PortListening {
    param([int]$Port)
    return ((Get-PortListenerPids -Port $Port).Count -gt 0)
}

# 结束进程树（/T 连带子进程）；统一走 taskkill —— 本环境 Stop-Process 对跨权限进程常失败。
function Stop-PortListeners {
    param([int]$Port)
    foreach ($ownerPid in (Get-PortListenerPids -Port $Port)) {
        try { & taskkill.exe /PID $ownerPid /T /F 2>$null | Out-Null } catch { }
    }
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

function Test-HttpHealth {
    param(
        [int]$Port,
        [int]$TimeoutSec = 3
    )
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/actuator/health" -TimeoutSec $TimeoutSec -UseBasicParsing
        return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300)
    } catch {
        return $false
    }
}

function Stop-DevService {
    param([string]$Name)
    $stopScript = Join-Path $Root 'stop-dev.ps1'
    try { & $stopScript $Name | Out-Null } catch { }
    # 兜底：stop-dev.ps1 若因权限/pid 文件缺失没清干净，这里按端口再确认一次，
    # 否则 Wait-PortFree 会假成功（Test-PortListening 曾恒 false）而留下旧进程。
    $port = [int]$servicePorts[$Name]
    if (Test-PortListening -Port $port) {
        Write-Host "  ~ $Name 端口 $port 仍监听，直接结束监听进程" -ForegroundColor Yellow
        Stop-PortListeners -Port $port
    }
}

# 传给子进程的关键变量（Hidden 窗口不会自动带上「刚从 .env 读入」的全部键，须显式写出）
function Get-ChildEnvAssignments {
    $keys = @(
        'JAVA_HOME_17',
        'JWT_PRIVATE_KEY_PATH', 'JWT_PUBLIC_KEY_PATH',
        'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD',
        'REDIS_HOST', 'REDIS_PORT',
        'MIS_REMOTE', 'NACOS_SERVER', 'NACOS_NAMESPACE', 'NACOS_CONFIG_GROUP',
        'MIS_KB_ENGINE_TYPE', 'MIS_KB_ENGINE_BASE_URL', 'MIS_KB_ENGINE_API_KEY', 'MIS_KB_RERANK_MODEL_ID',
        'AI_PLATFORM_BASE_URL', 'AI_PLATFORM_SSE_ENABLED',
        'AUTH_CAPTCHA_ENABLED',
        'JAVA_TOOL_OPTIONS', 'MAVEN_OPTS'
    )
    # Windows 默认 GBK：Nacos 中文 YAML / 日志中文会乱码。强制子进程 JVM UTF-8。
    # stdout/stderr.encoding 需 Java 18+；17 上多余属性无害。
    $utf8Jvm = '-Dfile.encoding=UTF-8 -Dsun.jnu.encoding=UTF-8 -Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8'
    $jto = [Environment]::GetEnvironmentVariable('JAVA_TOOL_OPTIONS', 'Process')
    if ([string]::IsNullOrEmpty($jto)) {
        Set-Item -Path 'Env:JAVA_TOOL_OPTIONS' -Value $utf8Jvm
    } elseif ($jto -notmatch 'file\.encoding') {
        Set-Item -Path 'Env:JAVA_TOOL_OPTIONS' -Value ($jto.Trim() + ' ' + $utf8Jvm)
    }
    $lines = @()
    $lines += "`$env:JAVA_HOME = '$($env:JAVA_HOME_17)'"
    foreach ($k in $keys) {
        $v = [Environment]::GetEnvironmentVariable($k, 'Process')
        if (-not [string]::IsNullOrEmpty($v)) {
            # 单引号包裹；值内单引号加倍转义
            $escaped = $v.Replace("'", "''")
            $lines += "`$env:$k = '$escaped'"
        }
    }
    return ($lines -join "`n")
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
            # 仅「端口在听」不够：僵死/错库进程也会占端口，start-dev 会误跳过（mis-kb 曾中招）
            if (Test-HttpHealth -Port $port) {
                Write-Host "  = $svc 已在 :$port 监听且 health 正常，跳过（需要重启用 -Restart）" -ForegroundColor Green
                continue
            }
            Write-Host "  ! $svc 端口 $port 在听但 health 失败（可能是旧 jar/错 DB_HOST），将停掉再启" -ForegroundColor Yellow
            Stop-DevService -Name $svc
            if (-not (Wait-PortFree -Port $port -TimeoutSec 45)) {
                Write-Host "  x $svc 端口 $port 仍被占用，跳过启动" -ForegroundColor Red
                Write-Host "    如果该端口由另一个 Windows 账号或更高完整性级别的进程占用，当前身份会收到 Access denied（详情见 taskkill 输出）- 请到启动它的那个终端，或以管理员身份停止。" -ForegroundColor DarkGray
                $failed += $svc
                continue
            }
        }

        if (Test-PortListening -Port $port) {
            Write-Host "  ~ $svc 端口 $port 占用中，先停止..." -ForegroundColor Yellow
            Stop-DevService -Name $svc
            if (-not (Wait-PortFree -Port $port -TimeoutSec 45)) {
                Write-Host "  x $svc 端口 $port 仍被占用，跳过启动" -ForegroundColor Red
                Write-Host "    如果该端口由另一个 Windows 账号或更高完整性级别的进程占用，当前身份会收到 Access denied（详情见 taskkill 输出）- 请到启动它的那个终端，或以管理员身份停止。" -ForegroundColor DarkGray
                $failed += $svc
                continue
            }
        }

        # 保留上一份日志，避免失败原因被 Tee 截断冲掉
        if (Test-Path $log) {
            Copy-Item -Path $log -Destination ($log + '.prev') -Force -ErrorAction SilentlyContinue
        }

        Write-Host "  -> $svc (port $port, 日志: $log)" -ForegroundColor Yellow

        $envBlock = Get-ChildEnvAssignments
        # 勿用 Tee-Object：PS 5.1 会按系统 ANSI(GBK) 解码管道再写文件，UTF-8 中文变乱码。
        # cmd 重定向保留 JVM 原始 UTF-8 字节；子进程先 chcp 65001 对齐控制台。
        $childCmd = @"
cd '$Root'
chcp 65001 | Out-Null
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding `$false
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding `$false
`$OutputEncoding = [Console]::OutputEncoding
$envBlock
cmd /c "mvn spring-boot:run -pl $svc > `"$log`" 2>&1"
"@

        $launcher = Start-Process powershell -ArgumentList @('-NoExit', '-Command', $childCmd) -WindowStyle Hidden -PassThru
        # 登记包装进程 PID：stop-dev.ps1 据此 taskkill /T 结束整棵树
        # （不能依赖 Get-CimInstance 反查 CommandLine —— 本环境会权限拒绝）。
        if ($launcher) {
            Set-Content -Path (Join-Path $LogDir "$svc.launch.pid") -Value $launcher.Id -Encoding ASCII -ErrorAction SilentlyContinue
        }

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
