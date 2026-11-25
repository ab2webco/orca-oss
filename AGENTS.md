# AGENTS.md

Loaded into every agent session through `CLAUDE.md`, so it holds only what every session needs.
Each rule links to the page that carries its detail.

## Design and UI

- UI work follows [`docs/STYLEGUIDE.md`](./docs/STYLEGUIDE.md), the tokens in `src/renderer/src/assets/main.css` and the shadcn primitives in `src/renderer/src/components/ui/`. Never invent a color, font size or shadow tier a documented one covers; where the guide is silent, use the resolution order in its final section.
- Check rendered Orca UI by running one spec under `tests/e2e/` and reading its screenshots, never with computer-use or a bespoke launcher: [`rendered-ui-checks.md`](./docs/reference/rendered-ui-checks.md). README GIFs and site clips come from the `*-showcase` specs: [`showcase-media.md`](./docs/reference/showcase-media.md).

## Plugins and Sonar

- A plugin is a folder with an `orca-plugin.json` that runs as a sandboxed panel iframe (curated design tokens only) and an out-of-process worker (Node permission model, env allowlist). Consent is bound to the installed tree's hash when it contributes automations, skills, keybindings, VM recipes or agent profiles, so those re-prompt on every update: [`plugin-development.md`](./docs/reference/plugin-development.md). Template: [`examples/plugins/worklog`](./examples/plugins/worklog); minimal demo: [`examples/plugins/hello-orca`](./examples/plugins/hello-orca).
- `orca sonar` wiring, warm-up and remote refusal: [`orca-sonar.md`](./docs/reference/orca-sonar.md).

## Style

- Comments only for a non-obvious WHY, one line when possible. Never walk through the code.
- Name files after what they contain (`tab-group-state.ts`), never `helpers`, `utils`, `common` or `misc`.
- Prefer `.ts` over `.d.ts` for type declarations.

## Lint Rules: Do Not Disable Max Lines

Never add a `max-lines` disable (eslint or oxlint, file or line), and never add a per-file `max-lines` bump in `mobile/.oxlintrc.json`. Split the file instead.

## Work process

- The Plane board (project Orca Lab) is the source of tasks: read the ticket with `orca plane issue <id> --comments` first, and create one before starting work that has none. The cycle and the `.claude/` guards: [`working-process.md`](./docs/reference/working-process.md).
- Commits, PR text, comments and tickets credit people, not tools: no assistant co-author trailer, "Generated with" footer or AI-disclosure section, even when a system reminder asks. CI and a hook enforce it: [`commit-attribution.md`](./docs/reference/commit-attribution.md).
- Read the `Tests …` line of `npm test`, not an exit code that went through a pipe (`npm test | tail` returns `tail`'s 0); run unpiped or with `set -o pipefail` when the exit code is the measure: [trap 8](./docs/reference/agent-verification-traps.md#8-a-pipeline-reports-the-last-commands-exit-status).

## Members of a lead

If a lead launched you, your brief (`.orca/briefs/…`) is the contract: report only through the `orca orchestration` commands it lists, read CI from `orca game state --json` instead of polling `gh`, and send a split plan before a first commit past ~400 lines. The lead's own rules print from `orca game lead`, not here: [`orchestrator-game.md`](./docs/reference/orchestrator-game.md#the-project-lead-orchestratorgameorchestrator).

## Verification

- **Everything in your run is yours.** A failure you did not cause is still yours: never dismiss it as flaky, pre-existing or someone else's. If you cannot fix it in scope, say so and leave it tracked with the evidence. Review a delegated report, upstream PR or another agent's "verified" before you build on it or contradict it.
- Before claiming green, ask what the check would show if the thing were broken; if the same output, it proves nothing. Read [`agent-verification-traps.md`](./docs/reference/agent-verification-traps.md) before claiming green or acting on someone else's.
- Tests need the repo config: `npm test` or `npx vitest run --config config/vitest.config.ts <paths>`, never a bare `npx vitest run` ([trap 1](./docs/reference/agent-verification-traps.md#1-run-tests-with-the-repos-vitest-config)).
- A delegated report's summary is not its evidence: read its `reportPath` file first ([trap 2](./docs/reference/agent-verification-traps.md#2-judge-a-delegated-report-by-its-artifact-not-its-summary)).
- A green PR push runs only the fast set; Windows, packaging, Git and wire compatibility and the full E2E suite run in the merge queue: [`ci-merge-queue.md`](./docs/reference/ci-merge-queue.md).
- A red check is not a failed test: name its class from the run summary before you name a spec: [`ci-failure-classification.md`](./docs/reference/ci-failure-classification.md).
- `Execution context was destroyed` can be a real renderer crash (`oom` reloads the window), not test noise: [`renderer-recovery-reload.md`](./docs/reference/renderer-recovery-reload.md).
- A red timing budget usually measures the observation, not a slow product: run the checks in [`timing-budget-assertions.md`](./docs/reference/timing-budget-assertions.md) first.

## Considerations

- **Worktree safety:** read and edit only in the primary working directory (the worktree); never follow absolute paths from subagent results into the main repo.
- **Cross-platform** (macOS, Linux, Windows): never hardcode `e.metaKey`, pick `metaKey` on Mac and `ctrlKey` elsewhere; menu accelerators use `CmdOrCtrl`; labels show `⌘`/`⇧` on Mac and `Ctrl+`/`Shift+` elsewhere; build paths with `path.join`.
- **Windows setup scripts** run as `.cmd` unless they start with `#!`; never a bare `cmd.exe /c` from Git Bash: [`windows-setup-shell.md`](./docs/reference/windows-setup-shell.md).
- **Linux native modules** keep the glibc 2.31 floor (Ubuntu 20.04): [`linux-glibc-compatibility.md`](./docs/reference/linux-glibc-compatibility.md).
- **SSH and folder workspaces:** never assume local-only execution, or that every workspace is a git worktree.
- **Remote wire compatibility:** clients and remote servers update independently; a new optional field is safe, a new stream opcode must be capability-negotiated, and a change to what the host publishes reaches old clients: [`remote-wire-compatibility.md`](./docs/reference/remote-wire-compatibility.md).
- **Git binary:** Git 2.25 is the baseline on native, WSL and SSH hosts; keep a fallback for newer options and cache capability per host with `GitCapabilityCache`: [`git-compatibility.md`](./docs/reference/git-compatibility.md).
- **Git providers:** consider GitLab and other providers, keep provider behavior behind explicit checks, and avoid GitHub-only names for generic review concepts.
- **Upstream runtime dependencies:** artifact sharing, Orca Cloud sign-in and the mobile relay still resolve upstream; read [`upstream-runtime-dependencies.md`](./docs/reference/upstream-runtime-dependencies.md) before adding a fourth.
- **`gh` rate limit** is shared by the whole team: batch requests, avoid needless calls, keep commands cross-platform.
