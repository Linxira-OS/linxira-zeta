# 0034. Owner holds: Android, desktop, audio, and the multi-terminal manager are paused pending explicit re-entry

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** Zeta owner (explicit scope ruling, 2026-11-12)
- **Links:** [roadmap](../roadmap.md), [requirements ledger](../requirements-ledger.md), [Studio surfaces](../../docs/studio-surfaces.md), [Android Tier 1](../../docs/android-tier1.md), [release scope ADR 0033](0033-1-5-2-owner-asset-review.md), [freeze ADR 0006](0006-release-freeze-internal-line.md)

## Context

The 1.5.x line is still the active internal line, with ADR 0033 allowing one
exact 1.5.2 asset-review exception and ADR 0006 governing the rest of the
freeze. The owner has now paused several surfaces that were being considered
for new development or release work, without deleting what already exists:

- **Android:** the CLI/source interface is enough for now; native development
  and a formal release asset are held. The owner's wording is
  「安卓这边可以先挂着，等我后面开，反正现在接口有就行了。我们安卓什么时候开发都没问题」.
- **Desktop:** new desktop development is held; the existing Electron 45 shell,
  SSH bridge source, and packaging evidence are retained.
- **Audio:** TTS/STT, system microphone, and desktop audio remain held:
  「STT TTS、系统麦克风与桌面音频一直暂挂，暂不开发」.
- **Work Studio multi-terminal manager:** the owner asked for a dedicated page
  with a left list of multiple terminals (Orca-like) and referenced
  [ELYTerminal](https://github.com/ELY-Open-Source/ELYTerminal). He asked
  whether to extend `zetaide` or reuse the old `zetawork` TUI with proper
  front/back rendering. No architecture has been chosen.
- **Old TY/TUI PR:** not merged and also held.

The current tree already contains implemented interfaces and source for some of
these areas (Android Gradle/debug build, SSH bridge, dictation bridge, Studio
terminal). A hold must not be recorded as "missing" or "not started", and it
must not be used to add release assets that the owner excluded.

## Decision

The following scope is explicitly held as of 2026-11-12:

1. **Android native development and formal release assets are held.** Android
   is not a release asset for the 1.5.2 review or any other release in this
   train. No device/emulator install, release keystore, or release-signing work
   happens while held. Existing Android source, CLI interface, unit tests, and
   debug-build evidence are preserved.
2. **Desktop new development is held.** Existing desktop runtime, packaging,
   SSH bridge source, and their evidence stay in the tree; this hold does not
   delete them or convert implemented source into a false "missing" claim.
3. **TTS/STT, system microphone, and desktop audio are held.** No new media
   features, audio provider installs/downloads, or hardware claims are added
   while held.
4. **The Work Studio multi-terminal manager page is held, and its architecture
   is undecided.** ELYTerminal is recorded only as an external reference. No
   decision is made between expanding `zetaide` and reusing the old `zetawork`
   TUI rendering architecture, and no manager page/refactor starts now. The
   existing multi-tab terminal (`TerminalPane` / `terminalSessions`, up to four
   restored tabs) stays available; this hold does not claim the terminal was
   absent.
5. **The old TY/TUI PR stays unmerged and held.** No merge, review, comment, or
   branch cleanup is authorized by this ADR.
6. Existing APIs, source, and tests are preserved rather than deleted. SSH
   real-target acceptance may continue as its own lane; this hold does not stop
   it.

Re-entry requires an explicit owner instruction naming the held area. This ADR
does not authorize a release, version bump, tag, push, PR, or main merge.

## Consequences

- Held areas are **not** counted as complete, verified, or releasable. They also
  are not counted as missing implementation when source already exists.
- Android cannot become a formal release asset, and no debug APK is smuggled
  into a release, while the hold stands.
- The 1.5.2 asset review must exclude Android and must not use desktop/audio/
  multi-terminal work as release evidence.
- The roadmap and requirements ledger carry the same holds with re-entry
  triggers; the ledger keeps existing source/build evidence instead of
  promoting it to `VERIFIED`.
- The multi-terminal page has no chosen architecture, so no implementation
  estimate or dependency can be inferred from ELYTerminal's stack. The existing
  multi-tab terminal remains available; only the Orca-like manager page is
  absent.
- Re-entry is deliberate: it happens only when the owner says so, not because a
  related feature happened to land.

## Alternatives

- **Build the multi-terminal manager now on `zetaide`.** Deferred: the owner
  asked for a choice, not a decision; the page remains unscoped.
- **Build it now by reusing the old `zetawork` TUI rendering architecture.**
  Deferred: no front/back rendering contract or architecture comparison exists.
- **Adopt ELYTerminal directly.** Deferred and not chosen: it is a reference,
  not an approved dependency or stack.
- **Treat the Android interface as a release asset.** Rejected: the owner
  explicitly held native development/release and said the existing interface is
  enough for now.
- **Delete the paused desktop/audio/terminal source because it is held.**
  Rejected: the owner asked to pause development, not to remove working source
  and tests.

## Links

- [Roadmap: Owner holds (2026-11-12)](../roadmap.md)
- [Requirements ledger: REQ-018, REQ-030, REQ-066, REQ-089, REQ-090](../requirements-ledger.md)
- [Work Studio surfaces](../../docs/studio-surfaces.md)
- [Android Tier 1](../../docs/android-tier1.md)
- [ADR 0006](0006-release-freeze-internal-line.md) — release freeze
- [ADR 0033](0033-1-5-2-owner-asset-review.md) — exact 1.5.2 asset review
- [ELYTerminal](https://github.com/ELY-Open-Source/ELYTerminal) — external reference only
