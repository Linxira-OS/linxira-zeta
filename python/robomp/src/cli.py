"""Command-line interface."""

from __future__ import annotations

import asyncio
import dataclasses
import json
import os
import sys
from pathlib import Path

import click
import uvicorn

from robomp.config import Settings, get_settings, reset_settings_cache
from robomp.db import INACTIVE_EVENT_STATES, get_database
from robomp.git_ops import GitCommandError
from robomp.logging_config import configure_logging
from robomp.manual_triage import (
    InvalidIssueRef,
    ManualTriageError,
    ManualTriageTimeout,
    await_terminal_state,
    enqueue_manual_triage,
    parse_issue_ref,
)
from robomp.offline import (
    OfflineFixtureError,
    OfflineReplayConflict,
    load_fixture,
    replay_offline,
    seed_fixture,
)
from robomp.proxy_client import GitHubProxyClient
from robomp.sandbox import SandboxManager
from robomp.server import create_app


def _settings_or_die(*, offline: bool = False) -> Settings:
    if offline:
        os.environ["ROBOMP_OFFLINE"] = "1"
        reset_settings_cache()
    try:
        return get_settings()
    except Exception as exc:
        click.echo(f"configuration error: {exc}", err=True)
        sys.exit(2)


def _require_proxy_mode(cfg: Settings) -> tuple[str, bytes]:
    if cfg.github_token is not None:
        raise SystemExit(
            "robomp orchestrator refuses to start with GITHUB_TOKEN set in env. "
            "The PAT must live only in the gh-proxy container."
        )
    if cfg.gh_proxy_url is None or cfg.gh_proxy_hmac_key is None:
        raise SystemExit(
            "robomp orchestrator requires ROBOMP_GH_PROXY_URL and "
            "ROBOMP_GH_PROXY_HMAC_KEY (run gh-proxy in a sibling container)."
        )
    return cfg.gh_proxy_url, cfg.gh_proxy_hmac_key.get_secret_value().encode("utf-8")


def _build_github(cfg: Settings) -> GitHubProxyClient:
    base_url, key = _require_proxy_mode(cfg)
    return GitHubProxyClient(base_url=base_url, hmac_key=key)


def _default_wait_timeout(cfg: Settings) -> float:
    return cfg.task_timeout_seconds + cfg.task_timeout_hard_grace_seconds + 30.0


@click.group()
def main() -> None:
    """roboomp control surface."""


@main.command()
def serve() -> None:
    """Run the webhook receiver + worker pool."""
    cfg = _settings_or_die()
    if cfg.offline:
        raise SystemExit("serve requires GitHub webhook mode; unset ROBOMP_OFFLINE")
    configure_logging(cfg.log_dir)
    cfg.ensure_paths()
    app = create_app(cfg)
    uvicorn.run(app, host=cfg.bind_host, port=cfg.bind_port, log_config=None)


