# 0059. Studio pins the authoritative SheetJS tarball as a local dependency

- **Status:** Proposed
- **Date:** 2026-11-16
- **Deciders:** Zeta maintainers
- **Links:** [REQ-099](../requirements-ledger.md), [SheetJS installation](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/)

## Context

The integrated spreadsheet worker uses SheetJS xlsx 0.20.3. Its official source is `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`; the public npm registry still exposes 0.18.5. npm12 defaults to rejecting remote tarball dependencies, so the existing lockfile fails the shared-infrastructure gate and a default npm12 install. Rewriting the URL to a nonexistent registry artifact or downgrading would change the shipped parser.

## Decision

Vendor the unchanged official 0.20.3 tarball at `web-app/vendor/xlsx-0.20.3.tgz` and make the renderer dependency and lockfile resolve that local file. Preserve its existing SHA-512 integrity and Apache-2.0 license. Keep npm remote fetching disabled by default; no allow-remote setting or CDN-wide exemption is introduced.

The lockfile guard accepts a local tarball only when the root package declares exactly that file, its canonical path stays inside the package root, it is a regular file, and its SHA-512 bytes match the locked integrity. Mirror and undeclared remote URLs remain rejected. A dependency update replaces the versioned tarball and lockfile together and rechecks provenance/license.

## Consequences

Clean renderer installs do not depend on the SheetJS CDN. The repository carries the upstream tarball and legal notice; runtime bundles retain the same parser version. Verification must exercise an npm12 install using default remote policy, read a workbook with the installed package, and retain the shared-infrastructure guard. This ADR remains Proposed during integration; it does not authorize a release.

## Alternatives

Keep the CDN dependency with `allow-remote=root`: rejected because it adds a remote-install opt-in and retains the external availability dependency. Public registry 0.18.5: rejected because it downgrades the integrated parser. Rewriting the 0.20.3 URL to that registry: rejected because the artifact is not published there.

## Links

- [Renderer dependency](../../web-app/package.json) and [locked integrity](../../web-app/package-lock.json)
- [Shared-infrastructure guard](../../scripts/check-shared-infra.ts) and [source policy](../upstream-commercial-assets.md)
- [Packaged legal notices](../../THIRD-PARTY-NOTICES.txt)
