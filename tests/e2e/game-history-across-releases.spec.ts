import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { GameHistoryRecord } from '../../src/shared/orchestrator-game-history'
import type { GameEvent } from '../../src/shared/orchestrator-game-events'

// A user updating from lab.104 keeps the game history that release wrote, and what a newer build
// added survives this one's rewrite (ORCA-695).
const FIXTURE = path.join(
  process.cwd(),
  'src/main/runtime/__fixtures__/orchestrator-game-history-lab-104.json'
)

const record: GameHistoryRecord = {
  ticket: 'CIN-14',
  repo: 'cineco',
  branch: null,
  agent: 'claude',
  account: null,
  launchedAt: null,
  endedAt: '2026-10-20T12:00:00.000Z',
  outcome: 'stopped',
  pr: null,
  lastReport: null
}

test('the game history a previous release wrote is read, kept and extended by this one', async ({
  electronApp,
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  const worktreeId = await waitForActiveWorktree(orcaPage)
  const repoId = await orcaPage.evaluate((id) => {
    const state = window.__store?.getState()
    return Object.values(state?.worktreesByRepo ?? {})
      .flat()
      .find((worktree) => worktree.id === id)?.repoId
  }, worktreeId)
  expect(repoId, 'the active worktree has no repo').toBeTruthy()

  const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const dir = path.join(userDataDir, 'orchestrator-game-history')
  const name = createHash('sha256').update(`repo:${repoId}`).digest('hex').slice(0, 32)
  const file = path.join(dir, `${name}.json`)
  const lab104 = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown[]>
  // What a newer build might add: a top-level key, a field, and an outcome this build cannot read.
  const seeded = {
    ...lab104,
    streaks: { 'CIN-12': 3 },
    records: [...lab104.records!, { ...record, ticket: 'CIN-99', outcome: 'abandoned', score: 4 }]
  }
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, JSON.stringify(seeded))

  const client = new RuntimeClient(userDataDir, 30_000, null, null)
  const history = await client.call<{ records: GameHistoryRecord[] }>('game.history', {
    worktreeId
  })
  expect(history.result.records.map((one) => one.ticket)).toEqual(['CIN-13', 'CIN-12'])
  const events = await client.call<{ events: GameEvent[] }>('game.events', { worktreeId })
  expect(events.result.events.map((one) => one.kind).sort()).toEqual(['claimed', 'merged'])

  await client.call('game.historyRecord', { worktreeId, record })
  const written = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  expect(written).toEqual({
    ...seeded,
    records: [...seeded.records, record],
    schemaVersion: 1
  })
  expect(
    (
      await client.call<{ records: GameHistoryRecord[] }>('game.history', { worktreeId })
    ).result.records.map((one) => one.ticket)
  ).toEqual(['CIN-14', 'CIN-13', 'CIN-12'])

  // A damaged file costs the history but is set aside, never overwritten.
  writeFileSync(file, '{not json')
  await client.call('game.historyRecord', { worktreeId, record: { ...record, ticket: 'CIN-15' } })
  const aside = readdirSync(dir).filter((one) => one.startsWith(`${name}.damaged-`))
  expect(aside).toHaveLength(1)
  expect(readFileSync(path.join(dir, aside[0]!), 'utf8')).toBe('{not json')
  expect(
    (
      await client.call<{ records: GameHistoryRecord[] }>('game.history', { worktreeId })
    ).result.records.map((one) => one.ticket)
  ).toEqual(['CIN-15'])
})
