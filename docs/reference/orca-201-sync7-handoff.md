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

> **Read "The A/B was run" below before acting on this section.** Two of its claims are
> measured false: the failure is not pair-only, and the real-home-lane mechanism is
> disconfirmed. The section is kept as the record of how the bisect got there.

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

That experiment was run. It did not. See below.

### The A/B was run. The mechanism is disconfirmed.

Restoring `codex-real-home-flag.ts` as a fork divergence was built and measured. **It
changes nothing for these specs**, so it was **dropped** (coordinator's call, 2026-08-10).
It is kept intact and cherry-pickable on branch
`fabolivark/orca-201-real-home-flag-divergence` (`412ad2777f`) should a future sync need the
out-of-process seam; it is deliberately absent from the PR's fork-divergence list, because a
divergence with no verified purpose is pure conflict surface for sync #8.

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

## E2E triage as of `ffa266869b` — by spec, with provenance

Shards 1 and 10 are **green** (`8a1a018324`, `ffa266869b`). Seven specs remain, across
shards 2, 4 and 6. None of them is a stale-string fix; each was classified by whether the
code it exercises was touched by the fork's resolutions, not by a single run.

| spec | shard | symptom | provenance |
| --- | --- | --- | --- |
| `orchestration-legacy-worker-missing-terminal-recovery` | 4 | waits `ACK`, gets a shell prompt | **ORCA-204** |
| `orchestration-legacy-worker-restart-recovery` | 4 | same | **ORCA-204** |
| `orchestration-worker-terminal-visibility:109` | 4 | same | **ORCA-204** — found this round; the pattern is not "the pair", it is any spec that starts a Codex worker on a fake CLI and waits for `ACK` |
| `tab-create-entry-file-paths` | 6 | omnibox shows no file rows | **ORCA-203** — product race, `FileListingCancelledError`; hook byte-identical to upstream *and* to pre-sync |
| `orca-profiles` ×2 | 4 | `button /^Switch profile$/` never renders | `OrcaProfileSwitcher.tsx` is **byte-identical to both** upstream and the pre-sync tip — the fork changed nothing here |
| `floating-tab-rename` | 2 | panel stays `aria-hidden="true"` | `FloatingTerminalPanel.tsx` is byte-identical to upstream and **+36/−9 vs pre-sync**: upstream changed it in this range and we took it wholesale |
| `github-created-issue-start-prefill` | 2 | `--prefill` never reaches the terminal buffer (received `""`) | **unclassified, and it needs a run** — see below. Not the ORCA-204 family |
| `issue-12656-terminal-link-tooltip` | 2 | hover tooltip `display: none`, `currentLinkText: null` | smells like the ORCA-197 hidden-window frame class; helper exists at `tests/e2e/helpers/frame-independent-ui.ts` |
| `repro-7732-gitlab-checks-job-details` | 2 | predicate timeout | **ORCA-203** — classified, see below |

### The two that were left blank

**`repro-7732-gitlab-checks-job-details` → ORCA-203.** The whole feature it exercises arrived
with this merge and the fork's resolutions touched none of it. The spec file is +160/−0 vs the
pre-sync tip (it does not exist there) and **byte-identical to `upstream/main`**; so are every
surface on its path — `helpers/source-control-ai-generation.ts` (`openChecks`, where the
predicate times out), `right-sidebar/checks-panel-content.tsx` (+103/−30 vs pre-sync),
`right-sidebar/ChecksPanel.tsx` (+116/−27), `runtime/gitlab-job-trace-client.ts` (**+105/−0,
new**) and `main/ipc/gitlab.ts` (+8/−2). The store symbols `openChecks` polls
(`rightSidebarTab`, `setRightSidebarOpen`) exist in the merged tree, and
`store/right-sidebar-route.ts` is identical to both trees. Upstream code, upstream spec,
untouched by us — the fix stands without the sync, so it ships under ORCA-203.

**`github-created-issue-start-prefill` → still unclassified, and deliberately so.** It is *not*
the ORCA-204 family: no `orchestration.workerStart`, no Codex worker, no `ACK` — it launches
Claude and asserts `--prefill` in the terminal buffer, which came back `""`. The spec is
byte-identical to both upstream and the pre-sync tip, but its path is not: **`TaskPage.tsx` is
+947/−7 vs `upstream/main` and +1808/−818 vs pre-sync**, i.e. one of the most heavily
fork-resolved files in the merge, sitting directly on this spec's flow
(`openTaskPage({taskSource:'github'})` → New GitHub issue → Start workspace from issue).
`launch-agent-in-new-tab.ts` (+3/−2 vs upstream, +2/−2 vs pre-sync) and `tui-agent-config.ts`
(+11/−0 vs upstream) are also fork-divergent on that path. Byte-identity therefore cannot
classify it either way.

It was run locally, and **the run does not reproduce CI's failure**: it dies ~100 lines earlier,
at `expect(newIssueButton).toBeEnabled()` (`spec:155`) — the *New GitHub issue* button stays
`disabled` for the full 15 s. That gate is `disabled={!newIssueTargetRepo}` (`TaskPage.tsx:9925`),
and `newIssueTargetRepo` is `selectedRepos.find(…) ?? selectedRepos[0] ?? null`, so locally
`selectedRepos` is empty and the flow never starts. CI gets past that button and fails later, on
the terminal buffer. One machine's earlier, different failure is not evidence about CI's, so this
stays open rather than being classified on the wrong symptom.

To close it, the next agent needs a run that reaches `spec:170` — either on Linux CI, or locally
after making the task page's repo selection non-empty — and then the fork-divergence of
`TaskPage.tsx` on that path decides it. Calling it inherited on the strength of the spec's
byte-identity alone would be exactly the weak criterion this ticket already retracted once.

**ORCA-204 belongs to #80** (decided; the rule below beat the earlier instruction to track it
outside). A fix that stands without the sync ships as its own PR; one that exists only because
the merge broke it goes in #80. Everything above except ORCA-204 is the former.

