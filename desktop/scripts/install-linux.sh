#!/bin/bash
# Zeta desktop — Linux 正式安装脚本
# 用法:
#   bash install-linux.sh zeta-desktop-<version>-linux-x64.tar.gz
# 选项:
#   --prefix <dir>     指定安装目录（默认 root: /opt/zeta-desktop，用户: ~/.local/lib/zeta-desktop）
#   --no-shortcut      不创建桌面快捷方式（仍会注册应用菜单）
# 特性:
#   - 幂等：重复运行自动替换旧版本（rm -rf 旧目录再装）
#   - 自动修复 chrome-sandbox 权限（Electron 必需 4755）
#   - 应用菜单注册（Categories=Development → 开始菜单"开发"类别）
#   - 可选桌面快捷方式（自动探测 XDG 桌面目录，含中文"桌面" locale）

set -euo pipefail

usage() { sed -n '2,12p' "$0"; exit 1; }

# ---- 参数解析 ----
[ $# -ge 1 ] || usage
TARBALL="$1"; shift
PREFIX=""
SHORTCUT=1
while [ $# -gt 0 ]; do
	case "$1" in
		--prefix) PREFIX="$2"; shift 2 ;;
		--no-shortcut) SHORTCUT=0; shift ;;
		*) usage ;;
	esac
done

[ -f "$TARBALL" ] || { echo "错误: 找不到安装包 $TARBALL"; exit 1; }

# ---- 目标目录 ----
if [ -n "$PREFIX" ]; then
	DEST="$PREFIX"
elif [ "$(id -u)" = "0" ]; then
	DEST="/opt/zeta-desktop"
else
	DEST="$HOME/.local/lib/zeta-desktop"
fi
PARENT="$(dirname "$DEST")"

# 真实用户（sudo 场景下安装菜单归调用者）
REAL_USER="${SUDO_USER:-$(id -un)}"
REAL_HOME="$(getent passwd "$REAL_USER" 2>/dev/null | cut -d: -f6)"
[ -n "$REAL_HOME" ] || REAL_HOME="$HOME"

echo "==> 安装到: $DEST"

# ---- 解压（tar 顶层可能带版本目录，探测后摊平到 DEST）----
TOP="$(tar tzf "$TARBALL" 2>/dev/null | head -1 | cut -d/ -f1 || true)"
[ -n "$TOP" ] || { echo "错误: 无效的 tar.gz"; exit 1; }

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
echo "==> 解压..."
tar xzf "$TARBALL" -C "$STAGE"
if [ -d "$STAGE/$TOP" ]; then SRC="$STAGE/$TOP"; else SRC="$STAGE"; fi
[ -x "$SRC/zeta-desktop" ] || { echo "错误: 包内未找到 zeta-desktop 可执行文件"; exit 1; }

# ---- 替换旧版本 ----
echo "==> 替换旧版本（如有）..."
rm -rf "$DEST"
mkdir -p "$PARENT"
mv "$SRC" "$DEST"

# ---- sandbox 权限 ----
if [ -f "$DEST/chrome-sandbox" ]; then
	chmod 4755 "$DEST/chrome-sandbox" || { echo "警告: chrome-sandbox 权限设置失败"; }
	echo "==> chrome-sandbox 权限已修复"
fi

# ---- zeta-d 命令（捆绑 CLI/TUI；`zeta-d -d` 打开桌面 GUI）----
if [ -f "$DEST/resources/bin/zeta-d" ]; then
	chmod +x "$DEST/resources/bin/zeta-d"
	mkdir -p "$REAL_HOME/.local/bin"
	ln -sfn "$DEST/resources/bin/zeta-d" "$REAL_HOME/.local/bin/zeta-d"
	echo "==> 已注册命令: $REAL_HOME/.local/bin/zeta-d (确保 ~/.local/bin 在 PATH 中)"
else
	echo "警告: 未找到 resources/bin/zeta-d，跳过 zeta-d 注册"
fi

# ---- 应用菜单注册 ----
APP_DIR="$REAL_HOME/.local/share/applications"
ICON_SRC="$DEST/resources/icon.ico"
mkdir -p "$APP_DIR"
cat > "$APP_DIR/zeta-desktop.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Zeta
Comment=Zeta coding agent desktop
Exec="$DEST/zeta-desktop"
Icon=$ICON_SRC
Terminal=false
Categories=Development;DevelopmentTool;
StartupWMClass=zeta-desktop
EOF
echo "==> 应用菜单已注册（开发类别）: $APP_DIR/zeta-desktop.desktop"

# ---- 桌面快捷方式（可选）----
if [ "$SHORTCUT" = "1" ]; then
	DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
	[ -n "$DESKTOP_DIR" ] && [ -d "$DESKTOP_DIR" ] || DESKTOP_DIR="$REAL_HOME/桌面"
	if [ -d "$DESKTOP_DIR" ] && [ -w "$DESKTOP_DIR" ]; then
		cp "$APP_DIR/zeta-desktop.desktop" "$DESKTOP_DIR/zeta-desktop.desktop"
		chmod +x "$DESKTOP_DIR/zeta-desktop.desktop"
		echo "==> 桌面快捷方式已创建: $DESKTOP_DIR/zeta-desktop.desktop"
	else
		echo "==> 跳过桌面快捷方式（桌面目录不可写: $DESKTOP_DIR）"
	fi
fi

# ---- 完成 ----
echo ""
echo "==> 安装完成: $DEST"
echo "    运行: $DEST/zeta-desktop"
echo "    重新安装相同命令即可升级/替换旧版本。"
