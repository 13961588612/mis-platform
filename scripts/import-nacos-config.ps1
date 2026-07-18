# 兼容旧命令，转发到 nacos-push.ps1
param(
    [string]$Namespace = "test",
    [string]$Group = "MIS_GROUP",
    [string]$NacosServer = "http://localhost:8848",
    [string]$Username = "nacos",
    [string]$Password = "nacos",
    [string]$SourceDir = ""
)

if ($SourceDir) {
    Write-Warning "SourceDir is deprecated; use deploy/nacos-config/$Namespace/ instead."
}

& (Join-Path $PSScriptRoot "nacos-push.ps1") `
    -Namespace $Namespace `
    -Group $Group `
    -NacosServer $NacosServer `
    -Username $Username `
    -Password $Password
