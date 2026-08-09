import { GLOBAL_FLAGS, type CommandSpec } from '../args'

// Why: the desktop "Add account" button is disabled when the UI drives a remote
// runtime (a headless server). These commands run the interactive agent login
// (`claude login` / `codex login`) in the caller's own terminal on the host and
// register the captured account with the local runtime, giving headless hosts a
// way to manage Claude and Codex accounts.
export const ACCOUNT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['account', 'add'],
    summary: 'Add a managed Claude or Codex account by signing in on this Orca host',
    usage: 'orca account add [--agent claude|codex] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent'],
    notes: [
      'Runs the agent login (`claude login` / `codex login`) in this terminal, then registers the account with the local Orca runtime.',
      'Codex uses device authorization so the browser can complete sign-in from a different machine.',
      'Sign in with the account you want to add (e.g. use a private/incognito browser window for a second account).',
      '--agent defaults to claude. Requires the Orca runtime to be running on this machine.'
    ],
    examples: ['orca account add', 'orca account add --agent codex']
  },
  {
    path: ['account', 'list'],
    summary: 'List managed Claude and Codex accounts on this Orca host',
    usage: 'orca account list [--terminal <handle>] [--refresh] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'refresh', 'terminal'],
    notes: [
      'Lists every managed account (provider, email, id, active selection) with cached session/weekly usage windows. Never prints credentials.',
      '`active` is the GLOBAL selection for new launches. It does NOT say which account a terminal runs on; the `terminal` block does.',
      'The `terminal` block reports the Claude account of the pane this command runs in — proven from ORCA_TERMINAL_HANDLE / ORCA_PANE_KEY, or the pane named by --terminal <handle>.',
      'Its state is `account` (that account), `none` (no managed account; the login in Orca’s shared runtime) or `unknown` with a reason. Unknown is never a licence to fall back to `active`.',
      'Quota is served from the last snapshot; pass --refresh to force a provider usage fetch first (slower, and it can stall behind broken auth).',
      'Accounts are host-local: `--environment` / `--pairing-code` are rejected rather than ignored; run it on the host whose accounts you want to see.',
      'Use the email or id with --claude-account / --codex-account on `terminal create`, `worktree create`, and `orchestration worker-start` to direct a launch at one account.'
    ],
    examples: [
      'orca account list --json',
      'orca account list --refresh --json',
      'orca account list --terminal orca-terminal-4 --json'
    ]
  },
  {
    path: ['account', 'switch'],
    summary: 'Switch one terminal to another managed Claude account and resume the same session',
    usage: 'orca account switch --to <email|id> [--terminal <handle>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'to', 'terminal'],
    notes: [
      'The runtime that owns the terminal performs the whole swap: stop the agent, point that PTY at the target vault, relaunch the SAME command with `--resume <session>`, and verify the resumed session id before committing.',
      'Same pane, same tab: nothing is focused, split, or created. A verification failure rolls the terminal back to the account it started on.',
      '--to takes an email or account id from `orca account list`; custom-endpoint accounts are rejected (they use the failover path).',
      'Omitting --terminal targets the terminal this command runs in, proven by ORCA_TERMINAL_HANDLE / ORCA_PANE_KEY. There is no focused-pane fallback.',
      'The runtime accepts the operation before it stops anything, so losing this CLI process does not cancel a switch that is already underway.'
    ],
    examples: [
      'orca account switch --to other@example.com',
      'orca account switch --to acct_123 --terminal orca-terminal-4 --json'
    ]
  }
]
