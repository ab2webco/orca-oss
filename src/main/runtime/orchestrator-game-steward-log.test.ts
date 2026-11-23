import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseGameMemberSteward } from '../../shared/orchestrator-game-member-steward'
import { GameStewardLog } from './orchestrator-game-steward-log'

const decision = (at: number, moment = 'edit') => ({
  at,
  moment,
  phase: 'implement',
  from: { model: 'claude-sonnet-5-5', effort: 'medium' },
  to: { model: 'claude-opus-5-5', effort: 'high' },
  applied: true,
  source: 'plan',
  why: 'editing code'
})

const entry = (ticket: string, session: string, decisions: ReturnType<typeof decision>[]) => ({
  ticket,
  session,
  decisions
})

describe('GameStewardLog', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'steward-log-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('appends each decision once although the pane re-sends it on every poll', async () => {
    const log = new GameStewardLog(() => dir)
    expect(await log.append('repo:a', entry('ORCA-12', 's1', [decision(1)]))).toBe(1)
    expect(await log.append('repo:a', entry('ORCA-12', 's1', [decision(1), decision(2)]))).toBe(1)
    expect((await log.read('repo:a', 'ORCA-12')).map((one) => one.at)).toEqual([1, 2])
  })

  // Why (ORCA-1350): the lead tunes the steward's per-phase turn table from this log.
  it("keeps the plugin's phase turn count from the pane's report through the file", async () => {
    const left = { ...decision(5, 'pr-ci'), phaseTurns: { phase: 'implement', turns: 37 } }
    const steward = parseGameMemberSteward({
      version: 1,
      session: 's1',
      ticket: 'ORCA-12',
      decisions: [left]
    })
    const log = new GameStewardLog(() => dir)
    await log.append('repo:a', {
      ticket: 'ORCA-12',
      session: 's1',
      decisions: steward?.decisions ?? []
    })
    expect((await log.read('repo:a', 'ORCA-12'))[0]?.phaseTurns).toEqual({
      phase: 'implement',
      turns: 37
    })
  })

  it('a decision with the same time from another session is its own line', async () => {
    const log = new GameStewardLog(() => dir)
    await log.append('repo:a', entry('ORCA-12', 's1', [decision(1)]))
    await log.append('repo:a', entry('ORCA-12', 's2', [decision(1)]))
    expect((await log.read('repo:a', 'ORCA-12')).map((one) => one.session)).toEqual(['s1', 's2'])
  })

  it('never rewrites the file: a restart reads what is kept and appends after it', async () => {
    await new GameStewardLog(() => dir).append('repo:a', entry('ORCA-12', 's1', [decision(1)]))
    const [file] = readdirSync(dir)
    const before = readFileSync(join(dir, file!), 'utf8')
    const again = new GameStewardLog(() => dir)
    expect(await again.append('repo:a', entry('ORCA-12', 's1', [decision(1), decision(3)]))).toBe(1)
    expect(readFileSync(join(dir, file!), 'utf8').startsWith(before)).toBe(true)
  })

  it('one file per project and ticket; an unreadable line is skipped on read', async () => {
    const log = new GameStewardLog(() => dir)
    await log.append('repo:a', entry('ORCA-12', 's1', [decision(1)]))
    await log.append('repo:a', entry('ORCA-13', 's1', [decision(1)]))
    await log.append('repo:b', entry('ORCA-12', 's1', [decision(1)]))
    const files = readdirSync(dir)
    expect(files).toHaveLength(3)
    const file = join(dir, files.find((one) => one.includes('ORCA-13'))!)
    writeFileSync(file, `${readFileSync(file, 'utf8')}{broken\n`)
    expect(await log.read('repo:a', 'ORCA-13')).toHaveLength(1)
    expect(await log.read('repo:a', 'ORCA-99')).toEqual([])
  })

  it('writes nothing for a ticket that could leave the log folder', async () => {
    const log = new GameStewardLog(() => dir)
    expect(await log.append('repo:a', entry('../x', 's1', [decision(1)]))).toBe(0)
    expect(
      await log.append('repo:a', { ticket: null, session: 's1', decisions: [decision(1)] })
    ).toBe(0)
    expect(readdirSync(dir)).toEqual([])
  })
})
