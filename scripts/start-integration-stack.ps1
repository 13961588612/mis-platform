# MIS Platform — 混合联调栈启动（Windows）
# 用法: .\scripts\start-integration-stack.ps1 [-WithAuthContainer]

param(
    [switch]$WithAuthContainer,
    [switch]$SkipBuild,
    [switch]$SkipMigrate
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$ComposeInfra = Join-Path $Root "deploy\docker-compose.dev.yml"
$ComposeStack = Join-Path $Root "deploy\docker-compose.stack.yml"
$BackendDir = Join-Path $Root "backend"
$KeysDir = Join-Path $BackendDir "keys"

function Test-Command($Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

Write-Host "=== MIS Integration Stack ===" -ForegroundColor Yellow

if (-not (Test-Path (Join-Path $KeysDir "private.pem"))) {
    Write-Error "缺少 JWT 密钥: $KeysDir\private.pem。见 backend/mis-auth/README.md"
}

Write-Host "`n[1/5] 启动基础设施..." -ForegroundColor Cyan
Push-Location $Root
docker compose -f $ComposeInfra up -d
if ($LASTEXITCODE -ne 0) { throw "基础设施启动失败" }

Write-Host "等待 PostgreSQL..." -ForegroundColor Cyan
$elapsed = 0
while ($elapsed -lt 90) {
    docker exec mis-postgres pg_isready -U postgres 2>$null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 3
    $elapsed += 3
}

if (-not $SkipMigrate -and (Test-Command mvn)) {
    Write-Host "`n[2/5] Flyway 迁移..." -ForegroundColor Cyan
    Push-Location $BackendDir
    if (Test-Path ".\mvn.ps1") { .\mvn.ps1 -pl mis-migrator flyway:migrate -q }
    else { mvn -pl mis-migrator flyway:migrate -q }
    Pop-Location
} else {
    Write-Host "`n[2/5] 跳过 Flyway" -ForegroundColor Gray
}

Write-Host "`n[3/5] 创建 Nacos 命名空间 integration..." -ForegroundColor Cyan
& (Join-Path $PSScriptRoot "ensure-nacos-namespace.ps1") -Namespace integration

Write-Host "`n[4/5] 推送 Nacos 配置..." -ForegroundColor Cyan
& (Join-Path $PSScriptRoot "nacos-push.ps1") -Namespace integration

if (-not $SkipBuild) {
    Write-Host "`n[5/5] 构建并启动稳定服务容器..." -ForegroundColor Cyan
    Push-Location $BackendDir
    if (Test-Path ".\mvn.ps1") {
        .\mvn.ps1 package -pl mis-gateway,mis-audit -am -DskipTests -q
        if ($WithAuthContainer) {
            .\mvn.ps1 package -pl mis-auth -am -DskipTests -q
        }
    } else {
        mvn package -pl mis-gateway,mis-audit -am -DskipTests -q
        if ($WithAuthContainer) { mvn package -pl mis-auth -am -DskipTests -q }
    }
    Pop-Location
} else {
    Write-Host "`n[5/5] 跳过 Maven 构建（-SkipBuild）" -ForegroundColor Gray
}

$profiles = if ($WithAuthContainer) { "stack-full" } else { "stack" }
docker compose -f $ComposeInfra -f $ComposeStack --profile $profiles up -d --build
if ($LASTEXITCODE -ne 0) { throw "稳定服务栈启动失败" }
Pop-Location

Write-Host @"

完成。

  Gateway     http://localhost:8080
  Nacos       http://localhost:8848/nacos  (namespace: integration)
  默认栈      mis-gateway + mis-audit（未起 mis-auth 容器，便于 IDE 调试 auth）

IDE 启动被测服务:
  环境变量见: deploy/ide/mis-auth-integration.env
  关键: MIS_REMOTE=true, NACOS_REGISTER_IP=host.docker.internal

集成测试:
  `$env:MIS_INTEGRATION_TEST='true'
  cd backend; .\mvn.ps1 test -pl mis-auth -Dtest=AuthFlowIntegrationTest

"@ -ForegroundColor Green
