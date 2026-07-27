# Agent Verification Traps

Every trap below was hit for real in this repo, by an agent that believed it had verified its
work. Each one shares a shape: **the check ran, it came back clean, and it was measuring the
wrong thing.** A green result is only evidence if you know what would have made it red.

Read this before reporting work as verified, and before acting on a report someone else
verified.

## 1. Run tests with the repo's Vitest config

There is **no `vitest.config.*` at the repo root**. A bare `npx vitest run <paths>` therefore
runs with Vitest's defaults and none of this repo's setup:

- `resolve.alias` for `@/` and `@renderer` → renderer files fail at import
- `define: ORCA_FEATURE_WALL_ENABLED` → modules reading it throw at import
- `hookTimeout: 60s` / `testTimeout: 30s` → slow integration cases fail on the 5s defaults

```sh
npx vitest run --config config/vitest.config.ts <paths>   # correct
npm test                                                   # also correct
```

**Why it fools you:** main-process tests using only relative imports pass either way, so the
command looks like it worked. The renderer failures read as real regressions — they arrive as
`FAIL <file> [ <file> ]`, the collection-error form, not as assertion failures.

**Tell:** a suite you did not touch "breaks", and the failures are collection errors rather
than assertions. Re-run with the config before believing it.

## 2. Judge a delegated report by its artifact, not its summary

A worker's `worker_done` body is a summary. When its payload carries a `reportPath`, that file
is the record — the summary compresses away exactly the specificity you need to check a claim.

**What happened:** a worker's summary said "the early return that kills `repair`". Its report
said the precise thing: `findTrustedCodexSessionResume` returns `null` for every non-empty
stale `transcriptPath` *before* the block that constructs `repair`. The summary was checked,
judged wrong, and publicly contradicted. The report was right.

**Rule:** read `reportPath` before accepting, rejecting, or acting on a worker's conclusion.
Never contradict a worker from its summary alone.

## 3. Verify the claim that was made, including its callers

A value can be constructed and still be unreachable. Checking the function that builds it
proves nothing if an earlier return in its caller means that branch never runs.

**What happened:** the end of a rescan function does construct `repair`, which "confirmed" the
field was alive. But the same function returns early whenever a recorded path exists, and
`repair` is only attached when a recorded path exists — mutually exclusive. The field was dead
code, and a `grep` for consumers found one that also could never fire.

**Rule:** for a reachability claim, trace entry conditions, not construction sites. A consumer
existing in the source is not evidence that it runs; check what its input requires.

## 4. A new test proves a fix only if it fails without it

A test written alongside a change usually passes on both sides of that change. Run it against
unmodified code first; if it passes there, it is a guard, not a regression test, and should be
described as one.

With the fix still uncommitted in the working tree:

```sh
git stash push -- <changed source files>                                # keep the test staged
npx vitest run --config config/vitest.config.ts <test>                  # must FAIL
git stash pop
npx vitest run --config config/vitest.config.ts <test>                  # must PASS
```

If the fix is already committed, revert the source file to the base commit instead — a bare
`git stash` on a clean tree stashes nothing and the run gives a false green.

This is Q1 of [`upstream-pr-adoption.md`](./upstream-pr-adoption.md), and it applies to work
written here, not only to adopted PRs.

## 5. Ambient environment leaks into test assertions

CLI tests read `process.env` directly, and agent panes export Orca's own variables. A test
asserting an exact payload will pass or fail depending on who runs it.

`ORCA_TERMINAL_HANDLE`, `ORCA_PANE_KEY`, and `ORCA_AGENT_LAUNCH_TOKEN` are all exported into
managed agent terminals. Any test touching a code path that reads one must delete it in
`beforeEach` and restore the original in `afterEach`.

**Tell:** an assertion diff showing a real-looking UUID or handle you never wrote in the test.

## 6. New tracked docs need a `.gitignore` allow-list entry

`docs/**` is ignored with an explicit allow-list. A new file under `docs/reference/` is
invisible to `git add` unless it is allow-listed — `git status` simply will not show it, so the
work looks committed and is not.

Add `!docs/reference/<file>.md` to `.gitignore` alongside the existing entries, and link the
doc from `AGENTS.md` or `README.md` so it is discoverable.

## 7. Piping a long-running process through `head` kills it

`npm run dev | head -60` gives `head` its 60 lines, then `head` exits, then the dev server dies
of `SIGPIPE` — reported as a clean `exit code 0`, which reads as success.

Redirect to a file and read the file:

```sh
npm run dev > /tmp/dev.log 2>&1 &
```

The same applies to any `--wait`, `tail -f`, or watch command you filter through a
head-terminated pipeline.

## 8. "Flaky" is a hypothesis, not a verdict

A test that fails in the full suite and passes in isolation has told you *where* the failure lives
(shared load, ordering, timers), not that it is harmless. Dismissing it is how a real
concurrency bug hides for months behind the word "flaky".

You own every failure in your run, including ones you did not cause. If it is out of scope to fix,
say so plainly and leave it tracked with the evidence you already gathered — the full-suite
failure, the isolated pass, and the run conditions. Never let it disappear into a sentence.

The same rule covers anything handed to you: a delegated worker's report, an upstream PR, another
agent's "verified". Review it before building on it *or* contradicting it.

## The common rule

Before reporting something verified, answer one question: **what would this check have shown if
the thing were broken?** If the answer is "the same output", the check is decoration. Replace it
or say plainly that the claim is unverified.
