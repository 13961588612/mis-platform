# MIS Platform — 本地开发一键初始化（Windows PowerShell）
# 用法: .\scripts\init-dev.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$ComposeFile = Join-Path $Root "deploy\docker-compose.dev.yml"
$BackendDir = Join-Path $Root "backend"

function Test-Command($Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Wait-PostgresReady {
    param([int]$MaxSeconds = 90)
    $elapsed = 0
    Write-Host "等待 PostgreSQL 就绪..." -ForegroundColor Cyan
    while ($elapsed -lt $MaxSeconds) {
        docker exec mis-postgres pg_isready -U postgres -d mis_platform 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "PostgreSQL 已就绪" -ForegroundColor Green
            return
        }
        Start-Sleep -Seconds 3
        $elapsed += 3
    }
    throw "PostgreSQL 在 ${MaxSeconds}s 内未就绪，请检查: docker logs mis-postgres"
}

Write-Host "=== MIS Platform 本地初始化 ===" -ForegroundColor Yellow
Write-Host "仓库根目录: $Root"

if (-not (Test-Command docker)) {
    Write-Error "未找到 docker，请先安装 Docker Desktop"
}
$composeV2 = Test-Command "docker"
docker compose version 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Error "需要 Docker Compose v2（docker compose）"
}

Write-Host "`n[1/3] 启动基础设施..." -ForegroundColor Cyan
Push-Location $Root
try {
    docker compose -f $ComposeFile up -d
    if ($LASTEXITCODE -ne 0) { throw "docker compose up 失败" }
}
finally {
    Pop-Location
}

Wait-PostgresReady

Write-Host "`n[2/3] Flyway 迁移..." -ForegroundColor Cyan
if (-not (Test-Command mvn)) {
    Write-Warning "未找到 mvn，跳过 Flyway。请安装 JDK 17 + Maven 后执行:"
    Write-Host "  cd backend" -ForegroundColor Gray
    Write-Host "  mvn -pl mis-migrator flyway:migrate" -ForegroundColor Gray
}
else {
    Push-Location $BackendDir
    try {
        mvn -pl mis-migrator flyway:migrate
        if ($LASTEXITCODE -ne 0) { throw "Flyway migrate 失败" }
        Write-Host "Flyway 迁移完成" -ForegroundColor Green
    }
    finally {
        Pop-Location
    }
}

Write-Host "`n[3/3] 完成" -ForegroundColor Green
Write-Host @"

基础设施:
  PostgreSQL  localhost:5432  mis / mis123  db=mis_platform
  Redis       localhost:6379
  Nacos       http://localhost:8848/nacos  (nacos/nacos)
  MinIO       http://localhost:9001        (minioadmin/minioadmin)

默认账号（须首次改密）:
  superadmin / Mis@123456
  admin      / Mis@123456  (app=system)

下一步: 在 IDE 启动 Java 微服务，或执行 mvn -pl mis-migrator flyway:info 查看迁移状态
"@
