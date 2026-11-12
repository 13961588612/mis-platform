#!/usr/bin/env bash
# Maven launcher wrapper that bypasses the broken Git-Bash mvn shell script.
export JAVA_HOME=/d/software/jdk-17.0.2
export PATH=/d/software/jdk-17.0.2/bin:$PATH
MVN_HOME=/d/software/apache-maven-3.9.16
BOOT_JAR="$MVN_HOME/boot/plexus-classworlds-2.11.0.jar"
PROJECT_DIR=/d/code/mis-platform/backend
# Convert POSIX paths to Windows form so the native Java launcher can
# resolve them (avoids MSYS path-mangling of /d/software -> \d\software).
BOOT_JAR_W=$(cygpath -w "$BOOT_JAR")
MVN_HOME_W=$(cygpath -w "$MVN_HOME")
PROJECT_DIR_W=$(cygpath -w "$PROJECT_DIR")
exec /d/software/jdk-17.0.2/bin/java \
  -classpath "$BOOT_JAR_W" \
  "-Dclassworlds.conf=$MVN_HOME_W/bin/m2.conf" \
  "-Dmaven.home=$MVN_HOME_W" \
  "-Dlibrary.jansi.path=$MVN_HOME_W/lib/jansi-native" \
  "-Dmaven.multiModuleProjectDirectory=$PROJECT_DIR_W" \
  org.codehaus.plexus.classworlds.launcher.Launcher \
  "$@"
