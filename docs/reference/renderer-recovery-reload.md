# When the renderer reloads itself

`page.evaluate: Execution context was destroyed, most likely because of a navigation.` is the
dominant E2E failure mode in this repo. It is not always a test artifact: Orca reloads its own
window when the renderer process dies, and that path ships to users.

Read this before calling such a failure flaky, and before raising a diff-size threshold.

## The recovery path, in production

| step | file:line | what it does |
| --- | --- | --- |
| listener | `src/main/window/createMainWindow.ts:635` | `webContents.on('render-process-gone')` → `scheduleRendererRecovery(details)` |
| filter | `:597-607` | returns early unless `isCrashReportReason(details.reason)` |
| reload | `:609-633` | after a 250 ms timer, calls `loadMainWindow(mainWindow)` — a real navigation |
| breaker | `:619-627` | 3 recoveries in 60 s exhausts it; the host then surfaces a Reload/Quit prompt |
| reasons | `src/shared/crash-reporting.ts:123-132` | `abnormal-exit`, `crashed`, `integrity-failure`, `killed`, `launch-failed`, `memory-eviction`, `oom` |

There is **no `isPackaged`, env, or E2E gate** on any of it. A user whose renderer runs out of
memory sees the window blank and reload itself, and on the third crash inside a minute gets the
recovery prompt.

`oom` and `memory-eviction` being in that list is what makes this a load-triggered path rather
than a crash-only one: enough content in the renderer reaches it without anything being broken.

## Why memory is the trigger that matters

`src/main/startup/renderer-heap-headroom.ts:6-15` states it outright — V8 OOM in the renderer is
*"the dominant renderer crash in the crash channel."* That is the crash channel from real
installs, not CI.

Chromium sizes the renderer's V8 old-space heap at roughly RAM/4, so an 8 GB machine caps near
~2.2 GB. Orca raises it toward the 4 GB pointer-compression cage (`RENDERER_HEAP_CAP_MB = 4096`)
but **only on machines reporting ≥ 7.5 GiB** (`RENDERER_HEAP_MIN_TOTAL_GIB`). Below that, the
Chromium default stands, deliberately: raising it there would trade a clean OOM for OS
memory-pressure kills. So the machines most likely to hit this are the ones that get no headroom.

## The gap the size guard leaves open

`getLargeDiffRenderLimit` (`src/shared/large-diff-render-limit.ts`) falls back to a summary only
above **120 000 lines per side** or **6 000 000 combined characters**. Measured against the
`large-diff-freeze-repro` fixture — 60 000 generated TypeScript lines:

```
chars: 1920000 | limited: false
```

Under both ceilings, so the full diff goes to Monaco. There is a band of diffs — large enough to
exhaust a 2.2 GB heap, small enough to clear both thresholds — where the guard does not engage.
The E2E spec lives in that band, which is why it is the spec that surfaces this.

**A red timing or freeze assertion on a large diff is therefore not automatically a mis-tuned
budget.** Check for a renderer crash first.

## Telling the two cases apart

Both produce the same Playwright message, so the message alone decides nothing.

| evidence | reading |
| --- | --- |
| `Target crashed` in the error text | the renderer process died — product path, not test noise |
| `reason` written to the E2E user-data dir as `renderer_recovery_reload` | the recovery path ran; the reload was Orca's, not Playwright's |
| `render-process-gone` / `oom` / `Renderer process` in the job log | same |
| only `most likely because of a navigation`, with no crash trace | undetermined — a lazy chunk load can also destroy the context |

The last row is the honest default. Do not upgrade it to "product bug" or downgrade it to
"flaky" without one of the rows above.

## Reading the automated evidence (ORCA-280)