### Nobody kills the worker. That SIGTERM is the test's own teardown.

> Supersedes the "Orca is killing a freshly spawned worker" reading. The ledger evidence was
> real; its timing was never measured, and the timing is what it turns on.

The ledger entry carried no timestamp, so a teardown signal read as a mid-test kill. Adding
`t` to the fake's `appendLedger` and instrumenting every kill/signal funnel settles it:

| event | time |
| --- | --- |
| fake Codex spawns | `23:01:00.749` |
| daemon `shutdownTerminalHostSessions` → `forceKill` on the worker PTY | `23:01:11.445` |
| fake Codex receives SIGTERM | `23:01:11.444` |

**One millisecond apart, ~11 s after spawn** — the 10 s `ACK` poll had already expired and the
test had already failed. The worker is alive for the whole assertion window. Reproduced on
three separate failing rounds.

Instrumented and **silent before teardown** on every failing round: `killWithDescendantSweep`,
`terminateDescendantSnapshot`'s `defaultSendSignal`, `forceKillPosixPtyProcessGroups`' pgroup
signal, all six `client.request('kill', …)` call sites in `daemon-pty-adapter.ts`/
`daemon-pty-provider.ts`, the daemon subprocess `kill`/`forceKill`/`signal`/`clear`, and
`local-pty-provider`'s `killLocalPtyProcess`/`killAll`.

Worth knowing before repeating this: **worker PTYs live in the daemon process, not in
`local-pty-provider`.** Probing only the Electron main process finds nothing and reads as "no
kill happened" for the wrong reason.

### What the assertion actually measures

Logging the daemon PTY's `write`/`onData` for the worker pane, on both arms:

```
08.765  write  "codex '--dangerously-bypass-approvals-and-sandbox'\n"
08.807  data   "\e]0;Codex Ready\a OpenAI Codex / model: e2e / directory: e2e"
08.814  write  "\e[200~You are working inside Orca… === TASK … Respond ACK and remain idle"
08.814  data   "^[[200~You are working inside Orca…"      ← the tty echoing that write back
09.315  write  "\r"
```

