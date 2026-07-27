# Upstream PR Adoption

This lab is a fork of [`stablyai/orca`](https://github.com/stablyai/orca) and adopts
upstream pull requests continuously. This document is the decision procedure for that:
open it next to a PR, work top to bottom, and land on one of three outcomes.

Rule of order: **safe > excellent > useful**. When quality or security is in doubt, do
not adopt. Only an adopted-and-verified PR enters a release.

`<n>` below is the upstream PR number. All `gh` calls go against `-R stablyai/orca`.

## Step 1 — Classify

Fetch the PR once and reuse the output; `gh` is rate-limited.

```sh
gh pr view <n> -R stablyai/orca --json number,title,state,labels,files,additions,deletions,body
gh pr diff <n> -R stablyai/orca > /tmp/pr-<n>.diff
```

Pick exactly one type:

| Type              | What it is                                              |
| ----------------- | ------------------------------------------------------- |
| `feature`         | New user-visible capability                             |
| `fix`             | Behavior correction, no new surface                     |
| `perf`            | Same behavior, better cost                              |
| `service-support` | SSH, relay, git providers, Plane/Linear, agent providers |
| `security`        | Fixes or hardens a security surface                     |
| `ci-chore`        | CI, packaging, tooling, docs — no runtime `src/` change  |

## Step 2 — Which gates apply

| Type              | Quality (Step 3) | Security (Step 4) | Compatibility (Step 5) |
| ----------------- | ---------------- | ----------------- | ---------------------- |
| `feature`         | full             | if triggered      | if triggered           |
| `fix`             | full             | if triggered      | if triggered           |
| `perf`            | full             | if triggered      | if triggered           |
| `service-support` | full             | **always**        | if triggered           |
| `security`        | full             | **always**        | if triggered           |
| `ci-chore`        | Q1, Q3, Q5 only  | if triggered      | if triggered           |

"if triggered" means the trigger check inside that step says yes. Never skip a trigger
check because the PR title sounds harmless — the trigger is the file list, not the title.

## Step 3 — Quality gate

Each item is yes/no. Any `no` moves the PR to Step 6.

**Q1 — Tests exist and are runnable.** Every changed non-test file under `src/` has a
changed or added `*.test.ts` in the same area of the diff, and the tests run under the
repo's config (the `--config` flag is mandatory or `@/` aliases fail):

```sh
grep '^+++ b/' /tmp/pr-<n>.diff | sed 's|^+++ b/||'   # changed paths
pnpm vitest run --config config/vitest.config.ts <changed test paths>
```

Test *significance* is not readable from a diff. To judge it, run the PR's new tests
against this repo **before** applying the PR: a test that already passes on unmodified
code proves nothing. This requires the local branch from Step 7, so Q1 has two parts —
"tests are present" is checkable now, "tests are significant" is checkable only after
Step 7's checkout. Do not mark the PR adopted until both parts have been answered.

**Q2 — Complies with [`AGENTS.md`](../../AGENTS.md).** Check the diff for each:

- No added `eslint-disable max-lines` / `oxlint-disable max-lines`, and no raised
  per-file cap. Pre-existing disables in touched files are not a `no`, but growing such
  a file is a Step 6 note.
  ```sh
  grep -n '^+.*disable max-lines' /tmp/pr-<n>.diff
  ```
- No `any` in added lines; no `.d.ts` added for project types.
  ```sh
  grep -nE '^\+.*\b(: *any\b|as any\b|<any>)' /tmp/pr-<n>.diff
  ```
- No hardcoded `e.metaKey` without a platform check; no hand-built path separators.
  ```sh
  grep -nE '^\+.*(metaKey|["'\''`]/["'\''`] *\+|\\\\)' /tmp/pr-<n>.diff
  ```
- New UI strings go through `translate('key', 'Fallback')`.
- Any new file is named for its domain concept — reject `helpers`, `utils`, `common`,
  `misc`, `shared`.

**Q3 — Bounded diff, no dead code, no debug traces.** Added lines contain no
`debugger`, and no `console.log` outside the logging conventions already present in the
touched file.

```sh
grep -nE '^\+.*(debugger|console\.(log|debug|trace))' /tmp/pr-<n>.diff
```

A diff over ~600 changed lines, or one spanning unrelated subsystems, is not
automatically a `no` — it is a mandatory Step 6 decision instead of a silent adopt.

**Q4 — UI follows the design system.** If the diff touches
`src/renderer/`, it uses tokens from `src/renderer/src/assets/main.css` and primitives
from `src/renderer/src/components/ui/`, per [`docs/STYLEGUIDE.md`](../STYLEGUIDE.md). No
invented color, size, or shadow values.

**Q5 — Local verification is green.** Run on the Step 7 branch, not on the diff:

```sh
pnpm typecheck
pnpm lint
pnpm build:desktop
pnpm vitest run --config config/vitest.config.ts <changed test paths>
```

`pnpm lint` already covers oxlint, the max-lines ratchet, and localization coverage.

## Step 4 — Security gate

**Trigger.** Run this against the PR's changed paths. Any match makes the security gate
mandatory, regardless of type:

```sh
gh pr view <n> -R stablyai/orca --json files --jq '.files[].path' \
  | grep -Ei 'pty|auth|token|credential|keychain|secret|vault|permission|updater|entitlement|ipc|^src/preload/|ssh|relay'
```

That covers the surfaces the gate is written for: PTY environment, authentication,
the updater, IPC (including the `src/preload/` bridge), and SSH. A diff that adds a new
`child_process` / `spawn` / `exec` call, a new outbound host, or a `package.json`
dependency also triggers the gate even if no path matches.

Each item is yes/no. Any `no` moves the PR to Step 6.

**S1 — No command injection.** Process launches pass arguments as an array, never an
interpolated string. Remote command builders escape every interpolated path with the
host-appropriate escaper on **both** branches — `shellEscape` for POSIX,
`powerShellLiteral` / `powerShellNativeArg` for Windows. A remote command that quotes
one branch and not the other is a `no`.

```sh
grep -nE '^\+.*(exec\(|execSync|spawn\(|`.*\$\{.*\}.*`)' /tmp/pr-<n>.diff
```

**S2 — Credentials handled carefully.** Secret files are created with mode `600` and
correct ownership; no secret, token, or full auth header reaches a log line or an error
message.

**S3 — No new network to untrusted hosts.** Any added URL, hostname, or port is
justified in the PR body and points at a host this lab already talks to.

```sh
grep -nE '^\+.*(https?://|fetch\(|net\.connect|new WebSocket)' /tmp/pr-<n>.diff
```

**S4 — Respects permissions and per-account isolation.** Auth checks are not removed or
widened; account-scoped stores (vaults, keychain slots, per-account token files) stay
scoped to their account.

**S5 — No unjustified dependencies.** Any `package.json` / lockfile change names the
new dependency in the PR body with a reason. Node builtins (`node:crypto`, …) are not
new dependencies.

```sh
grep -nE '^\+\+\+ b/.*(package\.json|pnpm-lock\.yaml)' /tmp/pr-<n>.diff
```

**S6 — Destructive remote operations are bounded.** Any added delete, prune, or GC of
remote state names exactly what it removes, and cannot remove state owned by a
concurrent Orca instance. State a concrete answer to "what happens if another instance
is mid-operation on that path right now?" — an unbounded or time-window-only answer is a
Step 6 note.

## Step 5 — Compatibility gate

**Git.** Triggered when the diff adds or changes a git command line.

```sh
grep -nE '^\+.*(simpleGit|git\.(raw|revparse)|\bgit [a-z-]+)' /tmp/pr-<n>.diff
```

Then apply [`git-compatibility.md`](./git-compatibility.md): the command must work on
the Git 2.25 baseline or degrade through `GitCapabilityCache` with a narrow
unsupported-error predicate, and global `-c` options must stay before the subcommand.

**Linux glibc.** Triggered when the diff touches a native module, `optionalDependencies`,
a rebuild script, or `config/electron-builder.config.cjs`. Then apply
[`linux-glibc-compatibility.md`](./linux-glibc-compatibility.md): the glibc 2.31 /
Ubuntu 20.04 floor holds.

**Platform and workspace shape.** The change works on macOS, Linux, and Windows; over
SSH and WSL as well as locally; and in a folder workspace as well as a git worktree. A
change that only holds for one of those is not adoptable as-is.

## Step 6 — Outcome

Exactly one of three. Record it in the tracking issue for the PR.

| Outcome                 | When                                                                                                                        | Action                                                                                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Adopt**               | Every applicable gate is `yes`.                                                                                              | Proceed to Step 7.                                                                                                                                                  |
| **Adopt with rework**   | The change is correct for the class of bug, but one or more gates fail on things the lab can fix locally — missing tests, a loose type, a Windows branch that is not escaped, an unbounded cleanup window. | Proceed to Step 7, then land the rework as a separate commit on the same adoption branch. The rework is part of the adoption, not a follow-up. Re-run Step 3 Q5 after it. |
| **Reject**              | A security gate fails on the design rather than the implementation; the change only holds on one platform or one workspace shape; the diff is too broad to review; or the answer to any gate stays unknown. | Do not adopt. Record which gate failed and why, so the same PR is not re-triaged from scratch when upstream revises it.                                              |

**Who decides.** Steps 1–5 are mechanical and any reviewer can run them. The choice
between *adopt with rework* and *reject* is the lab maintainer's, and so is any decision
to adopt a PR partially (cherry-picking a subset of its files). Ambiguity is not
resolved by the reviewer running the gates — it is escalated.

**Partial adoption** is a form of *adopt with rework*: take the files that pass, drop
the rest, and note in the tracking issue exactly what was left behind, so the next
upstream sync does not silently pull it in.

## Step 7 — Adoption procedure

```sh
git switch -c fabolivark/adopt-<n> main
git fetch origin pull/<n>/head
git merge --squash FETCH_HEAD
```

Resolve conflicts in favor of the lab's version where the two diverge intentionally.
Then run Step 3 Q5 in full, plus the Q1 significance check the diff could not answer.
Push to `fabolivark`, integrate into `main` on `ab2webco`, and release only after the
gates are green on the merged result — not only on the adoption branch.

## Known limits of this rubric

These are stated so nobody mistakes a green checklist for more assurance than it gives:

- **Test significance needs a branch.** A diff can prove a test exists; only running it
  against unmodified code proves it would have caught the bug. Step 3 Q1 defers that to
  Step 7 rather than pretending the diff answers it.
- **Q5 needs a branch too.** Build, typecheck, and lint are not diff-readable. A PR that
  has passed only Steps 1–6 is triaged, not vetted.
- **The `grep` commands are triage, not proof.** They surface candidates fast and have
  false positives and false negatives. A clean `grep` output is not a `yes` on its own —
  it means the reviewer still has to read the added lines in that area.
