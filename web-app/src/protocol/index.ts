/**
 * Studio protocol surface, vendored from the upstream Studio contract for the Zeta port (MIT — see
 * THIRD-PARTY-NOTICES.txt).
 *
 * Everything under `contract/` and `protocol/` is **types and pure
 * validation**: no transport, no client implementation, no Studio runtime.
 *
 * Import targets, mirroring the two upstream packages:
 *   `@/lib/studio-protocol/contract`  ← `@linxiraos/studio-contract`
 *   `@/lib/studio-protocol/protocol`  ← `@linxiraos/studio-protocol`
 *
 * The renderer ported under `components/studio/**` talks to `StudioClient`
 * (`lib/studio-client`), whose implementation maps each query/command onto a
 * Zeta gateway endpoint. One adapter at the boundary instead of rewriting 90k
 * lines of rendering code — and the wire protocol stays Zeta's own.
 */
export * from "./contract/index.js";
