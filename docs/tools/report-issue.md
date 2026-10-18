# Tool fault reports (`xd://report_issue`)

When a tool misbehaves, the agent can file a **public GitHub issue** on
`Linxira-OS/linxira-zeta`. There is no collector server: nothing is sent to
upstream OMP infrastructure, and no telemetry endpoint is involved.

## How the agent writes a report

The report is a plain-text write to the virtual device:

```
write xd://report_issue  →  <tool>: <one-sentence description of what went wrong>
```

A two-line form is also accepted when the description needs a second line.
Write one grievance per call; the first line names the tool and becomes the
issue title prefix.

## What leaves the machine

- the report text,
- the tool name,
- agent name and version, active model, platform, arch, and the install id,
- a public notice line stating the issue is visible to everyone.

Never include secrets, tokens, or personal data in the report text.

## Consent and controls

- Nothing is recorded until the first consent dialog is answered.
- `PI_AUTO_QA=0` (or `dev.autoqa: false`) disables the mechanism entirely.
- A denied consent (`dev.autoqaConsent: "denied"`) also disables it.
- Submission uses `GITHUB_TOKEN`, `GH_TOKEN`, `dev.autoqaPush.token`, or
  `gh auth token`, in that order. Without a token nothing is submitted; the
  caller gets the composed issue and a prefilled `.../issues/new` URL instead.
- Destination repository: `ZETA_ISSUE_REPO` (`owner/repo`), default
  `Linxira-OS/linxira-zeta`.

## Inspecting and cleaning the queue

Grievances are recorded locally first:

```
zetacode grievances            # list recorded reports
zetacode grievances --tool X   # filter by tool
zetacode grievances --clean    # delete recorded rows
zetacode grievances --push     # submit pending rows now
```
