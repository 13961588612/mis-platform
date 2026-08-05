# =============================================================================
# 用 DBA 账号在远端 PostgreSQL 创建 mis 用户与 mis_platform 库
# =============================================================================
# 依赖：本机已安装 psql（PostgreSQL 客户端），并加入 PATH。
#
# 示例：
#   .\scripts\init-mis-platform-db.ps1 `
#     -DbHost 10.254.16.6 -Port 5432 `
#     -AdminUser postgres -AdminPassword '***' `
#     -MisPassword 'mis123'
#
# 可选：-MisUser / -Database 覆盖默认名；-SkipIfExists 已存在则跳过并成功退出。
# =============================================================================

param(
    [Parameter(Mandatory = $true)]
    [Alias("Host")]
    [string]$DbHost,

    [int]$Port = 5432,

    [Parameter(Mandatory = $true)]
    [string]$AdminUser,

    [Parameter(Mandatory = $true)]
    [string]$AdminPassword,

    [Parameter(Mandatory = $true)]
    [string]$MisPassword,

    [string]$MisUser = "mis",
    [string]$Database = "mis_platform",
    [string]$AdminDatabase = "postgres",
    [switch]$SkipIfExists
)

$ErrorActionPreference = "Stop"

function Test-Psql {
    $cmd = Get-Command psql -ErrorAction SilentlyContinue
    if (-not $cmd) {
        Write-Error @"
未找到 psql。请先安装 PostgreSQL 客户端并加入 PATH，例如：
  winget install PostgreSQL.PostgreSQL.16
  或仅安装 Command Line Tools，将 bin 目录加入 PATH。
"@
    }
}

function Escape-SqlLiteral([string]$value) {
    return ($value -replace "'", "''")
}

Test-Psql

$env:PGPASSWORD = $AdminPassword
$misPassEsc = Escape-SqlLiteral $MisPassword

Write-Host "Connecting ${DbHost}:${Port} as $AdminUser → create role/db $MisUser / $Database" -ForegroundColor Cyan

$existsSql = @"
SELECT
  EXISTS(SELECT 1 FROM pg_roles WHERE rolname = '$MisUser') AS role_exists,
  EXISTS(SELECT 1 FROM pg_database WHERE datname = '$Database') AS db_exists;
"@

$existsOut = & psql -h $DbHost -p $Port -U $AdminUser -d $AdminDatabase -v ON_ERROR_STOP=1 -t -A -F '|' -c $existsSql
if ($LASTEXITCODE -ne 0) {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    exit $LASTEXITCODE
}

$parts = ($existsOut | Select-Object -First 1).Trim().Split('|')
$roleExists = ($parts[0] -eq 't')
$dbExists = ($parts[1] -eq 't')

if ($roleExists -and $dbExists) {
    if ($SkipIfExists) {
        Write-Host "Already exists: role=$MisUser db=$Database (SkipIfExists) — OK" -ForegroundColor Green
        Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
        exit 0
    }
    Write-Error "role '$MisUser' and database '$Database' already exist. Use -SkipIfExists to ignore, or drop them first."
}

$createRoleSql = if (-not $roleExists) {
    "CREATE USER $MisUser WITH PASSWORD '$misPassEsc';"
} else {
    Write-Host "Role $MisUser already exists — skip CREATE USER" -ForegroundColor Yellow
    "SELECT 1;"
}

$createDbSql = if (-not $dbExists) {
    "CREATE DATABASE $Database OWNER $MisUser;"
} else {
    Write-Host "Database $Database already exists — skip CREATE DATABASE" -ForegroundColor Yellow
    "SELECT 1;"
}

$bootstrapSql = @"
$createRoleSql
$createDbSql
GRANT ALL PRIVILEGES ON DATABASE $Database TO $MisUser;
"@

& psql -h $DbHost -p $Port -U $AdminUser -d $AdminDatabase -v ON_ERROR_STOP=1 -c $bootstrapSql
if ($LASTEXITCODE -ne 0) {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    exit $LASTEXITCODE
}

$schemaSql = @"
GRANT ALL ON SCHEMA public TO $MisUser;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $MisUser;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $MisUser;
"@

& psql -h $DbHost -p $Port -U $AdminUser -d $Database -v ON_ERROR_STOP=1 -c $schemaSql
$exitCode = $LASTEXITCODE
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue

if ($exitCode -ne 0) {
    exit $exitCode
}

Write-Host @"

Done.
  Host:     ${DbHost}:${Port}
  Database: $Database
  User:     $MisUser

Next (Flyway — use -Ddb.* , NOT DB_HOST env):
  cd backend
  .\mvn.ps1 -pl mis-migrator flyway:migrate ``
    "-Ddb.host=$DbHost" "-Ddb.port=$Port" "-Ddb.name=$Database" ``
    "-Ddb.user=$MisUser" "-Ddb.password=<mis密码>"
"@ -ForegroundColor Green
