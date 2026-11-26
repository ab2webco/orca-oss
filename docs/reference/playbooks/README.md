# Member playbooks

One playbook per task kind. A lead picks one with `orca game launch` and
`--kind bug-fix|feature|review|live-check`. The member's brief then links it, and never copies its text
(`orchestratorGame.orchestrator.playbooks` in `orca.yaml`, see
[`orchestrator-game.md`](../orchestrator-game.md)).

| Playbook                           | For                                                 | Launches as |
| ---------------------------------- | --------------------------------------------------- | ----------- |
| [`bug-fix.md`](./bug-fix.md)       | something that worked, or should work, and does not | implement   |
| [`feature.md`](./feature.md)       | new behaviour, a setting, a doc set                 | implement   |
| [`review.md`](./review.md)         | another member's PR or report                       | review      |
| [`live-check.md`](./live-check.md) | a merged change on a real build and host            | captures    |

## How a member uses one

1. Copy every step into your todo list, as written.
2. Keep each step, or mark it `skip: <reason>`. A step without a reason has been dropped, and a
   dropped step is a finding against the run.
3. Put the kept and skipped lines in the `worker_done` envelope's `verification` or
   `notesForNextAgent`, so the lead can see what was not done.

Each step names what enforces it: a hook under `.claude/hooks/`, a CI job, or the runtime. A step
marked **Unenforced** holds only if you keep it. When skipping an unenforced step causes a real
failure, turn it into a check and add it to the guard table in
[`working-process.md`](../working-process.md#las-guardas-y-la-falla-que-las-originó).

## For every kind

- **Classify a question before you ask it.** If running a command, a test or a probe answers it,
  run it and report what you saw. Ask (`orca orchestration ask`) only for what the lead or the
  person must decide: scope, taste, or a step that is hard to undo. _Unenforced_; a needless ask
  blocks you and costs the lead a turn.
- **Every verification claim carries its level.** `live` means you saw it, `unit` means tests only,
  `none` means not verified. _Enforced_: the runtime refuses a `worker_done` envelope with status
  `success` that carries a `none` claim.
- **Read [`agent-verification-traps.md`](../agent-verification-traps.md) before you claim green.**
  Ask what the check would show if the thing were broken.

The ideas come from the review of poteto/plugins `pstack` (MIT) in ORCA-1416. They are adapted to
Orca's own rules and traps, and no text was copied.
