# PR checks: per-push set and merge queue

`ab2webco` is on GitHub Free, which allows 20 concurrent Actions jobs across the org (5 of them
macOS). Each push to a PR used to schedule about 45 jobs from `pr.yml`. With about 13 open PRs, runs
sat queued for 2 hours or more, and each merge from `main` into a branch restarted its run
(ORCA-932). The checks are now split by event. None were removed.

## What runs where

`pr.yml` runs on `pull_request` and on `merge_group`.

| Job                                                  | PR push            | Merge queue                                             |
| ---------------------------------------------------- | ------------------ | ------------------------------------------------------- |
| static analysis, root directory guard, typecheck     | yes                | yes                                                     |
| unit tests (`tests node 24 n/N`)                     | 8 shards           | 16 shards                                               |
| detect e2e scope + `e2e (<mode>)`                    | changed specs only | scope from the queued diff (full suite when it matches) |
| Git compatibility, shell contracts, cli subprocess   | —                  | yes                                                     |
| managed hooks on Node 18, Claude hooks on Python 3.9 | —                  | yes                                                     |
| cross-version wire compatibility                     | —                  | yes                                                     |
| package, package (windows), Windows platform tests   | —                  | yes                                                     |
| `verify`, ci failure class                           | yes                | yes                                                     |

`packaged-plugin-seal.yml` now runs on `merge_group` (and `workflow_dispatch`). A merge group
carries no `paths` filter, so its `detect plugin seal scope` job applies the old path list, and the
three seal runners start only when one of those paths changed.

A push to an ordinary PR schedules at most 15 `pr.yml` jobs, plus `pr-test-loc`.
`config/scripts/pr-workflow-merge-queue.test.mjs` asserts the count stays under 20. The workflows
that only run when their own paths change (`mobile.yml`, `computer-e2e.yml`,
`skill-update-roundtrip.yml`) are not part of that count and still run on the push.

## E2E on a push

`select-pr-e2e-scope.mjs --defer-full-suite` is what a PR push runs:

- If the PR changed a spec, that spec runs on one runner (`changed-specs`), even when the PR also
  touched a full-suite path.
- If the PR touched a full-suite path and no spec, the push reports `e2e (merge-queue)` and the job
  is skipped. The queue runs the full suite.
- Otherwise nothing runs (`none`), as before.

The merge queue runs the script without the flag, on the queued diff
(`merge_group.base_sha..head_sha`), so the rules for when the full suite gates a merge are the same
as before this change.

## `verify` in both paths

`verify` is the one required check, and it means something different for each event:

- **PR push.** The fast set must succeed. The merge-queue set must be `success` or `skipped`.
- **Merge queue.** Every job must succeed. A skipped merge-queue job fails `verify`.

E2E keeps its existing rule in both: `skipped` passes only when the scope detector succeeded. So a
PR whose push is green still cannot reach `main` until the full set passes on the merged result.

## Repo settings the owner applies

None of this takes effect until the `main` ruleset turns the merge queue on:

1. **Settings → Rules → Rulesets →** the ruleset that targets `main` (create one if there is none).
2. **Require status checks to pass:** `verify`, source GitHub Actions. Keep it required.
3. **Require merge queue:** on. Merge method: squash. Suggested values are build concurrency 1,
   minimum group size 1, maximum group size 5, and status check timeout 90 minutes, enough for the
   full E2E suite.
4. Optional: also require the `packaged plugin seal (...)` checks. A skipped job counts as passing
   for a required check, so this only blocks when the seal ran and failed.

Until step 3 is applied, the `merge_group` jobs never run, and a PR merges after only the per-push
set. That is weaker than before this change, so apply the ruleset when this merges.

`gh pr merge <n> --auto --squash` keeps working. Once the PR's `verify` is green, GitHub adds the PR
to the queue, and the `post-merge-board-close` hook still waits for the `MERGED` state.
`main-merge-guard.py` still requires `verify` in the ruleset.

## Costs and limits

- A PR push runs half as many unit shards, so each shard takes about twice as long. The timeout went
  from 15 to 25 minutes.
- Windows, packaging and Git-version failures now show up only in the queue. When one fails, the
  queue removes the PR and the author fixes it on the branch.
- The scheduled `e2e.yml` run and the Lab Release gate do not change.
