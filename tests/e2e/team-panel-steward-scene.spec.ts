import { test, expect } from './helpers/orca-app'
import { setTheme, setWindowWidth, THEMES } from './helpers/settings-window'
import { writeSettings } from './helpers/settings-write'
import { openOfficeTeam, seedOfficeTeam, type SeededMember } from './helpers/team-office-seed'
import type { GameMemberSteward } from '../../src/shared/orchestrator-game-member-steward'
import type { GamePanelStyle } from '../../src/shared/orchestrator-game-panel'

const WIDTHS = [1440, 768, 390, 320]
const haiku = { model: 'claude-haiku-5-5', effort: 'low' }
const sonnet = { model: 'claude-sonnet-5-5', effort: 'medium' }
const opus = { model: 'claude-opus-5-5', effort: 'high' }
const T0 = Date.UTC(2026, 10, 17, 12)

// Its first move is on the stage before the panel opens, so only the moves after it are visits.
const stewardAfter = (moves: number): GameMemberSteward => {
  const decisions = [
    { at: T0, moment: 'plan', from: haiku, to: sonnet },
    ...Array.from({ length: moves }, (_, i) =>
      i % 2 === 0
        ? { at: T0 + i + 1, moment: 'edit', from: sonnet, to: opus }
        : { at: T0 + i + 1, moment: 'pr-ci', from: opus, to: haiku }
    )
  ].map((one) => ({ ...one, phase: 'implement', applied: true, source: 'plan', why: one.moment }))
  const last = decisions.at(-1)!.to
  return {
    session: 's-peach',
    ticket: 'ORCA-403',
    ...last,
    phase: 'implement',
    plan: 'plan',
    standDown: null,
    pinned: { model: false, effort: false },
    stepsSeen: 3,
    decisions: decisions.slice(-10)
  }
}

// Peach's card after `moves` visits: the stage's own move, then up and down in turn.
const movedText = (moves: number): string =>
  moves === 0
    ? 'Haiku 5.5 → Sonnet 5.5 · medium'
    : moves % 2 === 1
      ? 'Sonnet 5.5 → Opus 5.5 · high'
      : 'Opus 5.5 → Haiku 5.5 · low'

const team = (moves: number): SeededMember[] => [
  { name: 'Mario · ORCA-401 Code', state: 'idle' },
  { name: 'Luigi · ORCA-402 Code', state: 'idle' },
  { name: 'Peach · ORCA-403 Code', state: 'working', steward: stewardAfter(moves) },
  { name: 'Yoshi · ORCA-404 Code', state: 'idle' }
]

// Why test.use: a never-shown window paints about once a second on CI, too sparse for any walk.
test.use({ orcaAppExtraEnv: { ORCA_E2E_SHOW_INACTIVE: '1' } })

// ORCA-1242 PR 4: with Jev absent, the Orca steward walks to the member whose model it raised or
// lowered and says why, in every panel style and in each built-in scene's own colours.
test('the Orca steward visits the member whose model it moved, in every style and scene', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(900_000)
  const { dispose } = await openOfficeTeam(electronApp, orcaPage, { members: team(0) })
  try {
    const panel = orcaPage.getByTestId('team-panel')
    let moves = 0
    const peachModel = panel.locator('article', { hasText: 'Peach' }).locator('[data-team-model]')
    const visit = async (style: string, name: string): Promise<void> => {
      // Why: a member the scene first meets with the move already made only joins, unvisited, so
      // the move goes out once the scene holds Peach as the last move left her (ORCA-1466).
      await expect(peachModel).toHaveText(movedText(moves), { timeout: 30_000 })
      // Why: a read still marked updating sets no baseline, so the next read would be the first.
      await expect(panel.getByText('Updating the team…')).toBeHidden({ timeout: 30_000 })
      moves += 1
      await seedOfficeTeam(electronApp, { members: team(moves) })
      const scene = panel.locator(`[data-team-scene="${style}"]`).first()
      const bubble = scene.locator('[data-scene-bubble="steward"]')
      await expect(bubble, `no steward line: ${name}`).toBeVisible({ timeout: 20_000 })
      await expect(bubble).toHaveText(
        moves % 2 === 1
          ? 'Up to Opus 5.5 · high: editing code'
          : 'Down to Haiku 5.5 · low: watching the PR and CI'
      )
      const overflow = await panel.evaluate((node) => node.scrollWidth - node.clientWidth)
      expect(overflow, `panel overflows: ${name}`).toBeLessThanOrEqual(0)
      await scene.screenshot({ path: testInfo.outputPath(`${name}.png`) })
      // Why: the next visit starts from a stage the steward has left, not mid-walk.
      await expect(bubble).toBeHidden({ timeout: 15_000 })
    }
    const show = async (scene: string, style: GamePanelStyle, width: number): Promise<void> => {
      await writeSettings(orcaPage, {
        orchestratorGame: { scene, panel: { look: 'game', style, diorama: false, quality: 'low' } }
      })
      await setWindowWidth(electronApp, orcaPage, width)
      await orcaPage.evaluate((wide) => {
        const state = window.__store!.getState()
        state.setRightSidebarOpen(true)
        state.setRightSidebarTab('team')
        if (wide) {
          state.setRightSidebarWidth(640)
        }
      }, width === 1440)
      // Why the canvas: Office and Figures hold a placeholder while art decodes, and the canvas
      // mounting after the next move would take that move as its opening team, with no visit.
      await expect(
        panel
          .locator(`[data-team-scene="${style}"]`)
          .first()
          .getByRole('img', { name: 'Live team scene' })
      ).toBeVisible()
    }

    for (const style of ['office', 'figures', 'pixel'] as const) {
      for (const width of WIDTHS) {
        await show('quest', style, width)
        for (const theme of THEMES) {
          await setTheme(orcaPage, theme)
          await visit(style, `${style}-quest-${width}-${theme}`)
        }
      }
    }
    for (const scene of ['jrpg', 'tamer', 'vigilante']) {
      await show(scene, 'pixel', 1440)
      for (const theme of THEMES) {
        await setTheme(orcaPage, theme)
        await visit('pixel', `pixel-${scene}-1440-${theme}`)
      }
    }
  } finally {
    dispose()
  }
})
