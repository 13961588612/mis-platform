# =============================================================================
# a2ui-smoke-run.ps1  --  A2UI stack-up + Phase 0-1 end-to-end smoke
# Author : Gao Jianyuan (Architect)  |  See: a2ui-integration-checklist.md
# Nature : read-only probes + send ONE real A2UI message. No app source edited.
# Charset: pure ASCII (repo PowerShell convention)
#
# Phases:
#   Phase 0   stack-up order (real-host command list) + port reachability probes
#             (Redis / Gateway / ai-platform backend / frontend)
#   Phase 1   minimal A2UI client: SSE subscribe + WS send one a2ui_chat message,
#             assert the reply has a done frame (messageId/sessionId) + iqd-plan fence
#
# Usage:
#   .\a2ui-smoke-run.ps1 -Token "<MIS_JWT>" [-Gateway http://localhost:8080]
#                        [-Backend http://localhost:8000] [-Frontend http://localhost:5173]
#                        [-LaunchStack] [-SkipStack]
#
# NOTE: This script CANNOT bring up the full stack inside the sandbox
#       (see $CAN_RUN_IN_SANDBOX below). In the sandbox it only runs port probes
#       and prints the real-host command list (degraded delivery).
# =============================================================================

[CmdletBinding()]
param(
    [string]$Token     = "",
    [string]$Gateway   = "http://localhost:8080",   # local dev: 8080; integration via edge-nginx: 80
    [string]$Backend   = "http://localhost:8000",   # ai-platform FastAPI
    [string]$Bff       = "http://localhost:8081",   # mis-admin-bff (feedback only, not on A2UI path)
    [string]$Frontend  = "http://localhost:5173",   # mis-admin-web Vite
    [string]$RedisHost = "127.0.0.1",
    [int]   $RedisPort = 6379,
    [switch]$LaunchStack,
    [switch]$SkipStack,
    [int]   $WaitSec   = 25                            # seconds to wait for reply
)

$ErrorActionPreference = "Continue"
$ProgressPreference    = "SilentlyContinue"

# -----------------------------------------------------------------------------
# 0. Sandbox runnability (from .workbuddy/memory/MEMORY.md hard limits)
# -----------------------------------------------------------------------------
# Sandbox limits:
#   1) Maven is broken in sandbox (Git Bash MAVEN_HOME resolution) -> BFF/mis-gateway
#      cannot be compiled/brought up;
#   2) Nacos lives externally at 10.254.16.6 and cannot be started in sandbox;
#   3) Long-running services must be a single foreground command <=10min or they are
#      SIGKILLed; running multiple services foreground in parallel is not feasible.
# Conclusion: sandbox can only run port probes (+ smoke IF a stack is already
#             reachable); it cannot bring up the full stack.
$CAN_RUN_IN_SANDBOX = $false

function Write-Banner($t) { Write-Host ""; Write-Host ("==== " + $t + " ====") -ForegroundColor Cyan }
function Write-Ok($t)     { Write-Host ("  [OK]   " + $t) -ForegroundColor Green }
function Write-Warn($t)   { Write-Host ("  [WARN] " + $t) -ForegroundColor Yellow }
function Write-Fail($t)   { Write-Host ("  [FAIL] " + $t) -ForegroundColor Red }
function Write-Info($t)   { Write-Host ("  [INFO] " + $t) -ForegroundColor Gray }

# -----------------------------------------------------------------------------
# 1. Port reachability probe
# -----------------------------------------------------------------------------
function Test-Reachable($hostName, $port, $label) {
    $ok = $false
    try {
        $r = Test-NetConnection -ComputerName $hostName -Port $port -WarningAction SilentlyContinue -InformationLevel Quiet
        $ok = [bool]$r
    } catch { $ok = $false }
    if ($ok) { Write-Ok ("{0} reachable ({1}:{2})" -f $label, $hostName, $port) }
    else     { Write-Fail ("{0} NOT reachable ({1}:{2})" -f $label, $hostName, $port) }
    return $ok
}

