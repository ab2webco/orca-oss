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
- `.github/workflows/pr.yml:271` — the Node matrix owner ternary. Upstream's `pr.yml` has the
  literal `node: ['24', '26']` at its own `:381`; the fork runs one major to halve CI cost, and
  Node 26 coverage returns with every sync (ORCA-127, now Done). Guarded by
  `config/scripts/pr-workflow-parallelism.test.mjs:46-48`, which asserts the ternary's three
  fragments — so a dropped major fails a test rather than passing silently. Measured this sync:
  the ternary **survives the raw merge untouched**, at `:450` of the merged `pr.yml`, outside every
  conflict hunk. Workflow retention is belt to that suspenders, not the only thing holding it.

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

## 7. What the 174 actually cost: classify by hunk, not by path

**"174 conflicts" is 174 *paths*, and a path count does not predict cost.** A file with one import
collision and a file with nine overlapping logic rewrites both count as 1. Re-measured at the same
pinned SHAs, the 174 paths are:

| | count |
| --- | --- |
| paths with conflict markers | 146 (145 content + 1 add/add) |
| paths with no markers (modify/delete) | 28 — the three refactors in §2 |
| **conflict hunks inside those 146** | **327** |

Each hunk was merged with `merge.conflictStyle=diff3`, so every one carries ours / base / theirs.
The tier is decided from the base-line ranges each side edits — not from how the hunk looks:

| tier | rule | cost |
| --- | --- | --- |
| **T1 union** | one side equals base, or the two sides edit **disjoint** base ranges, or both sides only *insert* | minutes — take both |
| **T1 imports** | every changed line on both sides is an `import` statement or an import specifier | minutes — union the specifiers, repoint at upstream's new module paths |
| **T1 i18n keys** | locale JSON, neither side deletes a key, no key added by both with different values | minutes — union the keys |
| **T2 relocation** | upstream collapsed a large base block into a stub (`theirs ≤ 25%` of base, `ours ≥ 75%`) — it **moved** the code, it did not rewrite it | ~30 min per file — adopt the split, then re-home the fork's delta into upstream's new submodule |
| **T3 design** | both sides rewrote the same non-import construct | hours — needs a decision |

### The proportions

| scope | hunks | T1 | T2 | T3 |
| --- | --- | --- | --- | --- |
| whole merge | 327 | **191 (58.4%)** | 41 (12.5%) | **95 (29.1%)** |
| `src/renderer/src` (the 51 paths) | 100 | **67 (67%)** | 12 (12%) | **21 (21%)** |
| chunk 1 (`a0a654c3a9`) | 36 | 15 (41.7%) | 6 (16.7%) | 15 (41.7%) |

Denominator hygiene, because it is what makes the rest believable — of the renderer's 51 paths,
**7 are modify/delete** (they belong to the `9367169888` test-split recipe, not to content
resolution) and **5 are `i18n/locales/{en,es,ja,ko,zh}.json`**. The percentages above are over the
**44 renderer paths that carry markers**, and 100 hunks inside them.

**So the renderer is the least expensive of the big areas, not the most.** It holds 51 of 174 paths
but only 21 of 95 design hunks. Ranked by design load instead of path count:

| area | T3 hunks |
| --- | --- |
| `src/renderer/src` | 21 |
| `src/main/runtime` | 15 |
| `src/main/daemon` | 10 |
| `src/main/claude` | 7 |
| `src/main/ipc` | 3 |

And T3 hunks are mostly small: **28 are ≤3 changed lines**, 39 are 4-20, 23 are 21-100, and only 4
exceed 100. Files carrying at least one T3 hunk: **57 of 146** — so 89 conflicted files can be
resolved without a single design call.

### T2 is the class that was invisible in the path count, and the one that reverts silently

12.5% of hunks are upstream **file-splitting refactors**, and they are where #80's silent-revert
risk lives: the fork's edit sits in a block upstream moved to a new file, so "take upstream" builds,
typechecks, and quietly drops fork behavior. Measured examples:

