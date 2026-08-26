#!/bin/bash
# Build Zeta .deb package for x86_64 Linux
# Usage: ./build-deb.sh <version> <binary-path>
# Example: ./build-deb.sh 1.0.0 ../../packages/coding-agent/binaries/zeta-cli-linux-x64

set -euo pipefail

VERSION="${1:?Usage: $0 <version> <binary-path>}"
BINARY="${2:?Usage: $0 <version> <binary-path>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
BUILD_DIR="$(mktemp -d)"
PKG_NAME="zeta_${VERSION}_amd64"
PKG_DIR="$BUILD_DIR/$PKG_NAME"

echo "==> Building Zeta ${VERSION} .deb package (x86_64)"

# ----- Directory structure -----
mkdir -p "$PKG_DIR/DEBIAN"
mkdir -p "$PKG_DIR/usr/bin"
mkdir -p "$PKG_DIR/usr/share/doc/zeta"
mkdir -p "$PKG_DIR/usr/share/bash-completion/completions"
mkdir -p "$PKG_DIR/usr/share/zsh/site-functions"
mkdir -p "$PKG_DIR/usr/share/fish/vendor_completions.d"

# ----- Binary -----
cp "$BINARY" "$PKG_DIR/usr/bin/zeta"
chmod 755 "$PKG_DIR/usr/bin/zeta"

# ----- License -----
if [ -f "$REPO_ROOT/LICENSE" ]; then
  cp "$REPO_ROOT/LICENSE" "$PKG_DIR/usr/share/doc/zeta/LICENSE"
fi

# ----- Control file -----
sed -e "s/\${VERSION}/$VERSION/g" \
    -e "s/\${DEPENDS}//g" \
    "$SCRIPT_DIR/control" > "$PKG_DIR/DEBIAN/control"

# ----- Build .deb -----
OUTPUT_DIR="$REPO_ROOT/packages/coding-agent/binaries"
mkdir -p "$OUTPUT_DIR"
dpkg-deb --build "$PKG_DIR" "$OUTPUT_DIR/${PKG_NAME}.deb"

echo "==> Built: $OUTPUT_DIR/${PKG_NAME}.deb"
rm -rf "$BUILD_DIR"