import type { GameAgent } from './orchestrator-game-state'
import type { TeamFlowPhase } from './team-panel-model-types'

type PhaseInput = Pick<GameAgent, 'state' | 'toolName'> & {
  toolInput?: string | null
  review?: { state: string } | null
  workItem?: { statusGroup?: string | null } | null
}

// Why every agent's names: each reports its tools in its own words (agent-hook-listener's map), and
// the 3D Office shows what each member does whatever agent it runs (ORCA-1317).
const EDIT_TOOLS = new Set([
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
  'Create',
  'apply_patch',
  'write_file',
  'edit_file',
  'replace',
  'search_replace',
  'write_to_file',
  'replace_file_content',
  'multi_replace_file_content',
  'create',
  'edit',
  'write',
  'patch'
])
const SHELL_TOOLS = new Set([
  'Bash',
  'Execute',
  'exec_command',
  'shell_command',
  'run_shell_command',
  'run_command',
  'run_terminal_cmd',
  'run_terminal_command',
  'bash',
  'powershell',
  'terminal',
  'execute_code'
])
const PLAN_TOOLS = new Set(['EnterPlanMode', 'ExitPlanMode', 'TodoWrite'])
const TEST_COMMAND =
  /\b(?:vitest|jest|playwright test|pytest|go test|cargo test|(?:npm|pnpm|yarn|bun)(?: run)? test(?::\S+)?)\b/
const TEST_FILE = /\.(?:test|spec)\.|(?:^|\/)(?:__tests__|tests?|e2e)\//
const DOCS_FILE = /\.(?:md|mdx|rst)$|(?:^|\/)docs\//

export const isTeamWorkFinished = (agent: PhaseInput): boolean =>
  agent.review?.state === 'merged' || agent.workItem?.statusGroup === 'done'

// Why only from the tool: a phase must say what the member does now, never a guess (ORCA-1205).
const toolPhaseOf = (toolName: string | null, input: string): TeamFlowPhase | null => {
  if (toolName !== null && EDIT_TOOLS.has(toolName)) {
    return TEST_FILE.test(input) ? 'tests' : DOCS_FILE.test(input) ? 'docs' : 'code'
  }
  if (toolName !== null && SHELL_TOOLS.has(toolName) && TEST_COMMAND.test(input)) {
    return 'tests'
  }
  return toolName !== null && PLAN_TOOLS.has(toolName) ? 'plan' : null
}

/** Where a member's ticket is in the cycle; null while it waits, stops, or does what no phase names. */
export function teamFlowPhaseOf(agent: PhaseInput): TeamFlowPhase | null {
  if (isTeamWorkFinished(agent)) {
    return 'merge'
  }
  if (agent.state !== 'working') {
    return null
  }
  if (agent.workItem?.statusGroup === 'review') {
    return 'merge'
  }
  const phase = toolPhaseOf(agent.toolName, agent.toolInput ?? '')
  if (phase && phase !== 'plan') {
    return phase
  }
  return agent.review?.state === 'open' || agent.review?.state === 'draft' ? 'pr' : phase
}
