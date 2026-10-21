import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { createRestartSession } from './helpers/orca-restart'
import Database from '../../src/main/sqlite/sync-database'
import { LEGACY_RUN_ID, OrchestrationDb } from '../../src/main/runtime/orchestration/db'

const LEAD_HANDLE = 'term_orca_726_lead'
const WIDTHS = [1440, 768, 390, 320] as const
const THEMES = ['light', 'dark'] as const

// The 2026-10-21 production shape: an adopted DB, then two status messages filed under the legacy
// Run and carried by the lead's Delivery. 'two-runs' adds a second carrier, which no heal can own.
function seedStrayLegacyMail(
  userDataDir: string,
  carriers: 'lead-run' | 'two-runs'
): { leadRunId: string; strayIds: string[] } {
  const dbPath = path.join(userDataDir, 'orchestration.db')
  const seed = new OrchestrationDb(dbPath)
  seed.insertMessage({ from: 'term_old', to: 'term_old_coord', subject: 'pre-run mail' })
  seed.close()
  const adopted = new OrchestrationDb(dbPath)
  const lead = adopted.createRun({
    objective: 'ORCA-726 lead',
    coordinatorHandle: LEAD_HANDLE,
    coordinatorPaneKey: 'tab_lead:11111111-1111-4111-8111-111111111111'
  })
  const other = adopted.createRun({
    objective: 'ORCA-726 other lead',
    coordinatorHandle: 'term_orca_726_other',
    coordinatorPaneKey: 'tab_other:22222222-2222-4222-8222-222222222222'
  })
  const strayIds = ['after ctx_028ddbf112a7', 'after ctx_1e4ce481939e'].map(
    (subject) =>
      adopted.insertMessage({ runId: lead.id, from: 'term_worker', to: LEAD_HANDLE, subject }).id
  )
  adopted.close()

  const raw = new Database(dbPath)
  try {
    const move = raw.prepare('UPDATE messages SET run_id = ? WHERE id = ?')
    for (const id of strayIds) {
      move.run(LEGACY_RUN_ID, id)
    }
    const deliver = raw.prepare(
      "INSERT INTO deliveries (id, run_id, consumer_generation, message_ids, status) VALUES (?, ?, ?, ?, 'acknowledged')"
    )
    deliver.run('delivery_lead', lead.id, lead.consumer_generation, JSON.stringify(strayIds))
    if (carriers === 'two-runs') {
      deliver.run('delivery_other', other.id, other.consumer_generation, JSON.stringify(strayIds))
    }
  } finally {
    raw.close()
  }
  return { leadRunId: lead.id, strayIds }
}

function readMessageRuns(userDataDir: string, ids: string[]): string[] {
  const raw = new Database(path.join(userDataDir, 'orchestration.db'))
  try {
    const get = raw.prepare('SELECT run_id FROM messages WHERE id = ?')
    return ids.map((id) => (get.get(id) as { run_id: string }).run_id)
  } finally {
    raw.close()
  }
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate(async (next) => {
    const settings = await window.api.settings.set({ theme: next })
    window.__store?.setState({ settings })
  }, theme)
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

test.describe('orchestration.db with stray legacy mail (ORCA-726)', () => {
  test('opens the window and moves the strays into their Delivery Run', async ({
    flushRendererRecoveryEvidenceQueue
  }, testInfo) => {
    void flushRendererRecoveryEvidenceQueue
    const session = createRestartSession(testInfo)
    try {
      const seeded = seedStrayLegacyMail(session.userDataDir, 'lead-run')
      const { app, page } = await session.launch()
      try {
        await expect(page.locator('body')).toBeVisible()
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 900 })
          for (const theme of THEMES) {
            await setTheme(page, theme)
            await page.screenshot({
              path: testInfo.outputPath(`stray-legacy-mail-open-${width}-${theme}.png`)
            })
          }
        }
      } finally {
        await session.close(app)
      }
      expect(readMessageRuns(session.userDataDir, seeded.strayIds)).toEqual([
        seeded.leadRunId,
        seeded.leadRunId
      ])
    } finally {
      await session.dispose()
    }
  })

  test('opens the window even when orchestration.db cannot be adopted', async ({
    flushRendererRecoveryEvidenceQueue
  }, testInfo) => {
    void flushRendererRecoveryEvidenceQueue
    const session = createRestartSession(testInfo)
    try {
      seedStrayLegacyMail(session.userDataDir, 'two-runs')
      let stderr = ''
      const { app, page } = await session.launch({
        onStderr: (chunk) => {
          stderr += chunk
        }
      })
      try {
        await expect(page.locator('body')).toBeVisible()
        await page.setViewportSize({ width: 1440, height: 900 })
        await page.screenshot({ path: testInfo.outputPath('unadoptable-db-open-1440.png') })
        await expect.poll(() => stderr).toContain('[orchestration] startup failed')
        expect(stderr).toContain('inconsistent Run ownership')
      } finally {
        await session.close(app)
      }
    } finally {
      await session.dispose()
    }
  })
})
