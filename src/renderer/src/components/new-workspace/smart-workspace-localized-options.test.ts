import { beforeEach, describe, expect, it } from 'vitest'

import { i18n } from '@/i18n/i18n'
import { getMrStateFilters, getSmartWorkspaceNameModes } from './smart-workspace-localized-options'

describe('smart-workspace-localized-options', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('refreshes create-workspace source tabs when the UI language changes', async () => {
    expect(getSmartWorkspaceNameModes().map((mode) => mode.label)).toEqual([
      'Smart',
      'GitHub',
      'Linear',
      'Jira',
      'GitLab',
      'Branch',
      'Name'
    ])

    await i18n.changeLanguage('es')

    expect(getSmartWorkspaceNameModes().map((mode) => mode.label)).toEqual([
      'Inteligente',
      'GitHub',
      'Linear',
      'Jira',
      'GitLab',
      'Rama',
      'Nombre'
    ])

    await i18n.changeLanguage('en')

    expect(getSmartWorkspaceNameModes().map((mode) => mode.label)).toEqual([
      'Smart',
      'GitHub',
      'Linear',
      'Jira',
      'GitLab',
      'Branch',
      'Name'
    ])
  })

  it('refreshes GitLab state filters when the UI language changes', async () => {
    expect(getMrStateFilters().map((filter) => filter.label)).toEqual([
      'Open',
      'Merged',
      'Closed',
      'All'
    ])

    await i18n.changeLanguage('es')

    expect(getMrStateFilters().map((filter) => filter.label)).toEqual([
      'Abierto',
      'Fusionado',
      'Cerrado',
      'Todo'
    ])
  })
})