| path | base block | upstream leaves | fork delta to re-home |
| --- | --- | --- | --- |
| `src/renderer/src/store/slices/editor.ts` | 4958 lines | `export { createEditorSlice } from './editor/create-editor-slice'` | 19 lines |
| `src/renderer/src/store/slices/worktrees.ts` | 2900 lines | 41-line delegation | 88 lines |
| `src/renderer/src/App.tsx` | 1630 lines | deleted | 6 lines |
| `src/renderer/src/components/sidebar/WorktreeCard.tsx` | 456-577 lines ×5 hunks | `useWorktreeCardController(...)` | 39-52 lines |
| `src/preload/api-types.ts` | ×5 hunks | split modules | — |
| `src/main/claude-usage/store.ts`, `src/main/codex-usage/store.ts` | ×5, ×3 hunks | split modules | — |

Run the §3 fork-authored-lines check on **every T2 hunk** without exception — and, per the sample
below, on the T1 hunks too. That is the list the check exists for.

### Validation of the tiers

The rules were validated by hand against 14 hunks spanning every tier, and two false-positive
classes were found and fixed before the numbers above were taken: locale JSON where a key's only
change is gaining a trailing comma because a sibling was appended after it (union, not a
collision), and two pure insertions at the same base point (union — e.g.
`src/renderer/src/lib/worktree-creation-flow.ts:0`, where the fork adds a `linkedPlaneWorkItem`
spread and upstream adds a `nameWasGenerated` spread to the same object literal).

One known misclassification is left in, named rather than papered over: the add/add path
`src/main/runtime/rpc/methods/worktree-create-schemas.ts` has an empty base, so the rule reads it as
a union when it is really two independent implementations of the same new module — a design call.
It is 1 hunk of 327; the counts above already move it into T3.


### Validation in the other direction, and the error bar on 58.4%

Every refinement above moved hunks *out* of T3 and was driven by hunks suspected of being
misclassified — that covers false positives only. The false-negative direction was checked
separately: **10 T1 hunks drawn at random** (seed 269, over all 191) and read by hand.

**10 of 10 resolve as unions in minutes.** The sub-rules behind the 167 `T1-union` hunks split
**84 co-insertion / 83 disjoint-ranges**; `one-side-equals-base` is empty, as it must be, since git
does not conflict a hunk one side left alone. Two caveats the sample surfaced, both worth carrying:

