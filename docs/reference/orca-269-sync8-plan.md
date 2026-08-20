# ORCA-269 — upstream sync #8: terrain survey and merge plan

Investigation only; no merge was performed. Every number below was measured, not estimated, and
each is reproducible from the pinned SHAs. Delete this file when sync #8 lands.

## Pinned SHAs — every count below is relative to these

| ref | SHA | note |
| --- | --- | --- |
| `origin/main` | `db62b2b5722c14cf6c6a12e002e42d06e42b3e9d` | measurement base |
| `upstream/main` | `d7a23c84a9f68c88167bc68736562686fa2a53b0` | 671 ahead of `origin/main` |
| `origin/upstream-sync/main` | `e310889ef836697a8b9a2ec243950b9f970c34ea` | mirror tip, 24 behind upstream |
| merge base (both) | `a63df9179024ce5c24b8545ee8590199e77f555d` | sync #7's tip, 2026-08-10 |

`origin/main` moved twice during this session. Re-derive the counts against the current tip before
acting; the ratios hold, the absolute numbers drift by a few.

## 1. What `origin/upstream-sync/main` is

`.github/workflows/upstream-sync.yml` — daily cron at 12:00 UTC. It tries a real
`git merge upstream/main` on top of `origin/main`, and **when that merge conflicts it discards it**
(`git merge --abort; git reset --hard upstream/main`, lines 86-87), then restores the fork's
workflow directory on top (lines 98-103) because `GITHUB_TOKEN` cannot push under
`.github/workflows/`. Since the divergence guarantees conflicts, the branch is in practice always
the reset variant: **a pure mirror of upstream plus one workflow-retention commit**.

Confirmed pure mirror, not a merge:

- `git merge-base origin/main origin/upstream-sync/main` = `a63df91790` — the same base as
  `upstream/main`. It carries **none** of the fork's 670 commits.
- `origin/upstream-sync/main..origin/main` = 670, identical to `upstream/main..origin/main`.

**Nobody is using it because the workflow has never once succeeded.** All 12 scheduled runs from
2026-08-08 to 2026-08-19 failed, always at the same step, always with the same error:

```
pull request create failed: GraphQL: Resource not accessible by integration (createPullRequest)
```

