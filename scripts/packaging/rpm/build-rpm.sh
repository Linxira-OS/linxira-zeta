#!/bin/bash
# Build Zeta .rpm package for x86_64 Linux
# Usage: ./build-rpm.sh <version> <binary-path>
# Example: ./build-rpm.sh 1.0.0 ../../packages/coding-agent/binaries/zeta-cli-linux-x64

set -euo pipefail

VERSION="${1:?Usage: $0 <version> <binary-path>}"
BINARY="${2:?Usage: $0 <version> <binary-path>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
BUILD_DIR="$(mktemp -d)"
RPMBUILD_DIR="$BUILD_DIR/rpmbuild"

echo "==> Building Zeta ${VERSION} .rpm package (x86_64)"

# ----- RPM build directories -----
mkdir -p "$RPMBUILD_DIR"/{BUILD,RPMS,SOURCES,SPECS,SRPMS}

# ----- Copy binary to SOURCES -----
cp "$BINARY" "$RPMBUILD_DIR/SOURCES/zeta-cli-linux-x64"

# ----- Copy LICENSE -----
if [ -f "$REPO_ROOT/LICENSE" ]; then
  cp "$REPO_ROOT/LICENSE" "$RPMBUILD_DIR/SOURCES/LICENSE"
fi

# ----- Prepare spec -----
sed "s/%{version}/$VERSION/g" "$SCRIPT_DIR/zeta.spec" > "$RPMBUILD_DIR/SPECS/zeta.spec"

# ----- Build .rpm -----
rpmbuild -bb \
  --define "_topdir $RPMBUILD_DIR" \
  --define "version $VERSION" \
  "$RPMBUILD_DIR/SPECS/zeta.spec"

# ----- Copy output -----
OUTPUT_DIR="$REPO_ROOT/packages/coding-agent/binaries"
mkdir -p "$OUTPUT_DIR"
RPM_FILE=$(find "$RPMBUILD_DIR/RPMS" -name "*.rpm" -type f | head -1)
mv "$RPM_FILE" "$OUTPUT_DIR/zeta-${VERSION}-1.x86_64.rpm"

echo "==> Built: $OUTPUT_DIR/zeta-${VERSION}-1.x86_64.rpm"
rm -rf "$BUILD_DIR"