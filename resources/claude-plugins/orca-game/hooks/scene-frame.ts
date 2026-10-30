import type { HdMember } from './hd-party'
import { partyOf } from './party'
import { cellsOf } from './pixel-canvas'
import {
  advisorShownAt,
  currentScene,
  daylightNow,
  demoNow,
  gameConfig,
  isAlertShown,
  quest,
  teamEventAt,
  reactionAt,
  shownAction,
  shownCaption,
  shownLead,
  shownPhase,
  shownResting,
  type Animated,
  type Stage
} from './quest-state'
import { SCENE_ROWS, sceneCellsOf } from './scene'
import { hdBandRowsOf, hdSceneGridOf } from './scene-hd'

// What each Raster the game owns draws on a tick: the spinner's scene in its render, and the band's pet.

/** The spinner's stage for this width and terminal height, in the render the session draws now. */
export const stageOf = (columns: number, viewportRows?: number): Stage => {
  const { render } = gameConfig()
  return render === 'classic'
    ? { columns, rows: SCENE_ROWS, render: 'classic' }
    : { columns, rows: hdBandRowsOf(render, viewportRows), render: 'hd' }
}

const demoPartyOf = (hasRewards: boolean): HdMember[] =>
  partyOf(demoNow().state, hasRewards).map((one) => ({
    key: one.key,
    name: one.name,
    phase: one.phase,
    state: one.state
  }))

// Why the stage's render: a blit between a /quest render flip and the next ui.render keeps the Raster's rows.
export const stageCellsOf = (stage: Stage): string => {
  const since = quest.isDemo ? quest.demoAt : quest.captionAt
  if (stage.render === 'hd') {
    return cellsOf(
      hdSceneGridOf({
        scene: currentScene(),
        phase: shownPhase(),
        columns: stage.columns,
        rows: stage.rows,
        tick: quest.tick,
        caption: shownCaption(),
        since,
        reaction: reactionAt(quest.tick),
        isResting: shownResting(),
        action: shownAction(),
        advisor: advisorShownAt(quest.tick),
        isWaiting: isAlertShown(),
        light: daylightNow(),
        party: quest.isDemo ? demoPartyOf(gameConfig().rewards) : quest.hdParty,
        leavers: quest.isDemo ? [] : quest.leavers,
        marches: quest.isDemo ? new Map() : quest.marches,
        lead: shownLead(),
        event: teamEventAt(quest.tick)
      })
    )
  }
  return sceneCellsOf(
    currentScene(),
    shownPhase(),
    stage.columns,
    quest.tick,
    shownCaption(),
    since,
    reactionAt(quest.tick),
    shownResting(),
    shownAction(),
    advisorShownAt(quest.tick)
  ).cells
}

// Why classic: the band holds 8 rows at most, so its scene stays the 5-row art in either render.
export const petScene = (key: string, columns: number): Animated => ({
  key,
  columns,
  rows: SCENE_ROWS,
  draw: (at) =>
    sceneCellsOf(
      currentScene(),
      shownPhase(),
      columns,
      at,
      '',
      -Infinity,
      reactionAt(at),
      shownResting(),
      shownAction(),
      advisorShownAt(at)
    ).cells
})
