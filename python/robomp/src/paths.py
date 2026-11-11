"""Host path resolution for roboomp.

The container always sets explicit `ROBOMP_*` paths, so these defaults are for
host CLI runs: a user-state directory rather than the process cwd, honoring
XDG on POSIX, LOCALAPPDATA on Windows, and Zeta's `~/.zeta` fallback.
"""

from __future__ import annotations

import os
import platform
from collections.abc import Mapping
from pathlib import Path

DATA_DIR_ENV = "ROBOMP_DATA_DIR"


def resolve_data_dir(
    *,
    env: Mapping[str, str] | None = None,
    home: Path | None = None,
    system: str | None = None,
) -> Path:
    """Return the roboomp data root.

    Precedence: explicit `ROBOMP_DATA_DIR`; Windows `%LOCALAPPDATA%\\Zeta\\robomp`;
    POSIX `$XDG_STATE_HOME/zeta/robomp`; fallback `~/.zeta/robomp`.
    Empty values are ignored.
    """
    values = os.environ if env is None else env
    home_dir = Path.home() if home is None else home
    system_name = platform.system() if system is None else system

    override = values.get(DATA_DIR_ENV, "").strip()
    if override:
        return Path(override).expanduser()

    if system_name.lower() == "windows":
        local_app_data = values.get("LOCALAPPDATA", "").strip()
        base = Path(local_app_data).expanduser() if local_app_data else home_dir / "AppData" / "Local"
        return base / "Zeta" / "robomp"

    xdg_state = values.get("XDG_STATE_HOME", "").strip()
    if xdg_state:
        return Path(xdg_state).expanduser() / "zeta" / "robomp"

    return home_dir / ".zeta" / "robomp"


def default_workspace_root() -> Path:
    return resolve_data_dir() / "workspaces"


def default_sqlite_path() -> Path:
    return resolve_data_dir() / "robomp.sqlite"


def default_log_dir() -> Path:
    return resolve_data_dir() / "logs"


def default_natives_cache_root() -> Path:
    return resolve_data_dir() / "natives-cache"
