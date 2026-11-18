#!/bin/sh
set -e

# Zeta Coding Agent Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/Linxira-OS/linxira-zeta/main/scripts/install.sh | sh
#
# Options:
#   --source       Install via bun (installs bun if needed)
#   --binary       Always install prebuilt binary
#   --ref <ref>    Install specific tag/commit/branch
#   -r <ref>       Shorthand for --ref

REPO="Linxira-OS/linxira-zeta"
PACKAGE="@linxiraos/zeta"
INSTALL_DIR="${PI_INSTALL_DIR:-$HOME/.local/bin}"
MIN_BUN_VERSION="1.3.14"

# Parse arguments
MODE=""
REF=""
while [ $# -gt 0 ]; do
    case "$1" in
        --source)
            MODE="source"
            shift
            ;;
        --binary)
            MODE="binary"
            shift
            ;;
        --ref)
            shift
            if [ -z "$1" ]; then
                echo "Missing value for --ref"
                exit 1
            fi
            REF="$1"
            shift
            ;;
        --ref=*)
            REF="${1#*=}"
            if [ -z "$REF" ]; then
                echo "Missing value for --ref"
                exit 1
            fi
            shift
            ;;
        -r)
            shift
            if [ -z "$1" ]; then
                echo "Missing value for -r"
                exit 1
            fi
            REF="$1"
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# The prebuilt binary is the default: it updates itself with delta patches,
# which a bun package install cannot. A ref can name a branch or commit, which
# only a source install can build, so a bare --ref selects source.
if [ -z "$MODE" ]; then
    if [ -n "$REF" ]; then
        MODE="source"
    else
        MODE="binary"
    fi
fi

# Check if bun is available
has_bun() {
    command -v bun >/dev/null 2>&1
}

# Normalized host architecture (x64|arm64). On macOS this uses
# `sysctl hw.optional.arm64` so it stays correct inside a Rosetta session,
# where `uname -m` reports the translated x86_64.
host_arch() {
    if [ "$(uname -s)" = "Darwin" ]; then
        if [ "$(sysctl -in hw.optional.arm64 2>/dev/null || /usr/sbin/sysctl -in hw.optional.arm64 2>/dev/null)" = "1" ]; then
            echo "arm64"
        else
            echo "x64"
        fi
        return
    fi
    case "$(uname -m)" in
        x86_64|amd64)  echo "x64" ;;
        arm64|aarch64) echo "arm64" ;;
        *)             uname -m ;;
    esac
}

# Bun's own architecture (x64|arm64), or empty when it can't be determined.
bun_arch() {
    bun -e 'process.stdout.write(process.arch)' 2>/dev/null
}

# True when Bun's architecture matches the host. If Bun's arch can't be read,
# assume a match rather than block the install.
bun_arch_matches_host() {
    ba="$(bun_arch)"
    [ -z "$ba" ] && return 0
    [ "$ba" = "$(host_arch)" ]
}

version_ge() {
    current="$1"
    minimum="$2"

    current_major="${current%%.*}"
    current_rest="${current#*.}"
    current_minor="${current_rest%%.*}"
    current_patch="${current_rest#*.}"
    current_patch="${current_patch%%.*}"

    minimum_major="${minimum%%.*}"
    minimum_rest="${minimum#*.}"
    minimum_minor="${minimum_rest%%.*}"
    minimum_patch="${minimum_rest#*.}"
    minimum_patch="${minimum_patch%%.*}"

    if [ "$current_major" -ne "$minimum_major" ]; then
        [ "$current_major" -gt "$minimum_major" ]
        return $?
    fi

    if [ "$current_minor" -ne "$minimum_minor" ]; then
        [ "$current_minor" -gt "$minimum_minor" ]
        return $?
    fi

    [ "$current_patch" -ge "$minimum_patch" ]
}

require_bun_version() {
    version_raw=$(bun --version 2>/dev/null || true)
    if [ -z "$version_raw" ]; then
        echo "Failed to read bun version"
        exit 1
    fi

    version_clean=${version_raw%%-*}
    if ! version_ge "$version_clean" "$MIN_BUN_VERSION"; then
        echo "Bun ${MIN_BUN_VERSION} or newer is required. Current version: ${version_clean}"
        echo "Upgrade Bun at https://bun.sh/docs/installation"
        exit 1
    fi
}

# Check if git is available
has_git() {
    command -v git >/dev/null 2>&1
}

# Install bun
install_bun() {
    echo "Installing bun..."
    if command -v bash >/dev/null 2>&1; then
        curl -fsSL https://bun.sh/install | bash
    else
        echo "bash not found; attempting install with sh..."
        curl -fsSL https://bun.sh/install | sh
    fi
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
    require_bun_version
}

# Check if git-lfs is available
has_git_lfs() {
    command -v git-lfs >/dev/null 2>&1
}

