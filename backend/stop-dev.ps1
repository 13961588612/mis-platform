param(
    [Parameter(Position = 0)]
    [string]$Service
)

# Windows PowerShell 5.1：脚本须带 UTF-8 BOM；并设置控制台 UTF-8，避免中文乱码
if ($PSVersionTable.PSVersion.Major -lt 6) {
    try {
        chcp 65001 | Out-Null
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        $OutputEncoding = [System.Text.Encoding]::UTF8
    } catch {}
}

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

# ---------------------------------------------------------------- 进程定位原语
#
# <背景> 本环境（受限权限）下 Get-CimInstance / Get-WmiObject / Get-NetTCPConnection
# 均以 CimException「拒绝访问」失败 → 旧实现「未找到匹配进程」，端口不释放，
# 于是 start-dev 复用了旧 JVM（改了代码却像没生效）。现改为两条**不依赖 WMI/CIM**
# 的主路径（本环境已验证可用）：
#   ① 启动时登记的包装进程 PID 文件（logs/<svc>.launch.pid）→ taskkill /T /F 整树；
#   ② 端口监听进程（netstat -ano 解析）→ taskkill /T /F（pid 文件缺失/过期的兜底）。

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

function Wait-PortFree {
    param([int]$Port, [int]$TimeoutSec = 30)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (-not (Test-PortListening -Port $Port)) { return $true }
        Start-Sleep -Milliseconds 400
    }
    return $false
}

function Stop-ProcessTree {
    param([int]$OwnerPid)
    try {
        & taskkill.exe /PID $OwnerPid /T /F 2>$null | Out-Null
    } catch {
        Stop-Process -Id $OwnerPid -Force -ErrorAction SilentlyContinue
    }
}

$logDir = Join-Path $PSScriptRoot 'logs'

Write-Host "正在停止后端服务 ..." -ForegroundColor Cyan

# ① 优先按启动时登记的包装 PID 结束整树（顺带清掉 mvn/powershell 包装，避免残留堆积）
foreach ($name in $targets) {
    $pidFile = Join-Path $logDir "$name.launch.pid"
    if (-not (Test-Path $pidFile)) { continue }
    $raw = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    $launcherPid = 0
    if ([int]::TryParse([string]$raw, [ref]$launcherPid) -and $launcherPid -gt 0) {
        Write-Host "  停止 $name 启动器 PID $launcherPid（含子进程树）" -ForegroundColor Yellow
        Stop-ProcessTree -OwnerPid $launcherPid
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 1

# ② 兜底：按端口结束仍在监听的进程
foreach ($name in $targets) {
    $port = [int]$servicePorts[$name]
    foreach ($ownerPid in (Get-PortListenerPids -Port $port)) {
        Write-Host "  停止 PID $ownerPid（$name :$port 监听进程）" -ForegroundColor Yellow
        Stop-ProcessTree -OwnerPid $ownerPid
    }
}

Start-Sleep -Seconds 1

# ③ 复查端口是否释放（不放过「以为停了其实没停」）
$stuck = @()
foreach ($name in $targets) {
    $port = [int]$servicePorts[$name]
    if (Test-PortListening -Port $port) {
        foreach ($ownerPid in (Get-PortListenerPids -Port $port)) {
            Write-Host "  端口 $port 仍监听，再次结束 PID $ownerPid" -ForegroundColor Yellow
            Stop-ProcessTree -OwnerPid $ownerPid
        }
        if (-not (Wait-PortFree -Port $port -TimeoutSec 20)) {
            Write-Host "  ! $name 端口 $port 未能释放" -ForegroundColor Red
            Write-Host "    如果该端口由另一个 Windows 账号或更高完整性级别的进程占用，当前身份会收到 Access denied（详情见 taskkill 输出）- 请到启动它的那个终端，或以管理员身份停止。" -ForegroundColor DarkGray
            $stuck += $name
        }
    }
}

# 措辞区分：端口真正释放了才说「已停止」；否则明确说「未完全停止」并非零退出。
if ($stuck.Count -eq 0) {
    if ($Service) {
        Write-Host "$Service 已停止" -ForegroundColor Green
    } else {
        Write-Host "全部目标服务已停止" -ForegroundColor Green
    }
} else {
    $stopped = @($targets | Where-Object { $_ -notin $stuck })
    if ($stopped.Count -gt 0) {
        Write-Host "已停止: $($stopped -join ', ')" -ForegroundColor Yellow
    }
    Write-Host "未完全停止（端口仍被占用）: $($stuck -join ', ')" -ForegroundColor Red
    exit 1
}
