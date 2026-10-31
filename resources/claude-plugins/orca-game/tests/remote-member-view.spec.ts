import { afterEach, describe, expect, it } from 'vitest'

import { setGameLocale } from '../hooks/game-strings'
import { remoteViewNoticeOf } from '../hooks/remote-member-view'
import type { GameAgent } from '../types'

afterEach(() => setGameLocale('en'))

const member = (
  remote?: { host: string; stateKnown: boolean; gone?: true },
  state: GameAgent['state'] = 'idle'
) => ({
  paneKey: remote ? 'remote:ctx_826' : 'tab:1',
  displayName: 'ORCA-826 restart',
  state,
  ...(remote ? { remote } : {})
})

// Why: View on a remote member focused its host's handle locally and always failed (ORCA-790).
describe('View on a remote member', () => {
  it('leaves a local member to the terminal focus', () => {
    expect(remoteViewNoticeOf(member())).toBeNull()
  })

  it('says a gone member no longer exists, and how to rebind or free it (CIN-1297)', () => {
    expect(remoteViewNoticeOf(member({ host: 'imac', stateKnown: false, gone: true }))).toBe(
      'ORCA-826 restart no longer exists on imac; if it runs on in another terminal there: orca game rebind, else orca game stop'
    )
  })

  // Why: a finished member's closed terminal is how it ends, not something to free (ORCA-854).
  it('says a finished member whose terminal closed finished on its host', () => {
    const closed = member({ host: 'imac', stateKnown: true, gone: true }, 'done')
    expect(remoteViewNoticeOf(closed)).toBe(
      'ORCA-826 restart finished on imac; its terminal is closed'
    )
    setGameLocale('es')
    expect(remoteViewNoticeOf(closed)).toBe(
      'ORCA-826 restart terminó en imac; su terminal está cerrada'
    )
  })

  it('says the host does not answer and how to read the member', () => {
    expect(remoteViewNoticeOf(member({ host: 'imac', stateKnown: false }))).toBe(
      'imac does not answer; read ORCA-826 restart: orca orchestration worker-read --dispatch ctx_826'
    )
  })

  it('points a live member at its output through the relay', () => {
    expect(remoteViewNoticeOf(member({ host: 'imac', stateKnown: true }))).toBe(
      'ORCA-826 restart runs on imac; read it: orca orchestration worker-read --dispatch ctx_826'
    )
  })

  it('speaks the pane locale', () => {
    setGameLocale('es')
    expect(remoteViewNoticeOf(member({ host: 'imac', stateKnown: false, gone: true }))).toBe(
      'ORCA-826 restart ya no existe en imac; si sigue en otra terminal allí: orca game rebind, si no orca game stop'
    )
  })
})
