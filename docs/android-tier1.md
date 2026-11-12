# Android Tier 1 client

Status: **source implemented, not built, not device-verified**. No APK/AAB is produced by this change. Local Android build and device acceptance are `OWNER-WAIT` until the owner confirms the Android SDK/tooling environment. Public release remains frozen.

## Scope

- One paired host, one active profile, one required workspace binding. No profile selector.
- Kotlin shell + WebView loading the existing `web-app` Work Studio. No second chat UI.
- Native code owns pairing, TLS policy, secure storage, cookies, notifications, file chooser, navigation, and step-up entry.
- No local tool runtime, no SSH target bridge, no Tier 2 accessibility/screen control, no PWA substitute.

## Pairing / session

The client follows the final `local://remote-client-contract.md`:

1. Scan `https://host/#zeta-pair=<60s code>` or enter the code manually.
2. `POST /api/v1/pair` with `device: {label, platform: "android", issueToken: true, binding: {workspaceId}}`. The binding is required for this client; a missing or mismatched echo is a pairing failure, not an unbound device.
3. Require and store the returned `studio_session` cookie and `device.token`; a missing token fails pairing:
   - cookie: HttpOnly/Secure/SameSite=Strict, copied to `CookieManager`;
   - device token: encrypted with an Android Keystore AES-GCM key, never exposed to page JS.
4. Verify `GET /api/v1/bootstrap` natively before loading the WebView; a 401 never becomes a shell page. The cookie bootstrap returns `X-Studio-CSRF`; the page's existing transport reads it, so there is **no JavaScript bridge**.
5. The WebView uses the cookie for query/command/events. Native calls use the Keystore device token.

`device.binding` is parsed by the server, applied to the device **and** the session, and echoed in `device.binding`. A malformed binding is `400 binding_invalid`; `workspaceId` must be the Host registry's canonical id, not a path or alias. The Android UI sends the workspace id the operator supplies and shows the host-confirmed binding; it never claims a scope the host did not return.

Session lifetime is **1 hour sliding**: active use renews, idle expires, persistence only avoids a re-pair after a serve restart. A 401 is expected recovery, not a crash: the shell clears credentials and returns to pairing.

## Background events

When the app is backgrounded, `ConnectionService` subscribes to the existing authenticated `WS /api/v1/events` surface with the **same** `studio_session` cookie as the WebView (not the stateless device token), sends only the standard `{scope}` frame, and never sends commands. A native WebSocket sends no `Origin` header; the host's `isAllowedRequestOrigin` accepts that, and the cookie upgrade is the same read-credential path as the HTTP API. It deduplicates by `authorityEpoch + cursor` and ignores cursors at or below the last one; an authority change resets the cursor. `state.changed` triggers an immediate state probe, and failed/rejected/`outcome_unknown` dispatch receipts for `core.prompt`/`core.steer`/`core.followUp`/`core.continue` become needs-attention. A completed dispatch receipt is **not** turn completion.

