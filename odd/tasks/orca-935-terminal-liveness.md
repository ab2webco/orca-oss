# ORCA-935 — Fresh terminal liveness under loaded CI

## Objective
Keep a paired-host terminal listing trustworthy when PTY inventory is temporarily unavailable, without masking a genuinely dead terminal.

## Problem and evidence
The headed paired-remote reconnect spec failed twice in CI shard 5/12 with `terminal_liveness_unavailable` at its final `terminal.list(requireFreshPtyLiveness)` call. Jobs 124603273109 and 124610268577 show the same failure. Local repetitions previously passed. The 3-second inventory deadline and aggregate provider query need investigation; the logs do not identify the timed-out provider.

## Scope and constraints
Only the PTY inventory/liveness path, focused regression tests, and diagnostics needed for this failure. Strict TDD is enabled by project instructions. Use `npx vitest run --config config/vitest.config.ts <test-path>` for unit tests and the single-spec Playwright harness for E2E. Do not raise the timeout blindly, weaken fail-closed liveness, or enable auto-merge. The task's delivery target is one PR. About 400 authored lines is advisory, not a cap.

## Tasks
- [x] T1 (delegated): Trace the aggregate inventory failure path; add red regression tests, implement provider-scoped inventory with one fail-closed retry, and verify the unit suite. The CI logs do not identify the exact slow adapter; this remains an evidence gap.
- [x] T2 (inline): Run the headed paired-remote spec 10 times under one sustained CPU worker. Result: `10 passed (1.6m)`; the separate headless-folder case is marked `fixme` and appeared as `10 skipped`. Exit 0. Each headed run passed (7.6–9.2 s).
- [ ] T3 (inline): Review the diff, run applicable checks, make a conventional work-unit commit, open one PR, and observe fast checks. Acceptance: PR URL and check state recorded; no auto-merge.

## Progress
T1: original source `Tests 2 failed | 1173 skipped (1175)`; changed source `Tests 3 passed | 1172 skipped (1175)` and focused SSH guard `Tests 1 passed | 1175 skipped (1176)`. `npm run typecheck` exited 0. The SSH guard was not run against original source because E2E was concurrently using the worktree; its original-code path is demonstrably aggregate. Rollback boundary: `src/main/runtime/orca-runtime.ts` and its adjacent tests. Engram mirror pending: ambiguous active runtime sessions and no authoritative session ID.

T2: `npx playwright test tests/e2e/paired-remote-terminal-materialization-reconnect.spec.ts --config tests/playwright.config.ts --project=electron-headless --workers=1 --repeat-each=10` under one `yes` CPU process: `10 passed (1.6m)`, `10 skipped` (existing `fixme`). Log: `/tmp/orca935-e2e-10.log`.

Work-unit commit: `8b2908cb981` (`fix(terminal): retry scoped fresh liveness inventory`). Parent spot check after the commit: `Tests 4 passed | 1172 skipped (1176)` from the focused runtime suite.

## Delivery
Strategy: ask-on-risk. Forecast: approximately 100 authored changed lines across one work unit; no chain expected. Branch: `fabolivark/orca-935`.

## Next step
Finish the ten-run loaded E2E check, then commit and create the PR.
