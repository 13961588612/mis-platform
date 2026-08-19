#!/usr/bin/env bash
# Maven launcher wrapper that bypasses the broken Git-Bash mvn shell script.
export JAVA_HOME=/d/software/jdk-17.0.2
export PATH=/d/software/jdk-17.0.2/bin:$PATH
MVN_HOME=/d/software/apache-maven-3.9.16
BOOT_JAR="$MVN_HOME/boot/plexus-classworlds-2.11.0.jar"
PROJECT_DIR=/d/code/mis-platform/backend
exec /d/software/jdk-17.0.2/bin/java \
  -classpath "$BOOT_JAR" \
  "-Dclassworlds.conf=$MVN_HOME/bin/m2.conf" \
  "-Dmaven.home=$MVN_HOME" \
  "-Dlibrary.jansi.path=$MVN_HOME/lib/jansi-native" \
  "-Dmaven.multiModuleProjectDirectory=$PROJECT_DIR" \
  org.codehaus.plexus.classworlds.launcher.Launcher \
  "$@"
