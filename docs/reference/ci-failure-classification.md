# CI Failure Classification

A job killed by `timeout-minutes`, a job whose setup step failed, and a job with a red test all
report the same thing in the checks UI: `fail`. They are opposite diagnoses — one is the code,
one is the budget, one is the runner — and confusing them sends the wrong person to the wrong
place. It happened twice in one night (ORCA-215), and once a "red specs" list handed to a worker
included a spec that never ran.

The `ci failure class` job in `.github/workflows/pr.yml` reads this run's jobs back from the
GitHub Actions API at the end of the run and names each non-successful job's class on the run
summary page. **The goal is that a red check says why it is red without opening a log.**

## The classes and the signal behind each

`GET /actions/runs/{run_id}` and `GET /actions/runs/{run_id}/jobs` are the inputs for every
class but one; `hang` also needs the job's log, fetched for failed jobs only (see below). Neither
carries `timeout-minutes`, so the cap comes from the workflow YAML in the checkout
(`config/scripts/ci-workflow-job-definitions.mjs` matches an API job name back to the job that
declared it).

| Class                    | Signal                                                                                        | Triage                                             |
| ------------------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `timeout`                | `job.conclusion == "cancelled"` **and** `completed_at - started_at >= cap - 60s`              | budget — nothing failed, the job ran out of time   |
| `cancelled-by-run`       | `job.conclusion == "cancelled"` and `run.conclusion == "cancelled"`                           | none — a superseding push or a manual cancel       |
| `cancelled-by-fail-fast` | `job.conclusion == "cancelled"` and a matrix sibling reported `failure` within 120s before it | none — **a cancelled shard is not a failed shard** |
| `setup-failed`           | `job.conclusion == "failure"`, and a later executable step is `skipped`                       | the named step failed; the job's work never ran    |
| `hang`                   | would be `tests-failed`, **and** the job log carries the watchdog's `===== orca hang watchdog =====` block | budget — a test file wedged, no test failed |
| `tests-failed`           | `job.conclusion == "failure"`, and no later step was skipped                                  | code — the work step ran to completion and failed  |
| `gate-failed`            | `job.conclusion == "failure"` and the job is a declared gate (`--gate-job`)                   | none — it failed because a job it needs did        |
| `dependency-skipped`     | `job.conclusion == "skipped"`                                                                 | none — an `if` or a dependency kept it out         |
| `pending`                | `job.status != "completed"`                                                                   | none — still running when the run was classified   |
| `unclassified`           | anything the rules above do not cover                                                         | unknown — open the log                             |

Two rules carry the weight:

- **`timeout` is reachable only from `conclusion == "cancelled"`.** A job that reported `failure`
  is never reclassified by how long it ran, at any duration. The dangerous failure of this change
  would be a real red test masked as "ran out of time"; the branch order makes it unreachable and
  `ci-failure-class.test.mjs` pins it against a real failed job stretched past its cap.
- **When the cap cannot be resolved, the class is `unclassified`, not `timeout`.** Guessing a
  timeout from a bare `cancelled` is the same lie in the other direction.

Gate jobs are **named, not detected**. `verify`'s only step echoes `needs.*.result`, so by shape
it is identical to a job whose work step ran and failed — left unnamed it would print "a test
failed" on every red PR, which is this ticket's lie pointed the other way. `pr.yml` passes
`--gate-job verify`, and `--exclude-job 'ci failure class'` keeps the reporter from reporting on
itself (it is `in_progress` in its own API response).

The 60s timeout grace is measured, not chosen: job `94316018103` ran 30m17s against a 30-minute
cap, and `tests node 24 9/16` ran 15m14s against 15. `started_at` includes runner setup and the
runner kills the job a few seconds past the cap.

## Why the run summary and annotations, and not the other surfaces

- **Not the check name.** A job's `name` is fixed when the workflow is parsed. It cannot carry a
  class that is only decidable once the run has ended.