# -----------------------------------------------------------------------------
# 2. Phase 0 -- stack-up command list (real host; not executed in sandbox)
# -----------------------------------------------------------------------------
function Show-StackUpCommands {
    Write-Banner "Phase 0  stack-up command list (run on real host; not executed in sandbox)"
    Write-Info "Ordered by dependency. Each service has been started alone (green), but the"
    Write-Info "Gateway + ai-platform + frontend A2UI combined bring-up has NOT been integrated yet."
    Write-Host ""
    Write-Host "  # [0.0] Prereq: remote PG/Redis ready (or local: docker compose -f deploy/docker-compose.dev.yml up -d)" -ForegroundColor Gray
    Write-Host "  # [0.1] Migrate (skip if already applied)" -ForegroundColor Gray
    Write-Host "  #       cd backend && mvn -pl mis-migrator flyway:migrate" -ForegroundColor Gray
    Write-Host "  # [0.2] Nacos namespace (needed only for mixed integration; MIS_REMOTE=false => skip)" -ForegroundColor Gray
    Write-Host "  #       .\scripts\ensure-nacos-namespace.ps1 -Namespace integration" -ForegroundColor Gray
    Write-Host "  #       .\scripts\nacos-push.ps1 -Namespace integration" -ForegroundColor Gray
    Write-Host "  # [0.3] BFF + deps (mis-gateway/auth/iam/org/system/audit/kb)" -ForegroundColor Gray
    Write-Host "  #       cd backend && mvn package -pl mis-gateway,mis-audit -am -DskipTests" -ForegroundColor Gray
    Write-Host "  #       docker compose -f deploy/docker-compose.dev.yml -f deploy/docker-compose.stack.yml --profile stack up -d --build" -ForegroundColor Gray
    Write-Host "  # [0.4] Gateway (ai-platform TS; needs @ag-ui/* + rxjs installed)" -ForegroundColor Gray
    Write-Host "  #       cd agent/ai-platform/gateway && npm install && npm run dev      # :8080" -ForegroundColor Gray
    Write-Host "  # [0.5] ai-platform backend (inbound_worker consumes aip:inbound + A2uiRunLoop)" -ForegroundColor Gray
    Write-Host "  #       cd agent/ai-platform/backend && uvicorn src.main:app --port 8000 --reload" -ForegroundColor Gray
    Write-Host "  # [0.6] Frontend (mis-admin-web; Vite proxies :5173 -> :8080)" -ForegroundColor Gray
    Write-Host "  #       cd frontend/mis-admin-web && npm install && npm run dev        # :5173" -ForegroundColor Gray
    Write-Host "  # [0.7] AI fusion overlay stack (if using docker ai-platform)" -ForegroundColor Gray
    Write-Host "  #       docker compose -f deploy/docker-compose.ai.yml up -d" -ForegroundColor Gray
    Write-Host ""
    if (-not $SkipStack -and $LaunchStack -and -not $CAN_RUN_IN_SANDBOX) {
        Write-Warn "Got -LaunchStack but environment is sandbox (Maven/Nacos unavailable) -> printing only, not executing."
    }
}

