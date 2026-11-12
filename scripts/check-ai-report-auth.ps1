#Requires -Version 5.1
param(
    [string]$Token = $(if ($env:MIS_JWT) { $env:MIS_JWT } else {
        "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIiwiYXBwSWQiOjEsInBlcm1WZXJzaW9uIjoxNSwicm9sZXMiOlsiVEVOQU5UX0FETUlOIl0sImlzcyI6Im1pcy1wbGF0Zm9ybSIsInRlbmFudElkIjoxLCJlbXBsb3llZUlkIjoxLCJleHAiOjE3OTM4NTQyOTMsImlhdCI6MTc5Mzg0NzA5MywianRpIjoiZTBlN2Q1MWYtOWI3MS00OGEwLWJiMWEtZTMwZTdhZjg0Y2RhIiwidXNlcm5hbWUiOiJhZG1pbiJ9.C8kOy4UMNxjjBAMpJIP0jhGl8q-9Ad0OoHykSn2ABKkXpCUeKnDhZWYb9_-8DhfiTWEHvtXxwYGE32tovjxsCWkDdlTOabXJyf6t4ZK8dc6hebSkkEzweFpRABoOvabFzx9cE9GzB-Ufq1rujY5dr9yIHpDK9llUzLWMPAHSGxXnPABwJ3U0T1dK7yFVdO2_iflfhiC5EqU5moU_8rr1dQKWVBPDkeBY3rku74C7KIqu68YL_SHLp2zem4JuOQGgBcqBJQp6gujq4fdt0rK4SkPKYJWO3BZdvmcrjuOfAEyJ4kXl7o4zN5jadgnXCxusx79qDonsRxdp7pp3jloySA"
    }),
    [string]$PortalBase = "http://10.254.26.34",
    [string]$BffBase = "http://10.254.26.33:8081",
    [int]$TimeoutSec = 15
)

$ErrorActionPreference = "Continue"

if ([string]::IsNullOrWhiteSpace($Token)) {
    Write-Host "ERROR: pass -Token or set MIS_JWT"
    exit 2
}

function Decode-JwtPayload {
    param([string]$jwt)
    $parts = $jwt.Split(".")
    if ($parts.Count -lt 2) { return $null }
    $p = $parts[1].Replace("-", "+").Replace("_", "/")
    $mod = $p.Length % 4
    if ($mod -eq 2) { $p = $p + "==" }
    elseif ($mod -eq 3) { $p = $p + "=" }
    $bytes = [Convert]::FromBase64String($p)
    $json = [Text.Encoding]::UTF8.GetString($bytes)
    return ($json | ConvertFrom-Json)
}

function Invoke-Check {
    param([string]$Name, [string]$Url)
    $sw = [Diagnostics.Stopwatch]::StartNew()
    try {
        $resp = Invoke-WebRequest -Uri $Url -Headers $script:headers -UseBasicParsing -TimeoutSec $TimeoutSec
        $sw.Stop()
        $body = $resp.Content | ConvertFrom-Json
        $code = $body.code
        $msg = [string]$body.message
        $ok = ($code -eq 0 -or "$code" -eq "0")
        $color = if ($ok) { "Green" } else { "Yellow" }
        Write-Host ("[{0}] HTTP {1} biz={2} msg={3} ({4}ms)" -f $Name, [int]$resp.StatusCode, $code, $msg, $sw.ElapsedMilliseconds) -ForegroundColor $color
        Write-Host ("         {0}" -f $Url)
        if ($Name -match "auth/me" -and $ok -and $null -ne $body.data) {
            $perms = @($body.data.permissions)
            foreach ($p in @("ai-report:view", "ai:chat:use", "ai-report:save")) {
                $has = $perms -contains $p
                $c = if ($has) { "Green" } else { "DarkYellow" }
                Write-Host ("         perm {0} = {1}" -f $p, $has) -ForegroundColor $c
            }
            Write-Host ("         user={0} roles={1} permCount={2}" -f $body.data.username, (($body.data.roles) -join ","), $perms.Count)
        }
        if ($Name -match "catalog" -and $ok -and $null -ne $body.data) {
            $groups = @($body.data)
            $n = 0
            foreach ($g in $groups) { $n += @($g.reports).Count }
            Write-Host ("         groups={0} reports={1}" -f $groups.Count, $n)
        }
        return [pscustomobject]@{ Name = $Name; Url = $Url; Code = $code; Ok = [bool]$ok }
    }
    catch {
        $sw.Stop()
        $detail = $_.Exception.Message
        $biz = $null
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
            $raw = $_.ErrorDetails.Message
            try {
                $j = $raw | ConvertFrom-Json
                $biz = $j.code
                $detail = ("biz={0} msg={1}" -f $j.code, $j.message)
            }
            catch {
                $detail = $raw
            }
        }
        Write-Host ("[{0}] FAIL {1} ({2}ms)" -f $Name, $detail, $sw.ElapsedMilliseconds) -ForegroundColor Red
        Write-Host ("         {0}" -f $Url)
        return [pscustomobject]@{ Name = $Name; Url = $Url; Code = $biz; Ok = $false }
    }
}

