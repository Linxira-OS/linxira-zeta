# 0046. Studio workspace file resources use the existing Host authority

- **Status:** Proposed
- **Date:** 2026-11-15
- **Deciders:** Zeta maintainers
- **Links:** [REQ-099](../requirements-ledger.md), [ADR 0044](0044-studio-tag-sync-automation.md)

## Context

Studio v0.2.1 file viewers and editors consume workspace.file.inspect, workspace.file.readText, workspace.file.readChunk and workspace.file.writeText. The renderer contracts are present but Zeta's Host has no producers. Electron and SSH clients must read the same files through the existing authenticated Host, without a second filesystem authority.

## Decision

Port the official v0.2.1 workspace file service semantics into the Zeta gateway and register the four typed Studio operations in its existing files family. Resolve opaque workspace ids through the hidden-inclusive project inventory; retain the existing cookie, CSRF, context and device-binding gates. Resolve both the workspace root and target through realpath and refuse files outside the requested workspace, including symlink escapes. Absolute/file-URL links are accepted only when their canonical target is inside that workspace.

Use canonical file identity and the upstream stat version tuple (size, mtime, ctime, inode). Chunk reads are at most 512 KiB, require the inspected version and accept only safe non-negative offsets. Text reads and writes are limited to 8 MiB, preserve UTF-8/UTF-16 BOM and line-ending metadata, and reject unsupported binary text. Writes serialize per canonical file, compare expectedVersion and atomically replace via a same-directory temporary file, preserving permissions. Version conflicts return the current file rather than overwriting newer data.

Desktop FileResources uses these operations over its existing authenticated local/SSH transport. A file resource is owned by the renderer window that opened it; closing that owner releases the resource. Office conversion remains a separate signed-component capability and cannot be advertised without a real provider.

## Consequences

The file viewer and editor use one Host implementation across browser, Electron and SSH. The file identity never grants access by itself: every operation re-resolves its workspace and path. Existing artifact and file-tree routes retain their contracts. This ADR remains Proposed until focused filesystem behavior, current-source desktop tests and real viewer acceptance are recorded.

## Alternatives

- Read directly in Electron: rejected because SSH and bound-device behavior would diverge.
- Use unversioned whole-file downloads for all viewers: rejected because large range reads and concurrent editing require bounded reads and explicit conflicts.

## Links

- [Host file family](../../packages/coding-agent/src/server/studio-host/ops/files.ts)
- [Renderer file contract](../../web-app/src/vendor/client-contract/src/files.ts)
- [Studio surfaces](../../docs/studio-surfaces.md)
