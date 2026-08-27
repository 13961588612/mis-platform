# recon 前后端停止脚本
# 用法:
#   .\stop-dev.ps1            # 停止全部（后端 + 前端）
#   .\stop-dev.ps1 backend    # 仅停止后端
#   .\stop-dev.ps1 frontend   # 仅停止前端
param(
    [Parameter(Position = 0)]
    [string]$Target = 'all'
)

# Windows PowerShell 5.1：脚本须带 UTF-8 BOM；并设置控制台 UTF-8，避免中文乱码
if ($PSVersionTable.PSVersion.Major -lt 6) {
    try {
        chcp 65001 | Out-Null
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        $OutputEncoding = [System.Text.Encoding]::UTF8
    } catch {}
}

function Stop-PortProcess {
    param([int]$Port, [string]$Label)
    $conns = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if ($conns.Count -eq 0) {
        Write-Host "  - $Label :$Port 未监听，无需停止" -ForegroundColor DarkGray
        return
    }
    foreach ($c in $conns) {
        try {
            Stop-Process -Id $c.OwningProcess -Force -ErrorAction Stop
            Write-Host "  ok 已停止 $Label（PID $($c.OwningProcess)）" -ForegroundColor Green
        } catch {
            Write-Host "  x 停止 $Label 失败: $($_.Exception.Message)" -ForegroundColor Red
        }
    }
}

$wantAll = $Target -eq 'all'
$stopBackend  = $wantAll -or $Target -eq 'backend'
$stopFrontend = $wantAll -or $Target -eq 'frontend'

Write-Host '正在停止 recon 服务...' -ForegroundColor Cyan
if ($stopBackend)  { Stop-PortProcess -Port 8110 -Label 'recon-service(8110)' }
if ($stopFrontend) { Stop-PortProcess -Port 5176 -Label 'recon-admin-web(5176)' }

Write-Host ''
Write-Host '停止完成（若残留空白 PowerShell 窗口，可手动关闭）' -ForegroundColor Cyan
