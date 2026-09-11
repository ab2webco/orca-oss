import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginRemoteRuntimeAction,
  endRemoteRuntimeAction,
  isRemoteRuntimeActionPending,
  resetRemoteRuntimeActionsForTests,
  subscribeToRemoteRuntimeActions,
  trackRemoteRuntimeAction
} from './web-runtime-pending-actions'

const ENV = 'web-env-1'
const OTHER_ENV = 'web-env-2'
const WT = 'repo::/worktree'
const OTHER_WT = 'repo::/otro'

beforeEach(resetRemoteRuntimeActionsForTests)

describe('remote runtime pending actions', () => {
  it('reports pending while an action is in flight', () => {
    expect(isRemoteRuntimeActionPending(ENV, WT, 'terminal')).toBe(false)

    beginRemoteRuntimeAction(ENV, WT, 'terminal')
    expect(isRemoteRuntimeActionPending(ENV, WT, 'terminal')).toBe(true)

    endRemoteRuntimeAction(ENV, WT, 'terminal')
    expect(isRemoteRuntimeActionPending(ENV, WT, 'terminal')).toBe(false)
  })

  it('counts overlapping actions so the first to finish does not clear the other', () => {
    // Con un booleano en vez de un contador, terminar la primera apagaria el
    // indicador mientras la segunda sigue en vuelo.
    beginRemoteRuntimeAction(ENV, WT, 'terminal')
    beginRemoteRuntimeAction(ENV, WT, 'terminal')

    endRemoteRuntimeAction(ENV, WT, 'terminal')
    expect(isRemoteRuntimeActionPending(ENV, WT, 'terminal')).toBe(true)

    endRemoteRuntimeAction(ENV, WT, 'terminal')
    expect(isRemoteRuntimeActionPending(ENV, WT, 'terminal')).toBe(false)
  })

  it('keeps each workspace, host and kind separate', () => {
    beginRemoteRuntimeAction(ENV, WT, 'terminal')

    expect(isRemoteRuntimeActionPending(ENV, WT, 'browser')).toBe(false)
    expect(isRemoteRuntimeActionPending(ENV, OTHER_WT, 'terminal')).toBe(false)
    expect(isRemoteRuntimeActionPending(OTHER_ENV, WT, 'terminal')).toBe(false)
  })

  it('reports nothing pending without a host or a workspace', () => {
    // Un workspace local no tiene entorno: ahi el indicador no debe levantarse
    // nunca, porque la tab aparece al instante.
    beginRemoteRuntimeAction(ENV, WT, 'terminal')

    expect(isRemoteRuntimeActionPending(null, WT, 'terminal')).toBe(false)
    expect(isRemoteRuntimeActionPending(ENV, null, 'terminal')).toBe(false)
  })

  it('notifies subscribers on both edges', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToRemoteRuntimeActions(listener)

    beginRemoteRuntimeAction(ENV, WT, 'terminal')
    endRemoteRuntimeAction(ENV, WT, 'terminal')
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    beginRemoteRuntimeAction(ENV, WT, 'terminal')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('clears the indicator when the tracked action rejects', async () => {
    // Sin el `finally`, un rechazo dejaria el contador arriba y el spinner
    // girando para siempre, con el boton inutilizable.
    await expect(
      trackRemoteRuntimeAction(ENV, WT, 'terminal', () => Promise.reject(new Error('boom')))
    ).rejects.toThrow('boom')

    expect(isRemoteRuntimeActionPending(ENV, WT, 'terminal')).toBe(false)
  })

  it('holds the indicator up for the whole tracked call', async () => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const tracked = trackRemoteRuntimeAction(ENV, WT, 'browser', () => pending)

    expect(isRemoteRuntimeActionPending(ENV, WT, 'browser')).toBe(true)

    release()
    await tracked
    expect(isRemoteRuntimeActionPending(ENV, WT, 'browser')).toBe(false)
  })
})
