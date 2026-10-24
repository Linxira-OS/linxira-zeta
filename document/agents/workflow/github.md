<!-- 从根 AGENTS.md 原文移出（2026-10-25 精简，未改写）。GitHub 评论 / PR 的确认与贡献者规则。 -->

# GitHub 交互规则

> 硬约束（根 AGENTS.md 保留）：发评论 / 开 issue / 改 PR 描述前必须给用户看目标与文本并获批。

## GitHub

- Before posting a GitHub comment or creating an issue, MUST show the target and proposed text and obtain user confirmation. An explicit instruction to post supplied text to a specified target already counts as confirmation.
- A request to address or fix PR feedback permits drafting replies, not posting them without confirmation. A request only to get or check comments is read-only.
- When authorized to resolve review feedback, MUST verify the fix, obtain approval for a factual reply citing the change and verification, and post it in the existing thread before resolving. NEVER resolve if the reply is unapproved or posting fails.
- Permission to work on a PR does not authorize unrelated comments or issue creation.

### Pull requests


When authorized to create or edit a contributor-submitted PR, follow the checklist below. RoboOMP-managed PRs follow their dedicated workflow and enforced body format in `python/robomp/src/prompts/system_append.md` instead.

- MUST read `CONTRIBUTING.md` and `.github/PULL_REQUEST_TEMPLATE.md` first. Preserve the template sections and checklist, including when shortening an existing description.
- MUST obtain at least one sentence written by the contributor in their own words explaining what changed and why, as required by `CONTRIBUTING.md`. If it is missing, ask the contributor; NEVER generate a substitute. Preserve that sentence during edits.
- For user-facing changes, MUST follow the [Changelog](#changelog) attribution rules. Internal issue fixes keep their issue links. For external contributions, add the PR link and contributor credit after GitHub assigns the number, then push the entry before marking the changelog checklist item complete.
- MUST read back the published PR description after creating or editing it. Check only verified checklist items; explain skipped or inapplicable checks in `Testing`.