@main.command()
@click.argument("issue_ref", required=False)
@click.option(
    "--fixture",
    type=click.Path(exists=True, dir_okay=False, path_type=Path),
    default=None,
    help="Recorded issues.opened payload for --offline replay.",
)
@click.option("--offline", is_flag=True, help="Run the local fixture pipeline; no GitHub client or network.")
@click.option(
    "--wait-timeout",
    type=click.FloatRange(min=0.1),
    default=None,
    help="Seconds to wait for a terminal state before returning non-zero (default: task timeout + hard grace + 30).",
)
def triage(issue_ref: str | None, fixture: Path | None, offline: bool, wait_timeout: float | None) -> None:
    """Fetch a live issue and queue it as if a webhook arrived.

    ISSUE_REF is `owner/repo#NN`. With `--offline --fixture`, ISSUE_REF may be
    omitted and the fixture supplies the repo/number.
    """
    if offline:
        if fixture is None:
            click.echo("--offline requires --fixture", err=True)
            sys.exit(2)
        cfg = _settings_or_die(offline=True)
        cfg.ensure_paths()
        try:
            recorded = load_fixture(fixture)
            if issue_ref is not None:
                repo_full, number = parse_issue_ref(issue_ref)
                if (repo_full.lower(), number) != (recorded.repo.lower(), recorded.number):
                    raise OfflineFixtureError(
                        f"fixture is {recorded.repo}#{recorded.number}, not {repo_full}#{number}"
                    )
            db = get_database(cfg.sqlite_path)
            seed_fixture(db, recorded)
            result = replay_offline(settings=cfg, db=db, delivery_id=recorded.delivery_id)
        except (InvalidIssueRef, OfflineFixtureError, OfflineReplayConflict, GitCommandError) as exc:
            click.echo(f"offline replay failed: {exc}", err=True)
            sys.exit(2)
        click.echo(json.dumps(result.as_dict(), indent=2))
        return

    if issue_ref is None:
        click.echo("ISSUE_REF is required unless --offline --fixture is used", err=True)
        sys.exit(2)
    cfg = _settings_or_die()
    configure_logging(cfg.log_dir)
    cfg.ensure_paths()
    try:
        repo_full, number = parse_issue_ref(issue_ref)
    except InvalidIssueRef as exc:
        click.echo(str(exc), err=True)
        sys.exit(2)
    if not cfg.allows(repo_full):
        click.echo(f"refusing: {repo_full} not in ROBOMP_REPO_ALLOWLIST", err=True)
        sys.exit(2)

    async def _go() -> None:
        github = _build_github(cfg)
        db = get_database(cfg.sqlite_path)
        try:
            delivery = await enqueue_manual_triage(
                db=db,
                github=github,
                repo_full=repo_full,
                number=number,
            )
        except ManualTriageError as exc:
            click.echo(f"refusing: {exc}", err=True)
            sys.exit(2)
        # The dispatcher loop lives in the long-running `serve` process; we
        # only watch the row land in a terminal state. Wake latency is
        # bounded by `WorkerPool._dispatch_loop`'s 10s `_wakeup.wait()` fallback.
        click.echo(json.dumps({"delivery": delivery, "state": "queued"}, indent=2))
        timeout = wait_timeout if wait_timeout is not None else _default_wait_timeout(cfg)
        try:
            final = await await_terminal_state(db, delivery, timeout=timeout)
        except ManualTriageTimeout as exc:
            click.echo(
                json.dumps(
                    {"delivery": delivery, "state": exc.state, "timed_out": True, "error": str(exc)},
                    indent=2,
                ),
                err=True,
            )
            sys.exit(1)
        if final is None:
            click.echo(json.dumps({"delivery": delivery, "state": "missing"}, indent=2))
            return
        click.echo(
            json.dumps(
                {"delivery": delivery, "state": final.state, "error": final.last_error},
                indent=2,
            )
        )

    asyncio.run(_go())


