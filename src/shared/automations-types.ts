import type { AutomationPluginOrigin } from './automation-plugin-origin'
import type { TuiAgent } from './tui-agent'
import type { SetupDecision } from './worktree/create-types'
import type { TaskSourceContext, WorkspaceRunContext } from './task-source-context'

export type AutomationWorkspaceMode = 'existing' | 'new_per_run'
export type AutomationExecutionTargetType = 'local' | 'ssh'
export type AutomationSchedulerOwner = 'local_host_service' | 'ssh_bridge' | 'remote_host_service'
export type AutomationMissedRunPolicy = 'run_once_within_grace'
export type AutomationRunStatus =
  | 'pending'
  | 'dispatching'
  | 'dispatched'
  | 'completed'
  /** El comando de una automatizacion command-only corrio y salio distinto de
   *  cero. No es `skipped_precheck` (eso es "no valia la pena correr") ni
   *  `dispatch_failed` (eso es "no se pudo lanzar"): corrio y fallo. */
  | 'command_failed'
  | 'skipped_precheck'
  | 'skipped_missed'
  | 'skipped_unavailable'
  | 'skipped_needs_interactive_auth'
  | 'dispatch_failed'
export type AutomationRunTrigger = 'scheduled' | 'manual'

/** Statuses a run can never leave; only these are safe to evict from history. */
export function isFinalAutomationRunStatus(status: AutomationRunStatus): boolean {
  return (
    status === 'completed' ||
    status === 'command_failed' ||
    status === 'dispatch_failed' ||
    status === 'skipped_precheck' ||
    status === 'skipped_missed' ||
    status === 'skipped_unavailable' ||
    status === 'skipped_needs_interactive_auth'
  )
}

export type AutomationSchedulePreset = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'custom'
export type AutomationRunUsageProvider = 'claude' | 'codex'
export type AutomationRunUsageStatus = 'known' | 'unavailable'
export type AutomationRunUsageAttribution = 'provider_session_time_window'
export type AutomationRunUsageUnavailableReason =
  | 'run_not_finished'
  | 'provider_unsupported'
  | 'remote_usage_unavailable'
  | 'usage_not_enabled'
  | 'scan_failed'
  | 'no_matching_session'
  | 'ambiguous_session'

export type AutomationRunUsage = {
  status: AutomationRunUsageStatus
  provider: AutomationRunUsageProvider | null
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  reasoningOutputTokens: number | null
  totalTokens: number | null
  estimatedCostUsd: number | null
  estimatedCostSource: 'api_equivalent' | null
  providerSessionId: string | null
  attribution: AutomationRunUsageAttribution | null
  collectedAt: number
  unavailableReason: AutomationRunUsageUnavailableReason | null
  unavailableMessage: string | null
}

export type AutomationRunOutputSnapshot = {
  format: 'plain_text'
  content: string
  capturedAt: number
  truncated: boolean
}

/** Un comando de shell con su techo de tiempo. El precheck y el comando de una
 *  automatizacion command-only son la misma forma y los corre el mismo runner
 *  (`runAutomationPrecheck`), por eso comparten tipo en vez de duplicarlo. */
export type AutomationShellCommand = {
  command: string
  timeoutSeconds: number
}

export type AutomationPrecheck = AutomationShellCommand

export type AutomationShellResult = {
  command: string
  exitCode: number | null
  timedOut: boolean
  durationMs: number
  stdout: string
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
  error: string | null
  startedAt: number
  completedAt: number
}

export type AutomationPrecheckResult = AutomationShellResult

export type Automation = {
  id: string
  name: string
  prompt: string
  precheck: AutomationPrecheck | null
  /** Agente TUI que lanza la corrida, o `null` cuando la fila es command-only.
   *  Nunca leer directo: `getAutomationAction` decide cual de las dos formas es
   *  y no admite una fila que no sea ninguna. */
  agentId: TuiAgent | null
  /** Comando que ES la corrida, o `null` cuando la fila lanza un agente.
   *  Exactamente uno de `agentId` y `command` esta presente. */
  command?: AutomationShellCommand | null
  /** Why: runContext carries the logical project + host setup identity for
   *  multi-host projects; projectId remains only as the legacy repo-id storage
   *  field for pre-host-context automations.
   *  @deprecated Use runContext.projectId/runContext.repoId or
   *  getAutomationRunRepoId(). */
  runContext?: WorkspaceRunContext | null
  /** Why: task/provider data can come from a different host/account than the
   *  workspace run target, so automations persist it separately. */
  sourceContext?: TaskSourceContext | null
  /** @deprecated Legacy repo-id compatibility field. New code should persist
   *  runContext and use getAutomationRunRepoId() for fallback reads. */
  projectId: string
  executionTargetType: AutomationExecutionTargetType
  executionTargetId: string
  schedulerOwner: AutomationSchedulerOwner
  workspaceMode: AutomationWorkspaceMode
  workspaceId: string | null
  baseBranch: string | null
  setupDecision?: SetupDecision
  reuseSession: boolean
  /** Why: a user-picked live pane to receive reuse runs; null means reuse the
   *  previous automation session. Resolvable only in the renderer store. */
  targetPaneKey?: string | null
  timezone: string
  rrule: string
  dtstart: number
  enabled: boolean
  nextRunAt: number
  lastRunAt?: number
  missedRunPolicy: AutomationMissedRunPolicy
  missedRunGraceMinutes: number
  createdAt: number
  updatedAt: number
  /** Present only on automations a plugin declared. */
  pluginOrigin?: AutomationPluginOrigin
}

