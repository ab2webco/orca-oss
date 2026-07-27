# Lab Release Smoke Check

Run this against a release candidate build before promoting it. It exists because a build shipped
where **files would not open in the editor while a terminal was open** — a break in the most-used
loop in the app, invisible to 37k passing unit tests, and obvious within thirty seconds of using
the real thing.

Every item below is a whole-app interaction across a boundary unit tests do not cross: renderer
overlays, PTY lifecycle, the runtime socket, the updater. That is the only class of bug this
catches, and it is the class that reaches users.

## Cut and install the candidate

```sh
gh workflow run "Lab Release" -R ab2webco/orca-oss --ref main -f release_candidate=true
```

It publishes a real, downloadable release tagged `vX.Y.Z-lab.N.rc`, marked prerelease, with no
update nudge. It shows up on the repo's releases page like any other release, badged
**Pre-release**. Ordinary update checks exclude that tag shape, so no user receives it.

Two ways to get it onto your machine:

- **From the app** — **Alt+click** (⌥+click) *Check for Updates*. That modifier is the only
  in-app route to this channel, and it exercises the real auto-update path.
- **By hand** — download the installer from the release page and install over your current build.

> Never cut an RC unless a normal lab release carrying the exclusion
> (`isLabRcPrereleaseTag`, shipped in `1.4.152-lab.35`) has already reached users. Installs older
> than that still resolve RC tags and would update to it.

## The checks

Confirm the title bar shows the `.rc` version before starting — otherwise you are testing the
build you already had.

| # | Check | Broken looks like |
| --- | --- | --- |
| 1 | Open a file from the sidebar with **no** terminal open | Editor stays blank |
| 2 | Open a terminal, then open a different file | Editor blank or shows the terminal — **this is the regression that shipped** |
| 3 | Switch worktrees, open a file in the second one | Wrong file, wrong worktree, or blank |
| 4 | Type in a terminal, then click a file, then click back into the terminal | Keystrokes land in the wrong pane, or focus does not return |
| 5 | Launch an agent (`claude`, `codex`) from the UI in a worktree | Terminal never reaches a prompt |
| 6 | `orca status --json` from a terminal inside the app | `Orca is not running` while it plainly is |
| 7 | Open the editor on a large file, scroll, and edit | Freeze, or the scroll position jumps |
| 8 | Quit and relaunch; confirm tabs and terminals come back | Lost session, orphaned PTYs |

Checks 2 and 4 are the ones that would have caught the shipped bug. Do not skip them because they
feel trivial — that is precisely why nothing else covered them.

## Promote

Only after every check passes:

```sh
gh workflow run "Lab Release" -R ab2webco/orca-oss --ref main -f release_candidate=false
```

The promoted build takes the **next** number: `lab.36.rc` validated → ships as `lab.37`. That is
required, not cosmetic — `lab.36.rc` outranks `lab.36` in semver, so reusing the number would leave
every RC tester unable to update to the build they just validated.

## If a check fails

Do not promote and do not patch on top of the RC tag. Fix on `main`, then cut a fresh RC — it takes
the next number again. An RC is disposable; a release that reached users is not.
