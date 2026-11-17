"""Read-only evidence from an already-running robomp deployment.

This probes the real HTTP surface. It never submits an event or invokes a
GitHub write, and must not be presented as acceptance of those operations.
"""

from __future__ import annotations

from typing import Any

import httpx


def verify_running(
    base_url: str,
    *,
    timeout: float = 10.0,
    transport: httpx.BaseTransport | None = None,
) -> dict[str, Any]:
    """Require health, readiness and durable-state endpoints to answer correctly."""
    with httpx.Client(
        base_url=base_url.rstrip("/") + "/",
        timeout=timeout,
        transport=transport,
        trust_env=False,
        follow_redirects=False,
    ) as client:
        captured: dict[str, dict[str, Any]] = {}
        for endpoint in ("healthz", "readyz", "api/status", "events", "issues", "releases"):
            response = client.get(endpoint)
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict):
                raise ValueError(f"/{endpoint} did not return a JSON object")
            captured[endpoint] = payload

    if captured["healthz"].get("status") != "ok":
        raise ValueError("/healthz did not report ok")
    if captured["readyz"].get("status") != "ready":
        raise ValueError("/readyz did not report ready")
    status = captured["api/status"]
    runtime = status.get("runtime")
    if not isinstance(runtime, dict) or not isinstance(runtime.get("bot_login"), str):
        raise ValueError("/api/status is missing its runtime identity")
    if not isinstance(status.get("inflight"), list):
        raise ValueError("/api/status is missing its inflight projection")
    counts: dict[str, int] = {}
    for endpoint in ("events", "issues", "releases"):
        rows = captured[endpoint].get(endpoint)
        if not isinstance(rows, list):
            raise ValueError(f"/{endpoint} is missing its {endpoint} list")
        counts[endpoint] = len(rows)
    return {
        "running_http_verified": True,
        "bot_login": runtime["bot_login"],
        "endpoints": [f"/{endpoint}" for endpoint in captured],
        "visible_rows": counts,
        "github_writes_verified": False,
        "agent_execution_verified": False,
        "container_contract_verified": False,
    }
