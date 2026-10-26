import type { AgentCatalogEntry } from '@/lib/agent-catalog'
import type { GlobalWindowsRuntimeDefault } from '../../../../shared/project-execution-runtime'
import type { TuiAgent } from '../../../../shared/tui-agent'
import {
  TUI_AGENT_CONFIG,
  type TuiAgentDetectionRuntime
} from '../../../../shared/tui-agent-config'

export type AgentsPanePartition = {
  detected: AgentCatalogEntry[]
  inProcess: AgentCatalogEntry[]
  available: AgentCatalogEntry[]
}

/** The runtime whose detection the pane lists, or null when it is not a Windows host's local runtime. */
export function resolveAgentsPaneDetectionRuntime(args: {
  hostIsWindows: boolean
  activeServerEnvironmentId: string | null
  localWindowsRuntimeDefault: GlobalWindowsRuntimeDefault
}): TuiAgentDetectionRuntime | null {
  // Why: a remote server's platform is not known to the client, so its list keeps the default behavior.
  if (!args.hostIsWindows || args.activeServerEnvironmentId) {
    return null
  }
  return args.localWindowsRuntimeDefault.kind === 'wsl' ? 'wsl' : 'win32'
}

/**
 * Splits the catalog into the three Settings → Agents lists.
 * Why: an agent whose detection is unsupported on a runtime runs in-process there, so it is not "available to install".
 */
export function partitionAgentCatalogForPane(args: {
  catalog: readonly AgentCatalogEntry[]
  detectedIds: ReadonlySet<string> | null
  runtime: TuiAgentDetectionRuntime | null
}): AgentsPanePartition {
  if (args.detectedIds === null) {
    return { detected: [], inProcess: [], available: [] }
  }
  const detectedIds = args.detectedIds
  const detected = args.catalog.filter((agent) => detectedIds.has(agent.id))
  const notDetected = args.catalog.filter((agent) => !detectedIds.has(agent.id))
  return {
    detected,
    inProcess: notDetected.filter((agent) => runsInProcessOn(agent.id, args.runtime)),
    available: notDetected.filter((agent) => !runsInProcessOn(agent.id, args.runtime))
  }
}

function runsInProcessOn(agentId: TuiAgent, runtime: TuiAgentDetectionRuntime | null): boolean {
  if (!runtime) {
    return false
  }
  return TUI_AGENT_CONFIG[agentId].detectUnsupportedRuntimes?.includes(runtime) === true
}
