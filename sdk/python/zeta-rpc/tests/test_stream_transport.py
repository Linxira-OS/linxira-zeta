"""Attaching over a JSONL stream pair (a WebSocket bridge, a socketpair).

The backend exposes the protocol over WebSocket; this SDK stays transport-free,
so the adapter is any pair of text streams. The test stands a fake server on the
other side of the pair and drives real commands through the generated client.
"""

from __future__ import annotations

import json
import queue
import threading
import unittest
from typing import Any

from zeta_rpc import RpcClient


class _QueueReader:
    """Newline-per-item reader; `close()` ends the iteration."""

    def __init__(self) -> None:
        self._lines: queue.Queue[str | None] = queue.Queue()

    def feed(self, line: str) -> None:
        self._lines.put(line + "\n")

    def close(self) -> None:
        self._lines.put(None)

    def __iter__(self):
        return self

    def __next__(self) -> str:
        line = self._lines.get(timeout=5.0)
        if line is None:
            raise StopIteration
        return line


class _QueueWriter:
    """Collects written lines for the fake server thread."""

    def __init__(self) -> None:
        self._lines: queue.Queue[str] = queue.Queue()
        self._buffer = ""

    def write(self, text: str) -> int:
        self._buffer += text
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            if line:
                self._lines.put(line)
        return len(text)

    def flush(self) -> None:
        return None

    def close(self) -> None:
        self._lines.put("")

    def read_command(self, timeout: float = 5.0) -> dict[str, Any] | None:
        line = self._lines.get(timeout=timeout)
        return json.loads(line) if line else None


def _response(command: dict[str, Any], data: Any) -> dict[str, Any]:
    return {
        "id": command.get("id"),
        "type": "response",
        "command": command["type"],
        "success": True,
        "data": data,
    }


class StreamTransportTest(unittest.TestCase):
    def test_attach_speaks_the_protocol_over_arbitrary_streams(self) -> None:
        reader = _QueueReader()
        writer = _QueueWriter()
        reader.feed(
            json.dumps(
                {
                    "type": "ready",
                    "protocolVersion": 1,
                    "supportedProtocolVersions": [1],
                    "maxFrameBytes": 1048576,
                    "maxReassembledFrameBytes": 67108864,
                }
            )
        )
        client = RpcClient().attach(reader, writer)

        components = [
            {"id": "zetacode", "command": "zetacode", "openable": False, "reason": "runtime"},
            {"id": "zetaide", "command": "zetaide", "openable": True, "path": "/usr/bin/zetaide"},
        ]

        def server() -> None:
            first = writer.read_command()
            assert first is not None
            reader.feed(json.dumps(_response(first, {"components": components})))
            reader.feed(json.dumps({"type": "agent_start"}))
            second = writer.read_command()
            assert second is not None
            reader.feed(json.dumps(_response(second, None)))

        thread = threading.Thread(target=server, daemon=True)
        thread.start()
        try:
            listed = client.component_list()
            self.assertEqual([entry.id for entry in listed.components], ["zetacode", "zetaide"])
            self.assertTrue(listed.components[1].openable)
            client.abort()
            thread.join(timeout=5.0)
        finally:
            self.assertTrue(client.stop())
            self.assertIsNone(client._process)
            self.assertFalse(client._started)

    def test_attach_refuses_a_second_transport(self) -> None:
        reader = _QueueReader()
        writer = _QueueWriter()
        reader.feed(
            json.dumps(
                {
                    "type": "ready",
                    "protocolVersion": 1,
                    "supportedProtocolVersions": [1],
                    "maxFrameBytes": 1048576,
                    "maxReassembledFrameBytes": 67108864,
                }
            )
        )
        client = RpcClient().attach(reader, writer)
        try:
            with self.assertRaises(Exception):
                client.attach(_QueueReader(), _QueueWriter())
        finally:
            client.stop()


if __name__ == "__main__":
    unittest.main()
