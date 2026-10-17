import { describe, expect, it } from 'vitest'

import {
  LOCALIZABLE_GENERIC_TERMS,
  overlapsCanonicalRendering
} from './locale-generic-ui-terms.mjs'
import { NEVER_TRANSLATE_VALUES, repairTranslatedValue } from './locale-translation-policy.mjs'

const repairEs = (key, enValue, localeValue) =>
  repairTranslatedValue({ key, enValue, localeValue, locale: 'es' })

// Why: #12113 — repair-locale-catalog rewrote ~2000 translated values back to English because
// generic UI words (agent, terminal, commit, repo, Continue) were treated as brands. These pin
// the boundary: generic words stay translated, real brand names stay Latin.
describe('locale generic UI terms', () => {
  it('keeps a translated generic term when the whole value is that term', () => {
    expect(
      repairEs('auto.components.settings.QuickCommandsPane.4ccc63da87', 'Agent', 'Agente')
    ).toBe('Agente')
    expect(repairEs('auto.components.mobile.MobileHero.a8fb43cf1c', 'Continue', 'Continuar')).toBe(
      'Continuar'
    )
    expect(repairEs('auto.components.example', 'Repo', 'Repositorio')).toBe('Repositorio')
  })

  it('keeps a translated generic term inside a sentence', () => {
    expect(
      repairEs(
        'auto.components.settings.ExperimentalPane.agentDashboard.toggleLabel',
        'Toggle Agent Dashboard',
        'Alternar el panel de agentes'
      )
    ).toBe('Alternar el panel de agentes')
    expect(
      repairEs(
        'components.agentSessionContinuation.dialogTitle',
        'Continue in New Session',
        'Continuar en una nueva sesión'
      )
    ).toBe('Continuar en una nueva sesión')
  })

  it('still reverts real brand names that machine translation localized', () => {
    expect(repairEs('auto.stats.StatsPane.7d26110cea', 'Codex', 'Códice')).toBe('Codex')
    expect(repairEs('auto.components.example', 'Connect to Linear', 'Conectar con lineal')).toBe(
      'Conectar con Linear'
    )
    expect(repairEs('auto.components.example', 'Open in OpenCode', 'Abrir en código abierto')).toBe(
      'Abrir en OpenCode'
    )
  })

  it('still reverts nonsense renderings of a generic term', () => {
    // Comprometerse is "to pledge", Rebaja "a discount".
    expect(
      repairEs(
        'auto.components.right.sidebar.source.control.primary.action.ed93b4f14f',
        'Commit',
        'Comprometerse'
      )
    ).toBe('Commit')
    expect(
      repairEs(
        'auto.components.LinearIssueMarkdownDescriptionEditor.d9c47069ef',
        'Markdown',
        'Rebaja'
      )
    ).toBe('Markdown')
  })

  it('does not cut a valid word that contains a reverted form', () => {
    const value = 'Abrir repositorios'
    const start = value.indexOf('repositorio')
    expect(
      overlapsCanonicalRendering('Repo', 'es', value, start, start + 'repositorio'.length)
    ).toBe(true)
    expect(overlapsCanonicalRendering('Markdown', 'es', 'Rebaja', 0, 6)).toBe(false)
  })

  it('still fills in a translation when the catalog holds English', () => {
    expect(repairEs('auto.components.example', 'Explore Orca Lab', 'Explore Orca Lab')).toBe(
      'Explorar Orca Lab'
    )
  })

  it('keeps agent catalog product names in English by key, not by word', () => {
    expect(repairEs('auto.lib.agent.catalog.9e2a9bb87b', 'Continue', 'Continuar')).toBe('Continue')
    expect(repairEs('auto.lib.agent.catalog.760bc6883d', 'Codex', 'Códice')).toBe('Codex')
  })

  it('does not list a generic term as never-translatable', () => {
    const pinned = [...LOCALIZABLE_GENERIC_TERMS].filter((term) => NEVER_TRANSLATE_VALUES.has(term))
    expect(pinned).toEqual([])
  })
})
