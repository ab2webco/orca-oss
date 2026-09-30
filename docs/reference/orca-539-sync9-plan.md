# ORCA-539 — upstream sync #9: survey and merge plan

Survey only; nothing was merged. Every number was measured on 2026-09-30 against the SHAs below
and is reproducible from them. Delete this file when sync #9 lands.

## Pinned SHAs

| ref | SHA | note |
| --- | --- | --- |
| `origin/main` | `bf9bda0e767eaf75ae55e57c8a648a3e69700fa5` | measurement base |
| merge base | `8b04e060fa52cfd3f28145336e9be82255f53b74` | sync #8 chunk 5 tip, upstream 2026-08-15 |
| `upstream/main` | `3727100cc9dbcea6201f8a3e506676a3c4b53b18` | 3474 commits ahead of the base; moves ~150/day, re-pin the last chunk at execution |

Dry merge of the full gap: **701 conflicted paths** (sync #8: 174). By area: `src/renderer/src`
188, `src/main/runtime` 78, `src/main/persistence` 38, `src/main/ipc` 33, `src/main/daemon` 29.
By type: 1636 fix, 514 perf, 289 test, 276 feat.

Measure from a work branch, not `main`: the `never_write_to_main` hook refuses any command that
names `main`, including the read-only `git merge-tree --write-tree`.

## 1. Two structural findings that change the plan

### 1a. Sync #8 recorded ancestry it did not carry (122 files)

`origin/main` claims `8b04e060fa` as an ancestor, but 122 files that exist at that commit are
absent from our tree; upstream has modified 86 of them since. Git reads that as "the fork deleted
them", so each upstream change lands as a modify/delete conflict, or worse, is silently dropped.
The source is sync #8 chunk 5 (`7f9c28df3f`), which kept the fork's monoliths instead of taking
upstream's extractions:

| area | files missing | what upstream had at the base |
| --- | --- | --- |
| `src/main/persistence/` | 43 | `persistence.ts` is an 8-line barrel upstream; ours is an 8453-line monolith |
| `src/main/runtime/` | 21 | orchestration mailbox modules (`mailbox-*.ts`), `worktree-create-args.ts`, `runtime-graph-reload-lifecycle.ts` and their tests |
| `src/main/claude-accounts/` | 16 | split account-service and runtime-auth test suites plus harnesses |
| `src/renderer/src` | 13 | |
| `src/main/providers/` | 7 | shell-ready wrapper generation and zsh ZDOTDIR tests |

This is the same failure as ORCA-345 (`#13717` half-landed) and a sibling of ORCA-346. It also
means we silently lost upstream's test coverage for those areas.

**Decision: chunk 0 repairs it before any forward merge.** Restore upstream's layout at the base for
these 122 paths and re-apply the fork's deltas onto the modules. That removes a whole class of
conflicts from every later chunk. The automation survey marks the persistence layout as the
highest single risk: every forward chunk conflicts on `persistence.ts` otherwise.

### 1b. Upstream split `orca-runtime.ts` inside the gap (#17605)

ORCA-346 was written as "adopt upstream's decomposition or keep paying". In fact upstream was a
38,618-line monolith at the base too; it split the file on 2026-08-31 in one commit, `a5796ec8eb`
(#17605, 44,452 → 58 lines, one class per method in a linear inheritance chain). **The split
arrives with the merge; we do not have to design one.** What we must do is carry the fork's deltas
across it: `+3278/−695` lines from ~75 fork commits.

Clusters, by where they land at `a5796ec8eb`. Type: (a) edit to a method that still exists
→ re-apply in its module; (b) fork-only method → new fork-owned module; (c) upstream moved it into
a controller → redesign.

| # | cluster | ~lines | type |
| --- | --- | --- | --- |
| 1 | Plane CLI/provider (all `plane*` methods) | 420 | (b) → `runtime-plane-commands.ts`, installed like `runtime-jira-commands.ts` |
| 2 | Claude/Codex accounts, local and remote host | 840 | mixed; `addClaudeAccountFromConfigDir` now in `RuntimeAccountController` (c) |
| 3 | terminal writability, state, read, snapshots | 800 | mixed; `markGraphUnavailable`/`markRendererReloading` (c) |
| 4 | orchestration dispatch/delivery | 370 | (a) |
| 5 | CLI split, launch with account flags | 165 | (a)+(b) |
| 6 | automations/plugins (`createAutomation`/`updateAutomation`) | 130 | (a) → `orca-runtime-fence-automation-owner.ts` |
| 7 | dashboard popout, tail colour | 90 | (b), partly (a) |
| 8 | speech CLI | 35 | (c) → `runtime-service-command-surface.ts` |
| 9 | pairing, brand, scattered | 50 | (a) |
| 10 | imports and types | 330 | (c) → `runtime-terminal-contracts.ts`, `orca-runtime-core.ts` |

Order: 1 → 10 → 4, 6, 5, 9 → 3 → 2, 8. Estimate 4–6 engineer-days plus ~1.5 for tests: the fork's
`orca-runtime.test.ts` (50,290 lines, `+1264/−911`) must be redistributed into upstream's 98
`src/main/runtime/orca-runtime-tests/*.spec.ts`. New fork modules must be fully typed: upstream adds
a `@ts-nocheck` ratchet (`config/scripts/check-ts-nocheck-ratchet.mjs`).

Not verified: that type-(a) method bodies at `a5796ec8eb` are unchanged from the base; four methods
(`resolveLineageCandidateForTaskId`, `isPtyRunningAgent`, `getHookAgentRowForPane`,
`waitForStartupDraftReady`) exist at the base and have no definition at `a5796ec8eb`.

## 2. Chunks

Sync #8's rule: cut on points upstream itself released. Upstream tags releases on release branches,
so each cut is `git merge-base <tag> upstream/main`. `#17605` gets a chunk of its own so its
review is only the runtime port.

| chunk | cut | upstream date | commits (cum.) | conflicts (cum.) | new paths |
| --- | --- | --- | --- | --- | --- |
| 0 | repair §1a | — | — | — | 122 files restored |
| 1 | v1.4.188 → `e41074cb1f` | 08-20 | 242 | 178 | 178 |
| 2 | v1.4.192 → `ee1e002d00` | 08-28 | 652 | 353 | 175 |
| 3 | `a5796ec8eb` (#17605 split) | 08-31 | 963 | 420 | 67 |
| 4 | v1.4.197 → `0f22e1e905` | 09-03 | 1273 | 468 | 48 |
| 5 | v1.4.200 → `7dd183d82d` | 09-09 | 1875 | 553 | 92 |
| 6 | v1.4.205 → `9ab0a18e82` | 09-15 | 2250 | 572 | 19 |
| 7 | v1.4.214 → `7468e9cccb` | 09-26 | 3089 | 644 | 75 |
| 8 | v1.4.218+ → re-pin at execution | 09-29 | 3355+ | 661+ | 17+ |

Counts were measured before chunk 0, so chunk 0 should lower every row; re-measure after it.

What each chunk brings that the changelog advertises:

- **1**: three-column automation editor (#14803), filter by agent (#15224).
- **2**: automation owner/destination model (#16532, the big one: list scope, run writer, owner and
  SSH migrations), all destination hosts (#16665), host on details (#16823), table layout,
  arrow navigation; cross-host automations (1.4.192).
- **3**: the runtime split only.
- **4**: automation runs dashboard (#18226), lost vs failed (#17967), automation UX (#17626),
  agents activity view, diff whitespace toggle.
- **5**: inline diff cards, GitHub Projects roadmap, unified Create menu, session rewind, subagent
  rows; automation column sorting (#18885).
- **6**: Native Chat drag-and-drop, Fast mode, AI Vault search, 2 GB uploads.
- **7**: scheduler cron fixes (#20152, #20202, #20819), virtualized run history (#20916), cross-computer
  session search, OpenCode 2, Quick Open, Antigravity, Muse Code, preview tabs.
- **8**: Jupyter notebooks, composer context meter, ZCode/Qoder/DeepSeek, adaptive status bar, Reset
  Terminal (#23602, cross-check ORCA-537), mid-turn message queue, unencrypted-credential warning,
  SQLite profile store (#22612) and JSON writes retired (#23202).

Riskiest paths per chunk (fork diff × upstream churn): chunk 1 — the five i18n locales and
`orca-runtime.ts`; chunk 2 — `src/cli/index.test.ts`, `src/main/claude-accounts/service.ts`,
`TerminalPane.tsx`; later — `mobile/app/h/[hostId]/tasks.tsx`, `src/renderer/src/store/slices/worktrees.ts`
(6305-line fork diff), `.github/workflows/release-cut.yml`.

`src/renderer/src/components/TaskPage.tsx` was deleted upstream while the fork has 17 commits and a
1593-line diff on it: the fork's tasks page must be relocated, not merged.

## 3. What we own inside the conflicts

135 of the 701 paths have no fork commit at all — they conflict only because of earlier sync
resolutions. 38 of those have a ≤20-line fork diff and can take upstream after a glance; 31 have
>200 lines of sync residue and need a real three-way check.

Protect these, by area (conflicted paths; tickets from commit subjects):

| area | paths | tickets |
| --- | --- | --- |
| accounts on remote hosts | 49 | ORCA-165, 175, 189, 350, 482, 484, 489, 496, 525 |
| pairing/mobile | 42 | ORCA-305, 330, 349, 356–361, 412–419, 460–470, 500 |
| orchestration | 61 | ORCA-191, 204, 207, 253, 299, 370 |
| terminal reply order | 10 | ORCA-532, 536 — `terminal-query-reply.ts`, `pty-startup-*`, `daemon/session.ts`, `local-pty-provider.ts`, `relay/pty-handler.ts` |
| automations | 20 | ORCA-340, 406, 443, 514 — see §4 |
| plugins | ~14 | ORCA-274, 315, 514, 519 |
| Plane | via `src/cli/*`, `resources/skills/*.json`, mobile tasks | ~93 commits |
| branding (ORCA-392) | 105 by ticket | the rename spans `src/main`; don't resolve it path-by-path |
| CI guards | 33 | `release-cut.yml` above all |

## 4. Automations

What the user asked for arrives in chunks 1, 2, 4, 5 and 7. The fork's automation work (command-only
automations, plugin-owned automations and reconciliation, target a user-opened pane) collides as
follows:

- **Types** (`src/shared/automations-types.ts`): union. The fork makes `agentId` nullable and
  `AutomationCreateInput` a discriminated union; upstream adds `creationKey`,
  `executionTargetGeneration`, `occurrenceCount`. `agentId: null` ripples into ~17 upstream
  readers — run typecheck first.
- **Service and persistence**: take upstream, re-apply the command-only branch into the new tick
  and dispatch path, and port the fork's four create/update guards into upstream's
  `automation-definition-operations.ts` (they live in our `persistence.ts` monolith today —
  chunk 0 makes that tractable).
- **Renderer**: upstream decomposed `AutomationsPage.tsx` (−2078 lines) and
  `useAutomationDispatchEvents.ts`. Do not merge textually; rebuild the pane-target field and
  command-only controls in the new layout.
- **Storage**: no migration-number collision. Runs are stored as opaque JSON, so fork fields survive
  storage and are lost only where upstream's normalizers rebuild records. Upstream's owner and SSH
  migrations (chunk 2) rewrite every automation and need a `agentId: null` test.
- **Plugin rows**: `plugin-automation-reconciliation.ts` creates automations with no owner or
  destination fence. Verify they get `schedulerOwner` and `executionTarget*`, and that
  `listAutomationsForScope` keeps `pluginOrigin`.

ORCA-548 runs, after chunk 7: upstream's `automation-runs-dashboard.spec.ts`,
`automation-prompt-disclosure.spec.ts`, `automation-hidden-terminal-first-mount.spec.ts` and the owner/
destination fencing suites; ours: `plugin-automation-consent.spec.ts`, `service-command-only.test.ts`,
`plugin-automation-reconciliation.test.ts`, `AutomationTargetPaneField.test.tsx`,
`orca-runtime-automations.test.ts`.

## 5. Already hand-ported upstream PRs

| upstream | fork | chunk | action |
| --- | --- | --- | --- |
| #19365, #18748, #19521 | `74fa4e0d4b` | 5 | take theirs (identical) |
| #19523 | `74fa4e0d4b` | 5 | merge both; check the fork's `dead` handling |
| #17759 | `87c40cf387` | 4 | take theirs |
| #17731 | `87c40cf387` | 5 | take theirs |
| #19214, #19400 | `87c40cf387` (ported into the runtime monolith) | 5 | take theirs; make sure no fork copy survives in the monolith port |
| #18132, #18706 | `e4c81db4a6` (partial) | 4 | merge both; will re-conflict through chunk 8 |
| #15559 + fork fix ORCA-532 | `52a7da5f4c` (#425) | 1 | merge both — biggest re-conflict: `c92f394cde` (#15578) deleted the scheduler the fork's fix sits on |
| #19628, #19593 | `3c83cc0a29`, `a37da36f42` | not upstream yet | keep ours |

`a37da36f42` also carries five commits from unmerged upstream branches; keep ours and expect
duplicate hunks if they land.

## 6. CI workflows

Keep retaining `.github/workflows` in every chunk (`git checkout origin/main -- .github/workflows`).
Upstream has 252 workflow commits in the gap; 76 files differ. Keep fork-only `lab-release.yml`,
`pages.yml`, `track-community-prs.yaml`, `upstream-sync.yml` and the ORCA-266 E2E JSON-report step.

Adopt on purpose, in a separate PR after chunk 8:

- security: `release-policy.yml` and `release-ref-validation.yml` (#18980), signed Windows release
  binaries (#23680), release token permissions (#15675), PR LoC scripts from the default branch
  (#15016);
- cost: free ARM runners (#23576, #23594, #23685), shallow PR checkouts (#23562), pnpm caches (#23568,
  #23578), shard planning before static analysis (#23743, #23776), fewer concurrency slots (#23810).

Hidden coupling: `config/scripts/pr-workflow-parallelism.test.mjs`, `pr-e2e-gate-contract.test.mjs`
and `git-pull-request-diff-base.mjs` assert upstream's `pr.yml` shape. Taking the scripts while
keeping our `pr.yml` turns those contract tests red; move them together or keep both fork-side.

Skip the ~26 `cloud-*` relay workflows.

## 7. Rules carried from sync #8

- Merge, never rebase or squash; each chunk is its own PR, green before the next starts.
- Classify hunks, not paths: an upstream file split resolved as "take theirs" builds and silently
  drops fork behaviour. Check fork-authored lines on every such hunk.
- Re-verify `src/main/daemon/session.ts` and `src/relay/pty-handler.ts` (ORCA-532 fix) after every
  chunk that touches them.
- Red triage: class first (`docs/reference/ci-failure-classification.md`), base rate, then bisect
  inside the chunk.
- Record partial adoptions in the chunk's ticket so the next sync does not re-drop them — §1a is
  what happens when this is skipped.
