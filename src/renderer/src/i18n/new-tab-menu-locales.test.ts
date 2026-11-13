import { describe, expect, it } from 'vitest'
import es from './locales/es.json'

// Why (ORCA-717): the + menu read 'Ajustes de Agents…', half English beside its 'Agentes' heading.
describe('+ menu Spanish locale', () => {
  it('names the agent settings row in Spanish', () => {
    expect(es.auto.components.tab.bar.QuickLaunchButton['348a04c1ad']).toBe('Ajustes de agentes…')
  })
})