- **Not a step inside the failing job.** A job that was skipped or cancelled before its steps ran
  executes no steps at all, so it cannot report on itself — and those are exactly the classes this
  exists to name. `if: always()` does not help: a skipped job has nothing to always-run.
- **Not a PR comment.** It needs `pull-requests: write`, it does not work on fork PRs, and it adds
  a notification per run.
- **The job summary** (`$GITHUB_STEP_SUMMARY`) renders on the run summary page — the page a red
  check links to — above the job list, with no log opened. Annotations ride along for the classes
  worth a badge.

## Why `hang` needs the log, and what bounds the cost

The hang watchdog (`config/scripts/run-vitest-with-hang-watchdog.mjs`, ORCA-257) kills a wedged
shard and exits `124`, so the job reports `failure` — the same conclusion, the same step shape,
as a red test. Nothing in the jobs API separates them, which sent triage looking for a spec that
does not exist (ORCA-263).

Both distinguishing signals live in the log: the `::error title=Vitest hang::` annotation with
its `===== orca hang watchdog =====` block, and the step's exit code `124`. The block is what the
class keys on — any step may exit `124` for its own reasons, so the code alone would over-claim.
The marker strings are exported from `config/scripts/vitest-hang-marker.mjs` and imported by both
the watchdog that writes them and the classifier that reads them, so a rename cannot silently
retire the detection.

Cost is bounded twice over: the workflow fetches a log only for jobs whose conclusion is
`failure`, and the classifier asks for one only when the API signals already say `tests-failed`.
A green run reads no logs at all. `classifyRunJobs` still performs no I/O of its own — the caller
passes a `readJobLog` function, so classification stays reproducible off saved payloads.

## What is not covered

- `e2e.yml` on its `schedule` and `workflow_dispatch` triggers produces its own runs, which have
  no reporter job. When `e2e.yml` is called from `pr.yml` its jobs are part of the PR run and are
  classified.
- No matrix in this repo sets `fail-fast: true` today, so `cancelled-by-fail-fast` has no recorded
  run. Its test derives the shape from a real cancelled shard rather than inventing a payload, and
  the class exists so the guarantee holds the day a matrix omits `fail-fast`.
- `cancelled-by-run` is not observable from inside `pr.yml`: the run's own
  `cancel-in-progress` concurrency cancels the reporter along with everything else. It exists so
  a `cancelled` job can never be called a `timeout` when the run itself was cancelled, and it is
  exercised by the run `31663317660` fixture — not because you will see it printed here.
- A hang in a job whose log has expired or could not be fetched falls back to `tests-failed`,
  and the evidence says so (`hangCheckSkipped`). The classifier keeps the API answer rather
  than guessing — but it never asserts a red test on a log it did not read. The workflow
  deletes a zero-byte capture for the same reason: an empty log reads as "no hang".
- The reporter never gates. `verify` remains the merge gate and is untouched.
- One consumer does gate: `lab-release.yml`'s release signal gate classifies its own test jobs
  with `classifyRunJobs` before publishing (`config/scripts/release-signal-gate.mjs`). It blocks
  on every class, including `hang` and `timeout` — a run that did not finish cannot be read as
  green, or an infra hiccup would disarm the gate. The classes are what its message names, and
  the only place they change a verdict is a release candidate, which is not `--latest` and
  announces to nobody.

## Keeping it from degrading

- Fixtures are trimmed verbatim API payloads under `config/scripts/fixtures/ci-failure-class/`,
  each carrying its run URL, head SHA, and the `timeout-minutes` that were in effect at that SHA.
  The caps a test feeds the classifier are asserted equal to the caps recorded in the fixture, so
  the two cannot drift apart silently.
- The resolver test runs against the live `.github/workflows`, so renaming a job's `name:`
  template or moving its `timeout-minutes` fails a test instead of quietly turning every timeout
  into `unclassified`.
