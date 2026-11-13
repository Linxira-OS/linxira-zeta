from __future__ import annotations

from pathlib import Path

from robomp.paths import default_workspace_root, resolve_data_dir


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


def test_dotenv_data_dir_feeds_default_workspace(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("ROBOMP_DATA_DIR", raising=False)
    data = tmp_path / "from-dotenv"
    (tmp_path / ".env").write_text(f"ROBOMP_DATA_DIR={data}\n", encoding="utf-8")
    assert default_workspace_root() == data / "workspaces"


def test_dotenv_explicit_path_wins(monkeypatch, tmp_path: Path) -> None:
    from robomp.config import Settings, reset_settings_cache

    monkeypatch.chdir(tmp_path)
    for key in ("ROBOMP_DATA_DIR", "ROBOMP_WORKSPACE_ROOT", "ROBOMP_OFFLINE"):
        monkeypatch.delenv(key, raising=False)
    data = tmp_path / "state"
    explicit = tmp_path / "explicit-workspaces"
    (tmp_path / ".env").write_text(
        "\n".join(
            [
                "ROBOMP_OFFLINE=1",
                "ROBOMP_BOT_LOGIN=robomp-bot",
                "ROBOMP_GIT_AUTHOR_EMAIL=robomp-bot@example.invalid",
                f"ROBOMP_DATA_DIR={data}",
                f"ROBOMP_WORKSPACE_ROOT={explicit}",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    reset_settings_cache()
    try:
        cfg = Settings()  # type: ignore[call-arg]
        assert cfg.data_dir == data
        assert cfg.workspace_root == explicit
    finally:
        reset_settings_cache()