**The fake never writes `ACK` — on the passing arm either.** Its stdout is silent from the
banner until teardown on both arms. What satisfies `toContain('ACK')` is the *echo of the
preamble Orca pastes in*, which embeds the task spec `Respond ACK and remain idle`.

And the two arms differ in exactly one thing: **how far that echo gets before it stops.**
Logging the worker session's whole `onData` stream on both arms, at a 400-char slice:

| arm | last echoed chunk of the paste |
| --- | --- |
| passing | `…s task's follow-ups.\r\n\r\n=== TASK ===\r\nRespond ACK and` |
| failing | `…stop, return to an idle prompt, and take no further actions — do NOT start\r\nnew or unrelated work, do NOT run` |

The failing arm's echo is **cut off before the `=== TASK ===` block** — the very tail of the
paste, and the only place the string `ACK` appears anywhere in the run (`grep -c ACK` over the
whole daemon log: 1 on the passing arm, **0** on the failing one). Seven echo chunks instead of
eight; identical up to the truncation point.

The read is of the right pane, not the coordinator's — checked, not assumed. On the failing
round the spec's `worker.ptyId` is byte-for-byte the daemon session that received the
`codex '--dangerously-bypass-approvals-and-sandbox'` write.

**ORCA-204 restated:** Orca pastes the worker preamble into the PTY as **one ~4–6 KB write**
(`writeTerminalAgentPrompt` → `iterateTerminalInputChunks`, whose
`TERMINAL_INPUT_CHUNK_MAX_BYTES` is 16 KB, so the whole preamble is a single chunk), and the tty
intermittently drops its tail before the freshly-exec'd agent drains stdin. The `=== TASK ===`
block is at the end, so what gets lost is the task itself. The "latency" and "kill" lines are
both closed.

**This is a product bug, not a test artifact, and it is worse than the test.** A real worker gets
a truncated prompt — preamble rules intact, task missing — with nothing to signal it. The E2E only
notices because the string it polls for happens to sit in the dropped tail.

### Where to look next — a fix, not more diagnosis

`src/shared/terminal-input.ts` is byte-identical to **both** trees, so the 16 KB chunk size is not
what the merge changed; the preamble crossing a threshold, or the launch timing that decides
whether the agent is draining stdin yet, is. The knobs:

- `OrcaRuntime.writeTerminalAgentPrompt` (`orca-runtime.ts:17964`) already chunks with a
  `setTimeout(0)` between chunks — it just never splits at this size. A smaller chunk bound for
  the agent-prompt path is the narrow fix; verify it does not regress paste throughput.
- `AGENT_PROMPT_SUBMIT_DELAY_MS` and `runtime/agent-composer-readiness.ts` decide *when* the paste
  starts relative to the agent being ready to read. The failing arm pastes 7 ms after the fake's
  banner.

Verification bar: the pair fails roughly 1 in 2 to 4 rounds, so **one green round proves nothing**
— at least 5 interleaved rounds, plus a unit case that fails with the fix reverted.

Reproducing the instrumentation costs ~10 min: a `orca204(msg)` helper that appends
`new Error().stack` to a fixed path, called from the daemon's `pty-subprocess.ts`
`write`/`onData`/`kill`/`forceKill`/`signal` and from `killWithDescendantSweep`. Two traps that
cost this round several rounds:

- **`ORCA204_LOG`-style env gating is unreliable here** — `createRestartSession` builds its own
  launch env. Gate on a marker *file* instead.
- **`SKIP_BUILD=1` on top of a manual `npm run build` gives an app that never reaches
  `window.__store`.** Let global-setup build; the failure looks like a product regression.

Also note the specs delete their `fakeCliDir` in `afterAll`, so the ledgers are gone before you
can read them unless you guard that `rmSync`.

Also ruled out: `orchestration-legacy-worker-restart-recovery.spec.ts` has **no** `app-server`
branch in its fake and fails identically to the two that do, so the fake's `exit 2` is not the
cause either. And `[orchestration] legacy worker provider-ready recovery failed` is a dead end:
`reconcileLegacyWorkerTerminalsNow` only ever *defers* — every failure branch is
`deferredDispatchIds.add`, none of them kills.