Write-Host "======== JWT payload ========" -ForegroundColor Cyan
$claims = Decode-JwtPayload -jwt $Token
if ($null -ne $claims) {
    $iat = [DateTimeOffset]::FromUnixTimeSeconds([int64]$claims.iat).UtcDateTime.ToString("u")
    $exp = [DateTimeOffset]::FromUnixTimeSeconds([int64]$claims.exp).UtcDateTime.ToString("u")
    $now = [DateTime]::UtcNow.ToString("u")
    Write-Host ("sub={0} username={1} roles={2}" -f $claims.sub, $claims.username, (($claims.roles) -join ","))
    Write-Host ("iat={0} exp={1} now={2}" -f $iat, $exp, $now)
    if ([DateTime]::UtcNow -gt [DateTimeOffset]::FromUnixTimeSeconds([int64]$claims.exp).UtcDateTime) {
        Write-Host "WARNING: token expired" -ForegroundColor Red
    }
}
else {
    Write-Host "cannot decode JWT" -ForegroundColor Red
}

$script:headers = @{
    Authorization = ("Bearer {0}" -f $Token)
    Accept        = "application/json"
}

$targets = @(
    @{ Name = "portal auth/me"; Url = ($PortalBase + "/api/v1/auth/me") },
    @{ Name = "portal catalog"; Url = ($PortalBase + "/api/v1/ai-reports/catalog") },
    @{ Name = "portal defs"; Url = ($PortalBase + "/api/v1/ai-reports/defs") },
    @{ Name = "bff auth/me"; Url = ($BffBase + "/api/v1/auth/me") },
    @{ Name = "bff catalog"; Url = ($BffBase + "/api/v1/ai-reports/catalog") },
    @{ Name = "bff defs"; Url = ($BffBase + "/api/v1/ai-reports/defs") },
    @{ Name = "bff local me"; Url = "http://127.0.0.1:8081/api/v1/auth/me" },
    @{ Name = "bff local catalog"; Url = "http://127.0.0.1:8081/api/v1/ai-reports/catalog" }
)

Write-Host ""
Write-Host "======== probes ========" -ForegroundColor Cyan
$results = @()
foreach ($t in $targets) {
    $results += Invoke-Check -Name $t.Name -Url $t.Url
}

Write-Host ""
Write-Host "======== verdict ========" -ForegroundColor Cyan
$portalOk = @($results | Where-Object { $_.Name -like "portal*" -and $_.Ok }).Count -ge 2
$bffOk = @($results | Where-Object { $_.Name -like "bff *" -and $_.Name -notlike "*local*" -and $_.Ok }).Count -ge 1
$bff401 = @($results | Where-Object { $_.Name -like "bff *" -and $_.Code -eq 40100 }).Count -ge 1
$bff403 = @($results | Where-Object { $_.Name -like "bff *" -and $_.Code -eq 40300 }).Count -ge 1

if ($portalOk -and $bff401) {
    Write-Host "Portal OK, BFF direct 401: gateway accepts JWT but direct BFF signature fails / wrong instance." -ForegroundColor Yellow
    Write-Host "Set Agent MIS_ADMIN_BFF_BASE_URL to the BFF:8081 that verifies this JWT (usually http://127.0.0.1:8081 on S1). Do NOT point it to portal .34." -ForegroundColor Yellow
}
elseif ($portalOk -and $bff403) {
    Write-Host "BFF authenticated but 403: check ai-report:view / ai:chat:use and V160/V161 bindings." -ForegroundColor Yellow
}
elseif ($portalOk -and $bffOk) {
    Write-Host "Portal and BFF direct both OK. Agent catalog errors likely missing mis_upstream_jwt or wrong URL in process env." -ForegroundColor Green
}
elseif (-not $portalOk) {
    Write-Host "Portal failed first: refresh login / check gateway." -ForegroundColor Red
}
else {
    Write-Host "See probe lines above. 127.0.0.1:8081 only meaningful on S1." -ForegroundColor DarkYellow
}

Write-Host ""
Write-Host "Done."