The second row above used to require a human to notice `Target crashed` in a job log by hand —
nobody did, which is why every occurrence of this failure was undiagnosable after the fact. As of
ORCA-280, every E2E test reports this automatically. On any non-passing test, the `electronApp`
fixture (`tests/e2e/helpers/orca-app.ts`) reads `<userData>/crash-reports.json` — written
unconditionally by `CrashReportStore`, unlike the NDJSON trace sink, which `initObservability()`
disables in CI — before deleting the userData dir, via
`tests/e2e/helpers/renderer-recovery-evidence.ts`. It prints one line to the job log:

```
[renderer-recovery-evidence] <spec> > <test> :: <detail>
```

and attaches the full `RendererRecoveryEvidence` object as `renderer-recovery-evidence.json`.
Playwright inlines small attachments as base64 directly in `tests/test-results/e2e-report.json`,
which CI already uploads on every run (`always()`), so no extra artifact wiring was needed.

`detail` lands on one of four outcomes:

| outcome | meaning |
| --- | --- |
| `did not fire` | no renderer-source crash record exists — no crash evidence at all |
| `LIKELY` | a renderer crash record exists with a recoverable `reason`; the reload almost certainly ran but nothing on disk directly proves it — **this is the normal shape for a single-crash test failure** |
| `CONFIRMED` | a `renderer_recovery_reload` breadcrumb was found — direct proof, but this breadcrumb is only carried inside a *later* crash record in the same run, so it requires a second crash to appear at all |
| `did NOT run` (crash recorded) | the recorded reason is `integrity-failure`, the one reason `shouldRecoverRendererAfterProcessGone` always refuses |

Two things that are not obvious from the source and were confirmed empirically (ORCA-280, via
`window.webContents.forcefullyCrashRenderer()` in the `@ondemand`-tagged
`tests/e2e/renderer-recovery-evidence-repro.spec.ts`):

- `forcefullyCrashRenderer()` reports `reason: 'killed'` on macOS, not `'crashed'` (not yet checked
  on Linux CI — it may differ there). A persisted `'killed'` record still counts as LIKELY:
  `shouldRecordProcessGoneCrash` only ever drops a `'killed'` event before it reaches disk when
  `expectedTeardown` was `'app-shutdown'` or `'renderer-reload'`, so any `'killed'` record that *is*
  on disk already implies the one `expectedTeardown` value (`'none'`) that
  `shouldRecoverRendererAfterProcessGone` returns true for. LIKELY is still an inference, not a
  guarantee, on top of that: `scheduleRendererRecovery` (createMainWindow.ts) can still skip the
  reload after this check passes — `windowClosing`, `getIsQuitting()`, or a tripped circuit breaker
  (3 recoveries per 60s) all bail out — so a crash record from, say, a 4th crash in one run can be
  LIKELY-classified but not actually have reloaded.
- `TestInfo.titlePath` is a property (`Array<string>`), not a method — an early version of this
  hook called it as one and only failed silently inside the hook's own try/catch, never in the
  test. If evidence is missing for a real failure, check the job log for
  `[renderer-recovery-evidence] failed to collect evidence:` first.

Coverage: specs that launch their own `ElectronApplication` outside the `electronApp` fixture
(`orca-restart.ts`'s `createRestartSession`, `paired-electron-client.ts`'s
`launchPairedElectronClient`) originally bypassed this hook entirely — a real assertion failure in
`paired-remote-terminal-host-restart-background-sync.spec.ts` on PR #160 produced no evidence line
at all, which is silence indistinguishable from "no crash".

The first fix for this used `reportRendererRecoveryEvidence(..., { force: true })` from
`dispose()`, on the theory that `dispose()` runs inside the *test's own* `finally` block — not
Playwright fixture teardown — so `testInfo.status` is never finalized there for a normal
(non-soft) failed `expect()`/`expect.poll()` (it only `throw`s; status stays `'passed'` until that
propagates all the way out of the test function). That diagnosis was correct, but `force: true`
was the wrong fix: it reports on *every* test using these two helpers, pass or fail — verified on
PR #160's own CI, where three passing specs each printed a `did not fire` line. A signal that
fires on everything carries exactly as little information as one that fires on nothing.

