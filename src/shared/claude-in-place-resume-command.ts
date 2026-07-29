import {
  commandSeparator,
  quoteStartupArg,
  type AgentStartupShell
} from './tui-agent-startup-shell'

function setClaudeConfigDirCommand(configDir: string, shell: AgentStartupShell): string {
  if (shell === 'powershell') {
    return `$env:CLAUDE_CONFIG_DIR = ${quoteStartupArg(configDir, shell)}`
  }
  if (shell === 'cmd') {
    const escaped = configDir.replace(/([\^&|<>()%!"])/g, '^$1')
    return `set "CLAUDE_CONFIG_DIR=${escaped}"`
  }
  return `export CLAUDE_CONFIG_DIR=${quoteStartupArg(configDir, shell)}`
}

export function buildClaudeInPlaceResumeCommand(args: {
  configDir: string
  resumeCommand: string
  shell: AgentStartupShell
}): string {
  return `${setClaudeConfigDirCommand(args.configDir, args.shell)}${commandSeparator(args.shell)}${args.resumeCommand}`
}