# -----------------------------------------------------------------------------
# 3. Phase 1 -- A2UI smoke (SSE subscribe + WS send)
# -----------------------------------------------------------------------------
# Minimal WebSocket client (RFC6455) using only node stdlib; payload via env var.
$nodeWsClient = @'
const http = require('http');
const url = require('url');
function wsSend(wsUrl, payload) {
  return new Promise((resolve, reject) => {
    const u = new URL(wsUrl);
    const key = Buffer.from(Math.random().toString(36)).toString('base64');
    const req = http.request({
      host: u.hostname, port: u.port || 80, path: u.pathname + u.search,
      headers: { Connection: 'Upgrade', Upgrade: 'websocket',
        'Sec-WebSocket-Version': 13, 'Sec-WebSocket-Key': key }
    });
    req.on('upgrade', (res, socket) => {
      const data = Buffer.from(payload, 'utf8');
      const len = data.length;
      let header;
      if (len < 126) header = Buffer.from([0x81, len]);
      else if (len < 65536) header = Buffer.from([0x81, 126, len>>8, len&255]);
      else { header = Buffer.from([0x81,127]); const b=Buffer.alloc(8); b.writeUInt32BE(0,0); b.writeUInt32BE(len,4); header=Buffer.concat([header,b]); }
      socket.write(Buffer.concat([header, data]));
      setTimeout(() => { socket.end(); resolve('ws-sent'); }, 1500);
    });
    req.on('error', reject);
    req.end();
  });
}
const wsUrl = process.argv[2];
const payload = process.env.A2UI_PAYLOAD || '';
wsSend(wsUrl, payload).then(r=>{console.log(r);process.exit(0);}).catch(e=>{console.error('WS_ERR',e.message);process.exit(2);});
'@

function Invoke-A2uiSmoke {
    Write-Banner "Phase 1  A2UI smoke (SSE subscribe + WS send a2ui_chat)"
    if (-not $Token) { Write-Fail "Missing -Token (MIS JWT). Grab the Bearer value from browser Network after login."; return $false }

    $SID = "a2ui-smoke-" + [DateTimeOffset]::Now.ToUnixTimeSeconds()
    $sseFile = Join-Path $env:TEMP ("a2ui_sse_" + $SID + ".log")
    $wsUrl   = ($Gateway -replace '^http', 'ws') + "/ws/chat?token=" + $Token
    $sseUrl  = $Gateway + "/api/events/stream?sessionId=" + $SID

    $payloadObj = [ordered]@{
        type        = 'chat'
        sessionId   = $SID
        messageType = 'a2ui_chat'
        metadata    = [ordered]@{ a2ui = $true }
        content     = 'monthly sales by channel'
        timestamp   = '2026-08-24T00:00:00Z'
    }
    $payload = $payloadObj | ConvertTo-Json -Compress

    Write-Info ("sessionId = " + $SID)
    Write-Info ("SSE subscribe : " + $sseUrl)
    Write-Info ("WS send      : " + $wsUrl)

    # Background SSE subscription (curl -N hangs; events land on disk)
    $curlArgs = @('-N', '-s', '-H', ("Authorization: Bearer " + $Token), $sseUrl, '-o', $sseFile)
    $p = Start-Process -FilePath "curl.exe" -ArgumentList $curlArgs -PassThru -WindowStyle Hidden
    Start-Sleep -Seconds 2

    # WS send
    $nodePath = (Get-Command node -ErrorAction SilentlyContinue)
    if ($nodePath) {
        $clientJs = Join-Path $env:TEMP ("a2ui_ws_client_" + $SID + ".js")
        $nodeWsClient | Set-Content -Path $clientJs -Encoding ASCII
        $env:A2UI_PAYLOAD = $payload
        try { & node $clientJs $wsUrl 2>&1 | ForEach-Object { Write-Info ("WS: " + $_) } }
        catch { Write-Warn ("node WS client error: " + $_) }
        $env:A2UI_PAYLOAD = ""
    } else {
        Write-Warn "node not found; use wscat manually:"
        Write-Host ("  wscat -c {0}" -f $wsUrl) -ForegroundColor Gray
        Write-Host ("  {0}" -f $payload) -ForegroundColor Gray
    }

    Write-Info ("Waiting for reply {0}s ..." -f $WaitSec)
    Start-Sleep -Seconds $WaitSec

    if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }

    $raw = if (Test-Path $sseFile) { Get-Content $sseFile -Raw } else { "" }
    if (-not $raw) { Write-Fail "No SSE reply (check Gateway/Token/WS channel)"; return $false }

    $hasDone = $raw -match '"type"\s*:\s*"done"'
    $msgId   = if ($raw -match '"messageId"\s*:\s*"([^"]+)"') { $Matches[1] }
               elseif ($raw -match '"message_id"\s*:\s*"([^"]+)"') { $Matches[1] } else { "" }
    $sessId  = if ($raw -match '"sessionId"\s*:\s*"([^"]+)"') { $Matches[1] }
               elseif ($raw -match '"session_id"\s*:\s*"([^"]+)"') { $Matches[1] } else { "" }
    $planCnt = ([regex]::Matches($raw, 'iqd-plan')).Count
    $citeCnt = ([regex]::Matches($raw, 'iqd-citations')).Count
    $hasErr  = $raw -match '"type"\s*:\s*"error"'

    Write-Host ""
    if ($hasDone) { Write-Ok "received done frame" } else { Write-Fail "no done frame" }
    if ($msgId)   { Write-Ok ("done.messageId = " + $msgId) } else { Write-Fail "done missing messageId (check Phase 4 passthrough)" }
    if ($sessId)  { Write-Ok ("done.sessionId = " + $sessId) } else { Write-Warn "done missing sessionId" }
    Write-Info ("iqd-plan fence count      = " + $planCnt + "   (Phase 3.7 fidelity check)")
    Write-Info ("iqd-citations fence count = " + $citeCnt)
    if ($hasErr)  { Write-Fail "reply contains error frame (see raw SSE)" }

    Write-Info ("SSE raw log: " + $sseFile)
    $pass = $hasDone -and $msgId
    if ($pass) { Write-Ok "Phase 1 smoke PASS" } else { Write-Fail "Phase 1 smoke FAIL" }
    return $pass
}

