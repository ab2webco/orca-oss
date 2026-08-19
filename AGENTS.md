# Design System

All UI work — layout, color, typography, spacing, component selection, UX behavior — must follow [`docs/STYLEGUIDE.md`](./docs/STYLEGUIDE.md). Use the tokens defined in `src/renderer/src/assets/main.css` (the canonical source) and the shadcn primitives in `src/renderer/src/components/ui/`. Don't invent new color values, font sizes, or shadow tiers when a documented one already covers the role. When STYLEGUIDE.md is silent, follow the resolution order in its final section.

# Style
## Concise/Brief Non-obviosu comments ONLY
  * DO NOT: be verbose, explain the obvious, walk through the code ("WHY not HOW")
  * BE CONCISE. 1 LINE if possible

## Lint Rules: Do Not Disable Max Lines

NEVER add a `max-lines` disable (`eslint-disable max-lines`, `oxlint-disable max-lines`, or line-specific variants), and never add a per-file `max-lines` bump in `mobile/.oxlintrc.json`.

## File and Module Naming

Never use vague names like `helpers`, `utils`, `common`, `misc`, or `shared-stuff` for files, folders, or modules. They carry zero info and tend to become dumping grounds. Name files after what they _actually_ contain — prefer the concrete domain concept (e.g. `tab-group-state.ts`, `terminal-orphan-cleanup.ts`) over the generic role (`tabs-helpers.ts`, `terminal-utils.ts`). If you find yourself reaching for `helpers`, the file probably has more than one responsibility and should be split, or there's a better name hiding in the code that describes what the functions operate on.

## Type Declarations: Prefer `.ts` Over `.d.ts`

# Proceso de trabajo

El board de Plane (proyecto Orca Lab) es la fuente de las tareas. Si el trabajo no está en el board,
creá el ticket antes de empezar. El ciclo completo, las guardas del harness en `.claude/` y la falla
real que originó cada una están en [`docs/reference/working-process.md`](./docs/reference/working-process.md).

Dos que valen antes de reportar algo como verde: el exit code de `npm test` miente — leé la línea
`Tests …`; y un test que pasa igual contra el código viejo no prueba nada.

# Verification

**Everything in your run is yours.** A failure you did not cause is still a failure you own: never dismiss one as flaky, pre-existing, or someone else's and move on. Explaining a failure is not the same as closing it — if you cannot fix it in scope, say so plainly and leave it tracked with the evidence you gathered. The same applies to anything handed to you: a delegated worker's report, an upstream PR, another agent's "verified". Review it before you build on it or contradict it.

Before reporting work as verified, ask what the check would have shown if the thing were broken. If the answer is "the same output", the check proves nothing. Every trap in [`docs/reference/agent-verification-traps.md`](./docs/reference/agent-verification-traps.md) is one an agent here already hit while believing it had verified — read it before claiming green, and before acting on someone else's green.

Two that bite most often:

- **Tests need the repo config.** There is no root `vitest.config.*`, so a bare `npx vitest run` resolves no `@/` alias and no `ORCA_FEATURE_WALL_ENABLED`. Renderer suites then fail at import and read as regressions. Use `npm test` or `npx vitest run --config config/vitest.config.ts <paths>`.
- **A delegated report's summary is not its evidence.** When a `worker_done` payload carries a `reportPath`, read that file before accepting or contradicting the worker.
- **A red check is not a failed test.** A timeout, a failed setup step, and a red assertion all print `fail`. The run summary page names the class per job — see [`docs/reference/ci-failure-classification.md`](./docs/reference/ci-failure-classification.md) — before you name a spec.
- **`Execution context was destroyed` can be a product bug, not test noise.** Orca reloads its own window when the renderer dies, and `oom` is in the set of reasons that trigger it — so a large-diff or heavy-load spec can be reporting a crash a user would also see. [`docs/reference/renderer-recovery-reload.md`](./docs/reference/renderer-recovery-reload.md) has the chain and how to tell the two cases apart; check it before calling one flaky or raising a diff-size threshold.
- **A red timing budget is usually not a slow product.** `expect(latencyMs).toBeLessThan(N)` measures the product plus the cost of whatever the test does to observe it, and a poll-based measurement can only report values on its backoff grid. Four of these went red here in two nights with no product change behind any of them. Before blaming the code, run the three checks in [`docs/reference/timing-budget-assertions.md`](./docs/reference/timing-budget-assertions.md) — and read it before writing a new threshold.

