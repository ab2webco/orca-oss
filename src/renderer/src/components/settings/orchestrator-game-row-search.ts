import { searchKeywords, type SearchKeywordSpec } from './settings-search-keywords'
import { GAME_ROWS, type GameRowGroup, type GameRowId } from './orchestrator-game-row-visibility'

const S = 'auto.components.settings'
const spec = (key: string, fallback: string): SearchKeywordSpec => ({
  key: `${S}.${key}`,
  fallback
})

/** What finds each row; a row the page hides contributes none (ORCA-1112). */
const ROW_KEYWORDS: Record<GameRowId, (string | SearchKeywordSpec)[]> = {
  look: [spec('OrchestratorGamePanelSetting.look', 'Panel look')],
  style: [spec('OrchestratorGamePanelSetting.style', 'Scene style')],
  stylePreview: [],
  diorama: [
    spec('GamePanelDioramaRows.quality', 'Scene quality'),
    spec('GamePanelDioramaRows.pace', "Lead's pace"),
    'diorama'
  ],
  scene: [spec('OrchestratorGameSetting.scene', 'Scene'), 'scene file', 'custom scene'],
  prs: [spec('OrchestratorGamePanelSetting.prs', 'PRs'), 'merge queue'],
  machines: [spec('OrchestratorGamePanelSetting.machines', 'Machines')],
  advisor: [spec('OrchestratorGamePanelSetting.advisor', 'Advisor')],
  arcade: [spec('OrchestratorGamePanelSetting.arcade', 'Arcade')],
  timezone: [spec('OrchestratorGameRenderSetting.timezone', 'Time zone')],
  show: [spec('OrchestratorGameViewSetting.show', 'Show the game')],
  view: [spec('OrchestratorGameViewSetting.view', 'Default view'), 'zen', 'flat'],
  hud: [spec('OrchestratorGameSetting.hud', 'Teammate HUD'), 'hud'],
  rewards: [spec('OrchestratorGameSetting.rewards', 'Rewards'), 'xp'],
  openLinks: [spec('OrchestratorGameOpenLinksSetting.label', 'Open links in')],
  tracker: [spec('OrchestratorGameSetting.tracker', 'Work item tracking')],
  band: [
    spec('OrchestratorGameSetting.band', 'Show the band'),
    spec('OrchestratorGameSetting.terminalBand', 'Terminal band')
  ],
  bandPreview: [],
  render: [spec('OrchestratorGameRenderSetting.label', 'Render')]
}

/** The keywords of the shown rows in these groups; every row when `shown` is omitted. */
export function gameRowSearchKeywords(
  groups: readonly GameRowGroup[],
  shown?: ReadonlySet<GameRowId>
): string[] {
  return searchKeywords(
    GAME_ROWS.filter(
      (row) => groups.includes(row.group) && (shown === undefined || shown.has(row.id))
    ).flatMap((row) => ROW_KEYWORDS[row.id])
  )
}
