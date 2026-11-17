from __future__ import annotations

import json
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import httpx
import pytest
from click.testing import CliRunner

from robomp.acceptance import verify_running
from robomp.cli import main
from robomp.config import reset_settings_cache


@pytest.fixture
def running_http() -> Iterator[tuple[str, list[tuple[str, str]], dict[str, Any]]]:
    requests: list[tuple[str, str]] = []
    payloads: dict[str, Any] = {
        "/healthz": {"status": "ok"},
        "/readyz": {"status": "ready"},
        "/api/status": {"runtime": {"bot_login": "acceptance-bot"}, "inflight": []},
        "/events": {"events": [{"delivery_id": "one", "state": "done"}]},
        "/issues": {"issues": []},
        "/releases": {"releases": []},
    }

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            requests.append((self.command, self.path))
            payload = payloads.get(self.path)
            self.send_response(200 if payload is not None else 404)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(payload).encode())

        def log_message(self, format: str, *args: Any) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", requests, payloads
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_running_verification_reads_http_without_claiming_external_acceptance(
    running_http: tuple[str, list[tuple[str, str]], dict[str, Any]],
) -> None:
    url, requests, _ = running_http
    result = verify_running(url)
    assert result["running_http_verified"] is True
    assert result["bot_login"] == "acceptance-bot"
    assert result["visible_rows"] == {"events": 1, "issues": 0, "releases": 0}
    assert result["github_writes_verified"] is False
    assert result["agent_execution_verified"] is False
    assert result["container_contract_verified"] is False
    assert requests == [("GET", endpoint) for endpoint in result["endpoints"]]


def test_running_verification_cli_needs_no_local_github_configuration(
    running_http: tuple[str, list[tuple[str, str]], dict[str, Any]], monkeypatch: pytest.MonkeyPatch
) -> None:
    url, _, _ = running_http
    monkeypatch.setenv("GITHUB_TOKEN", "")
    monkeypatch.setenv("ROBOMP_GH_PROXY_URL", "")
    monkeypatch.setenv("ROBOMP_GH_PROXY_HMAC_KEY", "")
    monkeypatch.setenv("GITHUB_WEBHOOK_SECRET", "")
    reset_settings_cache()
    try:
        result = CliRunner().invoke(main, ["verify-running", "--url", url])
        assert result.exit_code == 0, result.output
        assert json.loads(result.output)["running_http_verified"] is True
    finally:
        reset_settings_cache()


def test_unready_or_malformed_deployment_fails_cli(
    running_http: tuple[str, list[tuple[str, str]], dict[str, Any]],
) -> None:
    url, _, payloads = running_http
    payloads["/readyz"] = {"status": "starting"}
    with pytest.raises(ValueError, match="did not report ready"):
        verify_running(url)
    result = CliRunner().invoke(main, ["verify-running", "--url", url])
    assert result.exit_code == 1
    assert "running verification failed" in result.output
    payloads["/readyz"] = {"status": "ready"}
    payloads["/events"] = {"events": "not-a-list"}
    with pytest.raises(ValueError, match="missing its events list"):
        verify_running(url)


def test_redirects_are_not_followed_to_another_target() -> None:
    requests: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(str(request.url))
        return httpx.Response(302, headers={"location": "https://different-target.invalid/"})

    with pytest.raises(httpx.HTTPStatusError):
        verify_running("http://robomp.invalid/", transport=httpx.MockTransport(handle))
    assert requests == ["http://robomp.invalid/healthz"]
