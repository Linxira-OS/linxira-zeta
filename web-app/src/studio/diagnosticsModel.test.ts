import { describe, expect, test } from "bun:test";
import type {
  EnvironmentReadModel,
  RuntimeConnection,
  RuntimeInstallState,
} from "@linxiraos/studio-contract";
import {
  deriveDiagnosticsView,
  isSignatureNotApplicable,
  isSystemRuntime,
  isUnmanagedSystemRuntime,
  runtimeCanReconnect,
  type DiagnosticsViewModel,
} from "./diagnosticsModel";

const SYSTEM_RUNTIME: RuntimeConnection = {
  status: "connected",
  classification: "compatible-system",
  backend: "studio-host",
  runtimeVersion: "1.5.1",
};

const NO_MANAGED_INSTALL: RuntimeInstallState = { status: "not-installed", signature: "unknown" };

function environment(
  runtime: RuntimeConnection,
  installer: RuntimeInstallState,
): EnvironmentReadModel {
  return {
    platform: "win32",
    arch: "x64",
    authority: { authorityId: "authority-test" as EnvironmentReadModel["authority"]["authorityId"], authorityEpoch: 1 as EnvironmentReadModel["authority"]["authorityEpoch"] },
    runtime,
    installer,
  };
}

function view(runtime: RuntimeConnection | undefined, installer: RuntimeInstallState | undefined): DiagnosticsViewModel {
  return deriveDiagnosticsView(
    {
      ...(runtime === undefined ? {} : { runtime }),
      ...(installer === undefined ? {} : { environment: environment(runtime ?? SYSTEM_RUNTIME, installer) }),
    },
    (key) => key,
  );
}

function check(checks: DiagnosticsViewModel["checks"], id: string) {
  const found = checks.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`missing check ${id}`);
  return found;
}

