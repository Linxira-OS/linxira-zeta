# Maintainer notes

This file is for maintainers and contributors who merge or release Zeta. It
records the coverage policy that is not yet enforced by a threshold, and the
checks that must run before a release.

## Coverage is measured, not yet gated

The current baseline is a one-off LCOV measurement from **2026-11-03** (local
Windows). It is recorded in [`README.md`](../README.md#coverage); the short
version:

| Package             | Line coverage | Function coverage | Source files reached |
| ------------------- | ------------: | ----------------: | -------------------: |
| `packages/agent`    |         88.0% |             83.5% |                 100% |
| `packages/ai`       |         89.9% |             92.3% |                98.3% |
| `packages/catalog`  |         93.8% |             63.4% |                94.9% |
| `packages/tui`      |         73.3% |             77.5% |                90.3% |
| `packages/utils`    |         78.7% |             75.1% |                97.0% |
| `coding-agent` core |         29.7% |             23.2% |                66.7% |

The five support packages combined are **81.2% lines / 79.7% functions**.
These are loaded-file numbers: Bun's LCOV omits files that no test imported.
The `coding-agent` figure is a **core sample only** (`test/session`,
`test/session-manager`, `test/config`, `test/core`), not the whole package. The
full 2,113-file suite did not finish within 40 minutes under coverage
instrumentation.

## Required Action

The **Coverage** workflow (`.github/workflows/coverage.yml`) is the canonical
report. It is manual (`workflow_dispatch`) and also runs on a weekly schedule.

Before a release or any merge that changes runtime behavior:

1. Run the **Coverage** workflow on the candidate commit.
2. Download the `coverage-lcov` artifact and keep it with the release/review
   evidence.
3. Compare the package totals against the baseline above. A drop larger than
   **0.5 percentage points** in a package's line coverage needs an explanation
   in the PR or release record.
4. Do not delete tests, skip assertions, or lower a threshold to get green.

The workflow is report-only today: it uploads LCOV even when a test fails. A
green workflow therefore means “the report ran”, not “all tests passed”. The
normal CI run remains the test gate; **the Coverage workflow does not relax or
replace any existing CI threshold**.

## Why coding-agent is not a single coverage number yet

`packages/coding-agent` has 2,113 test files and 1,671 source files. Running the
whole package in one coverage process exceeded 40 minutes locally. The workflow
therefore measures a fixed core sample. The next step is to split the package
into CI test buckets, run coverage per bucket, and merge the LCOV line hit sets;
do not report the core sample as the package total.

Known local-Windows noise: symlink creation can fail with `EPERM` (for example
`test/session-manager/move-to.test.ts`), and browser tests can race Chrome's
target listing. These are environment/fixture failures unless they reproduce on
Linux CI.

`test/tools/browser-relay-tab-isolation.test.ts` has one timing-sensitive case,
“opens a default tab…”: it waits only two seconds for the relay to list a newly
opened page. A failure with `No page target matched "First"` is a fixture race,
not evidence that the runtime changed. The same commit passed this test in the
`v18.16.0` sync-branch CI; rerun the failed job and, if it recurs, make the test
wait for the relay listing instead of extending the product timeout.

## Adding coverage

- New runtime code needs tests in the same change; do not land an uncovered
  branch and “raise coverage later”.
- Prefer behavior/contract tests over line-touching tests.
- When adding a package, add it to the Coverage workflow and to the table above.
- Coverage is evidence, not proof: still exercise the changed command or UI.

For the local test matrix and guard details, see
[`document/local-ci.md`](../document/local-ci.md).
