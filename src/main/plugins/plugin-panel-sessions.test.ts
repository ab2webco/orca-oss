import { describe, expect, it } from 'vitest'
import { PluginPanelSessions } from './plugin-panel-sessions'

const binding = {
  pluginKey: 'orca-samples.demo',
  panelId: 'dashboard',
  rootDir: '/plugins/orca-samples.demo/hash-one',
  manifestRevision: 'manifest-v1'
}

describe('PluginPanelSessions', () => {
  it('binds an opaque token to its transport owner and panel revision', () => {
    const sessions = new PluginPanelSessions()
    const token = sessions.issue('renderer:1', binding)

    expect(token).toHaveLength(43)
    expect(sessions.resolve('renderer:1', token)).toEqual(binding)
    expect(sessions.resolve('renderer:2', token)).toBeNull()
    expect(sessions.issue('renderer:1', binding)).toBe(token)
    expect(sessions.issue('renderer:1', { ...binding, rootDir: '/plugins/new' })).not.toBe(token)
    expect(sessions.issue('renderer:1', { ...binding, manifestRevision: 'manifest-v2' })).not.toBe(
      token
    )
  })

  it('revokes every session owned by a disconnected transport', () => {
    const sessions = new PluginPanelSessions()
    const first = sessions.issue('connection:one', binding)
    const second = sessions.issue('connection:one', { ...binding, panelId: 'secondary' })
    const other = sessions.issue('connection:two', binding)

    sessions.revokeOwner('connection:one')

    expect(sessions.resolve('connection:one', first)).toBeNull()
    expect(sessions.resolve('connection:one', second)).toBeNull()
    expect(sessions.resolve('connection:two', other)).toEqual(binding)
  })

  it('releases one session only for the owner that holds it', () => {
    const sessions = new PluginPanelSessions()
    const board = sessions.issue('connection:one', binding)
    const settings = sessions.issue('connection:one', { ...binding, panelId: 'settings' })

    expect(sessions.release('connection:two', board)).toBe(false)
    expect(sessions.resolve('connection:one', board)).toEqual(binding)

    expect(sessions.release('connection:one', board)).toBe(true)
    expect(sessions.resolve('connection:one', board)).toBeNull()
    expect(sessions.resolve('connection:one', settings)).not.toBeNull()
    // A released binding re-opens with a fresh token, never the dead one.
    expect(sessions.issue('connection:one', binding)).not.toBe(board)
  })
})