Completion and input come from the existing user state, not from an invented event: the service polls `POST /api/v1/query` for `session.state` (with the bound `workspaceId` in the query input so the host's binding guard intersects it), records the first snapshot as a baseline, and on later snapshots notifies when `isStreaming` goes true→false with `lastTurnOutcome` (`completed` / `interrupted`) or when `pendingInteraction.interactionId` becomes a new value. `interaction.required` and `conversation.turn.aborted` are not assumed to be emitted by this host; the client does not fabricate them. `resync.required` produces no notification. An idle 1h session 401 clears credentials, closes the socket, and broadcasts revocation.

On `onStart` the shell tells the service to pause its native subscription, so a foreground WebView is the only event consumer. On `onStop` the service resumes it. Unpair/host switch stops the service and closes the socket. A 401 from the cookie session clears local credentials, closes the socket, and broadcasts revocation; the service does not fall back to the device token for a WebView session.

Notifications are only available when `POST_NOTIFICATIONS` is granted. The host must emit the event kinds above; the client does not invent a new event protocol. Android 15's `dataSync` foreground timeout stops the service with a paused notification.

## Security boundary

- HTTPS only: `usesCleartextTraffic=false`; release network security config trusts system CAs only. No `proceed()` on WebView TLS errors. The host URL must be an origin root; reverse-proxy path prefixes are rejected rather than producing `/api/v1` 404s.
- Debug builds may trust a locally installed development CA; cleartext is still forbidden.
- Navigation is limited to the paired origin. External `https`, `mailto`, and `tel` links require confirmation and open outside the app; `http`, `file`, `content`, `javascript`, `intent`, and other origins are blocked.
- Device token: encrypted with an Android Keystore AES-GCM key, never exposed to page JS. An EC key/hash is generated for a future device-identity challenge, but the server has no challenge/signature verification today; do not claim hardware-backed device authentication, only at-rest token protection.
- WebView: JavaScript/DOM storage on (required by Work Studio), file/content access off, mixed content never allowed, third-party cookies off, geolocation off, WebRTC/media permissions denied.
- File upload uses the system document picker (`onShowFileChooser`) and needs no storage permission.
- Foreground notification: `POST_NOTIFICATIONS` is requested on Android 13+; a `dataSync` foreground service verifies the device session every 60s and stops on 401/revocation. Android 15's dataSync timeout is handled by stopping rather than pretending to stay online.
- Unpair/disconnect clears the cookie, Keystore-wrapped credential, device identity key, WEB storage, and the foreground service.
- `403 totp_required` is handled by the renderer's `AuthStepUpBoundary` (verify, then replay that one request once). The native step-up screen is a fallback for shell actions, not a second authorization path.
- `403 insufficient_scope` means read-only; `403 binding_scope` means the request left its binding. The shell does not filter these into success.

## Build

The source is a normal Gradle project with the standard wrapper checked in:

- `android/gradlew` / `android/gradlew.bat` (executable Linux script)
- `android/gradle/wrapper/gradle-wrapper.jar`
- `android/gradle/wrapper/gradle-wrapper.properties` — Gradle **8.9**, official
  `services.gradle.org` distribution, `distributionSha256Sum=d725d707...`
- `android/settings.gradle.kts`, `android/build.gradle.kts`, `android/app/build.gradle.kts`
- `android/gradle/libs.versions.toml`, `android/app/src/main/...`

Pinned toolchain: JDK 21 (AGP 8.7 baseline JDK 17, Gradle 8.9 supports 21),
AGP 8.7.3, Kotlin 2.0.21, compile/target SDK 35, min SDK 26, Build Tools 34.0.0
(AGP 8.7 default). Do not use the host's JDK 25 for AGP 8.7 unless verified.

Minimal CLI reproduction (no Android Studio needed):

```text
JAVA_HOME=<JDK 21>
ANDROID_HOME=<Android SDK with platforms;android-35 + build-tools;34.0.0>
GRADLE_USER_HOME=<isolated Gradle user home>

Windows:  gradlew.bat testDebugUnitTest assembleDebug
Linux:    ./gradlew testDebugUnitTest assembleDebug
```

Optional China Maven preference (project-level, default off):

```text
gradlew.bat testDebugUnitTest assembleDebug -Pzeta.useAliyunMirrors=true
```

This only adds Aliyun `repository/google|central|gradle-plugin` before the
official repositories; it does not downgrade AGP/Kotlin/SDK versions and no
global `init.gradle` is used. For a local SDK path, create ignored
`android/local.properties` with `sdk.dir=...` if `ANDROID_HOME` is not exported.

Verified on Windows: `BUILD SUCCESSFUL`, `testDebugUnitTest` and `assembleDebug`
passed; debug APK at `android/app/build/outputs/apk/debug/app-debug.apk`,
debug-signed by the SDK debug key. Release has no signing config and remains
unsigned/frozen. No emulator, NDK, or Android Studio is required for the build.

CI is **not** wired in this branch. A manual-only `android_tests` job patch is
delivered to the governance owner for review; it is not applied to
`.github/workflows/ci.yml`, not on push/PR/schedule, and not in
`release_gate`. Debug artifact only; no release signing key is created or
committed.

## Known holds

- The CLI build, unit tests, and debug APK are verified on this Windows host;
  **no device/emulator install or instrumentation run** was performed.
  `adb devices -l` is empty; do not claim a working install on a phone.
- Server contract is final for required device token, required/echoed binding, cookie CSRF, 1h sliding session, scope errors; the Android source targets it. The host is an origin root; `/studio/`-style prefixes are unsupported by this client.
- The mobile Work Studio surface exposes settings, device list, pairing and read-only TOTP verification; `device-revoke` and remote-token mutation stay hidden. The native shell does **not** hide or disable those existing web capabilities: its native pairing/step-up screens are its own entry, while the same web UI remains usable in the WebView. Renderer `AuthStepUpBoundary` must be mounted by the integration owner.
