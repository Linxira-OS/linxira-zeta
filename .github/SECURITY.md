# Security Policy

## Supported versions

Only the latest stable Zeta release receives security updates. Pre-release
builds are development artifacts and are supported only when a maintainer says
so for a specific investigation.

## Reporting a vulnerability

Do not open a public issue for a security vulnerability.

Use GitHub's private security advisory flow for this repository:

<https://github.com/Linxira-OS/linxira-zeta/security/advisories/new>

Include:

- the affected Zeta version and platform;
- a description of the impact and the affected command, tool, or endpoint;
- minimal reproduction steps or a proof of concept;
- relevant logs with secrets, tokens, and personal data removed.

If the advisory form is unavailable, contact the repository maintainers
privately through GitHub rather than posting details publicly.

## IM and server vulnerabilities

**IM and server security findings MUST use this private advisory.** Opening a
public issue or pull request for them is prohibited. This especially covers:

- token or credential leakage;
- webhook signature verification failures or forgery;
- allowlist or authorization bypass;
- cross-chat, cross-session, cross-instance, or cross-workspace routing;
- unauthenticated command execution;
- remote token, pairing, or TOTP bypass;
- SSRF or transport/origin exposure.

The owning roles are **Zeta server maintainers** and **Zeta IM maintainers**.
Do not include secrets, pairing codes, TOTP secrets, live tokens, or
credential-bearing screenshots in issues, logs, or reports.

If the defect is upstream, use the upstream project's private security channel
(not a public issue), and open our advisory in parallel when Zeta is affected.
Do not disclose before coordination.

## Response

Reports are handled on a best-effort basis. You can expect an initial
acknowledgement within a few days. Please allow time for a fix and coordinated
disclosure before publishing details.
