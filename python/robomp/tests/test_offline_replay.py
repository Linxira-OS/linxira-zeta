from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest
from click.testing import CliRunner

from robomp.cli import main
from robomp.config import Settings, reset_settings_cache
from robomp.db import Database, close_database, issue_key
from robomp.offline import (
    OfflineFixture,
    OfflineFixtureError,
    OfflineReplayConflict,
    load_fixture,
    replay_offline,
    seed_fixture,
)


def _local_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "fixture-repo"
    repo.mkdir()
    subprocess.run(["git", "init", "-b", "main", str(repo)], check=True, capture_output=True, text=True)
    (repo / "README.md").write_text("fixture\n", encoding="utf-8")
    subprocess.run(["git", "-C", str(repo), "add", "README.md"], check=True, capture_output=True, text=True)
    subprocess.run(
        [
            "git",
            "-C",
            str(repo),
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "-m",
            "fixture",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return repo


def _payload(repo: Path, *, delivery_id: str = "fixture-1", clone_url: str | None = None) -> dict[str, object]:
    return {
        "delivery_id": delivery_id,
        "event_type": "issues",
        "repository": {
            "full_name": "octo/widget",
            "clone_url": clone_url or str(repo),
            "default_branch": "main",
        },
        "issue": {"number": 7, "title": "Offline fixture", "state": "open"},
    }


@pytest.fixture
def offline_settings(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Settings:
    values = {
        "ROBOMP_OFFLINE": "1",
        "ROBOMP_BOT_LOGIN": "robomp-bot",
        "ROBOMP_GIT_AUTHOR_NAME": "robomp-bot",
        "ROBOMP_GIT_AUTHOR_EMAIL": "robomp-bot@example.invalid",
        "ROBOMP_DATA_DIR": str(tmp_path / "state"),
        "ROBOMP_WORKSPACE_ROOT": str(tmp_path / "workspaces"),
        "ROBOMP_SQLITE_PATH": str(tmp_path / "state" / "robomp.sqlite"),
        "ROBOMP_LOG_DIR": str(tmp_path / "logs"),
        "ROBOMP_NATIVES_CACHE_ENABLED": "false",
        "ROBOMP_RELEASE_SENTINEL_ENABLED": "false",
        "GITHUB_TOKEN": "",
        "ROBOMP_GH_PROXY_URL": "",
        "ROBOMP_GH_PROXY_HMAC_KEY": "",
        "GITHUB_WEBHOOK_SECRET": "",
    }
    for key, value in values.items():
        monkeypatch.setenv(key, value)
    reset_settings_cache()
    cfg = Settings()  # type: ignore[call-arg]
    cfg.ensure_paths()
    yield cfg
    reset_settings_cache()
    close_database()


def test_offline_settings_need_no_github_credentials(offline_settings: Settings) -> None:
    assert offline_settings.offline is True
    assert offline_settings.github_token is None
    assert offline_settings.gh_proxy_url is None
    assert offline_settings.release_sentinel_enabled is False


def test_fixture_records_dedupe_and_active_rows_conflict(
    offline_settings: Settings, tmp_path: Path
) -> None:
    db = Database(offline_settings.sqlite_path)
    fixture = OfflineFixture.from_payload(_payload(_local_repo(tmp_path)))
    assert db.record_event(
        delivery_id=fixture.delivery_id,
        event_type=fixture.event_type,
        repo=fixture.repo,
        issue_key=fixture.issue_key,
        payload=fixture.payload,
    )
    assert not db.record_event(
        delivery_id=fixture.delivery_id,
        event_type=fixture.event_type,
        repo=fixture.repo,
        issue_key=fixture.issue_key,
        payload=fixture.payload,
    )
    with pytest.raises(OfflineReplayConflict):
        seed_fixture(db, fixture)
    db.close()


def test_offline_replay_claims_worktree_and_writes_result(
    offline_settings: Settings, tmp_path: Path
) -> None:
    repo = _local_repo(tmp_path)
    fixture = OfflineFixture.from_payload(_payload(repo))
    db = Database(offline_settings.sqlite_path)
    seed_fixture(db, fixture)

    result = replay_offline(settings=offline_settings, db=db, delivery_id=fixture.delivery_id)

    row = db.get_event(fixture.delivery_id)
    assert row is not None and row.state == "done"
    issue = db.get_issue(issue_key(fixture.repo, fixture.number))
    assert issue is not None and issue.branch == result.branch
    workspace = Path(result.workspace)
    assert (workspace / "repo" / "README.md").is_file()
    payload = json.loads(Path(result.result_path).read_text(encoding="utf-8"))
    assert payload["state"] == "done"
    assert payload["no_network"] is True
    assert payload["agent_invoked"] is False
    db.close()


def test_offline_replay_recovers_running_after_restart(
    offline_settings: Settings, tmp_path: Path
) -> None:
    repo = _local_repo(tmp_path)
    fixture = OfflineFixture.from_payload(_payload(repo))
    db = Database(offline_settings.sqlite_path)
    seed_fixture(db, fixture)
    claimed = db.claim_event(fixture.delivery_id)
    assert claimed is not None and claimed.state == "running"
    db.close()

    reopened = Database(offline_settings.sqlite_path)
    result = replay_offline(settings=offline_settings, db=reopened, delivery_id=fixture.delivery_id)
    row = reopened.get_event(fixture.delivery_id)
    assert row is not None and row.state == "done"
    assert row.attempts == 2
    assert Path(result.workspace).is_dir()
    reopened.close()


def test_offline_replay_terminal_requires_force(
    offline_settings: Settings, tmp_path: Path
) -> None:
    repo = _local_repo(tmp_path)
    fixture = OfflineFixture.from_payload(_payload(repo))
    db = Database(offline_settings.sqlite_path)
    seed_fixture(db, fixture)
    replay_offline(settings=offline_settings, db=db, delivery_id=fixture.delivery_id)

    with pytest.raises(OfflineReplayConflict):
        replay_offline(settings=offline_settings, db=db, delivery_id=fixture.delivery_id)
    replay_offline(settings=offline_settings, db=db, delivery_id=fixture.delivery_id, force=True)
    row = db.get_event(fixture.delivery_id)
    assert row is not None and row.state == "done" and row.attempts == 2
    db.close()


def test_offline_replay_rejects_remote_clone_url(
    offline_settings: Settings, tmp_path: Path
) -> None:
    repo = _local_repo(tmp_path)
    fixture = OfflineFixture.from_payload(_payload(repo, clone_url="https://github.com/octo/widget.git"))
    db = Database(offline_settings.sqlite_path)
    seed_fixture(db, fixture)

    with pytest.raises(OfflineFixtureError):
        replay_offline(settings=offline_settings, db=db, delivery_id=fixture.delivery_id)
    row = db.get_event(fixture.delivery_id)
    assert row is not None and row.state == "failed"
    assert not (offline_settings.workspace_root / "octo__widget__7").exists()
    db.close()


def test_cli_triage_and_status_offline(
    offline_settings: Settings, tmp_path: Path
) -> None:
    repo = _local_repo(tmp_path)
    fixture_path = tmp_path / "fixture.json"
    fixture_path.write_text(json.dumps(_payload(repo)), encoding="utf-8")
    runner = CliRunner()

    triage = runner.invoke(main, ["triage", "--offline", "--fixture", str(fixture_path)])
    assert triage.exit_code == 0, triage.output
    triaged = json.loads(triage.output)
    assert triaged["state"] == "done"

    status = runner.invoke(main, ["status", "--offline", "--json"])
    assert status.exit_code == 0, status.output
    payload = json.loads(status.output)
    assert any(event["delivery_id"] == "fixture-1" and event["state"] == "done" for event in payload["events"])
    close_database()


def test_load_fixture_reads_recorded_payload(tmp_path: Path) -> None:
    repo = _local_repo(tmp_path)
    path = tmp_path / "fixture.json"
    path.write_text(json.dumps(_payload(repo)), encoding="utf-8")
    fixture = load_fixture(path)
    assert fixture.repo == "octo/widget"
    assert fixture.number == 7
    assert fixture.clone_url == str(repo)