- `src/renderer/src/store/slices/github.ts:0` reached `disjoint` through an interval-arithmetic edge
  (the fork's pure insertion sits at index 0, upstream replaces indices 0-2, and a zero-width point
  at a range's left edge is not counted as inside it). The **resolution is still a union** — keep
  upstream's repointed `shared/github/*` imports, add the fork's new one — so the cost tier is right
  and the reason is not. Expect a handful more like it.
- **A T1 hunk can be coupled to a T3 hunk in the same file.** `src/main/runtime/orca-runtime.ts:7`
  is a clean union at the declaration site, but upstream also changes
  `orchestrationFederationSyncs` from `Map<string, Promise<void>>` to
  `Map<string, { db, promise }>`, and the fork's uses of it live in that file's other 7 T3 hunks.
  Hunk tiers do **not** add up to a per-file cost. Resolve file by file, tier by hunk.

**The most useful thing the sample found is a correction to §7's own advice.** Two of the ten random
T1 hunks carry ORCA-210 protected-surface fork fields:
`src/main/daemon/terminal-host-options.ts:0` (`onStartupCommandStateChange`, co-inserted opposite
upstream's `reportReadinessEvent`) and `src/main/daemon/daemon-server.ts:1` (its wiring, opposite
upstream's `reportReadinessEvent` plus an `onSessionReaped` rework). A union that quietly resolves
"toward upstream" on a hunk that *looks* trivial drops a protected field exactly as silently as a T2
does. So: **run the fork-authored-lines check over every conflicted file, T1 included** — the same
instruction §3 already gives, and §7 should not have narrowed it to T2.

### Denominator, stated once more

The 327 hunks live in the 146 marker-carrying paths. The **28 modify/deletes sit outside that
denominator**, and about 3 of them are design calls, not batch work — `c86418eaad` deletes
`src/shared/orca-attribution.ts`, a protected surface. So "29.1% design" is a share of the
marker-carrying subset, not of all 174 paths.

### What this changes about the chunk order

Chunk 1 (`a0a654c3a9`, 27 paths) is **41.7% design by ratio but only 15 design hunks in absolute
terms, 9 of them ≤3 lines**. It stays the right first PR. Two things it carries that the path count
hid:

- Its T3 set is concentrated in **`src/main/runtime/orchestration`** (`db.ts`,
  `orchestration-db-retention-pagination.test.ts`, 5 hunks), not in the renderer.
- It conflicts **four of the E2E specs from #7's red set** —
  `tests/e2e/floating-tab-rename.spec.ts`, `github-created-issue-start-prefill.spec.ts`,
  `tab-create-entry-file-paths.spec.ts`, `worktree-jump-palette-filter.spec.ts`. The park/unpark
  decisions in §8 therefore land in the **first** PR, not a later one.

### Why the chunking axis is time and cannot be area

A merge is whole-tree: there is no `git merge` that brings upstream's renderer commits and not its
main-process commits. The two are not separable in this codebase either — upstream's renderer
changes and its main-process changes share the IPC and RPC schema surfaces
(`src/preload/api-types.ts` and `src/main/runtime/rpc/methods/*` are both in the conflict set), so
an area-sliced intermediate state would not typecheck. Every chunk boundary has to be a point that
upstream itself built, which is why the cuts in §4 are release cuts on `upstream/main`. Area is a
useful axis for **who reviews which hunk inside a chunk**, and for nothing else.

## 8. The #7 parks: 8 alive, all 5 survive the merge, and 3 have no reason left to exist

Measured on `origin/main` and against the merged tree.

**There are 8 `test.fixme` E2E specs on `main`, not 4.** Five are #7's lineage; three predate or sit
outside it:

| spec | park origin | still `test.fixme` on `main` | upstream copy has `test.fixme` | conflicts in this sync |
| --- | --- | --- | --- | --- |
| `orchestration-legacy-worker-missing-terminal-recovery.spec.ts:192` | #7 (`f62c1f6882`) | yes | **no** | no |
| `orchestration-legacy-worker-restart-recovery.spec.ts:167` | #7 (`f62c1f6882`) | yes | **no** | no |
| `orchestration-worker-terminal-visibility.spec.ts:121` | #7 (`f62c1f6882`) | yes | **no** | no |
| `tab-create-entry-file-paths.spec.ts:29` | #7 (`cf9a6e883e`) | yes | **no** | **yes — T3, 6-line hunk, in chunk 1** |
| `terminal-hidden-view-parking.spec.ts:484` | #7 | yes | **no** | no |
| `github-created-issue-start-prefill.spec.ts` | #7's "one left open" | yes | **no** | **yes — in chunk 1** |
| `paired-remote-terminal-materialization-reconnect.spec.ts` | pre-#7 | yes | **no** | no |
| `repro-7732-gitlab-checks-job-details.spec.ts` | pre-#7 | yes | **no** | no |

**All eight parks survive the raw merge**: 8 spec files carry a `test.fixme` on `main` and 8 carry
one in the merged tree, and the two that conflict each still hold theirs. Six of the eight do not
conflict at all, because upstream moved 0 or 1 commits in them.

**The two that do conflict are the ones to watch.** Upstream's copy of every parked spec has **no**
`test.fixme`, so wherever a park sits inside a hand-resolved file, the resolution decides whether
the park survives — and resolving toward upstream un-parks it, after which it reads as a sync
regression when it is a known failure with a written diagnosis. Both cases are
`tab-create-entry-file-paths.spec.ts` (diagnosis at `:20-28`) and
`github-created-issue-start-prefill.spec.ts` (`:128`, `:141`), and **both are in chunk 1**. Their
conflict hunks are in the test bodies, not on the `test.fixme` lines, which is precisely how a park
gets dropped by someone resolving the body.

One more spec in the conflict set deserves naming for the opposite reason:
`tests/e2e/voice-microphone-selection.spec.ts` carries **4 T3 design hunks** and is on the
do-not-reopen list — ORCA-197 (`44a97d6f74`) fixed it, 0/14 recently. It is not parked and must not
become parked; a wrong resolution here re-breaks a spec that was already paid for.

**One park is stale, two are not — and "the ticket is Done" does not settle it.** The three
`orchestration-*` parks each name ORCA-207 / ORCA-208 / ORCA-209 as their unpark condition (see
`orchestration-legacy-worker-missing-terminal-recovery.spec.ts:189-190`), and all three tickets are
Done. But ORCA-207 is *the oracle itself* — the specs assert on a tty echo of Orca's own write — and
closing it did not necessarily repair these three. Checked with
`git log f62c1f6882..origin/main -- <spec>`:

| spec | what actually landed since the park | verdict |
| --- | --- | --- |
| `orchestration-legacy-worker-restart-recovery.spec.ts` | **`d45645cd81`** — `test(e2e): assert agent output, not tty echo, in two pane-buffer oracles (ORCA-207) (#89)`, which rewrote this file's assertions, **plus** the ORCA-208/209 product fixes | all three stated blockers addressed; the `test.fixme` and its rationale comment are **stale** |
| `orchestration-legacy-worker-missing-terminal-recovery.spec.ts` | only `20a5fc1970` (ORCA-209 product fix) | **oracle never repaired** — #89 covered two oracles and this was not one |
| `orchestration-worker-terminal-visibility.spec.ts` | only `20a5fc1970` (ORCA-209 product fix) | **oracle never repaired** |

So PR 0 is **verify, not lift blind**: run the three on `main` under `--project=electron-headless`
before chunk 1, lift only what goes green, and file the oracle repair for the two that never got one
as its own ticket rather than as a sync prerequisite. Un-parking all three on the strength of the
ticket states would put two fresh reds in front of chunk 1 — the exact inversion of the goal. It
still belongs before chunk 1 and outside it, because a park lifted inside a chunk cannot be
attributed, and because a spec that goes green early starts contributing to the §5 baseline while
the chunks are in flight.

The other two #7 parks keep their reason: `terminal-hidden-view-parking:484` needs the accumulating
pane-manager defect fixed (product, not test), and `tab-create-entry-file-paths:29` needs the probe
run on Linux CI. Neither is sync #8's work; do not un-park either as a resolution shortcut.

### The reporter step is a park risk of its own

`.github/workflows/e2e.yml` has exactly **one** conflict hunk, and it is the fork's ORCA-266
`Upload E2E JSON report` step (`e2e-json-report-changed-attempt-${{ github.run_attempt }}`) against
upstream's rework of the same lane. **Resolving toward upstream deletes the artifact upload, and the
§5 baseline corpus silently stops growing** — the one mechanism that makes sync #8 cheaper than #7.
Keep the fork's step and port upstream's lane filtering into it.

`.github/workflows/pr.yml` has 4 hunks, 3 of them T1. The one T3 is the fork's
`select-pr-e2e-scope.mjs` call (ORCA-128) against upstream growing the inline scope block it
replaced from 13 to 43 lines: keep the fork's script and port upstream's new routing rules into it,
rather than taking either side whole.

### Drift

`upstream/main` moved to `012e9f410c` (**692** ahead of `origin/main`) while this was measured. All
counts in this document are at `d7a23c84a9` so they line up with §2 and §4. Re-pin the final chunk
at execution time; the cuts for chunks 1-4 are fixed points and do not move.
