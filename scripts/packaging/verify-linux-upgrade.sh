#!/usr/bin/env bash
# Prove the Linux desktop upgrade path against real release packages.
#
# Two transactions are exercised, each in its own pacman root (the host system
# is never touched):
#
#   1. linxira-zeta <old> -> linxira-zeta <new>   (same package name, zwork era
#      desktop to Zeta desktop). Asserts the installed version, that the old
#      zetawork file set is gone, that the new layout exists, that the bundled
#      kernel reports the new version, and that ~/.zeta is byte-identical.
#   2. linxira-zetawork (synthetic stub, the retired package name) -> the real
#      new package through a file:// sync repository, so pacman applies the
#      published Replaces/Conflicts rather than a bare -U.
#
# Usage:
#   verify-linux-upgrade.sh --old <linxira-zeta-old.pkg.tar.zst> \
#                           --new <linxira-zeta-new.pkg.tar.zst> \
#                           [--expect-old X] [--expect-new Y] [--workdir DIR]
#
# Requires: pacman, bsdtar (libarchive), sha256sum, root. Intended for an Arch
# container (archlinux:base) and for a Linxira WSL/root environment.

set -euo pipefail
export LC_ALL=C

OLD_PKG=""
NEW_PKG=""
EXPECT_OLD=""
EXPECT_NEW=""
WORKDIR=""

usage() {
	sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
	exit "${1:-2}"
}

while [[ $# -gt 0 ]]; do
	case "$1" in
	--old)
		OLD_PKG=${2:?--old needs a package}
		shift 2
		;;
	--new)
		NEW_PKG=${2:?--new needs a package}
		shift 2
		;;
	--expect-old)
		EXPECT_OLD=${2:?}
		shift 2
		;;
	--expect-new)
		EXPECT_NEW=${2:?}
		shift 2
		;;
	--workdir)
		WORKDIR=${2:?}
		shift 2
		;;
	-h | --help) usage 0 ;;
	*) echo "unknown argument: $1" >&2; usage ;;
	esac
done

[[ -n $OLD_PKG && -n $NEW_PKG ]] || usage
[[ -f $OLD_PKG ]] || {
	echo "missing old package: $OLD_PKG" >&2
	exit 2
}
[[ -f $NEW_PKG ]] || {
	echo "missing new package: $NEW_PKG" >&2
	exit 2
}
if [[ $(id -u) -ne 0 ]]; then
	echo "this test installs packages into a disposable root and needs root" >&2
	exit 2
fi
for tool in pacman bsdtar sha256sum; do
	command -v "$tool" >/dev/null || {
		echo "missing required tool: $tool" >&2
		exit 2
	}
done

WORKDIR=${WORKDIR:-$(mktemp -d "${TMPDIR:-/tmp}/zeta-upgrade.XXXXXX")}
mkdir -p "$WORKDIR"
OLD_PKG=$(cd "$(dirname "$OLD_PKG")" && pwd)/$(basename "$OLD_PKG")
NEW_PKG=$(cd "$(dirname "$NEW_PKG")" && pwd)/$(basename "$NEW_PKG")
# Never read the host's repository configuration: these roots have no sync DBs.
MIN_CONF="$WORKDIR/pacman-min.conf"
cat >"$MIN_CONF" <<'EOF'
[options]
Architecture = auto
SigLevel = Never
EOF

FAILS=0
pass() { printf 'PASS: %s\n' "$*"; }
fail() {
	printf 'FAIL: %s\n' "$*" >&2
	FAILS=$((FAILS + 1))
}
pkg_version() {
	pacman --root "$1" --dbpath "$1/var/lib/pacman" -Q "$2" 2>/dev/null | awk '{print $2}' || true
}
init_root() {
	local root=$1
	mkdir -p "$root/var/lib/pacman/local" "$root/var/cache/pacman/pkg" "$root/etc"
}
# -dd: these roots have no dependency closure; the package transaction
# semantics (replace, file ownership, upgrade) are what this test proves.
pacman_into() {
	local root=$1
	shift
	pacman --root "$root" --dbpath "$root/var/lib/pacman" --config "$MIN_CONF" \
		--cachedir "$root/var/cache/pacman/pkg" --noconfirm -dd -U "$@"
}

