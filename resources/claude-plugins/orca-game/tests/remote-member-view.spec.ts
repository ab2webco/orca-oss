import { afterEach, describe, expect, it } from 'vitest'

import { setGameLocale } from '../hooks/game-strings'
import { remoteOpenFailedOf, remoteOpenOf, remoteViewNoticeOf } from '../hooks/remote-member-view'
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

  // Why this short: the toast box shows three lines, and at 320 px a longer one cut off `stop`.
  it('says a gone member no longer exists, and how to rebind or free it (CIN-1297)', () => {
    expect(remoteViewNoticeOf(member({ host: 'imac', stateKnown: false, gone: true }))).toBe(
      'ORCA-826 restart no longer exists on imac: orca game rebind or stop'
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
      'ORCA-826 restart ya no existe en imac: orca game rebind o stop'
    )
  })
})

// Why: the owner opens a live remote member's terminal here, through the host's pairing (ORCA-839).
describe('Opening a live remote member', () => {
  const live = (remote: GameAgent['remote'], terminalHandle?: string) => ({
    ...member(),
    paneKey: 'remote:ctx_839',
    remote,
    ...(terminalHandle ? { terminalHandle } : {})
  })

  it('opens the terminal of a live member on its host', () => {
    expect(
      remoteOpenOf(live({ host: 'imac', environmentId: 'env-imac', stateKnown: true }, 'term_839'))
    ).toEqual({ handle: 'term_839', environmentId: 'env-imac' })
  })

  it('leaves a gone, silent, local or unaddressable member to its notice', () => {
    expect(remoteOpenOf(live(undefined, 'term_839'))).toBeNull()
    expect(
      remoteOpenOf(
        live({ host: 'imac', environmentId: 'env-imac', stateKnown: true, gone: true }, 'term_839')
      )
    ).toBeNull()
    expect(
      remoteOpenOf(live({ host: 'imac', environmentId: 'env-imac', stateKnown: false }, 'term_839'))
    ).toBeNull()
    expect(remoteOpenOf(live({ host: 'imac', stateKnown: true }, 'term_839'))).toBeNull()
    expect(
      remoteOpenOf(live({ host: 'imac', environmentId: 'env-imac', stateKnown: true }))
    ).toBeNull()
  })

  it('says why it could not open the member and how to read it instead', () => {
    const one = live({ host: 'imac', environmentId: 'env-imac', stateKnown: true }, 'term_839')
    expect(remoteOpenFailedOf(one)).toBe(
      'Could not open ORCA-826 restart on imac; read it: orca orchestration worker-read --dispatch ctx_839'
    )
    setGameLocale('es')
    expect(remoteOpenFailedOf(one)).toBe(
      'No se pudo abrir ORCA-826 restart en imac; léelo: orca orchestration worker-read --dispatch ctx_839'
    )
  })
})
