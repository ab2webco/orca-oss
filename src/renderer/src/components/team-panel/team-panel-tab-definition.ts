import { createElement, type ComponentType, type ReactNode } from 'react'
import type {
  TeamPanelModel,
  TeamSection,
  TeamTabId
} from '../../../../shared/team-panel-model-types'

export type SelectTeamPanelTab = (tab: TeamTabId) => void

export type TeamPanelTabBodyProps<V> = {
  value: V
  model: TeamPanelModel
  selectTab: SelectTeamPanelTab
}

export type TeamPanelTabCopy = {
  emptyTitle: string
  emptyText: string
  errorTitle: string
  /** When `unavailable` means this project has none, not that the host is too old. */
  unavailable?: { title: string; text: string }
}

export type TeamPanelTabView =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string }
  | { kind: 'empty' }
  | { kind: 'ready'; render: (selectTab: SelectTeamPanelTab) => ReactNode }

export type TeamPanelResolvedTab = {
  id: TeamTabId
  title: string
  /** Shown on the tab; only Inbox has one. */
  count: number | null
  copy: TeamPanelTabCopy
  view: TeamPanelTabView
}

export type TeamPanelTabSpec<V> = {
  id: TeamTabId
  title: () => string
  /** Null hides the tab. */
  section: (model: TeamPanelModel) => TeamSection<V> | null
  isEmpty: (value: V) => boolean
  copy: () => TeamPanelTabCopy
  count?: (model: TeamPanelModel) => number | null
  Body: ComponentType<TeamPanelTabBodyProps<V>>
}

export type TeamPanelTabDefinition = {
  id: TeamTabId
  resolve: (model: TeamPanelModel) => TeamPanelResolvedTab | null
}

// Why: erases V per tab so one registry array can hold tabs with different section values.
export function defineTeamPanelTab<V>(spec: TeamPanelTabSpec<V>): TeamPanelTabDefinition {
  const viewOf = (section: TeamSection<V>, model: TeamPanelModel): TeamPanelTabView => {
    if (section.kind !== 'ready') {
      return section
    }
    if (spec.isEmpty(section.value)) {
      return { kind: 'empty' }
    }
    const value = section.value
    return {
      kind: 'ready',
      render: (selectTab) => createElement(spec.Body, { value, model, selectTab })
    }
  }
  return {
    id: spec.id,
    resolve: (model) => {
      const section = spec.section(model)
      if (!section) {
        return null
      }
      return {
        id: spec.id,
        title: spec.title(),
        count: spec.count?.(model) ?? null,
        copy: spec.copy(),
        view: viewOf(section, model)
      }
    }
  }
}