export type AutomationRun = {
  id: string
  automationId: string
  runContext?: WorkspaceRunContext | null
  sourceContext?: TaskSourceContext | null
  title: string
  scheduledFor: number
  status: AutomationRunStatus
  trigger: AutomationRunTrigger
  workspaceId: string | null
  /** Why: run history must remain understandable after the backing workspace
   *  is deleted and its live metadata is gone. */
  workspaceDisplayName?: string | null
  sessionKind: 'terminal'
  chatSessionId: string | null
  terminalSessionId: string | null
  /** Why: a terminal tab can later point at a different pane/PTY. Automation
   *  run reopening must target the pane that actually executed the run. */
  terminalPaneKey: string | null
  terminalPtyId: string | null
  outputSnapshot: AutomationRunOutputSnapshot | null
  precheckResult: AutomationPrecheckResult | null
  /** Lo que hizo el comando de una corrida command-only: codigo de salida y
   *  salida acotada, en su propio campo para que el historial nunca etiquete el
   *  comando de la corrida como si fuera un precheck. */
  commandResult?: AutomationShellResult | null
  usage: AutomationRunUsage | null
  error: string | null
  startedAt: number | null
  dispatchedAt: number | null
  createdAt: number
  /** Why: run titles must stay unique once retention prunes old runs, so the
   *  number can no longer be derived from how many runs are currently kept. */
  runNumber?: number
}

type AutomationCreateBase = {
  name: string
  precheck?: AutomationPrecheck | null
  runContext?: WorkspaceRunContext | null
  sourceContext?: TaskSourceContext | null
  /** @deprecated Legacy repo-id compatibility field required for older stored
   *  automations and clients. Pair it with runContext for new writes. */
  projectId: string
  workspaceMode: AutomationWorkspaceMode
  workspaceId?: string | null
  baseBranch?: string | null
  setupDecision?: SetupDecision
  reuseSession?: boolean
  targetPaneKey?: string | null
  timezone: string
  rrule: string
  dtstart: number
  enabled?: boolean
  missedRunGraceMinutes?: number
  pluginOrigin?: AutomationPluginOrigin
}

/**
 * Una automatizacion es una de dos cosas y nunca ninguna: lanza un agente con
 * un prompt, o corre un comando. La union lo hace imposible de construir mal en
 * cada sitio que crea una fila — store, runtime, CLI y renderer — en vez de
 * dejar dos opcionales sueltos que admiten una fila que no significa nada.
 */
export type AutomationCreateInput =
  | (AutomationCreateBase & { agentId: TuiAgent; prompt: string; command?: null })
  | (AutomationCreateBase & { agentId?: null; prompt?: string; command: AutomationShellCommand })

export type AutomationUpdateInput = Partial<
  Pick<
    Automation,
    | 'name'
    | 'prompt'
    | 'precheck'
    | 'agentId'
    | 'command'
    | 'runContext'
    | 'sourceContext'
    | 'projectId'
    | 'workspaceMode'
    | 'workspaceId'
    | 'baseBranch'
    | 'setupDecision'
    | 'reuseSession'
    | 'targetPaneKey'
    | 'timezone'
    | 'rrule'
    | 'dtstart'
    | 'enabled'
    | 'missedRunGraceMinutes'
  >
> & {
  /** Solo la reconciliacion de plugins lo escribe: el esquema de
   *  `automation.update` no lo acepta, asi que ni el CLI ni un cliente remoto
   *  pueden reclamar una fila como propia de un plugin. */
  pluginOrigin?: AutomationPluginOrigin
}

export type AutomationDispatchRequest = {
  automation: Automation
  run: AutomationRun
  dispatchToken: string
}

export type AutomationDispatchResult = {
  runId: string
  status: AutomationRunStatus
  workspaceId?: string | null
  workspaceDisplayName?: string | null
  terminalSessionId?: string | null
  terminalPaneKey?: string | null
  terminalPtyId?: string | null
  outputSnapshot?: AutomationRunOutputSnapshot | null
  precheckResult?: AutomationPrecheckResult | null
  commandResult?: AutomationShellResult | null
  usage?: AutomationRunUsage | null
  error?: string | null
}

export type {
  ExternalAutomationProvider,
  ExternalAutomationManagerStatus,
  ExternalAutomationAction,
  ExternalAutomationRunStatus,
  ExternalAutomationTarget,
  ExternalAutomationJob,
  ExternalAutomationRun,
  ExternalAutomationRunsPage,
  ExternalAutomationRunsInput,
  ExternalAutomationCreateInput,
  ExternalAutomationUpdateInput,
  ExternalAutomationManager,
  ExternalAutomationActionInput
} from './external-automation-types'
