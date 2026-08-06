# =============================================================================
# Create aiplatform role + ai_platform database (Agent / ai-platform)
# =============================================================================
# Requires: psql on PATH. Mirrors deploy/postgres/init/02-create-ai-platform.sql
#
# Example:
#   .\scripts\init-ai-platform-db.ps1 `
#     -DbHost 10.254.16.6 -Port 5432 `
#     -AdminUser postgres -AdminPassword '***' `
#     -AiPassword 'aiplatform_dev_password'
#
# Optional: -AiUser / -Database / -SkipIfExists
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
    [string]$AiPassword,

    [string]$AiUser = "aiplatform",
    [string]$Database = "ai_platform",
    [string]$AdminDatabase = "postgres",
    [switch]$SkipIfExists
)

$ErrorActionPreference = "Stop"

function Test-Psql {
    $cmd = Get-Command psql -ErrorAction SilentlyContinue
    if (-not $cmd) {
        Write-Error @"
psql not found. Install PostgreSQL client and add it to PATH, e.g.:
  winget install PostgreSQL.PostgreSQL.16
"@
    }
}

function Escape-SqlLiteral([string]$value) {
    return ($value -replace "'", "''")
}

Test-Psql

$env:PGPASSWORD = $AdminPassword
$aiPassEsc = Escape-SqlLiteral $AiPassword

Write-Host "Connecting ${DbHost}:${Port} as $AdminUser -> create role/db $AiUser / $Database" -ForegroundColor Cyan

$existsSql = @"
SELECT
  EXISTS(SELECT 1 FROM pg_roles WHERE rolname = '$AiUser') AS role_exists,
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
        Write-Host "Already exists: role=$AiUser db=$Database (SkipIfExists) - OK" -ForegroundColor Green
        Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
        exit 0
    }
    Write-Error "role '$AiUser' and database '$Database' already exist. Use -SkipIfExists to ignore, or drop them first."
}

$createRoleSql = if (-not $roleExists) {
    "CREATE ROLE $AiUser WITH LOGIN PASSWORD '$aiPassEsc';"
} else {
    Write-Host "Role $AiUser already exists - skip CREATE ROLE" -ForegroundColor Yellow
    "SELECT 1;"
}

$createDbSql = if (-not $dbExists) {
    "CREATE DATABASE $Database OWNER $AiUser;"
} else {
    Write-Host "Database $Database already exists - skip CREATE DATABASE" -ForegroundColor Yellow
    "SELECT 1;"
}

$bootstrapSql = @"
$createRoleSql
$createDbSql
GRANT ALL PRIVILEGES ON DATABASE $Database TO $AiUser;
"@

& psql -h $DbHost -p $Port -U $AdminUser -d $AdminDatabase -v ON_ERROR_STOP=1 -c $bootstrapSql
if ($LASTEXITCODE -ne 0) {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    exit $LASTEXITCODE
}

$schemaSql = @"
GRANT ALL ON SCHEMA public TO $AiUser;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $AiUser;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $AiUser;
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
  User:     $AiUser

Next (Agent Core .env):
  D:\code\mis-platform\agent\ai-platform\backend\.env
    POSTGRES_HOST=$DbHost
    POSTGRES_PORT=$Port
    POSTGRES_DB=$Database
    POSTGRES_USER=$AiUser
    POSTGRES_PASSWORD=<ai password>

Then run Alembic migrations from agent/ai-platform/backend (see project docs).
"@ -ForegroundColor Green
