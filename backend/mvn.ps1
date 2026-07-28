# 使用 JAVA_HOME_17 运行 Maven（Spring Boot 3 插件需 JDK 17+ 作为 Maven 运行时）
# 勿将参数命名为 $Args（与 PowerShell 自动变量冲突，易把多参数拼成一个）
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$MavenArgs
)

if (-not $env:JAVA_HOME_17) {
    Write-Error "JAVA_HOME_17 未设置，请先配置 JDK 17 路径"
    exit 1
}

$env:JAVA_HOME = $env:JAVA_HOME_17
& mvn @MavenArgs
exit $LASTEXITCODE
