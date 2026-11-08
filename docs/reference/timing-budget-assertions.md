# Timing-budget assertions

A measured quantity compared against a fixed constant — `expect(latencyMs).toBeLessThan(2000)`.
Four of them went red in this repo across two nights, in three places that share no code, with no
product change behind any of them. This is what that class looks like, how to recognise one
before you write it, and how to make it robust without touching the ceiling.

The short version: **the number on the left is not the product's latency. It is the product's
latency plus the cost and the scheduling of whatever the test is doing to observe it.** Poll round
trips, timer callbacks, event-loop turns and poller ticks are all inside it.

## The measured cases

### 1. A ceiling that sat inside the instrument's dead zone

`tests/e2e/artificial-opencode-hidden-pressure-scenario.ts:235` — `restoreLatencyMs < 2000`. The
value was measured around an `expect.poll`, which runs Playwright's default backoff
(`intervals: [100, 250, 500, 1000]`, last value repeating —
`playwright-core/lib/utils/isomorphic/timeoutRunner.js:41`). That makes the reported number
**quantized**: it can only land on the cumulative sleeps **0 / 100 / 350 / 850 / 1850 / 2850 ms**,
plus accumulated callback cost. Nothing in between is reportable at all.

Twenty rounds on `main`, `--workers=1`:

```
173 175 189 192 195 198 198 223 224 225 225 226 238 241 256 390 1108 1159 2142 2322
                                                                            ^^^^ ^^^^ red
```

Zero values between 390 and 1108. Zero between 1159 and 2142. That is the poll grid, visible
directly in the data.

The restore's tail lands at **~1.1 s**, right on top of the 4th poll (850 ms plus accumulated
callback cost). Land just before it and the test reports ~1.1 s and passes. Miss it by a
millisecond and the next readable value is the 1850 ms step plus 292–472 ms of overhead — over
the 2 s ceiling no matter how fast the restore actually was. The CI failure that opened the
investigation read **2126.58 ms** = 1850 + 276.6, the same shape.

So the assertion was not testing a 2 s latency budget. It was testing *"did the restore land by
poll 4"*, with a **one-second dead zone** where no value can be reported.

The ceiling was right. The product was right — the real tail is 1073–1170 ms against 2000, a 41%
margin. The grid underneath was wrong. Fixed by passing explicit `intervals: [25, 50, 100]`;
the 2000 stayed.

### 2. A two-frame budget with no derivation

`tests/e2e/worktree-switch-responsiveness.spec.ts:142` — `timerDriftMs <= 32`, observed **47.1**.

The value comes from a real timer inside the renderer
(`timerDriftMs: firedAt - timerStart - timerDelayMs`, `spec.ts:112`), with no `expect.poll`
anywhere in the file. So this is *not* the quantization case: the value is continuous, and 47.1 ms
is a genuine main-thread drift on a loaded 4-core runner.

Rate: **1/56** complete E2E exposures between 2026-07-31 and 2026-08-13, plus a recurrence on
2026-08-14. At that rate a run of greens proves nothing, which is exactly why it kept surviving.

`MAX_CLICK_BACK_TIMER_DRIFT_MS = 32` carries **no comment explaining where 32 came from**. Two
frames at 60 Hz is the obvious guess, but nobody wrote it down, so nobody can say whether it is a
product budget or a number that happened to pass on the machine it was written on. That absence
is itself a signal.

### 3. A time budget disguised as a counter

`src/main/ipc/worktree-base-directory-poller.test.ts:262` —
`expect(pendingMarkerProbes).toBeLessThanOrEqual(pendingMarkerMaxTicks)` where
`pendingMarkerMaxTicks = WORKTREE_BASE_BACKSTOP_TICKS * 2` = 30. Observed **43**.

Nothing in that assertion mentions time, and it still belongs to this class: the probe count
accumulates while the test waits for an event. A slower environment means more ticks fire before
the awaited condition arrives, so the counter is a proxy for elapsed wall time with extra steps.

The same file's watch budget went red the night before for a different worker: **5124 ms against
a 5-second fs-watch budget**, under full-suite load. Same shape, different unit.

### 4. A grid that comes from the environment, not the instrument

`tests/e2e/artificial-opencode-hidden-pressure-scenario.ts:218`: `worstLatencyMs < 3000`,
observed **3065** (ORCA-1058). The poll is 5 ms and the observer's cost is a few ms, so this is
not case 1. The values still cluster: across 7 queue runs the worst key landed only near 15, 1030,
2050 or 3065 ms. That was at most once per window, at a random key, and the second-worst key was
always small.

A trace (Electron `contentTracing`) found the grid. In ORCA_E2E_HEADLESS the window is never
shown. viz keeps ticking every 16.7 ms, but the renderer's compositor gets a BeginFrame only every
~1016 ms. Its main thread then waits that long in `BeginMainFrame::commit` → `WaitForCommitCompletion`,
and a key that lands in that wait reads a whole second late (ORCA-760).

A/B, same probe: never shown, 3 of 25 windows stalled; shown, 0 of 25. The fix maps the window
for that spec (`ORCA_E2E_SHOW_INACTIVE=1`: shown inactive, not focusable, ignoring the mouse). The
ceiling did not change. **A cluster that the instrument's own step cannot explain is a step
somewhere else in the system — trace the measured path before you call it contention.**

