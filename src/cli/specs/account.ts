import { GLOBAL_FLAGS, type CommandSpec } from '../args'

export const ACCOUNT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['account', 'list'],
    summary: 'List managed Claude and Codex accounts with quota state',
    usage: 'orca account list [--refresh] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'refresh'],
    notes: [
      'Lists every managed account (provider, email, id, active selection) with cached session/weekly usage windows. Never prints credentials.',
      'Quota is served from the last snapshot; pass --refresh to force a provider usage fetch first (slower, and it can stall behind broken auth).',
      'Use the email or id with --claude-account / --codex-account on `terminal create`, `worktree create`, and `orchestration worker-start` to direct a launch at one account.'
    ],
    examples: ['orca account list --json', 'orca account list --refresh --json']
  }
]
