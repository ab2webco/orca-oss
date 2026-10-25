import { randomUUID } from 'node:crypto'
import type {
  Automation,
  AutomationCreateInput,
  AutomationUpdateInput
} from '../../../shared/automations-types'
import type { PersistedState } from '../../../shared/persisted-state-types'
import { normalizeAutomationCommand } from '../../../shared/automation-command-run'
import { normalizeAutomationPrecheck } from '../../../shared/automation-precheck'
import { nextAutomationOccurrenceAfter } from '../../../shared/automation-schedules'
import type { StoreOwnedPersistedState } from '../loading-store/store-owned-state'
import {
  getAutomationContextsForRepo,
  getAutomationSchedulerOwner,
  normalizeAutomationSessionReuse,
  normalizeAutomationSetupDecisionForWorkspaceMode
} from './automation-context-migration'

export type AutomationDefinitionOperations = {
  state: StoreOwnedPersistedState
  flush: () => void
  recordCreated: () => void
}

export function listAutomations(state: PersistedState): Automation[] {
  return (state.automations ?? [])
    .map((automation) => normalizeAutomationSessionReuse(automation))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function normalizeAutomationAccountPin(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/** Rows a given plugin declared. Identity, not name matching: renaming an
 *  automation in the UI must not detach it from its plugin. */
export function listAutomationsByPlugin(state: PersistedState, pluginKey: string): Automation[] {
  return (state.automations ?? []).filter(
    (automation) => automation.pluginOrigin?.pluginKey === pluginKey
  )
}

export function createAutomation(
  operations: AutomationDefinitionOperations,
  input: AutomationCreateInput
): Automation {
  const command = normalizeAutomationCommand(input.command)
  // Una fila que no lanza agente ni corre comando no significa nada. Los
  // tipos ya lo impiden; esto atrapa una carga RPC/persistida deformada.
  if (!command && !input.agentId) {
    throw new Error('An automation needs either a command to run or an agent to launch.')
  }
  const repo = operations.state.repos.find((entry) => entry.id === input.projectId)
  const now = Date.now()
  const executionTargetType = repo?.connectionId ? 'ssh' : 'local'
  const schedulerOwner = getAutomationSchedulerOwner(repo)
  const contexts = getAutomationContextsForRepo(repo, operations.state.projectHostSetups ?? [])
  const automation: Automation = {
    id: randomUUID(),
    name: input.name.trim() || 'Untitled automation',
    prompt: input.prompt ?? '',
    precheck: normalizeAutomationPrecheck(input.precheck),
    // Un comando gana sobre el agente: la union de entrada no deja declarar
    // los dos, y si una carga vieja trae ambos, correr el comando es lo
    // barato y reversible.
    agentId: command ? null : (input.agentId ?? null),
    command,
    runContext: input.runContext ?? contexts.runContext,
    sourceContext: input.sourceContext ?? contexts.sourceContext,
    projectId: input.projectId,
    executionTargetType,
    executionTargetId: executionTargetType === 'ssh' ? (repo?.connectionId ?? '') : 'local',
    schedulerOwner,
    workspaceMode: input.workspaceMode,
    // Una fila command-only no abre workspace: el comando corre en el
    // directorio del proyecto, asi que no puede reclamar uno ni una sesion.
    workspaceId:
      !command && input.workspaceMode === 'existing' ? (input.workspaceId ?? null) : null,
    baseBranch: input.workspaceMode === 'new_per_run' ? (input.baseBranch ?? null) : null,
    setupDecision: normalizeAutomationSetupDecisionForWorkspaceMode(
      input.workspaceMode,
      input.setupDecision
    ),
    reuseSession:
      !command && input.workspaceMode === 'existing' ? (input.reuseSession ?? false) : false,
    targetPaneKey:
      !command && input.workspaceMode === 'existing' && input.reuseSession === true
        ? (input.targetPaneKey ?? null)
        : null,
    claudeAccountId: command ? null : normalizeAutomationAccountPin(input.claudeAccountId),
    codexAccountId: command ? null : normalizeAutomationAccountPin(input.codexAccountId),
    timezone: input.timezone,
    rrule: input.rrule,
    dtstart: input.dtstart,
    enabled: input.enabled ?? true,
    nextRunAt: nextAutomationOccurrenceAfter(input.rrule, input.dtstart, now),
    missedRunPolicy: 'run_once_within_grace',
    missedRunGraceMinutes: input.missedRunGraceMinutes ?? 720,
    createdAt: now,
    updatedAt: now,
    ...(input.pluginOrigin ? { pluginOrigin: input.pluginOrigin } : {})
  }
  operations.state.automations = [...(operations.state.automations ?? []), automation]
  operations.recordCreated()
  operations.flush()
  return automation
}

export function updateAutomation(
  operations: AutomationDefinitionOperations,
  id: string,
  updates: AutomationUpdateInput
): Automation {
  const index = (operations.state.automations ?? []).findIndex((entry) => entry.id === id)
  if (index === -1) {
    throw new Error('Automation not found.')
  }
  const current = operations.state.automations[index]
  const nextCommand = Object.hasOwn(updates, 'command')
    ? normalizeAutomationCommand(updates.command)
    : (current.command ?? null)
  const nextAgentId = nextCommand
    ? null
    : Object.hasOwn(updates, 'agentId')
      ? (updates.agentId ?? current.agentId)
      : current.agentId
  if (!nextCommand && !nextAgentId) {
    throw new Error('An automation needs either a command to run or an agent to launch.')
  }
  const repoId = updates.projectId ?? current.projectId
  const repo = operations.state.repos.find((entry) => entry.id === repoId)
  const executionTargetType = repo?.connectionId ? 'ssh' : 'local'
  const schedulerOwner = getAutomationSchedulerOwner(repo)
  const contexts = getAutomationContextsForRepo(repo, operations.state.projectHostSetups ?? [])
  const rrule = updates.rrule ?? current.rrule
  const dtstart = updates.dtstart ?? current.dtstart
  const scheduleChanged = updates.rrule !== undefined || updates.dtstart !== undefined
  const workspaceMode = updates.workspaceMode ?? current.workspaceMode
  const nextWorkspaceId =
    !nextCommand && workspaceMode === 'existing'
      ? Object.hasOwn(updates, 'workspaceId')
        ? (updates.workspaceId ?? null)
        : current.workspaceId
      : null
  const nextReuseSession =
    !nextCommand && workspaceMode === 'existing'
      ? (updates.reuseSession ?? current.reuseSession ?? false)
      : false
  const updated: Automation = {
    ...current,
    ...updates,
    name: updates.name !== undefined ? updates.name.trim() || 'Untitled automation' : current.name,
    precheck: Object.hasOwn(updates, 'precheck')
      ? normalizeAutomationPrecheck(updates.precheck)
      : normalizeAutomationPrecheck(current.precheck),
    agentId: nextAgentId,
    command: nextCommand,
    projectId: repoId,
    runContext: Object.hasOwn(updates, 'runContext')
      ? (updates.runContext ?? null)
      : updates.projectId !== undefined
        ? contexts.runContext
        : (current.runContext ?? contexts.runContext),
    sourceContext: Object.hasOwn(updates, 'sourceContext')
      ? (updates.sourceContext ?? null)
      : updates.projectId !== undefined
        ? contexts.sourceContext
        : (current.sourceContext ?? contexts.sourceContext),
    executionTargetType,
    executionTargetId: executionTargetType === 'ssh' ? (repo?.connectionId ?? '') : 'local',
    schedulerOwner,
    workspaceMode,
    workspaceId: nextWorkspaceId,
    baseBranch:
      workspaceMode === 'new_per_run'
        ? Object.hasOwn(updates, 'baseBranch')
          ? (updates.baseBranch ?? null)
          : (current.baseBranch ?? null)
        : null,
    setupDecision:
      workspaceMode === 'new_per_run'
        ? Object.hasOwn(updates, 'setupDecision')
          ? normalizeAutomationSetupDecisionForWorkspaceMode(workspaceMode, updates.setupDecision)
          : normalizeAutomationSetupDecisionForWorkspaceMode(workspaceMode, current.setupDecision)
        : undefined,
    reuseSession: nextReuseSession,
    // Why: a pane key is bound to one workspace, so repointing the automation
    // must drop it rather than leave a target that can never resolve.
    targetPaneKey: !nextReuseSession
      ? null
      : Object.hasOwn(updates, 'targetPaneKey')
        ? (updates.targetPaneKey ?? null)
        : nextWorkspaceId !== current.workspaceId
          ? null
          : (current.targetPaneKey ?? null),
    claudeAccountId: nextCommand
      ? null
      : Object.hasOwn(updates, 'claudeAccountId')
        ? normalizeAutomationAccountPin(updates.claudeAccountId)
        : normalizeAutomationAccountPin(current.claudeAccountId),
    codexAccountId: nextCommand
      ? null
      : Object.hasOwn(updates, 'codexAccountId')
        ? normalizeAutomationAccountPin(updates.codexAccountId)
        : normalizeAutomationAccountPin(current.codexAccountId),
    rrule,
    dtstart,
    nextRunAt: scheduleChanged
      ? nextAutomationOccurrenceAfter(rrule, dtstart, Date.now())
      : current.nextRunAt,
    updatedAt: Date.now()
  }
  operations.state.automations[index] = updated
  operations.flush()
  return updated
}

export function deleteAutomation(operations: AutomationDefinitionOperations, id: string): void {
  operations.state.automations = (operations.state.automations ?? []).filter(
    (entry) => entry.id !== id
  )
  operations.state.automationRuns = (operations.state.automationRuns ?? []).filter(
    (entry) => entry.automationId !== id
  )
  operations.flush()
}