@main.command()
@click.argument("delivery_id")
@click.option(
    "--fixture",
    type=click.Path(exists=True, dir_okay=False, path_type=Path),
    default=None,
    help="Seed a missing recorded event before replaying.",
)
@click.option("--offline", is_flag=True, help="Run claim → local worktree → result; no GitHub client or network.")
@click.option("--force", is_flag=True, help="Replay a terminal (done/failed/skipped) delivery.")
@click.option(
    "--wait-timeout",
    type=click.FloatRange(min=0.1),
    default=None,
    help="Seconds to wait for a terminal state before returning non-zero (default: task timeout + hard grace + 30).",
)
def replay(
    delivery_id: str,
    fixture: Path | None,
    offline: bool,
    force: bool,
    wait_timeout: float | None,
) -> None:
    """Re-enqueue a stored event so the running `serve` pool can pick it up.

    With `--offline`, run the deterministic local pipeline instead and never
    contact GitHub.
    """
    if offline:
        cfg = _settings_or_die(offline=True)
        cfg.ensure_paths()
        db = get_database(cfg.sqlite_path)
        try:
            if fixture is not None:
                recorded = load_fixture(fixture)
                if recorded.delivery_id != delivery_id:
                    raise OfflineFixtureError(
                        f"fixture delivery is {recorded.delivery_id}, not {delivery_id}"
                    )
                if db.get_event(delivery_id) is None:
                    seed_fixture(db, recorded)
            result = replay_offline(settings=cfg, db=db, delivery_id=delivery_id, force=force)
        except (OfflineFixtureError, OfflineReplayConflict, GitCommandError) as exc:
            click.echo(f"offline replay failed: {exc}", err=True)
            sys.exit(2)
        click.echo(json.dumps(result.as_dict(), indent=2))
        return

    cfg = _settings_or_die()
    configure_logging(cfg.log_dir)
    cfg.ensure_paths()
    db = get_database(cfg.sqlite_path)
    row = db.get_event(delivery_id)
    if row is None:
        click.echo(f"unknown delivery: {delivery_id}", err=True)
        sys.exit(2)
    if not db.requeue_event(delivery_id, from_states=INACTIVE_EVENT_STATES):
        click.echo(
            f"delivery {delivery_id} is {row.state}; only inactive events can be replayed",
            err=True,
        )
        sys.exit(2)

    async def _wait() -> None:
        timeout = wait_timeout if wait_timeout is not None else _default_wait_timeout(cfg)
        try:
            final = await await_terminal_state(db, delivery_id, timeout=timeout)
        except ManualTriageTimeout as exc:
            click.echo(
                json.dumps(
                    {"delivery": delivery_id, "state": exc.state, "timed_out": True, "error": str(exc)},
                    indent=2,
                ),
                err=True,
            )
            sys.exit(1)
        if final is None:
            click.echo(json.dumps({"delivery": delivery_id, "state": "missing"}, indent=2))
            return
        click.echo(
            json.dumps(
                {"delivery": delivery_id, "state": final.state, "error": final.last_error},
                indent=2,
            )
        )

    asyncio.run(_wait())


@main.command()
@click.option("--offline", is_flag=True, help="Read local state without requiring GitHub credentials.")
@click.option("--json", "as_json", is_flag=True, help="Emit machine-readable queue/issue/release state.")
def status(offline: bool, as_json: bool) -> None:
    """Dump issue and release state."""
    cfg = _settings_or_die(offline=offline)
    cfg.ensure_paths()
    db = get_database(cfg.sqlite_path)
    issue_rows = db.list_issues()
    release_rows = db.list_releases()
    if as_json:
        click.echo(
            json.dumps(
                {
                    "events": [dataclasses.asdict(row) for row in db.list_events(limit=50)],
                    "issues": [dataclasses.asdict(row) for row in issue_rows],
                    "releases": [dataclasses.asdict(row) for row in release_rows],
                },
                indent=2,
                default=str,
            )
        )
        return
    for row in issue_rows:
        click.echo(
            f"{row.key:<40} state={row.state:<12} pr={row.pr_number or '-'} "
            f"branch={row.branch or '-'} updated={row.updated_at}"
        )
    release_rows = db.list_releases()
    if release_rows:
        if issue_rows:
            click.echo()
        click.echo("Releases:")
    for row in release_rows:
        error = f" error={row.last_error}" if row.last_error else ""
        click.echo(
            f"{row.key:<40} state={row.state:<12} rounds={row.rounds:<2} "
            f"sha={row.current_sha[:12]} updated={row.updated_at}{error}"
        )


@main.command()
@click.argument("issue_key")
def cleanup(issue_key: str) -> None:
    """Force-remove the workspace for an issue (does not touch the remote)."""
    cfg = _settings_or_die()
    cfg.ensure_paths()
    db = get_database(cfg.sqlite_path)
    row = db.get_issue(issue_key)
    if row is None:
        click.echo(f"unknown issue: {issue_key}", err=True)
        sys.exit(2)
    sandbox = SandboxManager(cfg.workspace_root)
    sandbox.remove_workspace(repo=row.repo, number=row.number)
    db.set_issue_state(issue_key, "abandoned")
    click.echo(f"cleaned up {issue_key}")


if __name__ == "__main__":
    main()
