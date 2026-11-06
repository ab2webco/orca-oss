import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { attachRepoAndOpenTerminal, createRestartSession } from './helpers/orca-restart'
import { TEST_REPO_PATH_FILE } from './global-setup'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { GameHistoryRecord } from '../../src/shared/orchestrator-game-history'
import type { GameEvent } from '../../src/shared/orchestrator-game-events'

// A user updating from lab.104 keeps the game history that release wrote, and what a newer build
// added survives this one's rewrite (ORCA-695). The file is on disk under the repo id's name before
// this build starts, as in a real upgrade; this build reads it under the repo's path (ORCA-1011).
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

const historyFiles = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir).filter((one) => one.endsWith('.json') && !one.includes('.damaged-'))
    : []

test('the game history a previous release wrote is read, kept and extended by this one', async ({
  flushRendererRecoveryEvidenceQueue
}, testInfo) => {
  void flushRendererRecoveryEvidenceQueue
  test.setTimeout(300_000)
  const repoPath = existsSync(TEST_REPO_PATH_FILE)
    ? readFileSync(TEST_REPO_PATH_FILE, 'utf8').trim()
    : ''
  test.skip(!repoPath || !existsSync(repoPath), 'Global setup did not produce a seeded test repo')
  const session = createRestartSession(testInfo)
  let app: ElectronApplication | null = null
  try {
    const first = await session.launch()
    app = first.app
    await waitForSessionReady(first.page)
    const worktreeId = await attachRepoAndOpenTerminal(first.page, repoPath)
    const repoId = await first.page.evaluate(
      (id) =>
        Object.values(window.__store?.getState().worktreesByRepo ?? {})
          .flat()
          .find((worktree) => worktree.id === id)?.repoId,
      worktreeId
    )
    expect(repoId, 'the active worktree has no repo').toBeTruthy()
    await session.close(first.app)
    app = null

    const dir = path.join(session.userDataDir, 'orchestrator-game-history')
    expect(historyFiles(dir), 'this build wrote a history before the upgrade').toEqual([])
    // What lab.104 named the file: the repo id's hash.
    const legacy = `${createHash('sha256').update(`repo:${repoId}`).digest('hex').slice(0, 32)}.json`
    const lab104 = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown[]>
    // What a newer build might add: a top-level key, a field, and an outcome this build cannot read.
    const seeded = {
      ...lab104,
      streaks: { 'CIN-12': 3 },
      records: [...lab104.records!, { ...record, ticket: 'CIN-99', outcome: 'abandoned', score: 4 }]
    }
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, legacy), JSON.stringify(seeded))

    const second = await session.launch()
    app = second.app
    await waitForSessionReady(second.page)
    const client = new RuntimeClient(session.userDataDir, 30_000, null, null)
    const tickets = async (): Promise<(string | null)[]> =>
      (
        await client.call<{ records: GameHistoryRecord[] }>('game.history', { worktreeId })
      ).result.records.map((one) => one.ticket)
    // Why poll: the relaunched runtime may not answer until its worktrees have loaded.
    await expect.poll(tickets, { timeout: 15_000 }).toEqual(['CIN-13', 'CIN-12'])
    const events = await client.call<{ events: GameEvent[] }>('game.events', { worktreeId })
    expect(events.result.events.map((one) => one.kind).sort()).toEqual(['claimed', 'merged'])

    await client.call('game.historyRecord', { worktreeId, record })
    // Why the lab.104 file must stay as it was: an older build after a downgrade still reads it.
    expect(JSON.parse(readFileSync(path.join(dir, legacy), 'utf8'))).toEqual(seeded)
    const current = historyFiles(dir).filter((one) => one !== legacy)
    expect(current, 'this build did not write the history under a name of its own').toHaveLength(1)
    const file = path.join(dir, current[0]!)
    const written = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    expect(written).toEqual({
      ...seeded,
      records: [...seeded.records, record],
      schemaVersion: 1
    })
    expect(await tickets()).toEqual(['CIN-14', 'CIN-13', 'CIN-12'])

    // A damaged file costs the history but is set aside, never overwritten.
    writeFileSync(file, '{not json')
    await client.call('game.historyRecord', { worktreeId, record: { ...record, ticket: 'CIN-15' } })
    const aside = readdirSync(dir).filter((one) =>
      one.startsWith(`${current[0]!.replace(/\.json$/, '')}.damaged-`)
    )
    expect(aside).toHaveLength(1)
    expect(readFileSync(path.join(dir, aside[0]!), 'utf8')).toBe('{not json')
    expect(await tickets()).toEqual(['CIN-15'])
  } finally {
    if (app) {
      await session.close(app)
    }
    await session.dispose()
  }
})
