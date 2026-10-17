import {
  advisorShownAt,
  currentScene,
  quest,
  reactionAt,
  shownAction,
  shownCaption,
  shownPhase,
  shownResting,
  type Animated,
  type Stage
} from './quest-state'
import { SCENE_ROWS, sceneCellsOf } from './scene'

// What each Raster the game owns draws on a tick: the spinner's scene in its render, and the band's pet.

export const stageOf = (columns: number): Stage => ({
  columns,
  rows: SCENE_ROWS,
  render: 'classic'
})

export const stageCellsOf = (stage: Stage): string =>
  sceneCellsOf(
    currentScene(),
    shownPhase(),
    stage.columns,
    quest.tick,
    shownCaption(),
    quest.isDemo ? quest.demoAt : quest.captionAt,
    reactionAt(quest.tick),
    shownResting(),
    shownAction(),
    advisorShownAt(quest.tick)
  ).cells

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
