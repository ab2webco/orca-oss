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
