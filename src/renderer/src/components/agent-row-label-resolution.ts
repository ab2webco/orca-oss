import {
  getAgentRowConversationName,
  type ConversationNameTab
} from '../../../shared/agent-row-conversation-name'
import { parsePaneKey } from '../../../shared/stable-pane-id'
import { DASHBOARD_MAX_LABEL_LENGTH } from '../../../shared/dashboard-snapshot'
import { getAgentRowPrimaryText } from '@/lib/agent-row-primary-text'
import type { DashboardAgentRow } from './dashboard/useDashboardData'

export type AgentRowLabelInput = {
  readonly paneKey: string
  readonly groupKey: string
  readonly conversationName: string | null
  readonly ownText: string
  readonly agentType: string
}

export function agentRowOwnsConversationName(row: DashboardAgentRow): boolean {
  const parentPaneKey = row.entry.orchestration?.parentPaneKey
  const usesParentTab =
    row.lineage?.depth === 1 &&
    parentPaneKey !== undefined &&
    parsePaneKey(parentPaneKey)?.tabId === row.tab.id
  return row.rowSource !== 'subagent' && !usesParentTab
}

export function resolveAgentRowConversationName(
  row: DashboardAgentRow,
  generatedTitlesEnabled: boolean,
  tab: ConversationNameTab = row.tab
): string | null {
  if (!agentRowOwnsConversationName(row)) {
    return null
  }
  return getAgentRowConversationName(tab, row.agentType, generatedTitlesEnabled)
}

function buildAgentRowLabelInputs(
  rows: readonly DashboardAgentRow[],
  generatedTitlesEnabled: boolean
): AgentRowLabelInput[] {
  return rows.map((row) => ({
    paneKey: row.paneKey,
    groupKey: `${row.rowSource === 'subagent' ? 'synthetic' : 'pane'}:${row.tab.id}`,
    conversationName: resolveAgentRowConversationName(row, generatedTitlesEnabled),
    ownText: getAgentRowPrimaryText(row.entry),
    agentType: row.agentType
  }))
}

function withoutBlanks(value: string): string {
  return value.trim()
}

function boundDashboardLabel(label: string, suffix = ''): string {
  if (suffix) {
    return `${label.slice(0, DASHBOARD_MAX_LABEL_LENGTH - suffix.length)}${suffix}`
  }
  if (label.length <= DASHBOARD_MAX_LABEL_LENGTH) {
    return label
  }
  const ordinal = label.match(/ \(\d+\)$/)?.[0] ?? ''
  return `${label.slice(0, DASHBOARD_MAX_LABEL_LENGTH - ordinal.length)}${ordinal}`
}

function hasDuplicateOrBlank(values: readonly string[]): boolean {
  const seen = new Set<string>()
  for (const value of values) {
    if (value === '' || seen.has(value)) {
      return true
    }
    seen.add(value)
  }
  return false
}

function resolveLabelGroup(rows: readonly AgentRowLabelInput[]): Map<string, string> {
  const labels = new Map<string, string>()
  if (rows.length === 1) {
    const row = rows[0]!
    labels.set(
      row.paneKey,
      withoutBlanks(row.conversationName ?? '') || withoutBlanks(row.ownText) || row.agentType
    )
    return labels
  }

  const own = rows.map((row) => withoutBlanks(row.ownText))
  if (!hasDuplicateOrBlank(own)) {
    rows.forEach((row, index) => labels.set(row.paneKey, own[index]!))
    return labels
  }

  const counts = new Map<string, number>()
  rows.forEach((row, index) => {
    const base = own[index] || withoutBlanks(row.conversationName ?? '') || row.agentType
    counts.set(base, (counts.get(base) ?? 0) + 1)
  })
  const occurrences = new Map<string, number>()
  const used = new Set<string>()
  rows.forEach((row, index) => {
    const base = own[index] || withoutBlanks(row.conversationName ?? '') || row.agentType
    let nth = (occurrences.get(base) ?? 0) + 1
    let label = counts.get(base) === 1 ? base : `${base} (${nth})`
    while (used.has(label)) {
      nth += 1
      label = `${base} (${nth})`
    }
    occurrences.set(base, nth)
    used.add(label)
    labels.set(row.paneKey, label)
  })
  return labels
}

/** Resolves pane labels together because uniqueness is a property of a tab. */
export function resolveAgentRowLabels(
  rows: readonly AgentRowLabelInput[]
): ReadonlyMap<string, string> {
  const groups = new Map<string, AgentRowLabelInput[]>()
  for (const row of rows) {
    const group = groups.get(row.groupKey)
    if (group) {
      group.push(row)
    } else {
      groups.set(row.groupKey, [row])
    }
  }
  const labels = new Map<string, string>()
  for (const group of groups.values()) {
    for (const [paneKey, label] of resolveLabelGroup(group)) {
      labels.set(paneKey, label)
    }
  }
  return labels
}

export function resolveRenderedAgentRowLabels(
  rows: readonly DashboardAgentRow[],
  generatedTitlesEnabled: boolean
): ReadonlyMap<string, string> {
  return resolveAgentRowLabels(buildAgentRowLabelInputs(rows, generatedTitlesEnabled))
}

export function resolveDashboardAgentRowLabels(
  rows: readonly DashboardAgentRow[],
  generatedTitlesEnabled: boolean
): ReadonlyMap<string, string> {
  const inputs = buildAgentRowLabelInputs(rows, generatedTitlesEnabled)
  const groupSizes = new Map<string, number>()
  for (const input of inputs) {
    groupSizes.set(input.groupKey, (groupSizes.get(input.groupKey) ?? 0) + 1)
  }
  const resolved = resolveAgentRowLabels(inputs)
  const labels = new Map<string, string>()
  const groups = new Map<string, AgentRowLabelInput[]>()
  for (const input of inputs) {
    const group = groups.get(input.groupKey)
    if (group) {
      group.push(input)
    } else {
      groups.set(input.groupKey, [input])
    }
  }
  for (const [groupKey, group] of groups) {
    const boundedByPane = new Map<string, string>()
    const counts = new Map<string, number>()
    for (const input of group) {
      const raw =
        groupSizes.get(groupKey) === 1 ? input.conversationName : resolved.get(input.paneKey)
      const bounded = raw ? boundDashboardLabel(raw) : ''
      boundedByPane.set(input.paneKey, bounded)
      if (bounded) {
        counts.set(bounded, (counts.get(bounded) ?? 0) + 1)
      }
    }
    const occurrences = new Map<string, number>()
    const used = new Set<string>()
    for (const input of group) {
      const base = boundedByPane.get(input.paneKey) ?? ''
      if (!base) {
        continue
      }
      let nth = (occurrences.get(base) ?? 0) + 1
      let label = counts.get(base) === 1 ? base : boundDashboardLabel(base, ` (${nth})`)
      while (used.has(label)) {
        nth += 1
        label = boundDashboardLabel(base, ` (${nth})`)
      }
      occurrences.set(base, nth)
      used.add(label)
      labels.set(input.paneKey, label)
    }
  }
  return labels
}