### 5. A liveness wait judged by the clock instead of by the product's own steps

`src/main/native-chat/transcript-watch-liveness.test.ts` waited 2 s for a 20 ms reconciliation
poll to deliver an append (ORCA-1122). It went red once in CI at 2050 ms. The other six tests in
the same worker ran at local speed (32–463 ms), and 1300 local samples, idle and under a full
`src/main` run, all delivered in 8–34 ms within 2 drains. A 2.1 s stall injected into the worker
right after the append reproduced the exact CI error 5/5: when the worker resumes, the wait's timer
fires and throws before the poll's stat ever comes back.

The product step is countable: while unbound, every drain ends with a failed `fs.watch` bind. The
second drain counted after the append must have read it. So the wait now fails at 2 drains without
delivery, which a mutated poll trips in ~60 ms, and keeps a 15 s clock only as a hang detector.
**When the product exposes its own step, bound the wait in steps, not in milliseconds.**

## Two subclasses, and you must tell them apart first

|  | Quantized | Contended |
| --- | --- | --- |
| Values across runs | Cluster on a small set of repeated points | Spread continuously |
| Failure shape | A cliff — it jumps a whole step | A tail — it drifts just over |
| Typical margin at failure | Large (2142 vs 2000) | Small (47.1 vs 32, 5124 vs 5000) |
| What is actually wrong | The measurement's resolution | The budget, or the environment |
| Fix | Finer resolution; ceiling untouched | Assert on a distribution, or derive the budget from measured CI percentiles |

**The discriminator is cheap: run the case k times and look at whether the values repeat on a few
points or spread out.** Clustered ⇒ quantized. Spread ⇒ contended. Cases 1 and 4 are quantized;
cases 2 and 3 are contended.

Getting this backwards is expensive in both directions. Treating a quantized failure as
contention leads to raising the ceiling, which buys a night and destroys the signal permanently.
Treating a contended failure as quantization leads to a resolution fix that changes nothing.

## Recognising one from the code, without running anything

- **A comparison against a bare numeric constant** where the left side is named `…Ms`,
  `…LatencyMs`, `…DriftMs`, `…DurationMs`, `…Ticks`, `…Probes`, `…Count`. Counters qualify:
  case 3 has no `Ms` in it anywhere.
- **The clock opens before an `await` that waits.** `expect.poll`, `expect(...).toPass()`,
  `waitForEvents`, `waitFor`, a `setTimeout` tick loop. If the stopwatch starts before the wait
  and stops after it, the wait's own machinery is inside the number.
- **No resolution argument passed to the waiting primitive.** No `intervals`, no `pollInterval`.
  That is the specific tell for the quantized subclass — it silently inherits the default backoff
  and its 1000 ms terminal step.
- **The constant's comment already mentions CI, runners, load or overhead.** The author is telling
  you the number is environment-calibrated. In case 1 the comment also records that `main` had
  already relaxed the same budget from 1 s to 4 s.
- **The constant has no comment at all** (case 2). Nobody can defend a threshold whose derivation
  was never written down.

## Three questions before blaming the product

1. **What is the smallest step this measurement can report?** Read it off the waiting primitive.
   If the step is an appreciable fraction of the ceiling, the assertion measures the step, not the
   budget. In case 1 the step below the 2000 ceiling was 1850, with 292–472 ms of callback
   overhead on top — the 150 ms of margin was spent before the test started.
2. **Is the observer's cost inside the number?** If the clock opens before the wait, yes.
3. **Do the values cluster or spread?** k runs answer it.

All three are minutes of work. They cost a night each time they were not asked.

## Making them robust without loosening the ceiling

1. **Make the resolution finer than the margin.** Pass explicit `intervals` to the waiting
   primitive. Case 1's fix was `intervals: [25, 50, 100]` — quantization error capped at 100 ms
   against 830 ms of headroom, verified over 36 local rounds with zero reds, **ceiling unchanged
   at 2000**.
2. **Take the measurement out of the observer's path.** Stamp a timestamp where the event actually
   happens — in main or the renderer, at the instant the condition becomes true — and read it once,
   instead of polling until you notice. Then the number is the product's latency and nothing else.
   This is the durable version of (1).
3. **Assert on a distribution, not a single sample.** A budget crossed once in N runs is not a
   budget crossed regularly. There is precedent in the same file as case 1:
   `medianLatencyMs < 75` as the strict assertion, alongside `worstLatencyMs < 3000` kept
   deliberately loose and documented as a catastrophic-hang detector. Copy that pair.
4. **Record the number on green too.** All four instances were unreadable until someone re-ran
   and captured the value by hand. Case 1's scenario already pushes `restore=…ms` into
   `testInfo.annotations`, but the `list` reporter never prints them, so no historical CI values
   exist — which is why the distribution had to be rebuilt from 20 local rounds. If the value were
   in every run's log, the distribution would be free.
5. **Do not raise the ceiling.** Each raise buys one night and turns a false red into a permanent
   blind spot.

## Method note

None of these numbers mean anything without a positive control. Before any rate above was
believed, case 1's ceiling was forced to `1` and the harness re-run: it reported
`status=unexpected` **and still captured** `restore=195ms`. The measurement distinguishes green
from red and reports the value in both cases. A rate measured with an instrument that cannot show
you a red is not a rate — see [`agent-verification-traps.md`](./agent-verification-traps.md).
