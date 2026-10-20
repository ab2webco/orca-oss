import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GameMemberSessionStore } from './orchestrator-game-member-session-store'
import type { GameMemberSessionPatch } from '../../shared/orchestrator-game-member-sessions'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function store(): { store: GameMemberSessionStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'orca-game-members-'))
  dirs.push(dir)
  return {
    store: new GameMemberSessionStore(
      () => dir,
      () => '2026-10-20T10:00:00.000Z'
    ),
    dir
  }
}

const launched = (ticket: string): GameMemberSessionPatch => ({
  ticket,
  runId: 'run_1',
  taskId: `task_${ticket}`
})

const onlyFile = (dir: string): string => {
  const files = readdirSync(dir).filter((name) => name.endsWith('.members.json'))
  expect(files).toHaveLength(1)
  return join(dir, files[0] as string)
}

describe('GameMemberSessionStore', () => {
  it('reads a project with no file as no members', async () => {
    expect(await store().store.read('repo:a')).toEqual({ ok: true, members: [] })
  })

  it('keeps each project apart and survives a new store on the same folder', async () => {
    const { store: first, dir } = store()
    await first.upsert('repo:a', launched('ORCA-1'))
    await first.upsert('repo:b', launched('ENG-1'))
    await first.upsert('repo:a', { ticket: 'ORCA-1', sessionId: 'abc' })
    const second = new GameMemberSessionStore(() => dir)
    const read = await second.read('repo:a')
    expect(read.ok && read.members.map((one) => [one.ticket, one.sessionId])).toEqual([
      ['ORCA-1', 'abc']
    ])
    const other = await second.read('repo:b')
    expect(other.ok && other.members.map((one) => one.ticket)).toEqual(['ENG-1'])
  })

  it('serializes concurrent writes to one project so none is lost', async () => {
    const { store: one } = store()
    await Promise.all(['ORCA-1', 'ORCA-2', 'ORCA-3'].map((t) => one.upsert('repo:a', launched(t))))
    const read = await one.read('repo:a')
    expect(read.ok && read.members.map((m) => m.ticket).sort()).toEqual([
      'ORCA-1',
      'ORCA-2',
      'ORCA-3'
    ])
  })

  it('removes the named tickets only', async () => {
    const { store: one } = store()
    await one.upsert('repo:a', launched('ORCA-1'))
    await one.upsert('repo:a', launched('ORCA-2'))
    await one.remove('repo:a', ['orca-1'])
    const read = await one.read('repo:a')
    expect(read.ok && read.members.map((m) => m.ticket)).toEqual(['ORCA-2'])
  })

  it('reports an unreadable file and refuses to write over it', async () => {
    const { store: one, dir } = store()
    await one.upsert('repo:a', launched('ORCA-1'))
    const file = onlyFile(dir)
    writeFileSync(file, '{"version":99,"members":[]}')
    expect(await one.read('repo:a')).toEqual({
      ok: false,
      reason: 'the saved members file is from a newer Orca (version 99)'
    })
    await expect(one.upsert('repo:a', launched('ORCA-2'))).rejects.toThrow(
      'not saved: the saved members file is from a newer Orca (version 99)'
    )
    await expect(one.remove('repo:a', ['ORCA-1'])).rejects.toThrow('not saved')
    expect(readFileSync(file, 'utf8')).toBe('{"version":99,"members":[]}')
  })

  it('sets an unreadable file aside, keeping its bytes, only when asked', async () => {
    const { store: one, dir } = store()
    await one.upsert('repo:a', launched('ORCA-1'))
    writeFileSync(onlyFile(dir), 'not json')
    const kept = await one.setAside('repo:a')
    expect(kept && readFileSync(kept, 'utf8')).toBe('not json')
    expect(await one.read('repo:a')).toEqual({ ok: true, members: [] })
    expect(await one.setAside('repo:a')).toBeNull()
  })
})
