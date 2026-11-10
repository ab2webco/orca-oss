import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GameStopSwitch } from './orchestrator-game-stop-switch'
import { GameStoreNames } from './orchestrator-game-store-names'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    chmodSync(dir, 0o700)
    rmSync(dir, { recursive: true, force: true })
  }
})

function stopSwitch(): { stops: GameStopSwitch; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'orca-game-stop-'))
  dirs.push(dir)
  return { stops: new GameStopSwitch(() => dir), dir }
}

const AT = '2026-10-16T10:00:00.000Z'

describe('GameStopSwitch', () => {
  it('is clear until set, keeps the first since when set again, and clears per project', async () => {
    const { stops, dir } = stopSwitch()
    expect(await stops.read('repo-a')).toBeNull()

    expect(await stops.set('repo-a', { since: AT, by: 'lead' })).toEqual({
      stopped: { since: AT, by: 'lead' },
      changed: true
    })
    expect(await stops.set('repo-a', { since: '2026-10-16T11:00:00.000Z', by: 'lead' })).toEqual({
      stopped: { since: AT, by: 'lead' },
      changed: false
    })
    expect(await new GameStopSwitch(() => dir).read('repo-a')).toEqual({ since: AT, by: 'lead' })
    expect(await stops.read('repo-b')).toBeNull()

    expect(await stops.clear('repo-a')).toEqual({ changed: true })
    expect(await stops.clear('repo-a')).toEqual({ changed: false })
    expect(await stops.read('repo-a')).toBeNull()
  })

  it('reads a damaged STOP file as set', async () => {
    const { stops, dir } = stopSwitch()
    await stops.set('repo-a', { since: AT, by: 'lead' })
    const [file] = readdirSync(dir)
    writeFileSync(join(dir, file as string), '{not json')

    expect(await stops.read('repo-a')).toEqual({ since: null, by: null, unreadable: true })
  })

  it.skipIf(process.platform === 'win32')('reads a STOP folder it cannot read as set', async () => {
    const { stops, dir } = stopSwitch()
    chmodSync(dir, 0o000)
    expect(await stops.read('repo-a')).toEqual({ since: null, by: null, unreadable: true })
  })
})

describe('a STOP that resume cleared stays cleared across restarts (ORCA-1157)', () => {
  it('does not come back from the repo-id file the ORCA-1011 rename keeps for a downgrade', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-game-stop-'))
    dirs.push(dir)
    const placeOf = () => ({ connectionId: null, path: '/work/helpdesk_netsat' })
    const key = 'repo:r_netsat'
    // A STOP an Orca from before ORCA-1011 wrote under the repo id's name.
    await new GameStopSwitch(() => dir).set(key, { since: AT, by: 'lead' })

    const running = new GameStopSwitch(() => dir, new GameStoreNames(placeOf))
    expect(await running.read(key)).toEqual({ since: AT, by: 'lead' })
    expect(await running.clear(key)).toEqual({ changed: true })
    expect(await running.read(key)).toBeNull()

    // Orca restarts: a new naming copies whatever the repo id's file still holds.
    const restarted = new GameStopSwitch(() => dir, new GameStoreNames(placeOf))
    expect(await restarted.read(key)).toBeNull()
    expect(readdirSync(dir).filter((name) => name.endsWith('.stop.json'))).toEqual([])
  })
})
