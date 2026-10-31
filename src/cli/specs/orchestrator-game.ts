import { GLOBAL_FLAGS, type CommandSpec } from '../args'
import {
  GAME_LAUNCH_OVERRIDE_FLAGS,
  GAME_LAUNCH_OVERRIDE_NOTES
} from './orchestrator-game-launch-flags'

export const ORCHESTRATOR_GAME_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['game', 'state'],
    summary: 'Read the Agent Teams game state of the current terminal',
    usage: 'orca game state [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['orca game state --json']
  },
  {
    path: ['game', 'lead'],
    summary: "Print the standing rules that make this session the project's lead",
    usage: 'orca game lead [--fresh] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'fresh'],
    notes: [
      "Orca's rules plus the project's own from orchestratorGame.orchestrator.rules in orca.yaml.",
      'A session a lead launched gets no rules: it reports to its lead.',
      "One live lead per project: with the project's lead live in another pane, Orca focuses that pane and prints `Not the lead:` instead of the rules.",
      "With the lead's pane closed, Orca reopens its last conversation in a new tab; when that fails, this session becomes a new lead and the output says why.",
      '--fresh rotates the lead: with the outgoing lead closed, Orca retires its stored conversation and this session becomes the new lead instead of reopening it.'
    ],
    examples: ['orca game lead', 'orca game lead --fresh']
  },
  {
    path: ['game', 'leads'],
    summary: 'List the project leads that are live on this Orca host',
    usage: 'orca game leads [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Prints project, label, lead handle and state. A session is listed once `orca game lead` ran in it and while its terminal exists.',
      'Only leads on this Orca host appear: leads on other paired hosts are not listed.',
      'Message a lead with `orca orchestration send --to <lead handle> --subject <subject> --body <request>`; a host older than this prints that it does not support game leads.'
    ],
    examples: ['orca game leads', 'orca game leads --json']
  },
  {
    path: ['game', 'open-link'],
    summary: "Open a game link in the system browser of Orca Lab's desktop",
    usage: 'orca game open-link <url> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'url'],
    positionalArgs: ['url'],
    notes: [
      'Only http(s) links. The game mod runs it when orchestratorGame.openLinks is system.',
      'Fails on a host with no desktop (orca serve) or an Orca older than it; the mod then opens an Orca tab.'
    ],
    examples: ['orca game open-link https://github.com/o/r/pulls']
  },
  {
    path: ['game', 'view'],
    summary: 'Store the Agent Teams game view for this project or every project',
    usage: 'orca game view <off|flat|zen|2d-classic|2d-hd> --scope <project|global> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'view', 'scope'],
    positionalArgs: ['view'],
    notes: [
      "--scope project stores it for the calling pane's repo on this machine (Settings → the project); global stores it for every project.",
      "A view is stored as orchestratorGame.mode and render; orca.yaml is never written. For every project, a project's own setting (this machine or orca.yaml) still wins.",
      "One pane alone changes with the game's /orca-game:view; an older host refuses this command."
    ],
    examples: ['orca game view flat --scope project', 'orca game view 2d-hd --scope global --json']
  },
  {
    path: ['game', 'launch'],
    summary: "Start one member for a ticket in its own worktree, as this project's lead",
    usage:
      'orca game launch <ticket> [--repo <selector>] [--on <host>] [--prompt <task>] [--agent <id>] [--account <email|id>] [--model <id>] [--effort <level>] [--skip-mcp-check] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'ticket',
      'repo',
      'on',
      'prompt',
      ...GAME_LAUNCH_OVERRIDE_FLAGS
    ],
    positionalArgs: ['ticket'],
    notes: [
      'Run it from the lead terminal: the member reports to it through Orca orchestration.',
      'The agent, model, cap and prompt come from orchestratorGame.orchestrator in orca.yaml or the project Settings.',
      'Refused when the project cap of running members is reached.',
      "--repo starts the member in that repo's own new worktree instead of a child of the lead's.",
      "--on <host> starts the member on that paired host (a saved environment) in a new worktree of --repo, which is then the host's repo selector and required; it takes the same roster name and game as a local member. --account (or the project's accounts: auto) is resolved by the host against its own accounts and refused there when it has none usable; the result names the email it used.",
      "A relaunch reuses the ticket's idle worktree in that repo (its previous member's, else linked to the ticket, else named after it; an open PR breaks a tie); refused when an agent is live there or two still match.",
      '--prompt replaces the project launchPrompt for this member, for a task that is not implementing the ticket; {id}, {title}, {url} and {status} are filled.',
      ...GAME_LAUNCH_OVERRIDE_NOTES
    ],
    examples: [
      'orca game launch CIN-1232 --json',
      'orca game launch CIN-1232 --prompt "Run the Tambora test run of {id} and report pass/fail"',
      'orca game launch CIN-1232 --repo name:cineco-frontend --json',
      'orca game launch ORCA-831 --on imac --repo name:orca-oss',
      'orca game launch CIN-1631 --on imac --repo name:cineco-backend --account ana@example.com',
      'orca game launch CIN-1232 --agent codex --account ana@example.com'
    ]
  },
  {
    path: ['game', 'fleet'],
    summary: "List the lead's members with their ticket, PR, CI, phase and next step",
    usage: 'orca game fleet [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Phases: needs-you (waiting on a question), limited (stopped by its account usage limit; `game move` it or wait), working, idle, finished (PR merged and ticket in review or done).',
      'Running members are every one not finished; free slots are the cap minus them.'
    ],
    examples: ['orca game fleet', 'orca game fleet --json']
  },
  {
    path: ['game', 'accounts'],
    summary:
      "List every managed account per agent with its 5h and 7d use and the lead's members on it",
    usage: 'orca game accounts [--refresh] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'refresh'],
    notes: [
      'Standing: free, near (90% or more of its 5h or 7d window), limited (100%), or unknown (no usage reading yet).',
      'usableAt is when a near or limited account is usable again; nextUsableAt is set when every account of an agent is near or limited.',
      'Members are the tickets of this lead running on each account. autoPick says whether orchestrator.accounts: auto may pick it.',
      '--refresh asks the providers for fresh usage first; without it Orca answers from its cached reading. No credentials are printed.'
    ],
    examples: ['orca game accounts', 'orca game accounts --refresh --json']
  },
  {
    path: ['game', 'move'],
    summary: 'Move a member its account limit stopped onto another managed account',
    usage:
      'orca game move <ticket> [--account <email|id|auto>] [--on <host> --repo <selector>] [--dry-run] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'ticket', 'account', 'on', 'repo', 'dry-run'],
    positionalArgs: ['ticket'],
    notes: [
      "--account defaults to auto: the other account of the member's agent with the most free quota.",
      'A Claude member is switched in its own terminal and resumes the same session (`orca account switch`); any other member is stopped and started again in its own worktree on the new account, linked with --retry-of.',
      'When every other account is at or near its limit, nothing moves and the result says when the first is usable again.',
      'Agents without Orca-managed accounts cannot move; wait for their reset.',
      "--on <host> --repo <selector> starts the member anew on that paired host, on --account or the project's account policy resolved there; once it starts, the old dispatch stops and its worktree is kept.",
      "A Claude member on a paired host is switched in place on that host's accounts; any other member there moves only with --on."
    ],
    examples: [
      'orca game move CIN-12',
      'orca game move CIN-12 --account ana@example.com --json',
      'orca game move CIN-12 --on m1 --repo name:cineco-backend --account ana@example.com'
    ]
  },
  {
    path: ['game', 'member'],
    summary: 'What one member is doing now and what it did since its launch, in one bounded read',
    usage: 'orca game member <ticket|terminal-handle> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'member'],
    positionalArgs: ['member'],
    notes: [
      'Now: state, phase, last tool, linked activity, a usage limit, and its last 20 terminal lines without escape codes; text left in a Claude input box is marked unsent (typed or a Claude suggestion) and given as unsentInput.',
      'Since launch: every dispatch of its task, the last 10 messages between it and the lead (questions, answers, worker_done), its last 10 commits since the base, PR, CI and ticket status.',
      'A part Orca cannot read is listed under notes; the rest still prints. Read-only.',
      'A member already freed is in `orca game history`.'
    ],
    examples: ['orca game member CIN-12', 'orca game member CIN-12 --json']
  },
  {
    path: ['game', 'history'],
    summary:
      "The project's members already freed: ticket, outcome, PR, agent, account and last report",
    usage: 'orca game history [--ticket <id>] [--since <date>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'ticket', 'since'],
    notes: [
      '`game sweep --close` and `game stop` write one record per member before freeing it; outcomes: merged, qa, stopped, failed, limited.',
      'Kept per project on the Orca host that runs the lead (also for SSH and folder projects), the last 200 records; newest first.',
      '--since takes a date (2026-10-15) or date-time; it compares with when the member was freed. Read-only.'
    ],
    examples: [
      'orca game history',
      'orca game history --ticket CIN-12 --json',
      'orca game history --since 2026-10-15'
    ]
  },
  {
    path: ['game', 'metrics'],
    summary:
      "The project's delivery numbers: tickets done, lead time, freed members by outcome, events",
    usage:
      'orca game metrics [--since <date>] [--until <date>] [--ticket <id>] [--character <name>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'since', 'until', 'ticket', 'character'],
    notes: [
      'Computed from `game events` and `game history` on the Orca host that runs the lead, so it also works for SSH and folder projects. Read-only.',
      'Done: a merged event, or a member freed as merged or with a merged PR. Lead time: first claim to last merge, per ticket.',
      '--since keeps entries at or after it, --until entries before it. Metrics with no recorded fact print "not recorded", never 0.',
      "--character keeps that character's own tasks (its last 20) and shows its level and XP. A ticket counts as done only when its own task on it is; lead time still runs from the ticket's first claim."
    ],
    examples: [
      'orca game metrics --since 2026-10-13',
      'orca game metrics --character Merlin --json',
      'orca game metrics --ticket CIN-12 --json',
      'orca game metrics --since 2026-10-01 --until 2026-10-08'
    ]
  },
  {
    path: ['game', 'wave'],
    summary: 'Launch members for the named tickets, or fill the free slots from the To Do',
    usage:
      'orca game wave [<ticket>[,<ticket>...]] [--repo <selector>] [--agent <id>] [--account <email|id>] [--model <id>] [--effort <level>] [--skip-mcp-check] [--dry-run] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'tickets', 'repo', 'dry-run', ...GAME_LAUNCH_OVERRIDE_FLAGS],
    positionalArgs: ['tickets'],
    notes: [
      'Without tickets, picks the To Do items in list order, skipping tickets a member already holds.',
      'Each launch goes through `orca game launch`; tickets past the cap are skipped, never launched.',
      '--dry-run prints the plan without launching anything.',
      '--agent, --account, --model, --effort and --skip-mcp-check apply to every member the wave launches.'
    ],
    examples: ['orca game wave --dry-run', 'orca game wave CIN-12,CIN-14 --json']
  },
  {
    path: ['game', 'sweep'],
    summary: 'List finished members and what each leaves pending; --close frees their tabs',
    usage: 'orca game sweep [--close] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'close'],
    notes: [
      '--close records each finished member in `orca game history`, then releases its dispatch, or closes its terminal when it has none.',
      'Working and waiting members and the lead are never touched, even with a merged PR or a completed Run; worktrees are left in place.',
      'Each row names its host, last activity and why it counts as finished.'
    ],
    examples: ['orca game sweep', 'orca game sweep --close --json']
  },
  {
    path: ['game', 'push'],
    summary: "Send idle members the project's continue prompt",
    usage: 'orca game push [--dry-run] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'dry-run'],
    notes: [
      "The prompt is orchestratorGame.orchestrator.pushPrompt in orca.yaml, or Orca's default.",
      'A member waiting on a question or dialog is reported, never sent anything; working ones are left.'
    ],
    examples: ['orca game push --dry-run', 'orca game push --json']
  },
  {
    path: ['game', 'stop'],
    summary: "Stop the lead's members so no member agent keeps running",
    usage: 'orca game stop [<ticket>[,<ticket>...] | --all [--hold]] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'tickets', 'all', 'hold'],
    positionalArgs: ['tickets'],
    notes: [
      'Records each member in `orca game history`, stops its live dispatch, then closes its terminal when the agent is still there.',
      'Never touches the lead. Worktrees are left in place.',
      'Name tickets or pass --all; each member is reported stopped, already stopped or failed.',
      '--all --hold first sets a persistent STOP for the project: game launch, wave, push and move are refused until `orca game resume`, a member the stop could not end gets a STOP message, and `game state` shows stopped. If STOP cannot be set, the members are stopped anyway and the result says why.'
    ],
    examples: [
      'orca game stop --all',
      'orca game stop --all --hold',
      'orca game stop CIN-12,CIN-14 --json'
    ]
  },
  {
    path: ['game', 'scene', 'new'],
    summary: 'Start a project scene file: Quest with an example foe, finale and pet',
    usage: 'orca game scene new <path> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'path'],
    positionalArgs: ['path'],
    notes: [
      'Runs locally without contacting the Orca Lab runtime.',
      'Never overwrites: an existing file is an error.',
      'Keep project scenes under .orca/scenes/ so `orca game scene list` and Settings find them.'
    ],
    examples: ['orca game scene new .orca/scenes/space.json']
  },
  {
    path: ['game', 'scene', 'validate'],
    summary: 'Check a scene file with the same rules Orca and the game apply',
    usage: 'orca game scene validate <file> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'file'],
    positionalArgs: ['file'],
    notes: [
      'Runs locally without contacting the Orca Lab runtime.',
      'Lists every problem as `path: message`; exits 1 when there is any.'
    ],
    examples: ['orca game scene validate .orca/scenes/space.json --json']
  },
  {
    path: ['game', 'scene', 'list'],
    summary: 'List the built-in scenes and the project scene files with their status',
    usage: 'orca game scene list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Runs locally without contacting the Orca Lab runtime.',
      'Finds .orca/scenes/ in this folder or the nearest parent that has one.'
    ],
    examples: ['orca game scene list --json']
  },
  {
    path: ['game', 'game', 'validate'],
    summary: 'Check an arcade game file with the same rules the game applies',
    usage: 'orca game game validate <file> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'file'],
    positionalArgs: ['file'],
    notes: [
      'Runs locally without contacting the Orca Lab runtime.',
      'Lists every problem as `path: message`; exits 1 when there is any.',
      'A game file is data for a built-in engine (runner): speed, gaps, jump, obstacles and an optional theme, at most 16 KB and 15 fps.'
    ],
    examples: ['orca game game validate .orca/games/runner.json --json']
  }
]
