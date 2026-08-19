#!/usr/bin/env bash
# QA 用 Maven 启动器修复脚本（2026-08-16，严过关/Yan）
#
# 背景：本机 `mvn` 直接执行报 "找不到或无法加载主类
# org.codehaus.plexus.classworlds.launcher.Launcher"。根因不是 classworlds jar 缺失
# （D:\software\apache-maven-3.9.16\boot\ 下确实存在 plexus-classworlds-2.11.0.jar），
# 而是环境变量 MAVEN_HOME 使用 Windows 反斜杠路径，Git Bash 下的 mvn shell 脚本
# 拼 -classpath 时无法解析。同时默认 JAVA_HOME 指向 JDK 1.8，而本项目要求 JDK 17
# （backend/pom.xml: <java.version>17</java.version>，Spring Boot 3.2.5）。
#
# 修复方式：绕过 mvn shell 脚本，直接以 Windows 风格路径调用 classworlds Launcher，
# 并把 JAVA_HOME 切到 JDK 17。
#
# 用法：bash mvn-run.sh <maven 参数...>
#   例：bash mvn-run.sh -o -pl mis-org test -Dtest=PostServiceListFilterTest

set -euo pipefail

JDK17="/d/software/jdk-17.0.2"
MVN_WIN='D:\software\apache-maven-3.9.16'
BACKEND_WIN='D:\code\mis-platform\backend'
BACKEND_POSIX="/d/code/mis-platform/backend"

if [ ! -x "$JDK17/bin/javac" ]; then
  echo "[FATAL] 未找到 JDK 17: $JDK17" >&2
  exit 1
fi

export JAVA_HOME="$JDK17"
export PATH="$JAVA_HOME/bin:$PATH"

cd "$BACKEND_POSIX"

exec java \
  -classpath "$MVN_WIN\\boot\\plexus-classworlds-2.11.0.jar" \
  "-Dclassworlds.conf=$MVN_WIN\\bin\\m2.conf" \
  "-Dmaven.home=$MVN_WIN" \
  "-Dmaven.multiModuleProjectDirectory=$BACKEND_WIN" \
  org.codehaus.plexus.classworlds.launcher.Launcher \
  "$@"
