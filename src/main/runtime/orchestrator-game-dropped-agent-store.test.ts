import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GameDroppedAgentStore } from './orchestrator-game-dropped-agent-store'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

const AT = '2026-11-02T10:00:00.000Z'
const agent = { worktreeId: 'repo1::/wt/907', environmentId: null }

function storeIn(dir = mkdtempSync(join(tmpdir(), 'orca-game-dropped-'))): GameDroppedAgentStore {
  dirs.push(dir)
  return new GameDroppedAgentStore(
    () => dir,
    () => AT
  )
}

// Why a file: a dropped agent stays out of the fleet after Orca restarts (ORCA-943).
describe('GameDroppedAgentStore', () => {
  it('keeps a drop per project across a new store, and a restore clears it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-game-dropped-'))
    await storeIn(dir).set('repo:repo1', { ...agent, name: 'ORCA-907' }, true)

    const reopened = storeIn(dir)
    expect(await reopened.read('repo:repo1')).toEqual([
      { worktreeId: 'repo1::/wt/907', environmentId: null, name: 'ORCA-907', droppedAt: AT }
    ])
    expect(await reopened.read('repo:repo2')).toEqual([])

    await reopened.set('repo:repo1', { ...agent, name: 'ORCA-907' }, false)
    expect(await storeIn(dir).read('repo:repo1')).toEqual([])
  })

  it('reads a missing file as nothing dropped', async () => {
    expect(await storeIn().read('repo:repo1')).toEqual([])
  })

  // Why by pane key: a removed member's sibling in the same worktree must stay listed (ORCA-1476).
  it('keeps a removed member by its pane key beside the drops, across a new store', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-game-dropped-'))
    await storeIn(dir).set('repo:repo1', { ...agent, name: 'ORCA-907' }, true)
    await storeIn(dir).forget('repo:repo1', { paneKey: 'remote:ctx_1177', name: 'orca-1177' })
    await storeIn(dir).set(
      'repo:repo1',
      { worktreeId: 'wt-2', environmentId: null, name: 'B' },
      true
    )

    const hides = await storeIn(dir).readAll('repo:repo1')
    expect(hides.forgotten).toEqual([
      { paneKey: 'remote:ctx_1177', name: 'orca-1177', forgottenAt: AT }
    ])
    expect(hides.dropped.map((one) => one.name)).toEqual(['ORCA-907', 'B'])
  })
})