# Install via bun
install_via_bun() {
    echo "Installing via bun..."
    if [ -n "$REF" ]; then
        if ! has_git; then
            echo "git is required for --ref when installing from source"
            exit 1
        fi

        TMP_DIR="$(mktemp -d)"
        trap 'rm -rf "$TMP_DIR"' EXIT

        if git clone --depth 1 --branch "$REF" "https://github.com/${REPO}.git" "$TMP_DIR" >/dev/null 2>&1; then
            :
        else
            git clone "https://github.com/${REPO}.git" "$TMP_DIR"
            (cd "$TMP_DIR" && git checkout "$REF")
        fi

        # Pull LFS files
        if has_git_lfs; then
            (cd "$TMP_DIR" && git lfs pull)
        fi

        if [ ! -d "$TMP_DIR/packages/coding-agent" ]; then
            echo "Expected package at ${TMP_DIR}/packages/coding-agent"
            exit 1
        fi

        bun install -g "$TMP_DIR/packages/coding-agent" || {
            echo "Failed to install from source"
            exit 1
        }
    else
        bun install -g "$PACKAGE" || {
            echo "Failed to install $PACKAGE"
            exit 1
        }
    fi
    echo ""
    echo "✓ Installed zetacode via bun"
    echo "Run 'zetacode' to get started!"
}

# Install binary from GitHub releases
install_binary() {
    # Detect platform
    OS="$(uname -s)"
    ARCH="$(host_arch)"

    case "$OS" in
        Linux)  PLATFORM="linux" ;;
        Darwin) PLATFORM="darwin" ;;
        *)      echo "Unsupported OS: $OS"; exit 1 ;;
    esac

    case "$ARCH" in
        x64|arm64) ;;
        *)         echo "Unsupported architecture: $ARCH"; exit 1 ;;
    esac

    if [ "$PLATFORM" = "linux" ]; then
        if [ -f /etc/alpine-release ] || { command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -qi musl; }; then
            PLATFORM="linux-musl"
        fi
    fi

    # Only the release matrix's three legs have published binaries (the
    # `zeta-cli-*` assets `packages/utils/src/release-assets.ts` names). On any
    # other host the download below would 404 halfway through with no
    # explanation, so say what exists and how to install from source instead.
    case "${PLATFORM}-${ARCH}" in
        linux-x64|linux-musl-x64) ;;
        *)
            echo "No prebuilt binary for ${PLATFORM}-${ARCH}."
            echo "Zeta CLI publishes prebuilt binaries for linux-x64, linux-musl-x64 and windows-x64 only"
            echo "(macOS and ARM publishing is paused)."
            echo "Install the package instead:"
            echo "    npm install -g ${PACKAGE}"
            echo "Or re-run this installer with --source (it installs bun when missing)."
            exit 1
            ;;
    esac

    BINARY="zeta-cli-${PLATFORM}-${ARCH}"
    # Get release tag
    if [ -n "$REF" ]; then
        echo "Fetching release $REF..."
        if RELEASE_JSON=$(curl -fsSL --connect-timeout 10 --max-time 60 "https://api.github.com/repos/${REPO}/releases/tags/${REF}"); then
            LATEST=$(echo "$RELEASE_JSON" | grep '"tag_name"' | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
        else
            echo "Release tag not found: $REF"
            echo "For branch/commit installs, use --source with --ref."
            exit 1
        fi
    else
        echo "Fetching latest release..."
        RELEASE_JSON=$(curl -fsSL --connect-timeout 10 --max-time 60 "https://api.github.com/repos/${REPO}/releases/latest")
        LATEST=$(echo "$RELEASE_JSON" | grep '"tag_name"' | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
    fi

    if [ -z "$LATEST" ]; then
        echo "Failed to fetch release tag"
        exit 1
    fi
    echo "Using version: $LATEST"

    mkdir -p "$INSTALL_DIR"
    # Download binary
    BINARY_URL="https://github.com/${REPO}/releases/download/${LATEST}/${BINARY}"
    echo "Downloading ${BINARY}..."
    curl -fsSL --connect-timeout 10 --speed-limit 1024 --speed-time 30 "$BINARY_URL" -o "${INSTALL_DIR}/zetacode"
    chmod +x "${INSTALL_DIR}/zetacode"

    # Verify the freshly installed binary can actually start before reporting
    # success. Bun's musl-target binaries link libstdc++/libgcc dynamically,
    # which stock Alpine/musl systems do not ship, so the download succeeds while
    # the binary exits 127 with relocation errors. Never claim success for a
    # binary that cannot run.
    if ! SMOKE_OUTPUT="$("${INSTALL_DIR}/zetacode" --version 2>&1)"; then
        echo ""
        echo "✗ zetacode was downloaded to ${INSTALL_DIR}/zetacode but cannot start:"
        echo "$SMOKE_OUTPUT" | sed 's/^/    /'
        if [ "$PLATFORM" = "linux-musl" ]; then
            echo ""
            echo "The musl build links libstdc++/libgcc dynamically. Install them, then re-run 'zetacode':"
            if command -v apk >/dev/null 2>&1; then
                echo "    apk add libstdc++ libgcc"
            else
                echo "    (install the libstdc++ and libgcc runtime packages for your distro)"
            fi
        fi
        exit 1
    fi

    echo ""
    echo "✓ Installed zetacode to ${INSTALL_DIR}/zetacode"

    # An omp earlier on PATH (a previous `bun install -g`, Homebrew, ...) keeps
    # winning over this install until it is removed or INSTALL_DIR moves ahead.
    ACTIVE_OMP="$(command -v omp 2>/dev/null || true)"
    if [ -n "$ACTIVE_OMP" ] && ! [ "$ACTIVE_OMP" -ef "${INSTALL_DIR}/omp" ]; then
        echo "'omp' still resolves to ${ACTIVE_OMP}; remove that install or put ${INSTALL_DIR} ahead of it on PATH."
        return
    fi

    # Check if in PATH
    case ":$PATH:" in
        *":$INSTALL_DIR:"*) echo "Run 'zetacode' to get started!" ;;
        *) print_path_hint ;;
    esac
}

