import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const FILE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['file', 'open'],
    summary: 'Open a workspace file in the Orca Lab editor',
    usage: 'orca file open <path> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'path', 'worktree'],
    positionalArgs: ['path'],
    notes: [
      'The path may be relative to the selected worktree or an absolute path inside that worktree. When --worktree is omitted, local CLI calls infer the current Orca Lab worktree from cwd.'
    ],
    examples: [
      'orca file open src/App.tsx',
      'orca file open --path docs/readme.md --worktree active'
    ]
  },
  {
    path: ['file', 'diff'],
    summary: 'Open a workspace file diff in the Orca Lab editor',
    usage: 'orca file diff <path> [--staged] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'path', 'staged', 'worktree'],
    positionalArgs: ['path'],
    notes: [
      'Diffs default to unstaged changes. Pass --staged to open the staged source-control diff.',
      'The path may be relative to the selected worktree or an absolute path inside that worktree.'
    ],
    examples: [
      'orca file diff src/App.tsx',
      'orca file diff --path package.json --staged --worktree branch:feature'
    ]
  },
  {
    path: ['file', 'read'],
    summary: 'Print a workspace file, on this host or a paired one',
    usage:
      'orca file read <path> [--offset <byte>] [--limit <bytes>] [--worktree <selector>] [--environment <env>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'path', 'offset', 'limit', 'worktree'],
    positionalArgs: ['path'],
    notes: [
      'The path must stay inside the selected worktree or folder workspace; the runtime rejects anything outside it.',
      'Without --offset/--limit the whole file is read up to the runtime preview budget (512 KiB, less over a paired connection). Larger files fail with a hint to read byte ranges.',
      '--offset/--limit read a byte range (default 64 KiB, at most 512 KiB); text output ends with the next --offset when more remains. Ranged reads are unavailable for SSH worktrees.',
      'Binary files are reported as binary and their bytes are never printed.',
      'With --environment, --worktree is required because the local cwd cannot identify a worktree on the other host.'
    ],
    examples: [
      'orca file read src/App.tsx',
      'orca file read README.md --worktree branch:main --environment imac',
      'orca file read logs/app.log --offset 0 --limit 65536 --worktree active --json'
    ]
  },
  {
    path: ['file', 'list'],
    summary: 'List a workspace directory, on this host or a paired one',
    usage: 'orca file list [<dir>] [--worktree <selector>] [--environment <env>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'path', 'worktree'],
    positionalArgs: ['path'],
    notes: [
      'Lists the worktree root when <dir> is omitted. Directories end with "/".',
      'The directory must stay inside the selected worktree or folder workspace.'
    ],
    examples: ['orca file list', 'orca file list src --worktree branch:main --environment imac']
  },
  {
    path: ['file', 'open-changed'],
    summary: 'Open all git-changed files for a workspace',
    usage: 'orca file open-changed [--mode edit|diff|both] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'mode', 'worktree'],
    notes: [
      'For v1, changed files come from git status for the selected worktree.',
      'The default mode is diff. Edit mode skips deleted files because there is no file to open.'
    ],
    examples: [
      'orca file open-changed',
      'orca file open-changed --mode both',
      'orca file open-changed --mode diff --worktree active'
    ]
  }
]