echo "== metadata =="
OLD_VERSION=$(bsdtar -xOf "$OLD_PKG" .PKGINFO | sed -n 's/^pkgver = //p')
NEW_VERSION=$(bsdtar -xOf "$NEW_PKG" .PKGINFO | sed -n 's/^pkgver = //p')
NEW_PKGINFO=$(bsdtar -xOf "$NEW_PKG" .PKGINFO)
pass "old package $OLD_VERSION, new package $NEW_VERSION"
if [[ -n $EXPECT_OLD && $OLD_VERSION != "$EXPECT_OLD" ]]; then
	fail "old package version $OLD_VERSION != $EXPECT_OLD"
fi
if [[ -n $EXPECT_NEW && $NEW_VERSION != "$EXPECT_NEW" ]]; then
	fail "new package version $NEW_VERSION != $EXPECT_NEW"
fi
grep -qx 'replaces = linxira-zetawork' <<<"$NEW_PKGINFO" || fail "new package does not declare Replaces linxira-zetawork"
grep -Eqx 'conflicts? = linxira-zetawork' <<<"$NEW_PKGINFO" || fail "new package does not declare Conflicts linxira-zetawork"
[[ -n $EXPECT_NEW ]] || EXPECT_NEW=$NEW_VERSION

echo "== transaction 1: same package name (zwork desktop -> Zeta desktop) =="
ROOT_A="$WORKDIR/root-a"
HOME_A="$WORKDIR/home-a"
init_root "$ROOT_A"
mkdir -p "$HOME_A/.zeta/agent/sessions/encoded-cwd"
printf '{"model":"keep-me"}\n' >"$HOME_A/.zeta/config.json"
printf '{"port":43141}\n' >"$HOME_A/.zeta/serve.json"
printf '{"projects":["/work/keep"]}\n' >"$HOME_A/.zeta/projects.json"
printf '{"turns":1}\n' >"$HOME_A/.zeta/agent/sessions/encoded-cwd/session.json"
CONFIG_SUM=$(cd "$HOME_A" && find .zeta -type f -print0 | sort -z | xargs -0 -r sha256sum)

pacman_into "$ROOT_A" "$OLD_PKG" >/dev/null
INSTALLED_OLD=$(pkg_version "$ROOT_A" linxira-zeta)
[[ $INSTALLED_OLD == "$OLD_VERSION" ]] && pass "old package installed ($INSTALLED_OLD)" || fail "old install version $INSTALLED_OLD != $OLD_VERSION"

pacman_into "$ROOT_A" "$NEW_PKG" >/dev/null
INSTALLED_NEW=$(pkg_version "$ROOT_A" linxira-zeta)
[[ $INSTALLED_NEW == "$EXPECT_NEW" ]] && pass "upgraded version is $INSTALLED_NEW" || fail "upgraded version $INSTALLED_NEW != $EXPECT_NEW"

for stale in usr/bin/zetawork usr/lib/zetawork; do
	[[ ! -e "$ROOT_A/$stale" ]] && pass "old path removed: /$stale" || fail "old path survived the upgrade: /$stale"
done
for fresh in opt/linxira-zeta/zeta-desktop usr/bin/zeta-desktop \
	usr/share/applications/linxira-zeta.desktop \
	usr/share/icons/hicolor/512x512/apps/linxira-zeta.png; do
	# Absolute symlinks (the packaged /usr/bin/zeta-desktop) dangle inside a
	# test root, so -L must count as present.
	[[ -e "$ROOT_A/$fresh" || -L "$ROOT_A/$fresh" ]] && pass "new path present: /$fresh" || fail "missing new path: /$fresh"
done
[[ -L "$ROOT_A/usr/bin/zeta-desktop" ]] && pass "usr/bin/zeta-desktop is the packaged symlink" || fail "usr/bin/zeta-desktop is not a symlink"

CONFIG_SUM_AFTER=$(cd "$HOME_A" && find .zeta -type f -print0 | sort -z | xargs -0 -r sha256sum)
[[ $CONFIG_SUM == "$CONFIG_SUM_AFTER" ]] && pass "~/.zeta is byte-identical" || fail "~/.zeta changed during the upgrade"

KERNEL="$ROOT_A/opt/linxira-zeta/resources/zeta/zeta"
if [[ -x $KERNEL ]]; then
	VERSION_OUT=$("$KERNEL" --version 2>&1 || true)
	EXPECT_BASE=${EXPECT_NEW%%-*}
	if [[ $VERSION_OUT == *"$EXPECT_BASE"* ]]; then
		pass "bundled kernel starts and reports $EXPECT_BASE ($VERSION_OUT)"
	else
		fail "bundled kernel --version output was: ${VERSION_OUT:0:200}"
	fi
