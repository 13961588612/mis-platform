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

Write-Host "正在停止后端服务 ..." -ForegroundColor Cyan

$procs = Get-CimInstance Win32_Process |
    Where-Object {
        $_.Name -in @('java.exe', 'powershell.exe', 'pwsh.exe') -and
        (Test-MatchesTarget -CommandLine $_.CommandLine -Names $targets)
    }

if (-not $procs) {
    Write-Host "未找到匹配进程: $($targets -join ', ')" -ForegroundColor Yellow
    exit 0
}

foreach ($p in $procs) {
    $preview = if ($p.CommandLine -and $p.CommandLine.Length -gt 100) {
        $p.CommandLine.Substring(0, 100) + '...'
    } else {
        $p.CommandLine
    }
    Write-Host "  停止 PID $($p.ProcessId) [$($p.Name)] $preview" -ForegroundColor Yellow
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 1

$left = Get-CimInstance Win32_Process -Filter "Name='java.exe'" |
    Where-Object { Test-MatchesTarget -CommandLine $_.CommandLine -Names $targets }

if ($left) {
    Write-Host "仍有残留，再次结束..." -ForegroundColor Yellow
    $left | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

if ($Service) {
    Write-Host "$Service 已停止" -ForegroundColor Green
} else {
    Write-Host "全部目标服务已停止" -ForegroundColor Green
}
