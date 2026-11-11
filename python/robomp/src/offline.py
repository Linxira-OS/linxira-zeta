"""Deterministic offline replay of roboomp's queue → worktree → result path.

This is a local validation surface, not the production bot. It never creates
a GitHub client, never spawns `zetacode`, and rejects non-local clone URLs so
a fixture cannot turn into a network fetch.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import urlparse

from robomp.config import Settings
from robomp.db import INACTIVE_EVENT_STATES, Database, EventRow, issue_key
from robomp.git_ops import GitCommandError, redact_credentials
from robomp.sandbox import SandboxManager


class OfflineReplayError(RuntimeError):
    """Base error for fixture loading and offline replay."""


class OfflineFixtureError(OfflineReplayError):
    """The fixture is not a usable `issues.opened`-shaped event."""


class OfflineReplayConflict(OfflineReplayError):
    """The requested delivery cannot be replayed without `--force`."""


@dataclass(slots=True, frozen=True)
class OfflineFixture:
    delivery_id: str
    repo: str
    number: int
    title: str
    clone_url: str
    default_branch: str
    event_type: str
    payload: dict[str, Any]

    @property
    def issue_key(self) -> str:
        return issue_key(self.repo, self.number)

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any], *, delivery_id: str | None = None) -> OfflineFixture:
        issue = payload.get("issue") if isinstance(payload.get("issue"), Mapping) else {}
        repository = payload.get("repository") if isinstance(payload.get("repository"), Mapping) else {}

        repo = payload.get("repo") or repository.get("full_name")
        number = payload.get("number") or issue.get("number")
        clone_url = payload.get("clone_url") or repository.get("clone_url")
        default_branch = payload.get("default_branch") or repository.get("default_branch") or "main"
        title = payload.get("title") or issue.get("title") or (f"Issue #{number}" if number is not None else "Offline issue")
        event_type = str(payload.get("event_type") or "issues")
        resolved_delivery = delivery_id or payload.get("delivery_id")

        if not isinstance(repo, str) or "/" not in repo:
            raise OfflineFixtureError("fixture repo must be owner/repo (repo or repository.full_name)")
        try:
            issue_number = int(number)
        except (TypeError, ValueError) as exc:
            raise OfflineFixtureError("fixture issue number must be an integer") from exc
        if not isinstance(clone_url, str) or not clone_url.strip():
            raise OfflineFixtureError("fixture clone_url is required (repository.clone_url or clone_url)")
        if not isinstance(resolved_delivery, str) or not resolved_delivery.strip():
            raise OfflineFixtureError("fixture delivery_id is required when it is not supplied by the caller")

        return cls(
            delivery_id=resolved_delivery.strip(),
            repo=repo.strip(),
            number=issue_number,
            title=str(title),
            clone_url=clone_url.strip(),
            default_branch=str(default_branch),
            event_type=event_type,
            payload=dict(payload),
        )


@dataclass(slots=True, frozen=True)
class OfflineReplayResult:
    delivery_id: str
    repo: str
    issue_number: int
    state: str
    branch: str
    workspace: str
    result_path: str

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def load_fixture(path: Path, *, delivery_id: str | None = None) -> OfflineFixture:
    """Load a recorded webhook payload from JSON."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise OfflineFixtureError(f"cannot read fixture {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise OfflineFixtureError("fixture must be a JSON object")
    return OfflineFixture.from_payload(data, delivery_id=delivery_id)


def assert_local_clone_url(clone_url: str) -> None:
    """Reject any fixture clone URL that could reach the network."""
    parsed = urlparse(clone_url)
    if parsed.scheme in ("http", "https", "ssh", "git"):
        raise OfflineFixtureError(f"offline replay refuses remote clone_url: {clone_url}")
    raw = clone_url.removeprefix("file://")
    path = Path(raw).expanduser()
    if not path.exists():
        raise OfflineFixtureError(f"offline clone_url does not exist locally: {clone_url}")


def seed_fixture(db: Database, fixture: OfflineFixture) -> EventRow:
    """Insert or replace an inactive fixture row; active rows conflict."""
    existing = db.get_event(fixture.delivery_id)
    if existing is not None and existing.state in ("queued", "running"):
        raise OfflineReplayConflict(f"{fixture.delivery_id} is already {existing.state}")
    if existing is None:
        inserted = db.record_event(
            delivery_id=fixture.delivery_id,
            event_type=fixture.event_type,
            repo=fixture.repo,
            issue_key=fixture.issue_key,
            payload=fixture.payload,
            state="queued",
        )
        if not inserted:
            raise OfflineReplayConflict(f"{fixture.delivery_id} was inserted concurrently")
    elif not db.replace_event_if_state_in(
        delivery_id=fixture.delivery_id,
        event_type=fixture.event_type,
        repo=fixture.repo,
        issue_key=fixture.issue_key,
        payload=fixture.payload,
        state="queued",
        allowed_existing_states=INACTIVE_EVENT_STATES,
    ):
        raise OfflineReplayConflict(f"{fixture.delivery_id} is not inactive")
    row = db.get_event(fixture.delivery_id)
    if row is None:  # pragma: no cover — insert/replace above guarantees it
        raise OfflineReplayError(f"{fixture.delivery_id} vanished after seeding")
    return row


def replay_offline(
    *,
    settings: Settings,
    db: Database,
    delivery_id: str,
    force: bool = False,
) -> OfflineReplayResult:
    """Run one event through claim → local worktree → persisted result."""
    row = db.get_event(delivery_id)
    if row is None:
        raise OfflineFixtureError(f"unknown delivery: {delivery_id}")

    if row.state == "running":
        # Crash/restart recovery: an interrupted replay is recoverable without
        # --force; this mirrors WorkerPool.start()'s stuck-running sweep.
        db.requeue_event(delivery_id, from_states=("running",))
    elif row.state in INACTIVE_EVENT_STATES:
        if not force:
            raise OfflineReplayConflict(
                f"{delivery_id} is {row.state}; terminal events require --force"
            )
        db.requeue_event(delivery_id, from_states=INACTIVE_EVENT_STATES)

    claimed = db.claim_event(delivery_id)
    if claimed is None:
        current = db.get_event(delivery_id)
        state = current.state if current is not None else "missing"
        raise OfflineReplayConflict(f"{delivery_id} could not be claimed (state={state})")

    try:
        fixture = OfflineFixture.from_payload(claimed.payload, delivery_id=claimed.delivery_id)
        assert_local_clone_url(fixture.clone_url)
        sandbox = SandboxManager(settings.workspace_root)
        workspace = sandbox.ensure_workspace(
            repo=fixture.repo,
            number=fixture.number,
            title=fixture.title,
            clone_url=fixture.clone_url,
            default_branch=fixture.default_branch,
            author_name=settings.resolved_author_name,
            author_email=settings.git_author_email or "robomp@invalid",
        )
        result_path = workspace.artifacts_dir / "offline-result.json"
        result = {
            "delivery_id": fixture.delivery_id,
            "state": "done",
            "repo": fixture.repo,
            "issue_number": fixture.number,
            "workspace": str(workspace.root),
            "branch": workspace.branch,
            "no_network": True,
            "agent_invoked": False,
        }
        result_path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        db.upsert_issue(
            key=fixture.issue_key,
            repo=fixture.repo,
            number=fixture.number,
            state="new",
            branch=workspace.branch,
            session_dir=str(workspace.session_dir),
        )
        db.mark_event(delivery_id, "done")
        return OfflineReplayResult(
            delivery_id=delivery_id,
            repo=fixture.repo,
            issue_number=fixture.number,
            state="done",
            branch=workspace.branch,
            workspace=str(workspace.root),
            result_path=str(result_path),
        )
    except (OfflineReplayError, GitCommandError, OSError, ValueError) as exc:
        db.mark_event(delivery_id, "failed", error=redact_credentials(str(exc)))
        raise


__all__ = [
    "OfflineFixture",
    "OfflineFixtureError",
    "OfflineReplayConflict",
    "OfflineReplayError",
    "OfflineReplayResult",
    "assert_local_clone_url",
    "load_fixture",
    "replay_offline",
    "seed_fixture",
]