## Still red in CI, and why

| lane | status |
| --- | --- |
| `static analysis` | **still red, and #81 does not fix it in CI.** See below. |
| `e2e (full)` shards 2/4/6/7 | 9 spec files / 10 cases on run `31441780221`. Six are ORCA-203; three are the ORCA-204 family; one is new — see below. |
| everything else | green. |

The PR **cannot go green** until ORCA-203 is resolved, ORCA-204 is fixed, and static analysis is
unblocked. ORCA-203 and the static-analysis call are the coordinator's; ORCA-204 is this PR's, and
it is diagnosed but not fixed.

### Static analysis: #81's resolver works, and its answer is discarded one layer down

Measured on run `31441780221` (`ac9f4d264c`), the first run of this branch carrying #81:

The resolver step does its job — the log says *React Doctor measures changed lines against
`a63df9179024ce5c24b8545ee8590199e77f555d`*, the upstream tip. React Doctor then prints
`Scanning changes: (detached HEAD) → 827ce46505ae…`, which is `main`'s tip, i.e. **the PR base**.
The run before #81 (`b4b8ab5728`) printed the same line against `267f58acd613…` — `main`'s
*previous* tip. Both runs measured against the PR base; neither ever saw `a63df91790`.

The 18 are the same 18 ORCA-202 documented — checked first because it was the cheap branch. Error
groups, files, lines and totals are identical across the two runs: `typescript/array-type ×9`
(`mobile/src/session/use-mobile-native-chat-answer-send.test.ts:615`), `Ref mutated during
render ×7` (`TaskPage.tsx:3877`), `Effect dependency recreated every render`
(`useEditorPanelRemoteSiblingContentState.test.tsx:84`), 18 errors / 42 warnings / 63 / 25.

Where the base is lost — `config/scripts/git-pull-request-diff-base.mjs`, which
`check-react-doctor-changed.mjs` runs the requested base through:

```js
if (eventName === 'pull_request' && headParents.length >= 2) {
  return headParents[0]
}
return requestedBase
```

Under `pull_request`, `actions/checkout` checks out the synthetic `refs/pull/N/merge`, which
always has two parents and whose first parent is the base branch tip — so the override always
fires and `requestedBase` is thrown away. Run against the real function with this run's SHAs:

| event / HEAD shape | returned base |
| --- | --- |
| `pull_request` + synthetic merge | `827ce46505…` (the PR base) |
| `push` + synthetic merge | `a63df91790…` |
| `pull_request` + single parent | `a63df91790…` |

The last two rows are why the local verification was green: locally there is no
`GITHUB_EVENT_NAME=pull_request` and no two-parent synthetic HEAD, so the override never fires.
ORCA-202's check exercised the resolver in isolation, not the whole chain under a PR event.

Both `git-pull-request-diff-base.mjs` and `check-react-doctor-changed.mjs` are **byte-identical to
`upstream/main`** — #81 added `resolve-changed-code-base.mjs` and a workflow step and did not
touch either. `check:code-quality:changed` goes through the same helper, so **ORCA-205 inherits
the same ceiling**: rebasing its base will not reach the tool either while the override stands.

Filed back on ORCA-202 (reopened there, not silently absorbed here).

### ORCA-203 cannot ship as a PR off `main`, measured

The rule says a fix that stands without the sync ships separately. For these specs that is true of
the *defect* and false of the *fix site*: the broken code only exists inside the sync.

| tree | result |
| --- | --- |
| `origin/main` (`827ce46505`) | `floating-tab-rename` ×3, `orca-profiles` ×3 — **6 passed**. `tab-create-entry-file-paths` and `repro-7732` do not exist there at all. |
| `upstream/main` (`a63df91790`), unmodified | `floating-tab-rename:179`, `orca-profiles:7`, `orca-profiles:33`, `repro-7732:116`, `tab-create-entry-file-paths:9` — **5 failed**, 3 passed |

