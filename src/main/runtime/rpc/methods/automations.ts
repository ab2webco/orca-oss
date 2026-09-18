import { z } from 'zod'
import { isValidAutomationSchedule } from '../../../../shared/automation-schedules'
import {
  MAX_AUTOMATION_PRECHECK_TIMEOUT_SECONDS,
  normalizeAutomationPrecheckTimeoutSeconds
} from '../../../../shared/automation-precheck'
import {
  MAX_AUTOMATION_COMMAND_TIMEOUT_SECONDS,
  normalizeAutomationCommandTimeoutSeconds
} from '../../../../shared/automation-command-run'
import { normalizeExecutionHostId } from '../../../../shared/execution-host'
import type { TaskProviderIdentity as SharedTaskProviderIdentity } from '../../../../shared/task-source-context'
import { isTuiAgent } from '../../../../shared/tui-agent-config'
import { defineMethod, type RpcMethod } from '../core'
import {
  OptionalBoolean,
  OptionalPlainString,
  OptionalPositiveInt,
  OptionalString,
  requiredNumber,
  requiredString
} from '../schemas'

const TuiAgent = requiredString('Missing provider').refine(isTuiAgent, {
  message: 'Unknown provider'
})

const AutomationWorkspaceMode = z.enum(['existing', 'new_per_run']).optional()
const SetupDecision = z.enum(['inherit', 'run', 'skip']).optional()
const ExecutionHostId = requiredString('Missing host id').transform((value, ctx) => {
  const hostId = normalizeExecutionHostId(value)
  if (!hostId) {
    ctx.addIssue({ code: 'custom', message: 'Invalid host id' })
    return z.NEVER
  }
  return hostId
})

const AutomationSchedule = requiredString('Missing trigger').refine(isValidAutomationSchedule, {
  message: 'Invalid automation trigger'
})

const AutomationPrecheck = z
  .object({
    command: requiredString('Missing precheck command'),
    timeoutSeconds: OptionalPositiveInt.transform((value) =>
      normalizeAutomationPrecheckTimeoutSeconds(value)
    ).refine((value) => value <= MAX_AUTOMATION_PRECHECK_TIMEOUT_SECONDS, {
      message: 'Precheck timeout is too large'
    })
  })
  .nullable()
  .optional()

const AutomationCommand = z
  .object({
    command: requiredString('Missing automation command'),
    timeoutSeconds: OptionalPositiveInt.transform((value) =>
      normalizeAutomationCommandTimeoutSeconds(value)
    ).refine((value) => value <= MAX_AUTOMATION_COMMAND_TIMEOUT_SECONDS, {
      message: 'Command timeout is too large'
    })
  })
  .nullable()
  .optional()

const OptionalNullablePlainString = z
  .unknown()
  .transform((value) => (value === null || typeof value === 'string' ? value : undefined))
  .pipe(z.union([z.string(), z.null(), z.undefined()]))
  .optional()

const TaskProviderIdentity = z
  .custom<SharedTaskProviderIdentity>(
    (value) =>
      value !== null &&
      typeof value === 'object' &&
      'provider' in value &&
      ['github', 'gitlab', 'linear', 'jira'].includes(String(value.provider))
  )
  .optional()
  .nullable()

const TaskSourceContext = z
  .object({
    kind: z.literal('task-source'),
    provider: z.enum(['github', 'gitlab', 'linear', 'jira']),
    projectId: requiredString('Missing source project id'),
    hostId: ExecutionHostId,
    projectHostSetupId: OptionalNullablePlainString,
    repoId: OptionalNullablePlainString,
    providerIdentity: TaskProviderIdentity,
    accountLabel: OptionalNullablePlainString
  })
  .optional()
  .nullable()

const WorkspaceRunContext = z
  .object({
    kind: z.literal('workspace-run'),
    projectId: requiredString('Missing run project id'),
    hostId: ExecutionHostId,
    projectHostSetupId: requiredString('Missing project host setup id'),
    repoId: requiredString('Missing repo id'),
    path: requiredString('Missing run path')
  })
  .optional()
  .nullable()