else
	fail "bundled kernel missing: /opt/linxira-zeta/resources/zeta/zeta"
fi
if [[ -e "$ROOT_A/opt/linxira-zeta/zeta-desktop" ]]; then
	ELF_OUT=$(head -c 4 "$ROOT_A/opt/linxira-zeta/zeta-desktop" 2>/dev/null | od -An -tx1 | tr -d ' \n')
	[[ $ELF_OUT == "7f454c46" ]] && pass "desktop entry point is an ELF binary" || fail "desktop entry point is not ELF (magic $ELF_OUT)"
fi

echo "== transaction 2: retired linxira-zetawork is replaced =="
ROOT_B="$WORKDIR/root-b"
REPO_B="$WORKDIR/repo-b"
init_root "$ROOT_B"
mkdir -p "$REPO_B"
STUB="$WORKDIR/linxira-zetawork-1.4.1-1-any.pkg.tar.zst"
STUB_DIR=$(mktemp -d "$WORKDIR/stub.XXXXXX")
mkdir -p "$STUB_DIR/usr/bin"
printf '#!/bin/sh\necho zetawork\n' >"$STUB_DIR/usr/bin/zetawork"
chmod 755 "$STUB_DIR/usr/bin/zetawork"
cat >"$STUB_DIR/.PKGINFO" <<'EOF'
pkgname = linxira-zetawork
pkgbase = linxira-zetawork
pkgver = 1.4.1-1
pkgdesc = synthetic retired zetawork package (test fixture for Replaces)
url = https://github.com/Linxira-OS/linxira-zeta
builddate = 0
packager = verify-linux-upgrade
size = 32
arch = any
license = MIT
provides = zetawork
EOF
bsdtar --zstd -cf "$STUB" -C "$STUB_DIR" .PKGINFO -C "$STUB_DIR" usr
pacman_into "$ROOT_B" "$STUB" >/dev/null
[[ $(pkg_version "$ROOT_B" linxira-zetawork) == 1.4.1-1 ]] && pass "synthetic linxira-zetawork installed" || fail "synthetic linxira-zetawork was not installed"

cp "$NEW_PKG" "$REPO_B/"
(cd "$REPO_B" && repo-add -q linxira-zeta.db.tar.zst "$(basename "$NEW_PKG")" >/dev/null)
cat >"$WORKDIR/pacman-test.conf" <<EOF
[options]
Architecture = auto
SigLevel = Never
[linxira-zeta]
Server = file://$REPO_B
EOF
pacman --root "$ROOT_B" --dbpath "$ROOT_B/var/lib/pacman" \
	--cachedir "$ROOT_B/var/cache/pacman/pkg" --config "$WORKDIR/pacman-test.conf" \
	--noconfirm -Sy >/dev/null
pacman --root "$ROOT_B" --dbpath "$ROOT_B/var/lib/pacman" \
	--cachedir "$ROOT_B/var/cache/pacman/pkg" --config "$WORKDIR/pacman-test.conf" \
	--noconfirm -dd -Su >/dev/null
if pacman --root "$ROOT_B" --dbpath "$ROOT_B/var/lib/pacman" -Q linxira-zetawork >/dev/null 2>&1; then
	fail "linxira-zetawork survived pacman -Su"
else
	pass "linxira-zetawork was replaced by linxira-zeta"
fi
[[ $(pkg_version "$ROOT_B" linxira-zeta) == "$EXPECT_NEW" ]] && pass "replacement installed at $EXPECT_NEW" || fail "replacement version is $(pkg_version "$ROOT_B" linxira-zeta)"
[[ ! -e "$ROOT_B/usr/bin/zetawork" ]] && pass "stub file /usr/bin/zetawork removed" || fail "stub file /usr/bin/zetawork survived"

echo
if [[ $FAILS -ne 0 ]]; then
	echo "Linux upgrade verification FAILED ($FAILS problem(s)); roots kept in $WORKDIR" >&2
	exit 1
fi
echo "Linux upgrade verification passed: $OLD_VERSION -> $EXPECT_NEW in place, linxira-zetawork replaced, ~/.zeta preserved."
rm -rf "$WORKDIR"