Actions is not permitted to open pull requests in this repository. `gh pr list --head
upstream-sync/main --state all` returns nothing: the PR the workflow exists to open has never
existed. The branch push (step 7) succeeds, so the mirror is current while the review surface it
was built to create is absent. Fixing that is one repository setting ("Allow GitHub Actions to
create and approve pull requests"), tracked separately from this sync.

### Verdict: use it as a recipe, not as a merge base

The retention commit is worth exactly **2 conflicts**, measured by isolating it — dry-merge
`upstream-sync/main~1` (the raw upstream tip of that run) and then `upstream-sync/main`:

| merged into `origin/main` | upstream commits | conflicting paths | `.github/` conflicts |
| --- | --- | --- | --- |
| `upstream/main` | 671 | **174** | `e2e.yml`, `pr.yml` |
| `upstream-sync/main~1` (raw upstream tip, same run) | 647 | 171 | `e2e.yml`, `pr.yml` |
| `upstream-sync/main` (with retention commit) | 647 | 169 | none |

So the branch's whole advantage is those two workflow files, and it costs 24 commits of staleness
to get them. It is also **force-pushed every day** (line 104, gated only on `behind != 0`, which
never closes at upstream's ~67 commits/day), so any branch built on it is clobbered at 12:00 UTC.

**Sync #8 merges `upstream/main` at a pinned SHA** and replicates the retention step by hand:

```
git checkout origin/main -- .github/workflows   # after the merge, before the commit
```

Two consequences of that recipe worth naming as standing decisions, because the bot has been
applying them silently:

- **Upstream workflow changes never arrive through this branch.** `rm -rf .github/workflows` plus
  checkout-ours discards all of them: 48 upstream commits touch `.github/workflows` since the base,
  18 files differ, and three upstream workflow files are absent from the fork
  (`dev-channel-win-build.yml` — genuinely new; `pr-test-loc.yml` and `release-policy.yml` — the
  fork dropped these deliberately). Scope matters: that loss belongs to the *mirror branch*. A
  hand-run `git merge upstream/main` does bring them, and every past sync came off a
  `fabolivark/*` branch, not off `upstream-sync/main`. Applying the retention checkout in a chunk
  therefore has to be a deliberate call each time — retain the fork's CI, and adopt whichever
  upstream workflow changes are wanted as a separate reviewed change.
- Retention covers `.github/workflows/` **only**. `.github/actions/install-node-dependencies/`,
  `.github/scripts/`, `.github/pull_request_template.md` and `.github/CONTRIBUTING.md` all differ
  between fork and upstream and are merged normally. For this sync that is safe — no file in
  `.github/` outside `workflows/` was touched by both sides since the base — but it is a gap, not
  a guarantee.

## 2. The 174 conflicts, by kind and by cause

Measured with `git merge --no-commit --no-ff upstream/main` then
`git diff --name-only --diff-filter=U`, aborted after. Cross-checks against the bot's own merge in
run `32254337316` (171 paths at its slightly older tips).

| kind | count |
| --- | --- |
| content | 142 |
| modify/delete (upstream deleted, fork modified) | 28 |
| add/add | 1 (`src/main/runtime/rpc/methods/worktree-create-schemas.ts`) |

By area: `src/renderer/src` 51, `src/main/daemon` 17, `src/main/runtime` 16, `tests/e2e` 11,
`src/main/ipc` 9, rest scattered.

**The 28 modify/deletes reduce to three upstream commits, each with one uniform recipe:**

| upstream commit | paths | what it did | resolution |
| --- | --- | --- | --- |
| `9367169888` | **22** | `refactor(tests): split every oversized test file off the max-lines suppression list (#14728)` | re-home the fork's cases into upstream's split files — mechanical, and it moves toward AGENTS.md's max-lines rule |
| `c86418eaad` | 3 | `rm git shim (#14141)` | **decision, not mechanics** — see §3, `src/shared/orca-attribution.ts` is a protected surface upstream deleted |
| `77f23b013f` | 1 | `refactor(shared): drop the shared/types barrel and import from the real modules (#14447)` | repoint the fork's `src/shared/types.ts` imports at the real modules |

The remaining 2 are one-offs (`ee8b9b2cc9`, `bb6f0c1cb5`). So "28 modify/deletes" is really
"3 upstream refactors" — 25 of the 28 are batch work once the recipe is chosen.

## 3. Fork surfaces a sync must not silently revert

The authoritative list is §6 of PR [#80](https://github.com/ab2webco/orca-oss/pull/80)'s body
(40 named survival checks). Reproduced here with this sync's risk measured per surface — fork
commits since the base vs upstream commits since the base:

| surface | fork | upstream | risk this sync |
| --- | --- | --- | --- |
| `src/main/claude-accounts/**` | 75 | 6 | **both moved**; 2 of its test files are in the modify/delete set |
| `src/shared/orca-attribution.ts` | 1 | 1 | **upstream deleted it** (`c86418eaad`) |
| `src/main/daemon/session.ts` | 8 | 10 | **both moved**; protected since ORCA-210/#83 |
| `.github/workflows/pr.yml` | 23 | 21 | **both moved**; carries the Node matrix, see below |
| `src/main/plane/**` | 33 | 0 | no upstream movement |
| `src/cli/handlers/plane.ts` | 9 | 0 | no upstream movement |
| `.claude/hooks/**` | 5 | 0 | no upstream movement |
| `src/main/update-feed-target.ts` | 2 | 0 | no upstream movement |
| `src/shared/orca-repository-url.ts` | 1 | 0 | no upstream movement |
| `src/main/plugins/plugin-kill-list-exemptions.ts` | 1 | 0 | no upstream movement |
| `config/scripts/select-pr-e2e-scope.mjs` | 1 | 0 | no upstream movement |

**Zero upstream movement is not safety.** PR #80's central finding is that a revert needs no
conflict — it needs upstream to move fork-modified logic into a file the fork does not have. The
four anchors that caught it in #7, at their current locations:

- `src/main/runtime/runtime-folder-workspace.ts:47` — `linkedPlaneWorkItem` on folder workspaces.
- `src/main/ai-vault/session-scanner-roots.ts:17-28` — `claudeProjectsRootDirs` /
  `additionalClaudeProjectsDirs`, the managed-vault projects roots plus the realpath dedup.
- `src/shared/release-channel.ts:36` — `DAILY_RELEASE_REPO = 'ab2webco/orca-oss'`; a wrong value
  here ships the fork's daily channel from upstream's repo.
- `.github/workflows/pr.yml:270` — the Node matrix owner ternary. Upstream's `pr.yml` has the
  literal `node: ['24', '26']`; the fork runs one major to halve CI cost, and Node 26 coverage
  returns with every sync (ORCA-127). Guarded by
  `config/scripts/pr-workflow-parallelism.test.mjs:46`, which asserts the ternary's three
  fragments — so a dropped major fails a test rather than passing silently. Workflow retention
  (§1) preserves this for free.

The method that found all four is §7 of #80's body: isolate **fork-authored lines** (present in the
fork's copy, absent from both the merge base and upstream's copy), then ask which of those exist
nowhere in the merged tree. Run it over every conflicted file, not the risky-looking ones. An
ad-hoc `git show <sha> -- <file> | grep <symbol>` is not a substitute: it matches context lines as
readily as added ones, and that misread cost a wrong resolution in #7.

## 4. Chunking: land it as 5 sequential merges, not one PR

671 commits in one PR is unreviewable, and #7 proved a 244k-line merge is where silent reverts
hide. Upstream's release tags are cut on side branches, so the boundaries are the **points on
`upstream/main` where each release was cut** (`git merge-base <tag> upstream/main`). Each row was
dry-merged into `origin/main` and aborted:

| candidate cut | date | upstream commits from base | conflicting paths (cumulative) | newly conflicting |
| --- | --- | --- | --- | --- |
| `a0a654c3a9` (1.4.182 cut) | 08-11 | 122 | **27** | 27 |
| `09ec516ae5` (1.4.183 cut) | 08-12 | 193 | 48 | 21 |
| `93334dc53f` (1.4.184 cut) | 08-13 | 273 | 72 | 24 |
| `cb42b60849` (1.4.185 cut) | 08-14 | 372 | 113 | 46 |
| `84784f5393` (date cut) | 08-16 | 503 | 157 | 44 |
| `19ba83d496` (date cut) | 08-17 | 576 | 166 | 10 |
| `upstream/main` | 08-20 | 671 | 174 | 8 |

The tail past the newest tag (`v1.4.185`, cut 08-14) has no release boundary, so it needs date cuts
— without one the final chunk would be 299 commits, larger than chunks 1-3 combined.

**Proposed split — 5 chunks, balanced by conflict load:**

| PR | merge target | upstream commits | conflicts to resolve |
| --- | --- | --- | --- |
| 1 | `a0a654c3a9` | 122 | 27 |
| 2 | `93334dc53f` | +151 | 45 |
| 3 | `cb42b60849` | +99 | 46 |
| 4 | `84784f5393` | +131 | 44 |
| 5 | `upstream/main` (re-pin at execution time) | +168 | 18 |

**The chunking is nearly free.** Those five sum to **180 resolutions against 174** for the
single-shot merge — 3.4% more total work, for a first PR of 27 conflicting paths instead of 174.
The per-cut numbers are cumulative versus `origin/main`, so "newly conflicting" is a lower bound: a
path re-conflicts in a later chunk only if upstream touches the same hunks again *and* the earlier
resolution diverges. Five chunks, not eight — each one needs its own full E2E cycle, and that CI
cost, not the conflict count, is what caps the split.

Rules for the sequence, inherited from #7:

- **Merge, never rebase.** `git merge-base --is-ancestor a63df91790 HEAD` must keep returning true;
  a rebase flattens the merge and breaks ancestry (#80, "Do not rebase this branch").
- Merge commit, not squash, so upstream history survives.
- Apply the `.github/workflows` retention checkout in every chunk.
- Each chunk is a PR into `main` with its own green cycle before the next starts.

## 5. Classifying the reds — and the one thing that must start now

The reason #7 cost three relays is that a red E2E did not distinguish "the sync broke it" from
"it was already broken". ORCA-266 fixed that in principle. In practice **the baseline population is
currently one run**:

- `report:e2e-failure-rate` (`config/scripts/e2e-failure-rate-report.mjs`) reads harvested
  Playwright JSON reports: `gh run download <run-id> --dir e2e-reports --pattern
  'e2e-json-report-*'` then `node config/scripts/e2e-failure-rate-report.mjs --reports e2e-reports`.
- ORCA-266 landed `0947cfb1ad` on **2026-08-19**. Of the eight most recent `e2e.yml` runs on
  `main`, only `32309012094` (2026-08-19 22:29 UTC) has `e2e-json-report-*` artifacts — 13 of them,
  expiring 2026-09-18. The four older runs checked have none.

**Action item with a date on it: start harvesting `main`'s scheduled `e2e.yml` runs into a growing
corpus now.** `e2e.yml` runs twice daily (~17:30 and ~22:29 UTC), so a usable baseline is days of
wall clock, not minutes. This is a second argument for chunking: chunk 1's review and CI cycle runs
while `main` keeps producing baseline runs, so by the later chunks the base rate is real.

Classification procedure per red, in order:

1. **Class before spec.** A red check is not a failed test. Run
   `config/scripts/ci-failure-class.mjs` (ORCA-263) — a watchdog-killed shard is a hang, a failed
   setup step is a setup failure, and neither is a spec regression. See
   `docs/reference/ci-failure-classification.md`.
2. **Base rate second.** If the spec's pre-sync failure rate on `main` is non-zero, it is not the
   sync's. File it against the baseline, do not bisect the merge.
3. **Rate zero, red now → the sync owns it.** Bisect within the chunk — a 122-commit window, not a
   671-commit one.

Traps already paid for, do not re-pay:

- `gh run view` reports **only the latest attempt**; for rates use `/attempts/N/jobs`. The
  artifact names already carry `-attempt-${{ github.run_attempt }}`, so the harvest is safe.
- An upper bound (`toBeLessThan`) read too early **passes**; only a lower bound or an equality goes
  red. See `docs/reference/timing-budget-assertions.md`.
- **229 specs run in CI, not 248** — `--project=electron-headless` excludes 13 `@headful`/
  `@ondemand` and 6 all-`fixme`.
- Do **not** reopen `restart-restore-terminal-input` or `voice-microphone-selection`; ORCA-197
  (`44a97d6f74`) fixed them, 0/14 recently.
- `Execution context was destroyed` can be a **product** bug — read
  `docs/reference/renderer-recovery-reload.md` before calling it flaky.

## 6. What #7 cost, as the expectation to calibrate against

From `docs/reference/orca-201-sync7-handoff.md` and #80's body: three agent relays, four rounds of
CI triage, 66 conflicting files at 404 new upstream commits. It closed with **4 specs parked**
under `test.fixme`, **3 tickets opened** (ORCA-207, ORCA-208 urgent, ORCA-209), and two more filed
rather than mixed in (ORCA-202, ORCA-203). Every red was upstream's; none was the fork's.

Sync #8 is 671 commits and 174 conflicts — roughly 1.7× #7's conflict load. The chunking in §4 and
the base rate in §5 are what keep that from being 1.7× three relays: the first PR is 27 conflicts,
and a red no longer has to be bisected to be attributed.