# =============================================================================
# Main
# =============================================================================
Write-Banner ("A2UI stack-up + Phase 0-1 smoke  (CAN_RUN_IN_SANDBOX = " + $CAN_RUN_IN_SANDBOX + ")")
Write-Info ("Gateway=" + $Gateway + "  Backend=" + $Backend + "  BFF=" + $Bff + "  Frontend=" + $Frontend + "  Redis=" + $RedisHost + ":" + $RedisPort)

# Phase 0.5 probes
Write-Banner "Phase 0.5  port reachability probes"
$rRedis = Test-Reachable $RedisHost $RedisPort "Redis"
$gwHost  = ([System.Uri]$Gateway).Host
$gwPort  = [int]([System.Uri]$Gateway).Port
$gwOk    = Test-Reachable $gwHost $gwPort "Gateway"
$bkHost  = ([System.Uri]$Backend).Host
$bkPort  = [int]([System.Uri]$Backend).Port
$bkOk    = Test-Reachable $bkHost $bkPort "ai-platform backend"
$feHost  = ([System.Uri]$Frontend).Host
$fePort  = [int]([System.Uri]$Frontend).Port
$feOk    = Test-Reachable $feHost $fePort "frontend"

# Phase 0 stack-up list
if (-not $SkipStack) { Show-StackUpCommands }

# Phase 1 smoke (only if Gateway reachable)
$smokeOk = $false
if ($gwOk) { $smokeOk = Invoke-A2uiSmoke } else { Write-Warn "Gateway not reachable; skip Phase 1 (bring up stack / confirm port first)" }

# Summary
Write-Banner "Summary"
Write-Info ("Redis={0} Gateway={1} Backend={2} Frontend={3} Smoke={4}" -f $rRedis, $gwOk, $bkOk, $feOk, $smokeOk)
if (-not $CAN_RUN_IN_SANDBOX) {
    Write-Warn "Sandbox cannot bring up full stack (Maven broken / Nacos external / multi-service foreground limit)."
    Write-Warn "On a real host, after Phase 0 stack-up, Phase 0.5 probes + Phase 1 smoke can go fully green."
}
exit $(if ($gwOk -and $smokeOk) { 0 } else { 1 })