# Print $1 in single quotes, so POSIX shells read it literally.
sh_quote() {
    printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

# Print $1 in double quotes, so fish reads it literally. fish expands only $
# inside them and treats \ as an escape, so escape \, " and $.
fish_quote() {
    printf '"%s"' "$(printf '%s' "$1" | sed 's/[\\"$]/\\&/g')"
}

# Print path $1 for the user to paste: ~/<rest> when it is in the home
# directory and has no characters a shell treats specially, otherwise quoted
# with the quoting function $2.
display_path() {
    case "$1" in
        "$HOME"/*)
            rest="${1#"$HOME"/}"
            case "$rest" in
                *[!A-Za-z0-9._/+-]*) ;;
                *)
                    printf '%s/%s' "~" "$rest"
                    return
                    ;;
            esac
            ;;
    esac
    "$2" "$1"
}

# Tell the user that INSTALL_DIR is not on PATH and print one command, for
# their login shell, that adds it to the shell's startup file and loads it.
print_path_hint() {
    # The startup file each shell reads, and the command that loads it into
    # the current shell. fish needs no file: fish_add_path saves the change.
    rc_file=""
    load_cmd="source"
    case "$(basename "${SHELL:-sh}")" in
        zsh) rc_file="${ZDOTDIR:-$HOME}/.zshrc" ;;
        bash)
            if [ "$(uname -s)" = "Darwin" ]; then
                # Terminals on macOS start bash as a login shell, which reads
                # only the first of these files that exists. Creating
                # ~/.bash_profile would hide an existing ~/.profile.
                rc_file="$HOME/.bash_profile"
                for login_file in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
                    if [ -f "$login_file" ]; then
                        rc_file="$login_file"
                        break
                    fi
                done
            else
                rc_file="$HOME/.bashrc"
            fi
            ;;
        fish) ;;
        *)
            rc_file="$HOME/.profile"
            load_cmd="."
            ;;
    esac

    if [ -z "$rc_file" ]; then
        path_cmd="fish_add_path $(display_path "$INSTALL_DIR" fish_quote)"
    else
        # Write $HOME instead of the expanded home directory so the line stays
        # correct if the home directory moves. The startup file reads the path
        # inside double quotes, so escape the characters those quotes expand.
        case "$INSTALL_DIR" in
            "$HOME"/*) dir_base="\$HOME/" dir_rest="${INSTALL_DIR#"$HOME"/}" ;;
            *) dir_base="" dir_rest="$INSTALL_DIR" ;;
        esac
        dir_rest="$(printf '%s' "$dir_rest" | sed 's/[\\"$`]/\\&/g')"
        rc_line="export PATH=\"${dir_base}${dir_rest}:\$PATH\""
        # zsh's and dash's echo turn backslashes into escape sequences.
        case "$rc_line" in
            *\\*) write_cmd="printf '%s\\n'" ;;
            *) write_cmd="echo" ;;
        esac
        rc_shown="$(display_path "$rc_file" sh_quote)"
        path_cmd="${write_cmd} $(sh_quote "$rc_line") >> ${rc_shown} && ${load_cmd} ${rc_shown}"
    fi

    # printf, not echo: the echo of macOS /bin/sh turns \n in a path into a
    # line break.
    printf '\n%s is not in your PATH. To add it, run:\n\n' "$INSTALL_DIR"
    printf '  %s\n\n' "$path_cmd"
    echo "Then run 'omp' to get started!"
}

# Main logic
case "$MODE" in
    source)
        if ! has_bun; then
            install_bun
        fi
        require_bun_version
        if ! bun_arch_matches_host; then
            echo "Error: bun reports architecture '$(bun_arch)' but this host is '$(host_arch)'."
            echo "Installing from source with this bun would produce a mismatched binary"
            echo "(e.g. x86_64 under Rosetta on Apple Silicon), causing slow startup and AVX warnings."
            echo "Install a native bun for your architecture, or re-run without --source to fetch the prebuilt $(host_arch) binary."
            exit 1
        fi
        install_via_bun
        ;;
    binary)
        install_binary
        ;;
esac