The actual fix separates *reading* the evidence (which must happen in `dispose()`, before it
deletes `userDataDir`) from *deciding whether to report it* (which needs the status that is only
reliable once Playwright has finalized it, i.e. in fixture teardown):

- `queueRendererRecoveryEvidence(testInfo, evidence)` — called from `dispose()`, reads the
  evidence eagerly and appends it to a `WeakMap<TestInfo, evidence[]>` keyed by the test's own
  `TestInfo` object (chosen because these helpers are called with only `testInfo`, not a fixture
  object — adding a callback parameter would mean touching 30+ existing call sites).
- `flushQueuedRendererRecoveryEvidence(testInfo)` — called from a new `{ auto: true }` fixture in
  `orca-app.ts` (`flushRendererRecoveryEvidenceQueue`), so it runs for *every* test regardless of
  whether that test requests `electronApp` at all. Reports the queued evidence only if
  `testInfo.status` is not `'passed'`/`'skipped'`. Auto fixtures still tear down after the test
  function's promise has settled like any other fixture, and queuing always finishes inside the
  test's own code (strictly before any fixture teardown starts), so by the time this flush runs,
  the queue is already complete and the status is already final — regardless of teardown ordering
  relative to other fixtures.

Verified both directions with a throwaway spec run against a real built Electron app: a passing
test using `createRestartSession` produced zero `[renderer-recovery-evidence]` lines; a failing one
produced exactly one.

## The first classified occurrence (ORCA-280)

PR #160's own CI run put this to use immediately. Three of the four failing shards were genuine,
unrelated bugs (left alone — see their own issues); the other two were this failure class, and the
hook gave a direct answer for both:

```
[renderer-recovery-evidence] combined-diff-invalidation-freeze-repro.spec.ts > ... :: renderer_recovery_reload: did not fire — crash-reports.json was never written to the E2E user-data dir, so Orca never recorded a renderer process-gone event.
```

Same verdict for `large-diff-freeze-repro.spec.ts`. Both stacks pointed at the identical shape: an
`expect.poll(() => orcaPage.evaluate(...))` inside a locally-defined `addAndActivateRepo` helper,
polling `fetchWorktrees` right after adding an isolated repo. No renderer crash — row 4, the
"genuinely transient navigation" case this doc always allowed for. Per "Why the test dies instead of
retrying" above, the fix was to make that one `page.evaluate` swallow only
`isExecutionContextDestroyedError` (`tests/e2e/helpers/execution-context-destroyed.ts`) and let the
poll retry, while any other thrown error still fails the test immediately — the assertions the specs
exist to make (freeze budgets, loaded-row counts) were not touched.

## Why one failure looks like four small ones

Per spec this mode reads as 4/37, 2/37, 2/11 and 1/33 — four minor rows nobody prioritises.
Aggregated it is 9 occurrences across 4 specs, 8 of them in the last 14 scheduled `main` runs:
the largest single contributor to E2E being red 81% of the time. A per-spec view hides it by
construction, which is the argument for harvesting per-spec rates and then summing by message.

## Why the test dies instead of retrying

Independent of the cause: in `playwright/lib/matchers/expect.js:275` the
`await poll.generator()` sits **outside** the surrounding `try/catch`, so an exception thrown by
the generator propagates instead of being retried. `expect.poll` absorbs a failed assertion, not
a thrown one — wrapping a `page.evaluate` in `expect.poll` does not make it crash-tolerant.

## Do not

- Raise `MAX_RENDERED_DIFF_LINES_PER_SIDE` or `MAX_RENDERED_DIFF_COMBINED_CHARACTERS` to make a
  spec pass. That widens the band where a user's renderer dies.
- Raise `ORCA_RENDERER_HEAP_MB` above 4096. The pointer-compression cage caps it silently, so the
  change reads as applied and does nothing.
- Treat the E2E window as representative of a user's: it never becomes visible, so anything
  gated on visibility or `requestAnimationFrame` behaves differently there (two earlier
  diagnoses were wrong for this reason).