describe("diagnostics model runtime states", () => {
  test("a connected source/dev runtime with no managed install is healthy, not missing", () => {
    const derived = view(SYSTEM_RUNTIME, NO_MANAGED_INSTALL);
    expect(derived.hero.kind).toBe("ok");
    expect(derived.hero.title).toBe("diagnostics.heroSystemRuntimeTitle");
    expect(derived.hero.title).not.toBe("diagnostics.heroNotInstalledTitle");
    expect(derived.hero.primary).toBe("recheck");
    expect(derived.hero.showReinstall).toBe(false);
    expect(derived.hero.detail).toContain("diagnostics.heroSignatureNotApplicable");

    expect(check(derived.checks, "runtime").tone).toBe("ok");
    const install = check(derived.checks, "install");
    expect(install.tone).toBe("ok");
    expect(install.action).toBeUndefined();
    expect(install.detail).toBe("diagnostics.managedRuntimeBundled");
    const signature = check(derived.checks, "signature");
    expect(signature.tone).toBe("ok");
    expect(signature.detail).toBe("diagnostics.signatureNotApplicable");
  });

  test("a managed runtime with a verified install keeps green checks", () => {
    const runtime: RuntimeConnection = { ...SYSTEM_RUNTIME, classification: "managed" };
    const installer: RuntimeInstallState = { status: "installed", version: "1.5.1", signature: "verified" };
    const derived = view(runtime, installer);
    expect(derived.hero.kind).toBe("ok");
    expect(derived.hero.showReinstall).toBe(true);
    expect(check(derived.checks, "install").tone).toBe("ok");
    expect(check(derived.checks, "signature").detail).toBe("diagnostics.signatureVerified");
  });

  test("an unsigned artifact is a signature failure, not an unknown status", () => {
    const runtime: RuntimeConnection = { ...SYSTEM_RUNTIME, classification: "managed" };
    const installer: RuntimeInstallState = { status: "installed", version: "1.5.1", signature: "unverified" };
    const derived = view(runtime, installer);
    const signature = check(derived.checks, "signature");
    expect(signature.tone).toBe("error");
    expect(signature.detail).toBe("diagnostics.signatureUnverified");
  });

  test("an unknown signature on an existing artifact stays a warning", () => {
    const runtime: RuntimeConnection = { ...SYSTEM_RUNTIME, classification: "managed" };
    const installer: RuntimeInstallState = { status: "installed", version: "1.5.1", signature: "unknown" };
    const derived = view(runtime, installer);
    expect(check(derived.checks, "signature").tone).toBe("warn");
    expect(check(derived.checks, "signature").detail).toBe("diagnostics.signatureUnknown");
  });

  test("a connected runtime without a managed record is a notice with an optional install", () => {
    const runtime: RuntimeConnection = { ...SYSTEM_RUNTIME, classification: "managed" };
    const derived = view(runtime, NO_MANAGED_INSTALL);
    expect(derived.hero.kind).toBe("notice");
    expect(derived.hero.title).toBe("diagnostics.heroManagedRecordMissingTitle");
    expect(derived.hero.primary).toBe("recheck");
    const install = check(derived.checks, "install");
    expect(install.tone).toBe("warn");
    expect(install.action).toBe("install");
  });

  test("a local artifact turns the missing record into an offered install", () => {
    const runtime: RuntimeConnection = { ...SYSTEM_RUNTIME, classification: "managed" };
    const installer: RuntimeInstallState = {
      status: "not-installed",
      signature: "verified",
      availableVersion: "1.5.2",
    };
    const derived = view(runtime, installer);
    expect(derived.hero.kind).toBe("notice");
    expect(derived.hero.primary).toBe("install");
    expect(check(derived.checks, "install").detail).toBe("diagnostics.notInstalledWithArtifact");
  });

  test("a failed runtime probe is still an error with reconnect guidance", () => {
    const runtime: RuntimeConnection = {
      status: "unavailable",
      classification: "unavailable",
      unavailableCode: "not-wired",
      unavailableReason: "the Zeta gateway did not answer its identity probe",
    };
    const derived = view(runtime, NO_MANAGED_INSTALL);
    expect(derived.hero.kind).toBe("down");
    expect(derived.hero.title).toBe("diagnostics.unavailableNotWiredTitle");
    expect(check(derived.checks, "runtime").tone).toBe("error");
    expect(check(derived.checks, "install").tone).toBe("error");
    // `not-wired` cannot be recovered by runtime.ensure, so no reconnect action.
    expect(runtimeCanReconnect(runtime)).toBe(false);
    expect(derived.hero.primary).toBe("recheck");
  });

  test("a recoverable probe failure offers reconnect", () => {
    const runtime: RuntimeConnection = {
      status: "unavailable",
      classification: "unavailable",
      unavailableCode: "launch-failed",
    };
    expect(runtimeCanReconnect(runtime)).toBe(true);
    expect(view(runtime, NO_MANAGED_INSTALL).hero.primary).toBe("reconnect");
  });

  test("helpers separate system, managed and not-applicable states", () => {
    expect(isSystemRuntime(SYSTEM_RUNTIME)).toBe(true);
    expect(isSystemRuntime({ ...SYSTEM_RUNTIME, classification: "managed" })).toBe(false);
    expect(isUnmanagedSystemRuntime(SYSTEM_RUNTIME, NO_MANAGED_INSTALL)).toBe(true);
    // The managed install does not appear when the connection drops; the
    // classification still says this host owns the runtime.
    expect(isUnmanagedSystemRuntime({ ...SYSTEM_RUNTIME, status: "unavailable" }, NO_MANAGED_INSTALL)).toBe(true);
    expect(isUnmanagedSystemRuntime({ ...SYSTEM_RUNTIME, classification: "managed" }, NO_MANAGED_INSTALL)).toBe(false);
    expect(isSignatureNotApplicable(NO_MANAGED_INSTALL)).toBe(true);
    expect(isSignatureNotApplicable({ status: "installed", signature: "unknown" })).toBe(false);
    expect(isSignatureNotApplicable({ status: "not-installed", signature: "verified", availableVersion: "1.5.2" })).toBe(false);
  });

  test("a dropped system runtime keeps its disconnect copy without a false install error", () => {
    const runtime: RuntimeConnection = {
      ...SYSTEM_RUNTIME,
      status: "disconnected",
      disconnectCode: "pipe-closed",
    };
    const derived = view(runtime, NO_MANAGED_INSTALL);
    expect(derived.hero.kind).toBe("down");
    expect(derived.hero.title).toBe("diagnostics.disconnectPipeClosedTitle");
    expect(check(derived.checks, "runtime").tone).toBe("error");
    expect(check(derived.checks, "install").tone).toBe("ok");
    expect(check(derived.checks, "install").detail).toBe("diagnostics.managedRuntimeBundled");
    expect(check(derived.checks, "signature").tone).toBe("ok");
  });
});
