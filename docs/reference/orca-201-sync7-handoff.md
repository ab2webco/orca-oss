# ORCA-201 — upstream sync #7 handoff

Working state of PR [#80](https://github.com/ab2webco/orca-oss/pull/80), branch
`fabolivark/orca-201-upstream-sync7`. Written mid-flight so the next agent does not
re-derive a 244k-line merge. **The PR body is the primary artifact** — triage, every
conflict resolution, the schema analysis, the protected-surface diff. This file carries
only what the PR body does not: where the open work stands.

Delete this file when the PR merges.

## Pinned references

| what | value |
| --- | --- |
| pre-sync base (fork) | `267f58acd613d2af0ad65546a29e0f64addfd0c7` |
| sync #6 tip (ancestry repair target) | `026ed921c1` |
| upstream tip merged | `a63df91790` (v1.4.178-rc.2) |
| last pre-sync CI run with **full E2E green** | run `31355315929`, all 10 shards |

Comparison worktrees used (recreate as needed; both need
`ln -s <repo>/node_modules` and `npm run build`):

```
git worktree add --detach <scratch>/pre-sync2 267f58acd6
git worktree add --detach <scratch>/up-main   upstream/main
```

## Done

- Merge landed in 8 commits: ancestry repair (`38d550be72`), the merge, and corrections.
- `npm run typecheck`, `npm run lint` (whole 10-command chain), `npm test`
  (**51257 passed / 0 failed**), mobile (`typecheck`/`lint`/`format:check`/**3427 passed**).
- 40 named protected-surface checks pass and are shown to discriminate.
- Four upstream effects refused + one unrunnable spec removed — see the PR body.
- Four silent reverts caught and repaired — see the PR body.
- `orchestration.test.ts` and `orca-runtime.test.ts` rebuilt as real three-way merges
  after a wholesale resolution silently dropped 38 lab cases.
- Inherited findings filed, **not** mixed into this PR: **ORCA-202** (React Doctor),
  **ORCA-203** (8 upstream E2E specs).

## Open: the one real regression

`tests/e2e/orchestration-legacy-worker-missing-terminal-recovery.spec.ts` and
`orchestration-legacy-worker-restart-recovery.spec.ts` fail **only when they run in the
same worker** (they share shard 4, and did so in the green pre-sync run too — this is not
a re-sharding artifact). The worker terminal shows a shell prompt instead of the fake
Codex's `ACK` inside a 10s `expect.poll`.

Measured, interleaved on one machine so load cannot masquerade as a tree difference:

| tree | pair failures |
| --- | --- |
| merged HEAD | 4 / 5 interleaved, 7 / 10 total |
| pre-sync `267f58acd6` | **0 / 5 interleaved, 0 / 8 total** |
| `upstream/main` | 0 / 1 |

Neither parent fails. Excluded with evidence: agent resolution is correct (probe on
`resolveAgentTerminalCreateOptions` shows `startupAgent: 'codex'` in,
`command: codex '--dangerously-bypass-approvals-and-sandbox'` out); the specs, their
fixture and `orca-app`/restart helpers are otherwise untouched by the sync; the spec
passes paired with an unrelated co-tenant.

### Where the bisect landed

The merge **silently dropped the E2E opt-out from the Codex real-home lane**. Upstream
deleted `src/main/codex/codex-real-home-flag.ts`; the resolution dropped the
`isCodexSystemDefaultRealHomeEnabled()` gate in `runtime-home-service.ts` because the
module no longer existed — and the same deletion took the test seam with it:

```diff
 tests/e2e/helpers/orca-restart.ts
-    userDataDir,
-    codexRealHomeEnabled: false
+    userDataDir
```

**Nine E2E entry points lost the parameter; six of them passed `false` on purpose**:
`orca-restart.ts`, `paired-electron-client.ts`, `headless-paired-runtime-host.ts`,
`computer-cli-driver.ts`, `headless-serve-desktop-activation.spec.ts`, and the helper's
own unit test. `ORCA_CODEX_SYSTEM_DEFAULT_REAL_HOME` also left the isolation helper's
protected-variable list.

Mechanism that fits: with the lane on, every launch runs `installRealHomeCodexHook` →
`grantManagedCodexHookTrust`, which executes `codex app-server`. These specs' fake Codex
has an explicit `app-server` branch that exits 2 — new startup work on the critical path
of a 10s poll.

**Not yet proven.** It correlates and is in the right area, but the failing local runs did
not show `codex-trust-grant` lines. The experiment that settles it: restore the opt-out,
re-run the interleaved A/B, and see whether HEAD goes 4/5 → 0/5.

### The A/B was run. The mechanism is disconfirmed.

Restoring `codex-real-home-flag.ts` as a fork divergence was built and measured. **It
changes nothing for these specs**, so it was not landed. It is kept intact and
cherry-pickable on branch `fabolivark/orca-201-real-home-flag-divergence` (`412ad2777f`),
and the decision to keep or drop it is open.

The restoration was proven **live, not inert** before measuring — this is the trap that
would have made an inert change read as a disproof:

- `tests/e2e/electron-home-isolation.spec.ts` reads
  `process.env.ORCA_CODEX_SYSTEM_DEFAULT_REAL_HOME` **inside the launched Electron main
  process**: `'0'` by default, `'1'` when the fixture opts in. 2/2 pass.
- A new unit case on `isHostSystemDefaultRealHomeSelected` discriminates — it fails with
  the restored gate condition removed.

Because the flag defaults to ON, `codexRealHomeEnabled: true` in the restored tree is
behaviourally identical to plain HEAD (the only added source condition is satisfied). That
makes the A/B one build and one tree, with no cross-tree confound:

| arm | `missing-terminal` alone | pair (3 cases, `--workers=1`) |
| --- | --- | --- |
| lane ON (≡ HEAD `ea662ed65f`) | 2 / 5 rounds failed | 6 failed cases, 4 / 5 rounds |
| lane OFF (restoration) | 2 / 5 rounds failed | 6 failed cases, 5 / 5 rounds |

Two corrections to the section above fall out of that table:

1. **The spec is not pair-only.** It fails **2/5 alone on both arms**, so this is not
   global state leaking between paired specs. Beware single runs: the first run of each arm
   here read as "ON passes alone, OFF fails alone", which five rounds show was noise.
2. **The startup-work hypothesis has the sign backwards.** Turning the lane off does not
   remove the `codex app-server` trust grant: `grantManagedCodexHookTrust` has three call
   sites in `src/main/codex/hook-service.ts` on the **managed** lane too (same count
   pre-sync). With the lane off, `prepareForCodexLaunch` returns the shared mirror instead
   of `null` and then runs `invalidateBackfillAfterManagedSystemDefaultLaunch`,
   `syncForCurrentSelection`, `syncSystemCodexResourcesIntoManagedHome()`,
   `syncSystemConfigIntoManagedCodexHome()` and starts the session bridge — strictly *more*
   synchronous launch work than the real-home lane, which returns early.

Restoring only 1 of the 9 pre-sync gate sites is not what makes this neutral: with zero
managed Codex accounts the other 8 are no-ops (`settings.codexManagedAccounts` is empty,
and `pty.ts`'s site needs `selectedCodexHomePath === null`), and the backfill-invalidation
site would only add work at flag-OFF.

### Where to look next

The symptom argues against latency altogether. The spec finds the pane by
`title === 'Codex Ready'`, so the fake Codex **did** spawn and write its title escape;
the tail then shows a shell prompt. That is "codex exited", not "codex was slow". The spec
already instruments this — `spawn.jsonl` and `interruption.jsonl` in its `fakeCliDir`. Read
`interruption.jsonl` on a failing run: a `signal` or `stdin-ctrl-c` entry means the pane was
torn down and closes the latency line of inquiry for good.

Upstream rewrote the surrounding machinery heavily in this range and it is unaudited for
this failure: `codex-session-backfill*`, `codex-session-migration-scheduler.ts`, and a new
`codex-state-db-backfill-recovery.ts` (+313 lines).

### Landed from this front

`tests/e2e/electron-home-isolation.spec.ts` compared `path.join(ORCA_E2E_USER_DATA_DIR,
'home')` un-realpathed while `createElectronHomeIsolation` canonicalizes HOME, so it failed
on any host with a symlinked tmpdir (macOS `/var` → `/private/var`). Confirmed failing
identically on `ea662ed65f`, so it is not the sync's; Linux CI hides it. Fixed
(`ce372efde0`).

## Still red in CI, and why

| lane | status |
| --- | --- |
| `static analysis` | **inherited**, ORCA-202. 18 React Doctor errors, all upstream's; the gate bills them to the sync because it diffs against the fork's pre-sync tip. 0 introduced. |
| `e2e (full)` shards 1/2/4/5/6/10 | 8 specs **inherited** (ORCA-203) + the pair above (ours, open). |
| everything else | green. |

The PR **cannot go green** until ORCA-202 and ORCA-203 are resolved. That is the
coordinator's call, not this PR's.

## Method notes worth keeping

- **A single run against `upstream/main` does not prove "inherited".** A spec that fails
  half the time fails on both trees. Classify on a static fact where one exists (the
  string the spec waits for does not exist in upstream's tree), and use repeated
  interleaved runs when it does not.
- **Shard numbers are not comparable across CI runs.** Playwright shards by index over the
  sorted spec list, so deleting one spec moves every later one. Compare by spec name.
- **A conflicted test file resolved by taking one side compiles, lints and passes while
  silently losing the other side's cases.** Rebuild with `git merge-file` against the true
  base, then audit fork-authored lines (present in the fork's copy, absent from both the
  base and upstream's) that exist nowhere in the merged tree.
- **Do not merge from an agent session.** `.claude/hooks/main-merge-guard.py` refuses it
  (ORCA-182); push, open/update the PR, hand the number to the coordinator.
