import { afterEach, describe, expect, it } from 'vitest'
import { i18n } from '@/i18n/i18n'
import {
  buildHostDisplayRegistry,
  hostDisplayLabel,
  localHostDisplayLabel
} from './local-host-display-label'

afterEach(async () => {
  await i18n.changeLanguage('en')
})

// Why (ORCA-1149): the owner asked for the local machine to read 'This computer', not 'Local Mac'.
describe('local host display label', () => {
  it('names the local machine This computer', () => {
    expect(localHostDisplayLabel()).toBe('This computer')
    expect(hostDisplayLabel('local')).toBe('This computer')
  })

  it('names it Este equipo in Spanish', async () => {
    await i18n.changeLanguage('es')
    expect(hostDisplayLabel('local')).toBe('Este equipo')
  })

  it('leaves other hosts as the shared label names them', () => {
    expect(hostDisplayLabel('ssh:devbox')).toBe('devbox')
    expect(hostDisplayLabel('all')).toBe('All hosts')
  })

  it('labels the registry local entry This computer and keeps the platform as its detail', () => {
    const [local] = buildHostDisplayRegistry({ repos: [], settings: null })
    expect(local.label).toBe('This computer')
    expect(local.detail).not.toBe('This computer')
  })

  it('lets a user-set name for the local host win', () => {
    const [local] = buildHostDisplayRegistry({
      repos: [],
      settings: null,
      hostLabelOverrides: new Map([['local', 'Studio']])
    })
    expect(local.label).toBe('Studio')
  })
})
