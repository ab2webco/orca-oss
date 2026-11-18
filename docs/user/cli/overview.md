# CLI

The `orca` command controls a running Orca Lab from any terminal. Scripts and agents use it to
create worktrees, drive terminals, coordinate agents, run a team and share artifacts.

## Install

Open **Settings > General > Orca Lab CLI** and choose **Register** under **Shell command**.

- On macOS, Orca Lab links `orca` into `/usr/local/bin`, or into `~/.local/bin` when that folder
  exists and `/usr/local/bin` does not.
- On Windows, Orca Lab adds the command folder to your user PATH.
- On Linux AppImage builds, Orca Lab installs a wrapper script.
- WSL has its own **WSL shell command** entry.

Use **Remove** in the same place to undo the registration.

## Main command groups

- `orca open`, `orca status` and `orca serve`: start Orca Lab, check that it is running, or run it
  without a window on a server.
- `orca worktree`: create, list, show, set and remove worktrees, and find or stop the processes
  left inside one.
- `orca terminal`: create, list, read, send text to, wait on, split, rename, wake and close
  terminals.
- `orca orchestration`: send messages, ask questions and dispatch tasks between agents.
- `orca game`: run a team: a lead, one member per ticket, the fleet, history and the Inbox.
- `orca account`: list accounts and their cached quota, add an account, switch Claude accounts,
  and store a long-lived Claude token.
- `orca environment`: save, list and remove the paired Orca Lab hosts you run members on.
- `orca artifacts`: share, update, list, delete and unshare HTML or Markdown artifacts.
- `orca plane` and `orca linear`: read and update linked tasks.
- `orca sonar`: search the repository through the Orca Sonar index.

Run `orca --help` or `orca <group> --help` for the full list of subcommands and options. Every
command takes `--json` for machine-readable output.

## Run a team: orca game

Run these from the lead's terminal, or from any Orca terminal in the project for the read-only
ones. [Agent Teams](../agents/agent-teams.md) explains the lead and its members.

- `orca game lead [--fresh]`: make this session the project's lead. `--fresh` retires the old lead's conversation instead of reopening it.
- `orca game leads`: list the leads that are live on this Orca host.
- `orca game launch <ticket>`: start one member for a ticket in its own worktree. `--on <host> --repo <selector>` runs it on a paired host; `--account`, `--agent`, `--model` and `--effort` override the project's choice.
- `orca game wave [<ticket>,...]`: launch members for the named tickets, or fill the free slots from the To Do. `--dry-run` only prints the plan.
- `orca game fleet`: list the members with their ticket, PR, CI, phase and next step, including paused and found agents.
- `orca game state`: the game state of the current terminal, including `review.ci` and `review.mergeState`.
- `orca game member <ticket|character>`: what one member is doing now and what it did since its launch.
- `orca game accounts [--refresh]`: every managed account with its 5 h and 7 d use and the members running on it.
- `orca game move <ticket>`: move a member that hit its account limit onto another account.
- `orca game adopt <name|ticket>`: make an agent the fleet found running (here or on a paired host) a member, so mail flows both ways.
- `orca game drop <name|ticket>`: take an agent out of the fleet without stopping it or touching its worktree.
- `orca game sweep [--close]`: list finished members and what each leaves pending. `--close` records them in the history and frees their tabs.
- `orca game history`: the project's freed members: ticket, outcome, PR, character, agent, account and host. Filter with `--ticket`, `--character` or `--since`.
- `orca game resume-members`: bring back the members a restart left paused, or free them with `--discard`.
- `orca game owner-questions`: what the lead asked you that still waits for an answer. Answer with `orca game answer-owner`.
- `orca game owner-question <id>`: one question and your answer, with when and where you gave it. A member runs it to check an answer its lead relays instead of asking you again.
- `orca game metrics`: tickets done, lead time and freed members by outcome.
- `orca game stop <ticket>|--all [--hold]`: stop members and record them in the history. `--all --hold` also sets a STOP that refuses new launches until `orca game resume`.
- `orca game adopt-history --from-repo-id <id>`: fold the history, lessons and STOP a removed repo id left behind into this project.
- `orca game scene list`: list the built-in scenes and the project's scene files. `scene new` and `scene validate` author one.
- `orca game view <view> --scope project|global`: store the terminal band's view for this project or every project.

```bash
orca game launch ORCA-101
orca game launch ORCA-102 --on build-box --repo path:/srv/orca-oss
orca game wave --dry-run
orca game history --since 2026-11-01
```

## Terminals and worktrees

- `orca terminal wake --terminal <handle>` wakes a sleeping agent terminal and resumes its
  conversation on the same account, as clicking it in the window does. Add `--environment <host>`
  for a terminal on a paired host.
- `orca terminal state` reads an agent's state from its own session log, not from the screen.
- `orca terminal rename` sets or clears a tab's title.
- `orca worktree processes --worktree <selector>` lists the processes whose working directory is
  inside a worktree; `--stop` ends only the orphaned ones.
- `orca worktree rm` refuses the worktree of a team member that has not finished, even with
  `--force`, which only skips the dirty-tree check. `--force-member` removes it anyway.

```bash
orca terminal wake --terminal term_abc123
orca worktree processes --worktree active --stop
orca worktree rm --worktree id:wt-1 --force-member
```

## Accounts

- `orca account list` shows each managed Claude and Codex account with its cached quota. It never
  prints credentials.
- `orca account add` adds an account on this host.
- `orca account switch --to <email|id>` switches a terminal to another Claude account and resumes
  the same conversation.
- `orca account token set --account <email|id>` stores a long-lived `claude setup-token` token for
  one Claude account on this host, and `orca account token clear` removes it. See
  [Usage tracking and accounts](../agents/usage-tracking.md#long-lived-tokens).

```bash
orca account list
orca account token set --account me@example.com
```

## Orca Sonar

With the Orca Sonar plugin enabled, `orca sonar find <words...>` finds lines that contain every
word and `orca sonar symbol <name>` finds declarations with that exact name, from an index instead
of a full search. `orca sonar status` shows what the index holds. See
[Orca Sonar](../../reference/orca-sonar.md).

## How it connects

The CLI reads a runtime file in Orca Lab's data folder and talks to the running app over a local
socket. It needs Orca Lab to be running, except for `orca open`.
