import { describe, expect, test } from "bun:test";
import { StudioHost, StudioOperations } from "../src/server/studio-host/index.js";

const ORIGIN = "http://127.0.0.1:43150";
const ops = new StudioOperations([
  {
    id: "test",
    queries: { "environment.get": async () => ({}) },
    commands: { "core.abort": async () => undefined },
  } as never,
]);
const host = new StudioHost(ops);

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`http://127.0.0.1${path}`, {
    ...init,
    headers: { origin: ORIGIN, ...(init.headers as Record<string, string> | undefined) },
  });
}

async function bootstrap(remoteAddr: string): Promise<Response> {
  return host.handle(request("/api/v1/bootstrap"), remoteAddr);
}

async function credentials(): Promise<{ cookie: string; csrf: string }> {
  const response = await bootstrap("127.0.0.1");
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie");
  const csrf = response.headers.get("x-studio-csrf");
  expect(cookie).toContain("studio_session=");
  expect(csrf).toBeTruthy();
  return { cookie: cookie!, csrf: csrf! };
}

describe("Studio host loopback auth", () => {
  test("loopback bootstrap auto-pairs and returns CSRF", async () => {
    const response = await bootstrap("127.0.0.1");
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("studio_session=");
    expect(response.headers.get("x-studio-csrf")).toBeTruthy();
  });

  test("non-loopback bootstrap remains unauthenticated", async () => {
    const response = await bootstrap("203.0.113.9");
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-studio-csrf")).toBeNull();
  });

  test("query works with the minted cookie", async () => {
    const { cookie } = await credentials();
    const response = await host.handle(
      request("/api/v1/query", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ queryName: "environment.get", input: {} }),
      }),
      "127.0.0.1",
    );
    expect(response.status).toBe(200);
    expect((await response.json()) as { ok: boolean }).toMatchObject({ ok: true });
  });

  test("command requires the CSRF returned by bootstrap", async () => {
    const { cookie, csrf } = await credentials();
    const body = JSON.stringify({
      commandName: "core.abort",
      input: {},
      idempotencyKey: "probe",
      requestId: "probe",
    });
    const rejected = await host.handle(
      request("/api/v1/command", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body,
      }),
      "127.0.0.1",
    );
    expect(rejected.status).toBe(401);

    const accepted = await host.handle(
      request("/api/v1/command", {
        method: "POST",
        headers: { cookie, "x-studio-csrf": csrf, "content-type": "application/json" },
        body,
      }),
      "127.0.0.1",
    );
    expect(accepted.status).toBe(202);
    expect((await accepted.json()) as { status: string }).toMatchObject({ status: "accepted" });
  });
});
