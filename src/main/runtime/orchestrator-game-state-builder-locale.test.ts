import { describe, expect, it } from 'vitest'
import type { UiLanguage } from '../../shared/ui-language'
import { buildOrchestratorGameState } from './orchestrator-game-state-builder'

const none = async () => null

const stateWith = (uiLanguage: UiLanguage | undefined, systemLocale: string) =>
  buildOrchestratorGameState({
    settings: uiLanguage === undefined ? undefined : { uiLanguage },
    systemLocale,
    worktree: null,
    agents: [],
    leaderPaneKey: null,
    readReview: none,
    readPlane: none,
    readLinear: none
  })

// Why: the pane's ORCA_GAME_LOCALE is fixed at launch; the state is how a running pane hears a change.
describe('the UI language the game state hands the mod', () => {
  it('sends the chosen language, resolving the system choice from the OS locale', async () => {
    expect((await stateWith('es', 'en-US')).locale).toBe('es')
    expect((await stateWith('en', 'es-CO')).locale).toBe('en')
    expect((await stateWith('system', 'es-CO')).locale).toBe('es')
    expect((await stateWith(undefined, 'es-CO')).locale).toBe('es')
  })

  it('sends English for a language the game does not ship', async () => {
    expect((await stateWith('system', 'fr-FR')).locale).toBe('en')
  })
})