So the provenance verdict is confirmed by positive evidence, on upstream's own tree, not by
byte-identity: these five are upstream's, imported by the merge. And a branch off `origin/main`
cannot fix them — two of the four spec files are absent there, and the other two pass because
`main` does not yet carry the upstream code that breaks them. A fix authored there would be
unverifiable and probably wrong.

**Decided (coordinator, 2026-08-10): the five ship inside #80.** The rule's purpose is that #80
not become a junk drawer, and its real criterion is whether the fix needs the sync to exist — here
the *fix site* does not exist without it. The tie-breaker is that a sync landing with five red
specs puts main's scheduled E2E back in the red the same day ORCA-197 made it green, which is the
whole value of that ticket. A stacked branch was explicitly rejected: fragile merge ordering on a
244k-line PR, with a window where main is red. They go in #80 under their own heading, listed
apart from the merge resolutions. ORCA-203 stays open as the reference for the two-run evidence.

### Progress on the five

**`orca-profiles` ×2 — done (`745df186ab`).** Root cause: `OrcaProfileSwitcher` has **no render
site left anywhere**. Pre-sync, `sidebar/SidebarToolbar.tsx:70` rendered
`<OrcaProfileSwitcher placement="sidebar" />`; in `upstream/main` and in the merged tree nothing
imports it, while the component, its unit test and the E2E spec all survive. Verified live, not
inferred: with `ORCA_MULTI_PROFILE_UI=1` the store really does hold
`orcaProfilesMultiProfileUi: true` and the IPC returns `multiProfileUi: true` — the flag chain is
intact — and a DOM sweep finds **zero** buttons whose label or text matches `/profile|account/i`.
So the two cases asserted a surface upstream deleted; they cannot be repaired without re-adding
it. Removed, with the reason at the top of the file. The remaining case (`hides the account
trigger when cloud is unconfigured`) still asserts real behaviour and passes.

Worth flagging as a product question, not smuggling into a test fix: `profile-ui-scope.ts` still
documents the switcher as *"stays reachable behind this product-scope toggle"*, which upstream's
own removal made false. The fork had that UI before this sync. If we want it back, that is a
divergence to decide deliberately.

**`floating-tab-rename:179` — narrowed to the restart session, not fixed.** Fails at
`getByRole('menuitem').filter({ hasText: 'Rename' })` after right-clicking the tab; the other two
cases in the file pass.

Ruled out by static comparison: the spec file is **byte-identical across all three trees** and the
right-click block existed pre-sync, where it was green; `tab-bar/EditorFileTabContextMenu.tsx` and
`tab-bar/EditorFileTab.tsx` — which own that menu item and the `Rename file <name>` textbox the
spec then types into — are byte-identical across all three too, and `EditorFileTab.tsx` still
renders the context menu in every tree.

Ruled out by measurement, which is the useful part: **the context menu works in the merged tree.**
A probe that seeds the same floating Markdown tab through the same store calls, opens the panel
the same way and right-clicks the tab — but on the plain `orcaPage` fixture instead of
`createRestartSession` — gets the menu, with `Rename⌘R` first (which `hasText: 'Rename'` matches),
`menus: 1`, and the seeded file at `mode: 'edit'`, `readOnly: null`, `conflict: null`,
`diffSource: null`, so `canRename` holds.

So the failure belongs to the **restart-session launch path**, not to the menu, the tab or the
fork's resolutions. Next: what the restart session's app has that the plain fixture's does not —
it seeds no repo, so the likeliest candidate is an onboarding or empty-state overlay swallowing
the right-click. Dump `document.elementFromPoint` at the tab's centre right after the right-click
in the restart arm; an overlay identifies itself immediately.

**`tab-create-entry-file-paths:9` and `repro-7732:116` — untouched this session.** The first
times out clicking `button 'New tab'`; the second times out inside `openChecks` waiting for
`rightSidebarTab === 'checks'`.

Diagnosis started on the `upstream/main` worktree, which is the clean arm — the failures reproduce
there with no fork code in the picture. What is established for `orca-profiles` ×2:

