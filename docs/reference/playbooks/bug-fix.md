# Playbook: bug fix

Copy each line into your todo list. Keep it, or mark it `skip: <reason>` ([how](./README.md)).

- [ ] **Read the ticket and every comment** (`orca plane issue <id> --comments`, and `--json` for
      the description and criteria). Move it to In Progress. _Enforced_: `board-state-guard.py`
      refuses `gh pr create` while the ticket is not In Progress. Reading the comments is
      unenforced.
- [ ] **Reproduce on the same surface the report names** before you change code: the same OS, the
      same host kind (local, SSH, WSL, paired host), workspace kind (git or folder), build and
      locale. Write down the command and what it printed. _Unenforced._
- [ ] **Write the failing test at the call site**, not only in the helper, because the bug can live
      in the caller ([trap 3](../agent-verification-traps.md#3-verify-the-claim-that-was-made-including-its-callers)).
      _Unenforced._
- [ ] **Narrow the cause with runtime evidence**: a log line, a probe, or `git bisect` between a
      good and a bad commit. Before each test, say what output would prove the guess wrong.
      Reading code and guessing is not narrowing. _Unenforced._
- [ ] **Fix the root cause, then revert every speculative change.** A guard, retry or timeout added
      because it "might help" is not shipped unless evidence shows it is needed. Each hunk in the
      diff traces back to the cause. _Unenforced._
- [ ] **Prove the test fails without the fix**: revert the source to the base commit, run it, and see
      it fail ([trap 4](../agent-verification-traps.md#4-a-new-test-proves-a-fix-only-if-it-fails-without-it)).
      _Unenforced._
- [ ] **Estimate the diff before the first commit.** When it passes about 400 lines outside tests,
      send your lead a split plan first. _Enforced late_: the `test vs non-test LoC` job counts the
      lines on the PR, and `oversized-pr-review-guard.py` reports the size at merge.
- [ ] **Run the touched suites with the repo config** and read the `Tests …` line, never a piped
      exit code ([trap 1](../agent-verification-traps.md#1-run-tests-with-the-repos-vitest-config),
      [trap 8](../agent-verification-traps.md#8-a-pipeline-reports-the-last-commands-exit-status)).
      _Enforced_: `test-result-guard.py` locally, the `tests` and `verify` jobs on the PR.
- [ ] **Typecheck and lint.** _Enforced_: the `typecheck` and `static analysis` jobs.
- [ ] **Confirm the fix on the surface from step 2**, as `live`, or report it as `unit` with the
      reason. _Enforced_: the `worker_done` envelope refuses `success` with a `none` claim.
- [ ] **On red CI, name the failure class before you name a spec**, and never call it flaky
      ([trap 9](../agent-verification-traps.md#9-flaky-is-a-hypothesis-not-a-verdict)). _Enforced in
      part_: the `ci failure class` job classifies each job; what you conclude is unenforced.
- [ ] **PR text says what it fixes, what it leaves open, and how it was verified**, with no tool
      credit. _Enforced_: `pr-attribution-guard.mjs` and the `pr text attribution` job.
