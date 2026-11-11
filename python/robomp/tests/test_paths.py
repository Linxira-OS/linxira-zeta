from __future__ import annotations

from pathlib import Path

from robomp.paths import resolve_data_dir


def test_explicit_data_dir_wins(tmp_path: Path) -> None:
    assert resolve_data_dir(env={"ROBOMP_DATA_DIR": str(tmp_path / "explicit")}) == tmp_path / "explicit"


def test_windows_local_appdata(tmp_path: Path) -> None:
    env = {"LOCALAPPDATA": str(tmp_path / "AppData" / "Local")}
    assert resolve_data_dir(env=env, home=tmp_path / "home", system="Windows") == (
        tmp_path / "AppData" / "Local" / "Zeta" / "robomp"
    )


def test_windows_home_fallback(tmp_path: Path) -> None:
    assert resolve_data_dir(env={}, home=tmp_path / "home", system="Windows") == (
        tmp_path / "home" / "AppData" / "Local" / "Zeta" / "robomp"
    )


def test_posix_xdg_state(tmp_path: Path) -> None:
    env = {"XDG_STATE_HOME": str(tmp_path / "state")}
    assert resolve_data_dir(env=env, home=tmp_path / "home", system="Linux") == (
        tmp_path / "state" / "zeta" / "robomp"
    )


def test_posix_dot_zeta_fallback(tmp_path: Path) -> None:
    assert resolve_data_dir(env={}, home=tmp_path / "home", system="Linux") == (
        tmp_path / "home" / ".zeta" / "robomp"
    )
