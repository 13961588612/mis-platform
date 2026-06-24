# 使用 JAVA_HOME_17 运行 Maven（Spring Boot 3 插件需 JDK 17+ 作为 Maven 运行时）
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Args
)

if (-not $env:JAVA_HOME_17) {
    Write-Error "JAVA_HOME_17 未设置，请先配置 JDK 17 路径"
}

$env:JAVA_HOME = $env:JAVA_HOME_17
& mvn @Args
exit $LASTEXITCODE
