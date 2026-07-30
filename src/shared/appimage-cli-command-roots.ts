// Why (ORCA-138): the AppImage main process must decide whether an argv is a CLI
// invocation before Electron boots, but the main tsconfig cannot import the CLI
// project. This lives in `shared` — the one directory both tsconfigs include —
// so the drift test can compare it against COMMAND_SPECS from the CLI side.
//
// A root missing here makes the AppImage boot the GUI instead of running the
// command: it loses the single-instance lock to the live window and exits with
// no output. That is how `orca.appimage plane project list --json` silently did
// nothing. `src/cli/appimage-cli-command-roots.test.ts` guards the sync.
export const APPIMAGE_CLI_COMMAND_ROOTS: readonly string[] = [
  'account',
  'agent',
  'agent-context',
  // Why: main() short-circuits these two at argv[0] before COMMAND_SPECS
  // parsing, so `agent-teams-tmux` has no spec to derive from and both must be
  // asserted by name rather than through the specs loop.
  'agent-teams-tmux',
  'automations',
  'back',
  'capture',
  'check',
  'claude-teams',
  'clear',
  'click',
  'clipboard',
  'computer',
  'console',
  'cookie',
  'dblclick',
  'diagnostics',
  'dialog',
  'download',
  'drag',
  'emulator',
  'environment',
  'eval',
  'exec',
  'file',
  'fill',
  'find',
  'focus',
  'forward',
  'full-screenshot',
  'geolocation',
  'get',
  'goto',
  'highlight',
  'hover',
  'inserttext',
  'intercept',
  'is',
  'keypress',
  'linear',
  'mouse',
  'network',
  'open',
  'orchestration',
  'pdf',
  'plane',
  'project',
  'reload',
  'repo',
  'screenshot',
  'scroll',
  'scrollintoview',
  'select',
  'select-all',
  'serve',
  'set',
  'skills',
  'snapshot',
  'status',
  'storage',
  'tab',
  'terminal',
  'type',
  'uncheck',
  'upload',
  'viewport',
  'vm',
  'wait',
  'worktree'
]

// Why: these have no CommandSpec because main() handles them at argv[0] before
// spec parsing; the drift test asserts them separately from the derived set.
export const APPIMAGE_CLI_PRE_SPEC_ROOTS: readonly string[] = ['agent-teams-tmux', 'claude-teams']