const AutomationId = z.object({
  id: requiredString('Missing automation id')
})

const AutomationRuns = z.object({
  automationId: OptionalString
})

const AutomationCreate = z
  .object({
    name: requiredString('Missing automation name'),
    prompt: OptionalString,
    precheck: AutomationPrecheck,
    command: AutomationCommand,
    agentId: TuiAgent.optional(),
    runContext: WorkspaceRunContext,
    sourceContext: TaskSourceContext,
    repo: OptionalString,
    workspace: OptionalString,
    workspaceMode: AutomationWorkspaceMode,
    baseBranch: OptionalPlainString,
    setupDecision: SetupDecision,
    reuseSession: OptionalBoolean,
    targetPaneKey: OptionalNullablePlainString,
    timezone: OptionalString,
    rrule: AutomationSchedule,
    dtstart: requiredNumber('Missing trigger start time'),
    enabled: OptionalBoolean,
    missedRunGraceMinutes: OptionalPositiveInt
  })
  // Una automatizacion es una de dos cosas y nunca ninguna: el tipo lo exige en
  // proceso, esto lo exige en el cable.
  .refine((params) => Boolean(params.command) !== Boolean(params.agentId), {
    message: 'Pass either a command to run or an agent to launch, not both and not neither'
  })
  .refine((params) => Boolean(params.command) || Boolean(params.prompt?.trim()), {
    message: 'Missing automation prompt'
  })

const AutomationUpdateFields = z.object({
  name: OptionalString,
  prompt: OptionalString,
  precheck: AutomationPrecheck,
  agentId: TuiAgent.optional(),
  command: AutomationCommand,
  runContext: WorkspaceRunContext,
  sourceContext: TaskSourceContext,
  repo: OptionalString,
  workspace: OptionalString,
  workspaceMode: AutomationWorkspaceMode,
  // Why: update patches distinguish omitted from null so callers can clear a saved base branch.
  baseBranch: OptionalNullablePlainString,
  setupDecision: SetupDecision,
  reuseSession: OptionalBoolean,
  // Why: update patches distinguish omitted from null so callers can clear a saved target pane.
  targetPaneKey: OptionalNullablePlainString,
  timezone: OptionalString,
  rrule: AutomationSchedule.optional(),
  dtstart: requiredNumber('Missing trigger start time').optional(),
  enabled: OptionalBoolean,
  missedRunGraceMinutes: OptionalPositiveInt
})

const AutomationUpdate = z.object({
  id: requiredString('Missing automation id'),
  updates: AutomationUpdateFields
})

export const AUTOMATION_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'automation.list',
    params: null,
    handler: (_params, { runtime }) => ({ automations: runtime.listAutomations() })
  }),
  defineMethod({
    name: 'automation.show',
    params: AutomationId,
    handler: (params, { runtime }) => ({ automation: runtime.showAutomation(params.id) })
  }),
  defineMethod({
    name: 'automation.create',
    params: AutomationCreate,
    handler: async (params, { runtime }) => {
      const { command, agentId, prompt, ...rest } = params
      // El refine del esquema ya garantizo que hay exactamente una forma; esto
      // solo se la muestra al tipo.
      return {
        automation: await runtime.createAutomation(
          command
            ? { ...rest, command }
            : { ...rest, agentId: agentId as NonNullable<typeof agentId>, prompt: prompt ?? '' }
        )
      }
    }
  }),
  defineMethod({
    name: 'automation.update',
    params: AutomationUpdate,
    handler: async (params, { runtime }) => ({
      automation: await runtime.updateAutomation(params.id, params.updates)
    })
  }),
  defineMethod({
    name: 'automation.delete',
    params: AutomationId,
    handler: (params, { runtime }) => runtime.deleteAutomation(params.id)
  }),
  defineMethod({
    name: 'automation.runNow',
    params: AutomationId,
    handler: async (params, { runtime }) => ({ run: await runtime.runAutomationNow(params.id) })
  }),
  defineMethod({
    name: 'automation.runs',
    params: AutomationRuns,
    handler: (params, { runtime }) => ({
      runs: runtime.listAutomationRuns(params.automationId)
    })
  })
]
