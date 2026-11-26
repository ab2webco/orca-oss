# Playbook: feature

Copy each line into your todo list. Keep it, or mark it `skip: <reason>` ([how](./README.md)).

- [ ] **Read the ticket and every comment**, and list its acceptance criteria in your todo list.
      _Enforced in part_: `board-state-guard.py` refuses `gh pr create` while the ticket is not In
      Progress.
- [ ] **Run the throughput checkpoint before you fan out or commit.** Answer each of the four in
      one line, or write `n/a: <reason>`. _Unenforced_; the lead's brief asks for a split plan only
      past 400 lines.
  - Blocking first steps: what must land before anything else can start.
  - Independent workstreams: parts that touch disjoint files.
  - Shared mutable state: files, docs, locale files, published state or settings that two parts
    would both edit.
  - Smallest safe split: one PR per topic, in order. Send it to your lead when it is more than one.
- [ ] **Size each phase.** One phase is one function or type plus its tests, and touches two or
      three files. Prefer several small phases to a few large ones, and split a phase that needs more
      than five test cases. _Unenforced._
- [ ] **Check each item in AGENTS.md _Considerations_** that the change can touch: SSH, Windows,
      folder workspaces, wire compatibility, the Git 2.25 baseline. _Enforced in part_: the
      `cross-version wire compatibility`, `Git compatibility` and `Windows platform tests` jobs.
      Some of them run only in the merge queue ([ci-merge-queue.md](../ci-merge-queue.md)).
- [ ] **A new field in published state**: search `tests/e2e` for deep-equals on that object and
      assert the field there. _Enforced late_: the full E2E suite in the merge queue.
- [ ] **A new tracked doc gets its `.gitignore` allow-list entry**
      ([trap 6](../agent-verification-traps.md#6-new-tracked-docs-need-a-gitignore-allow-list-entry)).
      An English doc the site publishes gets its `es` pair and a stamp (`pnpm translations stamp` in
      `site/`). _Enforced_ for site docs by the `Site check` workflow. The allow-list is unenforced.
- [ ] **UI follows [`STYLEGUIDE.md`](../../STYLEGUIDE.md)**, and you check it rendered through one
      spec under `tests/e2e/` ([rendered-ui-checks.md](../rendered-ui-checks.md)). _Enforced in
      part_: the `static analysis` job runs the code-quality and brand-drift checks.
- [ ] **Estimate the diff before the first commit**, as in [bug-fix.md](./bug-fix.md). _Enforced
      late_: the `test vs non-test LoC` job and `oversized-pr-review-guard.py`.
- [ ] **Run the touched suites, typecheck and lint.** _Enforced_: `test-result-guard.py`, and the
      `tests`, `typecheck` and `static analysis` jobs.
- [ ] **Verify each acceptance criterion**, with its level (`live`, `unit`, `none`) in the
      envelope. _Enforced_: the runtime refuses `success` with a `none` claim.
