# Playbook: live check

Copy each line into your todo list. Keep it, or mark it `skip: <reason>` ([how](./README.md)).

- [ ] **Name the build and host under test**: the version Orca reports (`orca status --json`,
      `appVersion`), the host and its OS, and the merged PRs the build carries. _Unenforced._
- [ ] **On Linux, never run a bare `orca` or `/usr/bin/orca`**: it can be the GNOME screen reader.
      Use the CLI path your brief gives. _Enforced_ for hooks only, by `orca_cli.py` and
      `orca-cli.sh`. Your own shell is unenforced.
- [ ] **Write down what broken looks like before you look**: the old behaviour, or the output the
      bug printed. A check that would show the same thing either way proves nothing
      ([the common rule](../agent-verification-traps.md#the-common-rule)). _Unenforced._
- [ ] **Check each criterion on the surface the ticket names** (desktop, mobile, SSH host, Windows,
      a folder workspace), one observation each, with its evidence: a screenshot path or the command
      and what it printed. _Unenforced._
- [ ] **Check rendered UI through one spec under `tests/e2e/`**, never with computer-use
      ([rendered-ui-checks.md](../rendered-ui-checks.md)). Ask your lead before a local E2E run.
      _Unenforced._
- [ ] **Confirm a visual defect at full resolution before you list it.** A thumbnail or the first
      captured frame can be stale. _Unenforced._
- [ ] **A defect you find goes to its own ticket with the evidence**, and is not fixed inside the
      check. _Unenforced._
- [ ] **Report `live` only for what you saw.** What you could not reach is `unit` or `none`, and a
      `none` claim makes the status `blocked`. _Enforced_: the runtime refuses `success` with a
      `none` claim.
