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

function Test-MatchesTarget {
    param([string]$CommandLine, [string[]]$Names)
    if (-not $CommandLine) { return $false }
    foreach ($name in $Names) {
        if (
            $CommandLine -match ("-pl\s+" + [regex]::Escape($name)) -or
            $CommandLine -match ("\\" + [regex]::Escape($name) + "\\") -or
            $CommandLine -match ("/" + [regex]::Escape($name) + "/")
        ) {
            return $true
        }
    }
    return $false
}

function Stop-ProcessTree {
    param([int]$ProcessId)
    try {
        # /T 结束子进程树，避免只杀 powershell 留下 orphan java 占端口
        & taskkill.exe /PID $ProcessId /T /F 2>$null | Out-Null
    } catch {
        Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Test-PortListening {
    param([int]$Port)
    $c = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    return ($c.Count -gt 0)
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

Write-Host "正在停止后端服务 ..." -ForegroundColor Cyan

$procs = Get-CimInstance Win32_Process |
    Where-Object {
        $_.Name -in @('java.exe', 'powershell.exe', 'pwsh.exe', 'cmd.exe') -and
        (Test-MatchesTarget -CommandLine $_.CommandLine -Names $targets)
    }

if (-not $procs) {
    Write-Host "未找到匹配进程: $($targets -join ', ')" -ForegroundColor Yellow
} else {
    # 先停监听端口的 java，再清包装进程，减少 Address already in use
    $ordered = $procs | Sort-Object {
        if ($_.Name -eq 'java.exe' -and $_.CommandLine -match 'TieredStopAtLevel|target\\classes') { 0 }
        elseif ($_.Name -eq 'java.exe') { 1 }
        else { 2 }
    }

    foreach ($p in $ordered) {
        $preview = if ($p.CommandLine -and $p.CommandLine.Length -gt 100) {
            $p.CommandLine.Substring(0, 100) + '...'
        } else {
            $p.CommandLine
        }
        Write-Host "  停止 PID $($p.ProcessId) [$($p.Name)] $preview" -ForegroundColor Yellow
        Stop-ProcessTree -ProcessId $p.ProcessId
    }
}

Start-Sleep -Seconds 1

$left = Get-CimInstance Win32_Process |
    Where-Object {
        $_.Name -in @('java.exe', 'powershell.exe', 'pwsh.exe', 'cmd.exe') -and
        (Test-MatchesTarget -CommandLine $_.CommandLine -Names $targets)
    }
if ($left) {
    Write-Host "仍有残留，再次结束..." -ForegroundColor Yellow
    $left | ForEach-Object { Stop-ProcessTree -ProcessId $_.ProcessId }
    Start-Sleep -Seconds 1
}

foreach ($name in $targets) {
    $port = [int]$servicePorts[$name]
    if (Test-PortListening -Port $port) {
        # 端口仍被占：按端口杀监听进程（防止匹配漏掉）
        $owners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique)
        foreach ($opid in $owners) {
            Write-Host "  端口 $port 仍监听，结束 PID $opid" -ForegroundColor Yellow
            Stop-ProcessTree -ProcessId $opid
        }
        if (-not (Wait-PortFree -Port $port -TimeoutSec 20)) {
            Write-Host "  ! $name 端口 $port 未能释放" -ForegroundColor Red
        }
    }
}

if ($Service) {
    Write-Host "$Service 已停止" -ForegroundColor Green
} else {
    Write-Host "全部目标服务已停止" -ForegroundColor Green
}