# Considerations
## Worktree Safety

Always use the primary working directory (the worktree) for all file reads and edits. Never follow absolute paths from subagent results that point to the main repo.

## Cross-Platform Support

Orca targets macOS, Linux, and Windows. Keep all platform-dependent behavior behind runtime checks:

- **Keyboard shortcuts**: Never hardcode `e.metaKey`. Use a platform check (`navigator.userAgent.includes('Mac')`) to pick `metaKey` on Mac and `ctrlKey` on Linux/Windows. Electron menu accelerators should use `CmdOrCtrl`.
- **Shortcut labels in UI**: Display `⌘` / `⇧` on Mac and `Ctrl+` / `Shift+` on other platforms.
- **File paths**: Use `path.join` or Electron/Node path utilities — never assume `/` or `\`.
- **Windows setup scripts**: the setup/issue-command runner is a `.cmd` batch file unless the script starts with a `#!` line — never derive that from the user's terminal-shell preference, and never launch a `.cmd` runner with a bare `cmd.exe /c` from a Git Bash pane (MSYS rewrites the `/c`). See [`docs/reference/windows-setup-shell.md`](./docs/reference/windows-setup-shell.md).
- **Linux native modules**: keep the glibc floor at Ubuntu 20.04 / glibc 2.31. A module compiled from source on a newer runner can reference symbol versions absent on the floor and crash the app on startup. See [`docs/reference/linux-glibc-compatibility.md`](./docs/reference/linux-glibc-compatibility.md); packaging fails if a bundled native binary needs newer glibc.

## SSH Use Case

All changes must consider the SSH use case. Don't assume local-only execution.

## Folder Workspace Use Case

All changes must consider folder workspaces as well as git worktrees. Don't assume every workspace is a git worktree.

## Remote Wire Compatibility

Clients and remote Orca servers update independently, so mixed versions are the normal state. Before changing anything a paired client and host exchange — RPC params, stream frames, or the content either side publishes over them — follow [`docs/reference/remote-wire-compatibility.md`](./docs/reference/remote-wire-compatibility.md). A new optional field is safe; a new stream opcode must be capability-negotiated because decoders drop unknown opcodes silently; and changing what the host publishes reaches old clients even with no wire change.

## Git Binary Compatibility

Orca runs the user's Git binary on native, WSL, and SSH hosts, which may all have different versions. Treat Git 2.25 as the core-workflow baseline and follow [`docs/reference/git-compatibility.md`](./docs/reference/git-compatibility.md).

When adding or changing a Git command:

- Check when every subcommand and option was introduced. For newer behavior, keep a baseline-compatible fallback or degrade safely.
- Use `GitCapabilityCache` with a narrow unsupported-error predicate so recurring operations do not retry a known-invalid command. Do not rely only on `git --version`; wrappers such as `simple-git` do not remove host-version differences.
- Scope capability state to the host that executes Git: native, WSL distro, SSH provider, or relay connection. Cover the first fallback, later cached calls, concurrent probes, and relevant host isolation in tests.
- Keep the real-binary compatibility contract in PR CI current. When adopting a newer Git feature, add its version boundary so the preferred command and fallback both run against representative Git releases.
- Preserve commands that begin with global Git options such as `-c` before the subcommand, including auto-maintenance suppression used by worktree-create fetches.

## Git Provider Compatibility

Source-control and review changes must consider GitLab and other supported git providers, not only GitHub. Keep provider-specific behavior behind explicit checks, and avoid GitHub-only naming for generic review concepts.

## Upstream Runtime Dependencies

Three services still resolve against upstream in a packaged Lab build — artifact sharing, Orca Cloud sign-in, and the mobile relay. What each one sends, what the user is told, and why none of them is hostable here is in [`docs/reference/upstream-runtime-dependencies.md`](./docs/reference/upstream-runtime-dependencies.md). Read it before adding a fourth.

## GitHub CLI Usage

Be mindful of the user's `gh` CLI API rate limit — batch requests where possible and avoid unnecessary calls. All code, commands, and scripts must be compatible with macOS, Linux, and Windows.
