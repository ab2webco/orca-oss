import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const TERMINAL_CREATE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['terminal', 'create'],
    summary: 'Create a terminal session in the current worktree',
    usage:
      'orca terminal create [--worktree <selector>] [--title <name>] [--agent <id>] [--command <text>] [--claude-account <email|id>] [--codex-account <email|id>] [--focus] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'worktree',
      'agent',
      'command',
      'title',
      'focus',
      'claude-account',
      'codex-account'
    ],
    notes: [
      'Creates a visible terminal tab without switching focus when possible; falls back to a background handle if the UI cannot adopt it. Pass --focus to switch to it.',
      'Use this, not worktree create, for a fresh agent in the current checkout.',
      'Pass --agent <id> (same ids as `orca worktree create --agent`) to launch that agent with the launch arguments and environment configured in Settings, including the permission mode. Use --agent for agent workers so the configured mode is honored.',
      '--command launches raw argv and never applies the configured agent defaults, so an agent started that way keeps its own built-in permission prompts. --agent and --command are mutually exclusive; pass --command only when custom argv is required.',
      'Pass --claude-account or --codex-account (email or id from `orca account list --json`) to launch this terminal against a specific managed account. The launch flag beats the worktree account pin; the pin beats the global selection. It composes with --agent.',
      'An account-directed terminal always spawns on the background path, so it skips renderer-backed niceties for interactive agent TUIs.'
    ],
    examples: [
      'orca terminal create --json',
      'orca terminal create --worktree active --agent codex --json',
      'orca terminal create --worktree active --title worker-1 --agent claude --json',
      'orca terminal create --worktree active --agent claude --claude-account dev@example.com --json',
      'orca terminal create --worktree active --command "codex --model gpt-5.5" --json',
      'orca terminal create --worktree path:/projects/myapp --title "RUNNER" --command "opencode"'
    ]
  }
]
