import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { attachRepoAndOpenTerminal, createRestartSession } from './helpers/orca-restart'
import { TEST_REPO_PATH_FILE } from './global-setup'
import { RuntimeClient } from '../../src/cli/runtime-client'
import { ORCHESTRATOR_GAME_CHARACTERS_HANDLERS } from '../../src/cli/handlers/orchestrator-game-characters'
import type { GameCharacterRow } from '../../src/shared/orchestrator-game-characters'
import type { GameHistoryRecord } from '../../src/shared/orchestrator-game-history'

// A character's saved progress is read back after Orca restarts (ORCA-684).
const freed = (ticket: string, patch: Partial<GameHistoryRecord> = {}): GameHistoryRecord => ({
  ticket,
  repo: null,
  branch: null,
  agent: 'claude',
  account: null,
  launchedAt: '2026-10-22T09:00:00.000Z',
  endedAt: '2026-10-22T10:30:00.000Z',
  outcome: 'merged',
  pr: '#41 merged',
  lastReport: null,
  ...patch
})

test("each character's progress survives an Orca restart and `orca game characters` prints it", async ({
  flushRendererRecoveryEvidenceQueue
}, testInfo) => {
  void flushRendererRecoveryEvidenceQueue
  test.setTimeout(300_000)
  const repoPath = existsSync(TEST_REPO_PATH_FILE)
    ? readFileSync(TEST_REPO_PATH_FILE, 'utf-8').trim()
    : ''
  test.skip(!repoPath || !existsSync(repoPath), 'Global setup did not produce a seeded test repo')
  const session = createRestartSession(testInfo)
  const apps: ElectronApplication[] = []
  const characters = async (worktreeId: string): Promise<GameCharacterRow[]> =>
    (
      await new RuntimeClient(session.userDataDir, 30_000, null, null).call<{
        characters: GameCharacterRow[]
      }>('game.characters', { worktreeId })
    ).result.characters
  try {
    const first = await session.launch()
    apps.push(first.app)
    await waitForSessionReady(first.page)
    await attachRepoAndOpenTerminal(first.page, repoPath)
    const worktreeId = await waitForActiveWorktree(first.page)

    const client = new RuntimeClient(session.userDataDir, 30_000, null, null)
    const record = (character: string, characterKey: string, one: GameHistoryRecord) =>
      client.call('game.historyRecord', { worktreeId, record: one, character, characterKey })
    await record('Arthur', 'arthur', freed('CIN-1'))
    await record('Arturo', 'arthur', freed('CIN-2', { outcome: 'qa', pr: '#42 open' }))
    // The same task freed twice (a retried stop) counts once.
    await record('Arturo', 'arthur', freed('CIN-2', { outcome: 'qa', pr: '#42 open' }))
    await record('Merlin', 'merlin', freed('CIN-3', { outcome: 'stopped', pr: null }))
    const before = await characters(worktreeId)
    expect(before.map((one) => [one.key, one.tickets, one.xp, one.current])).toEqual([
      ['arthur', 2, 150, null],
      ['merlin', 1, 0, null]
    ])

    await session.close(first.app)
    apps.pop()
    const second = await session.launch()
    apps.push(second.app)
    await waitForSessionReady(second.page)

    await expect.poll(() => characters(worktreeId), { timeout: 30_000 }).toEqual(before)

    const printed: string[] = []
    const log = console.log
    console.log = (line: string) => printed.push(line)
    const env = { ...process.env }
    try {
      process.env.ORCA_WORKTREE_ID = worktreeId
      delete process.env.ORCA_TERMINAL_HANDLE
      await ORCHESTRATOR_GAME_CHARACTERS_HANDLERS['game characters']({
        flags: new Map(),
        client: new RuntimeClient(session.userDataDir, 30_000, null, null),
        cwd: repoPath,
        json: false
      })
    } finally {
      console.log = log
      process.env = env
    }
    const text = printed.join('\n')
    writeFileSync(testInfo.outputPath('orca-game-characters.txt'), `${text}\n`)
    expect(text).toContain('Arturo  Lv 2 · 150 XP · free')
    expect(text).toContain('2 tickets · 2 PRs, 1 merged · 3h 0m · merged 1, qa 1')
    expect(text).toContain('Merlin  Lv 1 · 0 XP · free')
    expect(text).toContain('1 ticket · 0 PRs, 0 merged · 1h 30m · stopped 1')
    expect(Math.max(...text.split('\n').map((line) => line.length))).toBeLessThanOrEqual(80)
  } finally {
    for (const app of apps.toReversed()) {
      try {
        await session.close(app)
      } catch {
        // best-effort cleanup
      }
    }
    await session.dispose()
  }
})
