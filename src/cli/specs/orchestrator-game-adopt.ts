import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

/** The lead choosing which agents are in its fleet: adopt one, drop one without killing it (ORCA-943), or remove one (ORCA-1476). */
export const ORCHESTRATOR_GAME_ADOPT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['game', 'adopt'],
    summary:
      'Make an agent found on this machine or a paired host a member, so mail reaches it both ways',
    usage: 'orca game adopt <name|ticket> [--force] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'name', 'force'],
    positionalArgs: ['name'],
    notes: [
      'For a found agent of this project on this machine or a paired host (the fleet lists it as found): its task starts on its own terminal, with worker-start (--on for a host), and lead mail then reaches it and its reports reach the lead.',
      'An agent dropped with `orca game drop` comes back into the fleet first.',
      'Refused while the agent is mid-turn (unless --force), when it leads a Run on its host, or when its terminal no longer runs. Adopting an agent already adopted reuses its dispatch.'
    ],
    examples: ['orca game adopt ORCA-915', 'orca game adopt orca-915 --force --json']
  },
  {
    path: ['game', 'drop'],
    summary: "Take an agent out of the lead's fleet without stopping it or touching its worktree",
    usage: 'orca game drop <name|ticket> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'name'],
    positionalArgs: ['name'],
    notes: [
      'The agent stays out of the fleet and the Panel across refreshes and restarts, and is not resumed after a restart, until `orca game adopt` brings it back.',
      'A member on this machine whose dispatch still reports to the lead is detached first: the dispatch ends, its pane keeps running. One on a paired host is detached there the same way; a host whose Orca cannot is refused by name and version.'
    ],
    examples: ['orca game drop ORCA-915', 'orca game drop orca-907 --json']
  },
  {
    path: ['game', 'remove'],
    aliases: [['game', 'rm']],
    summary:
      "Remove one member from the lead's fleet and the Team panel: stop it if its session runs, otherwise forget it",
    usage: 'orca game remove <dispatch-id|name> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'member'],
    positionalArgs: ['member'],
    notes: [
      "Names one member by its dispatch id, its pane key (what the Team card sends) or its exact name, never by ticket or worktree: a name several members share is refused with each one's key.",
      'A live session is stopped first: its own dispatch, found by its terminal, and its terminal; a member on a paired host is stopped and released there. Another member in the same worktree, folder or ticket is never touched.',
      'Then Orca forgets it, also when its host no longer has its terminal or worktree or does not answer; a host that did not answer is named, since its agent may still run there.'
    ],
    examples: ['orca game remove ctx_1a2b3c4d5e6f', 'orca game remove Ginebra --json']
  }
]
