# Playbook: review

Copy each line into your todo list. Keep it, or mark it `skip: <reason>` ([how](./README.md)).

- [ ] **Pin the head you review**: write the PR number and head sha in your todo list and in your
      report. A push after that sha needs a fresh look. _Unenforced._
- [ ] **Read the ticket's criteria first, then the diff**, and check each criterion against the
      code, not against the PR text. _Unenforced._
- [ ] **Read the evidence, not the summary**: a member's `reportPath`, the test that is said to
      prove the fix, and the CI run
      ([trap 2](../agent-verification-traps.md#2-judge-a-delegated-report-by-its-artifact-not-its-summary)).
      _Unenforced._
- [ ] **Run the touched suites with the repo config, then mutate the fix**: revert one hunk and
      confirm a test goes red
      ([trap 4](../agent-verification-traps.md#4-a-new-test-proves-a-fix-only-if-it-fails-without-it)).
      _Enforced in part_: `test-result-guard.py` reads the result. The mutation is unenforced.
- [ ] **Trace the callers for each reachability claim**
      ([trap 3](../agent-verification-traps.md#3-verify-the-claim-that-was-made-including-its-callers)).
      _Unenforced._
- [ ] **Check the AGENTS.md _Considerations_ the diff touches**: SSH, Windows, folder workspaces,
      wire compatibility, Git 2.25. _Enforced in part_ by the matching CI jobs, some of them only in
      the merge queue.
- [ ] **Treat a bot's or tool's review comments with doubt**: fix each one, dismiss it with a
      concrete reason, or ask. _Unenforced._
- [ ] **Each finding has a file and line, a concrete failure scenario and a severity** (a bug the
      change adds, a bug that was already there, or a nit). _Unenforced_; ORCA-1337 owns the
      verdict format.
- [ ] **Change no code unless your brief says so**, and never push to a PR your lead has enqueued.
      _Enforced in part_: `main-merge-guard.py` refuses any merge or push to `main`.
- [ ] **Report the verdict** (approve or request changes) with the reviewed sha and a
      `reportPath`, each claim with its level. _Enforced_: the runtime validates the envelope.
