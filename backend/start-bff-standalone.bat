@echo off
setlocal EnableExtensions
REM ============================================================================
REM  mis-admin-bff standalone launcher (persistent, detached from caller shell)
REM ----------------------------------------------------------------------------
REM  Gateway routes /api/v1/** to lb://mis-admin-bff via Nacos discovery
REM  (namespace=integration, group=MIS_GROUP). BFF must register to Nacos with a
REM  healthy heartbeat, otherwise the gateway logs
REM  "No servers available for service: mis-admin-bff" and returns 503.
REM  This script builds the latest jar (keeps uncommitted chat-timeout 180s and
REM  other workspace changes) then launches java detached via `start /b`, so the
REM  process survives even after the launching shell exits.
REM ----------------------------------------------------------------------------
REM  Usage (run from anywhere):
REM    start-bff-standalone.bat          -> build + launch
REM    start-bff-standalone.bat nopkg    -> skip build, launch existing jar
REM ============================================================================

cd /d D:\code\mis-platform\backend
set ROOT=D:\code\mis-platform
set JAVA_HOME=D:\software\jdk-17.0.2
set PATH=D:\software\jdk-17.0.2\bin;%PATH%
set MAVEN=D:\software\apache-maven-3.9.16\bin\mvn.cmd

REM ---- Override host-injected SERVER__PORT=20231. Spring relaxed binding maps
REM ---- SERVER__PORT to server.port; 20231 is occupied by the host process and
REM ---- would make Spring Boot fail to start.
set SERVER_PORT=8081
set SERVER__PORT=8081

REM ---- Integration environment (same as .env.integration)
set MIS_REMOTE=true
set NACOS_SERVER=10.254.16.6:8848
set NACOS_NAMESPACE=integration
set NACOS_CONFIG_GROUP=MIS_GROUP
set DB_HOST=10.254.16.6
set DB_PORT=5432
set DB_NAME=mis_platform
set DB_USER=mis
set DB_PASSWORD=mis123
set REDIS_HOST=10.254.16.6
set REDIS_PORT=6379
set JWT_PRIVATE_KEY_PATH=%ROOT%\backend\keys\private.pem
set JWT_PUBLIC_KEY_PATH=%ROOT%\backend\keys\public.pem
REM Force UTF-8 for the child JVM so Nacos YAML with Chinese comments parses
REM correctly (Windows default GBK breaks it). Same as start-dev.ps1.
if "%JAVA_TOOL_OPTIONS%"=="" (
  set JAVA_TOOL_OPTIONS=-Dfile.encoding=UTF-8
) else (
  echo %JAVA_TOOL_OPTIONS% | findstr /i "file.encoding" >nul
  if errorlevel 1 set JAVA_TOOL_OPTIONS=%JAVA_TOOL_OPTIONS% -Dfile.encoding=UTF-8
)

echo [1/3] env ready: JAVA_HOME=%JAVA_HOME% NACOS=%NACOS_SERVER%/%NACOS_NAMESPACE% SERVER_PORT=%SERVER_PORT%

if /I "%~1"=="nopkg" goto :launch

echo [2/3] building latest jar (mis-admin-bff + dependency modules, tests skipped) ...
call "%MAVEN%" -pl mis-admin-bff -am package -DskipTests
if errorlevel 1 (
  echo [FAIL] Maven build failed. Uncommitted workspace changes are untouched.
  exit /b 1
)

:launch
set JAR=%ROOT%\backend\mis-admin-bff\target\mis-admin-bff-0.1.0-SNAPSHOT.jar
if not exist "%JAR%" (
  echo [FAIL] jar not found: %JAR%. Run without nopkg to build first.
  exit /b 1
)

echo [3/3] launching BFF detached -> %JAR% ...
REM start /b decouples the process from the launching shell; output goes to log
start "mis-admin-bff" /b "%JAVA_HOME%\bin\java.exe" -jar "%JAR%" > "%ROOT%\backend\bff-run.log" 2>&1
echo launch issued. log: %ROOT%\backend\bff-run.log
echo acceptance checks (run after ~30-60s):
echo   curl -s -o /dev/null -w "%%{http_code}" http://localhost:8081/actuator/health          expect 200
echo   curl "http://10.254.16.6:8848/nacos/v1/ns/instance/list?serviceName=mis-admin-bff^&namespaceId=integration"   expect hosts non-empty healthy=true
echo   login (admin / Mis@123456 + captcha) then GET http://localhost:8080/api/v1/agent-ops/agents with Bearer token -> expect HTTP 200 code:0 with agent data
exit /b 0