- The switcher's trigger *is* labelled `Switch profile`, via `aria-label={triggerLabel}`
  (`OrcaProfileSwitcher.tsx:228`), but only when `multiProfileUi` is true; otherwise it is
  `Account`, and at `:118` the component returns `null` entirely when `!multiProfileUi` and cloud
  is unconfigured — which is the E2E state. So "element not found" means the flag is false.
- The flag is not being lost in the harness: `launchEnv` is spread into the launch env by
  `createElectronHomeIsolation`, and `ORCA_MULTI_PROFILE_UI` is not in `RESTRICTED_ENV_KEYS`.
  Exporting `ORCA_MULTI_PROFILE_UI=1` into the run's own environment as well **does not fix it** —
  still 2 failed, so this is not the env-does-not-reach-the-app trap.

Next step is the remaining link in that chain: main computes
`multiProfileUi: isMultiProfileUiEnabled()` at `src/main/ipc/orca-profiles.ts:176`, and the
renderer store reads `orcaProfilesMultiProfileUi: state.multiProfileUi` at
`store/slices/orca-profiles.ts:57`. Check whether the payload the store actually consumes is the
one that carries the field — if upstream added it to a different response shape, the flag never
lands in the renderer, which would be a genuine upstream defect and fits ORCA-203's thesis.

Note `github-created-issue-start-prefill` is **not** one of these five — it is still the explicit
non-classification above, and it *does* exist on all three trees.

### E2E on run `31441780221`, by spec

Shards 2, 4, 6 and 7. `issue-12656-terminal-link-tooltip` is **gone** from the red list since the
previous triage; `terminal-hidden-view-parking` is **new**. Compare by name, never by shard index.

ORCA-203 (six): `floating-tab-rename`, `tab-create-entry-file-paths`, `orca-profiles` ×2,
`repro-7732-gitlab-checks-job-details`, plus `github-created-issue-start-prefill` which is still
the explicit non-classification above. ORCA-204 (three):
`orchestration-legacy-worker-missing-terminal-recovery`,
`orchestration-legacy-worker-restart-recovery`, `orchestration-worker-terminal-visibility:109`.

**New: `terminal-hidden-view-parking.spec.ts:467` — "reproduces a static frame byte-for-byte
across 25 park/reveal cycles".** It fails with `terminal tab … did not park (pane manager still
mounted)` at `helpers/terminal-hidden-parking.ts:19`, a 20 s poll on
`window.__paneManagers?.get(tabId) !== undefined`.

This one is **not** inherited-by-construction and should not be filed as ORCA-203 without a
measurement. The spec and its helper are byte-identical to *both* upstream and the pre-sync tip,
and the case existed pre-sync — it was green in run `31355315929`, the last full-green pre-sync
run. What is *not* identical is the surface it exercises: the only non-`env.d.ts` owner of
`__paneManagers` is `terminal-pane/use-terminal-pane-lifecycle.ts`, which is **+15/−0 vs
`upstream/main`** and +86/−22 vs pre-sync — a fork divergence carried through the merge, sitting
exactly on the mount/unmount path the assertion polls.

The 15 fork lines thread two extra callbacks (`onPtyCodexResumeBlockedRef`,
`onAgentRateLimitDetected`) into the deps object rebuilt at `:861`. The obvious mechanism —
a fresh function identity each render keeping the pane manager from settling into unmount — was
checked and **does not hold**: `handleAgentRateLimitDetected` is `useCallback`-wrapped
(`TerminalPane.tsx:962`) over `[paneTransportsRef, worktreeId]`, both stable, and it is listed in
the consuming deps array at `:1853`. So the fork's added lines are not destabilising that object
by identity.

That leaves the failure unexplained, and it is the one red spec with no provenance verdict. Next
measurement, in order: read the trace for run `31441780221` shard 7 to see whether the tab ever
reaches the parked state at all or only misses the 20 s deadline, then run it locally against
`upstream/main` and the pre-sync tip on repeated interleaved rounds — a single run cannot separate
inherited from intermittent, which this file already learned twice.

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
