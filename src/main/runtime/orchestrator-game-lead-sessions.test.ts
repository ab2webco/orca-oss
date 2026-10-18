import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GameLeadSessions } from './orchestrator-game-lead-sessions'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function sessions(): { store: GameLeadSessions; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'orca-game-lead-'))
  dirs.push(dir)
  return { store: new GameLeadSessions(() => join(dir, 'leads')), dir }
}

const SESSION = { sessionId: 'sess-1', agentArgs: '--teammate-mode auto', worktreeId: 'wt1' }

describe('GameLeadSessions', () => {
  it("keeps each project's lead session across a restart of the store", async () => {
    const { store, dir } = sessions()
    expect(await store.read('repo:a')).toBeNull()

    await store.write('repo:a', SESSION)
    await store.write('repo:b', { ...SESSION, sessionId: 'sess-2', agentArgs: null })

    const reopened = new GameLeadSessions(() => join(dir, 'leads'))
    expect(await reopened.read('repo:a')).toEqual(SESSION)
    expect(await reopened.read('repo:b')).toEqual({
      ...SESSION,
      sessionId: 'sess-2',
      agentArgs: null
    })
  })

  it('reads a damaged record as no session', async () => {
    const { store, dir } = sessions()
    await store.write('repo:a', SESSION)
    const [file] = (await import('node:fs')).readdirSync(join(dir, 'leads'))
    writeFileSync(join(dir, 'leads', file ?? ''), '{"sessionId": 3}')

    expect(await store.read('repo:a')).toBeNull()
  })
})
