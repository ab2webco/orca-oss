import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

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
    usage: 'orca game lead [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      "Orca's rules plus the project's own from orchestratorGame.orchestrator.rules in orca.yaml.",
      'A session a lead launched gets no rules: it reports to its lead.'
    ],
    examples: ['orca game lead']
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
    path: ['game', 'launch'],
    summary: "Start one member for a ticket in its own child worktree, as this project's lead",
    usage: 'orca game launch <ticket> [--repo <selector>] [--prompt <task>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'ticket', 'repo', 'prompt'],
    positionalArgs: ['ticket'],
    notes: [
      'Run it from the lead terminal: the member reports to it through Orca orchestration.',
      'The agent, model, cap and prompt come from orchestratorGame.orchestrator in orca.yaml or the project Settings.',
      'Refused when the project cap of running members is reached.',
      "--repo starts the member in that repo's own new worktree instead of a child of the lead's.",
      '--prompt replaces the project launchPrompt for this member, for a task that is not implementing the ticket; {id}, {title}, {url} and {status} are filled.'
    ],
    examples: [
      'orca game launch CIN-1232 --json',
      'orca game launch CIN-1232 --prompt "Run the Tambora test run of {id} and report pass/fail"',
      'orca game launch CIN-1232 --repo name:cineco-frontend --json'
    ]
  },
  {
    path: ['game', 'fleet'],
    summary: "List the lead's members with their ticket, PR, CI, phase and next step",
    usage: 'orca game fleet [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Phases: needs-you (waiting on a question), working, idle, finished (PR merged and ticket in review or done).',
      'Running members are every one not finished; free slots are the cap minus them.'
    ],
    examples: ['orca game fleet', 'orca game fleet --json']
  },
  {
    path: ['game', 'wave'],
    summary: 'Launch members for the named tickets, or fill the free slots from the To Do',
    usage: 'orca game wave [<ticket>[,<ticket>...]] [--repo <selector>] [--dry-run] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'tickets', 'repo', 'dry-run'],
    positionalArgs: ['tickets'],
    notes: [
      'Without tickets, picks the To Do items in list order, skipping tickets a member already holds.',
      'Each launch goes through `orca game launch`; tickets past the cap are skipped, never launched.',
      '--dry-run prints the plan without launching anything.'
    ],
    examples: ['orca game wave --dry-run', 'orca game wave CIN-12,CIN-14 --json']
  },
  {
    path: ['game', 'sweep'],
    summary: 'List finished members and what each leaves pending; --close frees their tabs',
    usage: 'orca game sweep [--close] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'close'],
    notes: [
      "--close releases each finished member's dispatch, or closes its terminal when it has none.",
      'Working and waiting members and the lead are never touched; worktrees are left in place.'
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
    usage: 'orca game stop [<ticket>[,<ticket>...] | --all] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'tickets', 'all'],
    positionalArgs: ['tickets'],
    notes: [
      "Stops each member's live dispatch, then closes its terminal when the agent is still there.",
      'Never touches the lead. Worktrees are left in place.',
      'Name tickets or pass --all; each member is reported stopped, already stopped or failed.'
    ],
    examples: ['orca game stop --all', 'orca game stop CIN-12,CIN-14 --json']
  },
  {
    path: ['game', 'scene', 'new'],
    summary: 'Start a project scene file from the built-in Quest scene',
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
  }
]
